// Boot, world upload, cinematic intro and the frame loop.
/* global WORKER_SOURCE */
import * as THREE from 'three';
import { clamp, lerp, ss, BASE, N, TR, LAKES, LK, PEAKS, CHANNELS, TRAILS } from './shared.js';
import { $, isTouch, renderer, scene, camera, U, Q, Qs, QUALITY, G, heightAt, groundAt, waterAt, cellOf } from './core.js';
import { buildSky, sky, sun, setTime, sky_state, applyShadowQuality, setSunBaker, buildWeather, updateWeather, thunderQueue, setWeather } from './atmos.js';
import { makeGroundTextures, buildTerrain, updateTerrainLOD, resetTerrainLOD, groundAlb } from './terrain.js';
import { buildWater, renderReflection } from './water.js';
import { buildVegetation, buildGrass, updatePools, applyVegQuality, grassMesh, flowerMesh } from './vegetation.js';
import { buildTrails } from './trails.js';
import { buildWildlife, updateWildlife, setSpotHandler, setAnimalSound, markSeen } from './wildlife.js';
import { P, updatePlayer, teleport, toggleFly, setPlayerHooks, keys } from './player.js';
import { buildPOIs, buildMapBase, initUI, updateUI, toggleMap, toast, spotted, closePanels, togglePhoto, setQualityUI, setSoundUI, updateHourTxt, placeAt, journalSpecies } from './ui.js';
import { setSound, updateAudio, animalSound, audioOn } from './audio.js';
import { render, resizePost } from './post.js';
import { NC } from './worldgen.js';

if (isTouch) document.body.classList.add('touch');
$('ctrlHelp').innerHTML = isTouch
  ? '<b>אגודל שמאל</b><span>הליכה (ג׳ויסטיק)</span><b>אגודל ימין</b><span>גרירה להסתכלות</span><b>רחיפה</b><span>מעוף מעל הפארק</span><b>מפה</b><span>קפיצה ליעדים ומסלולים מודרכים</span>'
  : '<b>W A S D</b><span>הליכה, Shift לריצה</span><b>עכבר</b><span>לחיצה על המסך ותזוזה להסתכלות</span><b>F</b><span>רחיפה מעל הפארק (רווח / C)</span><b>M · J · P</b><span>מפה ומסלולים · יומן שדה · מצב צילום</span>';
window.addEventListener('error', e => { $('err').textContent = 'שגיאה: ' + (e.message || e); });
const progEl = $('prog'), progTxt = $('progTxt');
const stage = (t, p) => { progTxt.textContent = t; progEl.style.width = p + '%'; };

let pixelRatio = Q().pr;
function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false); resizePost(); }
addEventListener('resize', resize);

// ---------------------------------------------------------------- world upload
let worker, sunTex, sunPending = false, sunWant = null;
const lastSun = new THREE.Vector3(9, 9, 9);
function requestSun(dir) {
  if (lastSun.distanceToSquared(dir) < 1e-5) return;
  lastSun.copy(dir);
  if (sunPending) { sunWant = dir.clone(); return; }
  sunPending = true; worker.postMessage({ type: 'sun', dir: [dir.x, dir.y, dir.z] });
}
function onWorld(r) {
  Object.assign(G, r.grids);
  r.lakes.forEach((l, i) => Object.assign(LAKES[i], l));
  r.channels.forEach((c, i) => { CHANNELS[i].path = c.path; CHANNELS[i].W = c.W; });
  r.trails.forEach((t, i) => { TRAILS[i].path = t.path; TRAILS[i].cum = t.cum; });
  const tex = (data, w, h, fmt, type, linear) => { const t = new THREE.DataTexture(data, w, h, fmt, type); t.minFilter = linear ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter; t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter; t.generateMipmaps = !!linear; t.needsUpdate = true; return t; };
  U.heightTex.value = tex(G.H, N, N, THREE.RedFormat, THREE.FloatType, false);
  U.biomeTex.value = tex(G.BIO, N, N, THREE.RGBAFormat, THREE.UnsignedByteType, true);
  U.trailTex.value = tex(G.TRL, TR, TR, THREE.RedFormat, THREE.UnsignedByteType, true);
  U.extra.value = tex(G.EXTRA, NC, NC, THREE.RGBAFormat, THREE.UnsignedByteType, true);
  sunTex = tex(new Uint8Array(NC * NC).fill(255), NC, NC, THREE.RedFormat, THREE.UnsignedByteType, true); U.sunVis.value = sunTex;
  makeGroundTextures(r.tex);
}

async function boot(saved) {
  try {
    resize();
    stage('מתחיל לבנות עולם…', 2);
    const res = await new Promise((resolve, reject) => {
      worker = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })));
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') stage(m.t, m.p);
        else if (m.type === 'done') resolve(m.r);
        else if (m.type === 'error') reject(new Error(m.message));
        else if (m.type === 'sun') { sunTex.image.data.set(m.vis); sunTex.needsUpdate = true; sunPending = false; if (sunWant) { const d = sunWant; sunWant = null; lastSun.set(9, 9, 9); requestSun(d); } }
      };
      worker.onerror = (e) => reject(new Error(e.message || 'worker error'));
      worker.postMessage({ type: 'gen', opts: { mobile: isTouch } });
    });
    stage('מעלה את העולם לכרטיס הגרפי…', 88); await frameYield();
    onWorld(res);
    setSunBaker(requestSun);
    setTime(saved.hour ?? 9.5);
    buildTerrain(); buildSky(); buildWeather();
    stage('בונה יערות ומים…', 91); await frameYield();
    buildWater(); buildTrails();
    buildVegetation(res.scatter, groundAlb()); buildGrass();
    stage('משחרר חיות בר…', 95); await frameYield();
    buildWildlife(); buildPOIs(); buildMapBase();
    setSpotHandler(spotted); setAnimalSound(animalSound); markSeen(journalSpecies());
    initUI({ onQuality: setQuality, onSound: (on) => setSound(on) });
    setQualityUI(Qs.name); setSoundUI(false); applyShadowQuality(); applyVegQuality();
    const B = LAKES[LK.bear], hall = PEAKS[1];
    if (saved.x !== undefined) { P.fly = !!saved.fly; document.body.classList.toggle('flying', P.fly); teleport(saved.x, saved.z); P.yaw = saved.yaw; P.pitch = saved.pitch; if (P.fly) P.y = saved.y; }
    else {
      // pick the shore spot whose view across the lake opens onto distant peaks rather than a near wall
      let best = null, bs = -1e9;
      for (let i = 0; i < 20; i++) {
        const an = i / 20 * Math.PI * 2, x = B.x + Math.cos(an) * 118, z = B.z + Math.sin(an) * 118;
        if (waterAt(x, z) !== null) continue;
        const dx = (B.x - x) / 118, dz = (B.z - z) / 118, h0 = heightAt(x, z) + 1.7;
        let near = -1, far = -1;
        for (let d = 150; d < 4000; d *= 1.15) { const a = (heightAt(x + dx * d, z + dz * d) - h0) / d; if (d < 600) near = Math.max(near, a); else far = Math.max(far, a); }
        let trees = 0; for (let d = 0; d < 60; d += 6) { const k = cellOf(x - dx * d * 0.3 + dx * d, z - dz * d * 0.3 + dz * d); trees += G.BIO[k * 4] / 255; }
        const sc = far - Math.max(0, near - far) * 2 - Math.abs(heightAt(x, z) - B.level) * 0.01 - trees * 0.15 - G.BIO[cellOf(x, z) * 4] / 255 * 0.5;
        if (sc > bs) { bs = sc; best = [x, z, B.x + dx * 1000, B.z + dz * 1000]; }
      }
      teleport(...best); P.pitch = 0.06;
    }
    intro.center.set((B.x + hall.x) / 2, 0, (B.z + hall.z) / 2); intro.center.y = heightAt(intro.center.x, intro.center.z);
    updatePools(intro.center.x, intro.center.z, true);
    stage('מוכן', 100);
    $('intro').classList.add('ready');
    $('startBtn').disabled = false;
    clock.getDelta(); requestAnimationFrame(frame);
    if (saved.x !== undefined) start(true);
  } catch (err) { console.error(err); $('err').textContent = 'לא ניתן היה לבנות את העולם: ' + err.message; }
}
const frameYield = () => new Promise(r => setTimeout(r, 30));

// ---------------------------------------------------------------- cinematic intro & handoff
const intro = { center: new THREE.Vector3(), t: 0, blend: -1, fromP: new THREE.Vector3(), fromQ: new THREE.Quaternion() };
let started = false;
function introCamera(dt) {
  intro.t += dt;
  // slow drone orbit over the Bear Lake basin, framed toward the high peaks
  const a = 0.35 + intro.t * 0.03, R = 1500, c = intro.center;
  const x = c.x + Math.cos(a) * R, z = c.z + Math.sin(a) * R * 0.8 - 500;
  camera.position.set(x, Math.max(heightAt(x, z) + 260, c.y + 620 + Math.sin(intro.t * 0.1) * 60), z);
  camera.lookAt(c.x - 150, c.y + 260, c.z + 250);
}
function start(instant) {
  if (started) return; started = true;
  $('intro').hidden = true; $('hud').hidden = false;
  if (!instant) { intro.blend = 0; intro.fromP.copy(camera.position); intro.fromQ.copy(camera.quaternion); P.inputLock = true; }
  const pl = placeAt(P.x, P.z, P.y + BASE); toast(pl.he, pl.en);
  $('c').focus();
}
$('startBtn').onclick = () => start(false);

// ---------------------------------------------------------------- quality
function setQuality(name) {
  Qs.name = name; pixelRatio = Q().pr; renderer.setPixelRatio(pixelRatio);
  setQualityUI(name); applyShadowQuality(); applyVegQuality(); resetTerrainLOD(); updatePools(P.x, P.z, true); resize();
}
setPlayerHooks({
  onFly: (on) => toast(on ? 'מצב רחיפה' : 'חזרה להליכה', on ? (isTouch ? 'הג׳ויסטיק נע לכיוון המבט · ריצה = מהיר' : 'רווח / C לגובה · Shift מהיר') : ''),
  onKey: (code) => {
    if (!started) return;
    if (code === 'KeyF') toggleFly();
    if (code === 'KeyM') toggleMap();
    if (code === 'KeyJ') $('bJournal').click();
    if (code === 'KeyP') togglePhoto(!document.body.classList.contains('photo'));
    if (code === 'KeyT') { setTime(sky_state.hour >= 20.5 ? 5.6 : Math.min(23.5, sky_state.hour + 1.5)); updateHourTxt(); }
    if (code === 'Escape') { closePanels(); togglePhoto(false); }
  },
});

// ---------------------------------------------------------------- frame loop
const clock = new THREE.Clock();
let frameAcc = 0, frames = 0, lodT = 0, lowFps = 0;
const _q = new THREE.Quaternion();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05), now = clock.elapsedTime;
  U.time.value = now;
  if (!started) introCamera(dt);
  else {
    updatePlayer(dt);
    if (intro.blend >= 0) {
      intro.blend = Math.min(1, intro.blend + dt / 2.8); const k = ss(0, 1, intro.blend);
      _q.copy(camera.quaternion); camera.position.lerpVectors(intro.fromP, camera.position, k); camera.quaternion.slerpQuaternions(intro.fromQ, _q, k);
      if (intro.blend >= 1) { intro.blend = -1; P.inputLock = false; }
    }
  }
  const cp = camera.position;
  U.cam.value.set(cp.x, cp.z);
  if (!started) U.player.value.set(1e6, 0, 1e6);
  lodT -= dt;
  if (lodT <= 0) { lodT = 0.2; updateTerrainLOD(cp.x, cp.y, cp.z); updatePools(cp.x, cp.z); }
  updateWildlife(dt, started ? P.x : cp.x, started ? P.z : cp.z, cp.y, now, started && intro.blend < 0);
  updateWeather(dt);
  sky.position.copy(cp);
  if (sun.castShadow) {
    const ts = (sun.shadow.camera.right * 2) / sun.shadow.mapSize.x, tx = Math.round(cp.x / ts) * ts, tz = Math.round(cp.z / ts) * ts, ty = cp.y;
    const ld = U.lightDir.value;
    sun.target.position.set(tx, ty, tz); sun.position.set(tx + ld.x * 700, ty + ld.y * 700, tz + ld.z * 700);
    sun.target.updateMatrixWorld(); renderer.shadowMap.needsUpdate = true;
  }
  if (Q().reflect) renderReflection(started ? P : { x: cp.x, z: cp.z, pitch: camera.rotation.x, yaw: camera.rotation.y }, pixelRatio, [grassMesh, flowerMesh]);
  render(dt);
  if (started) { updateUI(dt, now); updateAudio(dt, P, P.speed); }
  if (!audioOn()) thunderQueue.length = 0;
  // adaptive resolution, then quality
  frameAcc += dt; frames++;
  if (frameAcc > 2) {
    const avg = frameAcc / frames * 1000; frameAcc = 0; frames = 0;
    if (avg > 36 && pixelRatio > 0.65) { pixelRatio = Math.max(0.65, pixelRatio - 0.15); resize(); lowFps = 0; }
    else if (avg > 36) { if (++lowFps >= 2 && Qs.name !== 'low') { const order = ['low', 'medium', 'high', 'ultra']; setQuality(order[order.indexOf(Qs.name) - 1]); pixelRatio = Math.max(0.65, Q().pr - 0.3); resize(); lowFps = 0; } }
    else if (avg < 20 && pixelRatio < Q().pr) { pixelRatio = Math.min(Q().pr, pixelRatio + 0.1); resize(); }
  }
}

window.claude?.hot?.snapshot?.(() => ({ x: P.x, z: P.z, y: P.y, yaw: P.yaw, pitch: P.pitch, fly: P.fly, hour: sky_state.hour }));
window.claude?.hot?.ready ? window.claude.hot.ready(boot) : boot(window.claude?.hot?.data ?? {});
window.__park = { scene, pools: () => import('./vegetation.js').then(m => m.pools.map(p => [p.mesh.count, p.cap, p.mesh.visible, p.mesh.geometry.attributes.position.count])), P, setQuality, teleport, setTime, toggleFly, LAKES, PEAKS, start: () => start(true), setWeather, get stats() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; } };
