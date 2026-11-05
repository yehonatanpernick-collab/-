// ============================================================================
//  Game: post-processing, aircraft instance, cameras, scenarios, UI, main loop
// ============================================================================
const S = {
  state: 'loading', acId: 'fighter', scen: 'takeoff', time: 'sunset', wx: 'scattered', wind: 'light', quality: isTouch ? 'medium' : 'high',
  hudOn: true, cam: 'chase', groundH: 0, nearRunway: null, rings: null, ringIdx: 0, ringT: 0, t: 0, pendingLanding: null, lastCall: null,
};
try { const sv = JSON.parse(localStorage.getItem('rakia.prefs') || '{}'); for (const k of ['acId', 'scen', 'time', 'wx', 'wind', 'quality']) if (sv[k]) S[k] = sv[k]; if (sv.invert) Input.invert = true; } catch (e) { }
const savePrefs = () => { try { localStorage.setItem('rakia.prefs', JSON.stringify({ acId: S.acId, scen: S.scen, time: S.time, wx: S.wx, wind: S.wind, quality: S.quality, invert: Input.invert })); } catch (e) { } };

// ---------------------------------------------------------------- Post-processing
let composer, bloom, vignette;
function setupComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: S.quality === 'low' ? 0 : 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.92); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  vignette = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uAmt: { value: 0.35 }, uRed: { value: 0 }, uGrey: { value: 0 }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmt, uRed, uGrey, uTime; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d) * (1.0 + uGrey*0.8));
        c.rgb *= mix(1.0, v, uAmt + uGrey*0.6);
        float g = dot(c.rgb, vec3(0.299,0.587,0.114)); c.rgb = mix(c.rgb, vec3(g), uGrey*0.7);
        c.rgb = mix(c.rgb, c.rgb*vec3(1.2,0.25,0.2), uRed*smoothstep(0.15,0.7,length(d)));
        float lum = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
        c.rgb = mix(vec3(lum), c.rgb, 1.1);
        c.rgb = c.rgb * c.rgb * (3.0 - 2.0 * c.rgb) * 0.22 + c.rgb * 0.78;
        c.rgb *= mix(vec3(0.97,0.99,1.04), vec3(1.04,1.0,0.95), smoothstep(0.2, 0.9, lum));
        c.rgb += (h(vUv*1000.0+uTime)-0.5)*0.012;
        gl_FragColor = c; }` });
  composer.addPass(vignette);
}
const QUALITY = {
  low: { pr: 0.85, shadow: 0, bloom: false, view: 6, trees: 0.35 },
  medium: { pr: 1.4, shadow: 2048, bloom: true, view: 8, trees: 0.9 },
  high: { pr: 1.75, shadow: 4096, bloom: true, view: 10, trees: 1.35 },
  ultra: { pr: 2, shadow: 4096, bloom: true, view: 12, trees: 1.8 },
};
function applyQuality(rebuild = true) {
  const Q = QUALITY[S.quality];
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pr));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = Q.shadow > 0; sun.castShadow = Q.shadow > 0;
  if (Q.shadow) { sun.shadow.mapSize.set(Q.shadow, Q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  setupComposer(); bloom.enabled = Q.bloom;
  const changed = VIEW_R !== Q.view || TREE_DENSITY !== Q.trees; VIEW_R = Q.view; TREE_DENSITY = Q.trees;
  if (changed && rebuild) resetTerrain();
  terrainUniforms.uDetail.value = S.quality === 'low' ? 0 : 1;
}

// ---------------------------------------------------------------- Aircraft instance
let AC_I = null; // { def, fm, model, P, eye, cockpit, spot }
const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
function makeCockpit(def, model) {
  const g = new THREE.Group(); g.visible = false; model.root.add(g);
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 300; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const e = model.eye; const dark = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.8 });
  const shellMat = new THREE.MeshStandardMaterial({ color: def.id === 'airliner' ? 0x5d6066 : 0x2b2e33, roughness: 0.9, side: THREE.BackSide });
  let pw = 1.15, ph = 0.34, pz = -0.62;
  if (def.id === 'airliner') { pw = 1.9; ph = 0.5; pz = -0.95; }
  if (def.id === 'fighter') { pw = 0.62; ph = 0.2; pz = -0.62; }
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(0.85, 0.85, 0.85) }));
  const cxp = def.id === 'airliner' ? 0.55 : def.id === 'light' ? 0.18 : 0;
  panel.position.set(e.x + cxp, e.y - 0.36 - ph / 2 + 0.12, e.z + pz); panel.rotation.x = -0.25; g.add(panel);
  const glare = new THREE.Mesh(new THREE.BoxGeometry(pw * 1.15, 0.06, 0.32), dark); glare.position.set(panel.position.x, panel.position.y + ph / 2 + 0.04, panel.position.z - 0.08); g.add(glare);
  // lower cabin shell
  const sw = def.id === 'airliner' ? 3.6 : def.id === 'light' ? 1.15 : 0.95, sl = def.id === 'airliner' ? 4 : 2.2;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.8, sl), shellMat); shell.position.set(def.id === 'airliner' ? 0 : 0, e.y - 0.33 - 0.4, e.z + 0.2); g.add(shell);
  if (def.id === 'fighter') { const hudGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.17), new THREE.MeshBasicMaterial({ color: 0x8dffb8, transparent: true, opacity: 0.05, depthWrite: false })); hudGlass.position.set(e.x, e.y - 0.08, e.z - 0.6); hudGlass.rotation.x = -0.4; g.add(hudGlass); }
  return { g, cv, ctx: cv.getContext('2d'), tex, t: 0 };
}
function spawnAircraft(id) {
  if (AC_I) { scene.remove(AC_I.model.root); AC_I.model.root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  const def = AC[id]; const model = def.build();
  model.root.traverse(o => { if (o.material && o.material.isMeshStandardMaterial) o.material.envMapIntensity = (o.material.userData.envBase ?? 1) * (env.envScale ?? 1); });
  scene.add(model.root);
  const fm = new FlightModel(def);
  const spot = new THREE.SpotLight(0xfff2dd, 0, 900, 0.32, 0.5, 1.2); spot.position.copy(model.P.landLight); model.root.add(spot);
  const spT = new THREE.Object3D(); spT.position.copy(model.P.landLight).add(V3(0, -12, -80)); model.root.add(spT); spot.target = spT;
  const cockpit = makeCockpit(def, model);
  model.P.gear.forEach(g => { g.len0 = g.wheels.position.y; });
  AC_I = { def, fm, model, P: model.P, eye: model.eye, cockpit, spot, lights: true };
  Audio.setAircraft(def);
  vaporL.clear(); vaporR.clear(); contrails.forEach(c => c.clear());
  return AC_I;
}

function trimFor(def, V, alt, flapIdx) {
  const rho = 1.225 * Math.exp(-alt / 8500); const CL = def.mass * G0 / (0.5 * rho * V * V * def.S);
  return clamp((CL - def.CL0 - def.flaps.dCL[flapIdx]) / def.CLa, -0.05, 0.25);
}
function placeAir(fm, pos, hdg, V, flap, gammaDeg = 0) {
  const a = trimFor(fm.d, V, pos.y, flap); fm.flap = flap; fm.flapPos = flap;
  fm.place(pos, hdg, V, a * RAD + gammaDeg);
  // velocity along flight path, not the nose
  fm.vel.set(Math.sin(hdg * DEG) * Math.cos(gammaDeg * DEG), Math.sin(gammaDeg * DEG), -Math.cos(hdg * DEG) * Math.cos(gammaDeg * DEG)).multiplyScalar(V);
}

// ---------------------------------------------------------------- Scenarios
const SCEN = {
  takeoff: { name: 'המראה — נמל צוק הים', sub: 'מסלול 36 · 3,400 מ׳', code: 'TZK 36' },
  approach: { name: 'נחיתה — גישה סופית', sub: '9 ק״מ, שביל גלישה 3°', code: 'ILS 36' },
  carrier: { name: 'שיגור מנושאת מטוסים', sub: 'קטפולטה בלב הים', code: 'CVN' },
  trap: { name: 'נחיתה על נושאת מטוסים', sub: 'וו נחיתה, כבל מספר 3', code: 'TRAP' },
  mountain: { name: 'שדה הרים', sub: 'מסלול קצר בין פסגות', code: 'HRM 03' },
  rings: { name: 'מסלול טבעות בעמקים', sub: '14 טבעות, נגד השעון', code: 'RACE' },
  free: { name: 'טיסה חופשית', sub: 'באוויר מעל החוף', code: 'FREE' },
};
function startScenario() {
  const ac = spawnAircraft(S.acId); const fm = ac.fm; const d = ac.def;
  S.rings = null; ringGroup.clear(); S.pendingLanding = null; S.cat = null; fm.parking = false;
  smoke.clear(); fire.clear(); clearDebris(); S.crashT = null; S.landShown = false; S.maxAgl = 0;
  const gy = -d.gear[1].p.y + 0.02;
  const rwStart = (ap, back) => { const r = runwayInfo.find(x => x.ap === ap); const p = r.thr.clone().addScaledVector(r.dir, back); p.y = ap.elev + gy; fm.place(p, ap.hdg, 0); fm.n = d.engine.idle; fm.parking = true; };
  switch (S.scen) {
    case 'takeoff': rwStart(AIRPORTS[0], d.id === 'airliner' ? 70 : 90); toast(`שחרר בלם חניה P · מצערת Shift · סיבוב ב-${Math.round((d.vRef * 0.95) * KT)} קשר`, 6); break;
    case 'mountain': rwStart(AIRPORTS[1], 40); toast('מסלול קצר — מדפים F לפני ההמראה', 5); break;
    case 'approach': {
      const ap = AIRPORTS[0]; const r = runwayInfo[0]; const dist = d.id === 'light' ? 5000 : 9000;
      const p = r.thr.clone().addScaledVector(r.dir, -dist); p.y = ap.elev + dist * Math.tan(3 * DEG) + 18;
      const fl = d.id === 'airliner' ? 3 : d.id === 'light' ? 2 : 1; const V = d.vRef * (d.id === 'light' ? 1.15 : 1.12);
      placeAir(fm, p, ap.hdg, V, fl, -3); fm.in.throttle = d.id === 'light' ? 0.12 : 0.33; fm.n = fm.in.throttle;
      toast('עקוב אחר שביל הגלישה (PAPI: 2 לבן 2 אדום) · גע בעדינות', 6); break;
    }
    case 'carrier': {
      const C = WORLD.carrier; const p = V3(C.x - 2, C.deck + gy, C.z - 40);
      fm.place(p, 0, 0); fm.n = d.engine.idle; fm.cat = { state: 'hold', t: 0, accel: Math.pow(d.vRef * 1.18, 2) / (2 * 118) }; S.cat = fm.cat;
      toast('Enter — שיגור קטפולטה (המצערת תוגבר אוטומטית)', 7); break;
    }
    case 'trap': {
      const C = WORLD.carrier; const dist = 4200; const p = V3(C.x - 2, C.deck + dist * Math.tan(3.5 * DEG) + 6, C.z + 92 + dist);
      placeAir(fm, p, 0, d.vRef * (d.id === 'airliner' ? 1.1 : 1.0), d.id === 'airliner' ? 4 : d.id === 'light' ? 3 : 1, -3.5);
      fm.in.throttle = d.id === 'light' ? 0.12 : d.id === 'fighter' ? 0.36 : 0.33; fm.n = fm.in.throttle; fm.hook = !!d.hook; fm.hookPos = fm.hook ? 1 : 0;
      toast(d.hook ? 'וו נחיתה למטה (K) · כוון ל"כדור" הירוק · מצערת מלאה במגע!' : 'אין וו נחיתה למטוס הזה — בהצלחה…', 7); break;
    }
    case 'rings': {
      const p = V3(0, 520, -600); placeAir(fm, p, 0, d.vCruise * 0.8, 0, 0); fm.in.throttle = d.id === 'fighter' ? 0.8 : 0.75; fm.n = fm.in.throttle;
      if (d.retract) { fm.gearDown = false; fm.gearPos = 0; }
      S.rings = buildRings(Math.max(22, d.b * 1.6)); S.ringIdx = 0; S.ringT = 0; toast('עבור דרך כל הטבעות לפי הסדר', 5); break;
    }
    case 'free': default: {
      const p = V3(-5200, 1150, 7000); placeAir(fm, p, 40, d.vCruise * 0.85, 0, 0); fm.in.throttle = d.id === 'fighter' ? 0.78 : 0.72; fm.n = fm.in.throttle;
      if (d.retract) { fm.gearDown = false; fm.gearPos = 0; }
      toast('מפרץ אלמוג — העיר במזרח, ההרים בצפון, הנושאת במערב', 6);
    }
  }
  if (Input.setTouchThrottle) Input.setTouchThrottle(fm.in.throttle);
  ac.model.root.visible = true;
  syncModel(0);
  S.state = 'fly'; S.t = 0; resetCamera();
  updateTerrain(fm.pos.x, fm.pos.z, 0, true);
}

// ---------------------------------------------------------------- UI
let toastT = 0;
function toast(t, dur = 2.5) { const el = $('toast'); el.textContent = t; el.classList.add('show'); toastT = dur; }
function buildMenu() {
  const planes = $('planes'); planes.innerHTML = '';
  for (const id of ['fighter', 'light', 'airliner']) {
    const d = AC[id]; const b = document.createElement('button'); b.className = 'plane' + (S.acId === id ? ' on' : ''); b.id = 'pl-' + id;
    b.innerHTML = `<span><span class="nm">${d.name}</span><span class="role">${d.role} · <span class="num">${d.spec.vmax}</span></span></span>`;
    b.onclick = () => { S.acId = id; savePrefs(); buildMenu(); menuPreview(); }; planes.appendChild(b);
  }
  const sc = $('scen'); sc.innerHTML = '';
  for (const [k, v] of Object.entries(SCEN)) { const b = document.createElement('button'); b.className = 'opt' + (S.scen === k ? ' on' : ''); b.id = 'sc-' + k; b.innerHTML = `<span><div>${v.name}</div><small>${v.sub}</small></span>`; b.onclick = () => { S.scen = k; savePrefs(); buildMenu(); }; sc.appendChild(b); }
  const seg = (id, opts, key, after) => { const el = $(id); el.innerHTML = ''; for (const [k, label] of opts) { const b = document.createElement('button'); b.textContent = label; b.className = S[key] === k ? 'on' : ''; b.onclick = () => { S[key] = k; savePrefs(); buildMenu(); after && after(); }; el.appendChild(b); } };
  seg('segTime', [['dawn', 'זריחה'], ['noon', 'צהריים'], ['sunset', 'שקיעה'], ['night', 'לילה']], 'time', () => applyConditions(S.time, S.wx));
  seg('segWx', [['clear', 'בהיר'], ['scattered', 'עננים'], ['overcast', 'מעונן']], 'wx', () => applyConditions(S.time, S.wx));
  seg('segWind', [['calm', 'שקט'], ['light', 'קלה'], ['strong', 'חזקה']], 'wind');
  seg('segQ', [['low', 'נמוכה'], ['medium', 'בינונית'], ['high', 'גבוהה'], ['ultra', 'אולטרה']], 'quality', () => applyQuality(true));
  const inv = $('segInv'); inv.innerHTML = ''; [[false, 'רגיל (S מושך)'], [true, 'הפוך']].forEach(([v, l]) => { const b = document.createElement('button'); b.textContent = l; b.className = Input.invert === v ? 'on' : ''; b.onclick = () => { Input.invert = v; savePrefs(); buildMenu(); }; inv.appendChild(b); });
}
const KEYS_HELP = [
  ['בטלפון', 'ג׳ויסטיק · מצערת · עוד'],
  ['גובה (אף למעלה / למטה)', 'S / W · ↓ / ↑'], ['גלגול', 'A / D · ← / →'], ['הגה כיוון וגלגל אף', 'Q / E'], ['מצערת', 'Shift / Ctrl · + / −'], ['מצערת סרק / מלאה', 'End / Home'],
  ['גלגלי נחיתה', 'G'], ['מדפים הורדה / הרמה', 'F / R'], ['בלמים (החזק)', 'Space / B'], ['בלם חניה', 'P'], ['בלם אוויר / ספוילרים', 'X'], ['דחף הפוך (על הקרקע)', 'N'],
  ['טרים', '[ / ]'], ['טייס אוטומטי', 'Z'], ['וו נחיתה', 'K'], ['שיגור קטפולטה', 'Enter'], ['אורות', 'L'],
  ['מצלמה (רדיפה, תא טייס, מסלול, חלוף, מגדל)', 'C · 1–5'], ['סיבוב מבט / זום', 'גרירת עכבר · גלגלת'], ['HUD · מפה · קול', 'H · M · T'], ['השהיה', 'Esc'],
];
function fillKeys() { $('keysList').innerHTML = KEYS_HELP.map(([a, b]) => `<span>${a}</span><span>${b.split(' · ').map(x => `<span class="kbd">${x}</span>`).join(' ')}</span>`).join(''); }
function showDialog(id, on) { $(id).classList.toggle('hidden', !on); }
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.dialog').classList.add('hidden'));

function setFlightUI(on) {
  $('panel').classList.toggle('hidden', !on); $('minimapWrap').classList.toggle('hidden', !on); $('topright').classList.toggle('hidden', !on);
  $('touch').classList.toggle('on', on && isTouch); $('menu').classList.toggle('hidden', on);
}
function goMenu() {
  S.state = 'menu'; ['dlgPause', 'dlgCrash', 'dlgLand'].forEach(d => showDialog(d, false)); setFlightUI(false); buildMenu(); menuPreview();
}
function menuPreview() {
  const ac = spawnAircraft(S.acId); const ap = AIRPORTS[0]; const r = runwayInfo[0];
  const p = r.thr.clone().addScaledVector(r.dir, 260).add(V3(0, 0, 0)); p.y = ap.elev - ac.def.gear[1].p.y - 0.02;
  ac.fm.place(p, ap.hdg + 0, 0); ac.fm.n = 0.25; syncModel(0); smoke.clear(); fire.clear(); clearDebris();
  S.menuT = 0; updateTerrain(p.x, p.z, 0, true);
}
$('btnFly').onclick = () => { Audio.init(); savePrefs(); setFlightUI(true); startScenario(); };
$('btnKeys').onclick = () => { fillKeys(); showDialog('dlgKeys', true); };
$('pResume').onclick = () => togglePause(false);
$('pRestart').onclick = () => { showDialog('dlgPause', false); startScenario(); };
$('pMenu').onclick = () => goMenu();
$('cRestart').onclick = () => { showDialog('dlgCrash', false); startScenario(); };
$('cMenu').onclick = () => goMenu();
$('lContinue').onclick = () => { showDialog('dlgLand', false); S.state = 'fly'; };
$('lRestart').onclick = () => { showDialog('dlgLand', false); startScenario(); };
$('tbCam').onclick = () => Input.fire('camera'); $('tbHud').onclick = () => Input.fire('hud'); $('tbSnd').onclick = () => Input.fire('sound'); $('tbMenu').onclick = () => togglePause(true);
$('minimapWrap').onclick = () => Input.fire('map');
$('tbFull').onclick = () => { try { const d = document; (d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen()).catch(() => toast('מסך מלא לא זמין כאן')); } catch (e) { toast('מסך מלא לא זמין כאן'); } };
function togglePause(on) { if (S.state !== 'fly' && S.state !== 'paused') return; S.state = on ? 'paused' : 'fly'; showDialog('dlgPause', on); }

// ---------------------------------------------------------------- Actions
const fmA = () => AC_I && AC_I.fm;
const flying = () => S.state === 'fly' && fmA() && !fmA().crashed;
Input.on('gear', () => { const f = fmA(); if (!flying() || !f.d.retract) { if (flying()) toast('גלגלים קבועים'); return; } if (f.wow && f.gearDown) { toast('לא ניתן לאסוף גלגלים על הקרקע'); return; } f.gearDown = !f.gearDown; Audio.motor(4); toast(f.gearDown ? 'גלגלים — למטה' : 'גלגלים — למעלה'); });
Input.on('flapDown', () => { const f = fmA(); if (!flying()) return; f.flap = Math.min(f.flap + 1, f.d.flaps.dCL.length - 1); Audio.motor(1.2); toast(`מדפים ${f.d.flaps.label[f.flap]}`); });
Input.on('flapUp', () => { const f = fmA(); if (!flying()) return; f.flap = Math.max(f.flap - 1, 0); Audio.motor(1.2); toast(`מדפים ${f.d.flaps.label[f.flap]}`); });
Input.on('parking', () => { const f = fmA(); if (!flying()) return; f.parking = !f.parking; toast(f.parking ? 'בלם חניה — מופעל' : 'בלם חניה — משוחרר'); });
Input.on('speedbrake', () => { const f = fmA(); if (!flying()) return; f.spoilers = f.spoilers > 0 ? 0 : 1; toast(f.spoilers ? (f.d.id === 'airliner' ? 'ספוילרים — פתוחים' : 'בלם אוויר — פתוח') : 'בלם אוויר — סגור'); });
Input.on('reverse', () => { const f = fmA(); if (!flying()) return; if (!f.d.engine.rev) { toast('אין דחף הפוך במטוס זה'); return; } f.reverse = !f.reverse; toast(f.reverse ? 'דחף הפוך — מוכן' : 'דחף הפוך — כבוי'); });
Input.on('lights', () => { if (!AC_I) return; AC_I.lights = !AC_I.lights; toast(AC_I.lights ? 'אורות — דולקים' : 'אורות — כבויים'); });
Input.on('autopilot', () => { const f = fmA(); if (!flying()) return; if (f.ap) { f.ap = null; Audio.beep(520, 0.25, 0.12, 3); toast('טייס אוטומטי — מנותק'); } else if (!f.wow) { f.engageAP(); Audio.beep(900, 0.08, 0.1); toast('טייס אוטומטי — גובה, כיוון ומהירות נעולים'); } });
Input.on('hook', () => { const f = fmA(); if (!flying()) return; if (!f.d.hook) { toast('אין וו נחיתה'); return; } f.hook = !f.hook; toast(f.hook ? 'וו נחיתה — למטה' : 'וו נחיתה — למעלה'); if (!f.hook && f.caught) f.caught = false; });
Input.on('enter', () => {
  if (S.state === 'crashed' || !$('dlgCrash').classList.contains('hidden')) { showDialog('dlgCrash', false); startScenario(); return; }
  const f = fmA(); if (!flying()) return;
  if (f.cat && f.cat.state === 'hold') { f.in.throttle = 1; f.parking = false; toast('שיגור!'); setTimeout(() => { if (f.cat) { f.cat.state = 'fire'; f.cat.t = 0; Audio.burst(1.5, 500, 0.6, 'lowpass'); } }, 1100); }
});
const CAMS = ['chase', 'cockpit', 'orbit', 'flyby', 'tower'];
const CAM_NAMES = { chase: 'מצלמת רדיפה', cockpit: 'תא טייס', orbit: 'מסלול חופשי', flyby: 'חלוף', tower: 'מגדל פיקוח' };
function setCam(c) { S.cam = c; Input.look.yaw = 0; Input.look.pitch = 0; toast(CAM_NAMES[c], 1.4); S.flyby = null; }
Input.on('camera', () => { if (S.state === 'fly') setCam(CAMS[(CAMS.indexOf(S.cam) + 1) % CAMS.length]); });
['cam1', 'cam2', 'cam3', 'cam4', 'cam5'].forEach((k, i) => Input.on(k, () => { if (S.state === 'fly') setCam(CAMS[i]); }));
Input.on('hud', () => { S.hudOn = !S.hudOn; });
Input.on('map', () => { if (S.state === 'fly') $('minimapWrap').classList.toggle('big'); });
Input.on('pause', () => { if (!$('dlgKeys').classList.contains('hidden')) { showDialog('dlgKeys', false); return; } if (S.state === 'fly') togglePause(true); else if (S.state === 'paused') togglePause(false); });
Input.on('sound', () => { Audio.init(); Audio.on = !Audio.on; toast(Audio.on ? 'קול — פועל' : 'קול — מושתק'); });
Input.on('trimUp', () => { const f = fmA(); if (!flying()) return; f.trim = clamp(f.trim + 0.004, -0.08, 0.08); });
Input.on('trimDown', () => { const f = fmA(); if (!flying()) return; f.trim = clamp(f.trim - 0.004, -0.08, 0.08); });
Input.on('idle', () => { const f = fmA(); if (flying()) f.in.throttle = 0; });
Input.on('fullThrottle', () => { const f = fmA(); if (flying()) f.in.throttle = f.d.engine.ab ? 0.9 : 1; });
Input.on('help', () => { fillKeys(); showDialog('dlgKeys', true); });

// ---------------------------------------------------------------- Model sync
function syncModel(dt) {
  const { fm, P, model, def } = AC_I; const root = model.root;
  root.position.copy(fm.pos); root.quaternion.copy(fm.q);
  const s = fm.surf; const flapA = fm.flapPos / Math.max(1, def.flaps.dCL.length - 1) * (def.id === 'fighter' ? 0.35 : 0.7);
  const eMax = P.elevScale ? 0.3 : 0.42;
  P.elevL && P.elevL.set(-s.e * eMax); P.elevR && P.elevR.set(-s.e * eMax);
  P.rud && P.rud.set(s.r * 0.42);
  P.ailL && P.ailL.set(s.a * 0.35 + (P.flaperon ? flapA : 0)); P.ailR && P.ailR.set(-s.a * 0.35 + (P.flaperon ? flapA : 0));
  P.flapL && P.flapL.set(flapA); P.flapR && P.flapR.set(flapA);
  if (P.spoil) P.spoil.forEach((sp, i) => { const rollAssist = i === 1 ? Math.max(0, s.a) : Math.max(0, -s.a); sp.set(-(Math.max(fm.spoilerPos, rollAssist * 0.5)) * 0.85); });
  if (P.spd) P.spd.forEach(sb => { sb.piv.rotation.y = sb.s * fm.spoilerPos * 0.9; });
  if (P.hook) P.hook.rotation.x = lerp(-1.45, -0.5, fm.hookPos);
  // gear
  P.gear.forEach((g, i) => {
    const C = fm.contacts[i]; const ext = def.retract ? fm.gearPos : 1;
    _q.setFromAxisAngle(g.foldAxis, g.foldAngle * (1 - smoothstep(0, 1, ext)));
    if (g.steer && fm.wow) { const sf = lerp(1, 0.12, smoothstep(5, 35, fm.tele.gs || 0)); g.grp.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), -fm.in.yaw * def.gear[i].steer * sf)); } else g.grp.quaternion.copy(_q);
    g.grp.visible = ext > 0.03;
    g.wheels.position.y = g.len0 + Math.min(C.pen || 0, def.gearTravel);
    const sp = (C.on ? C.spin : (g.lastSpin || 0) * Math.exp(-dt * 0.4)); g.lastSpin = sp;
    g.spin.forEach(w => { w.rotation.x -= sp / g.r * dt; });
  });
  // propeller / fans / flame
  if (P.prop) { const rps = (fm.crashed ? 0 : fm.rpm || 0) / 60; P.prop.group.rotation.z += rps * Math.PI * 2 * dt * 0.97; const blur = smoothstep(500, 1600, fm.rpm || 0); P.prop.disc.material.opacity = blur * P.prop.maxBlur; P.prop.group.children.forEach(b => b.visible = blur < 0.9 || Math.random() < 0.4); }
  if (P.fans) P.fans.forEach(f => { f.rotation.z += (fm.crashed ? 0 : 6 + fm.n * 80) * dt; });
  if (P.flame) { flameMat.uniforms.uAB.value = fm.crashed ? 0 : fm.ab; flameMat.uniforms.uPow.value = fm.crashed ? 0 : fm.n; flameMat.uniforms.uTime.value += dt; P.flame.forEach((f, i) => { f.visible = fm.ab > 0.02 || fm.n > 0.5; f.scale.set(1, 1, 0.6 + fm.ab * 0.5 + Math.sin(S.t * 40 + i) * 0.03); }); P.nozzleGlow.material.color.setRGB(0.25 + fm.ab * 3, 0.08 + fm.ab * 1.2, 0.02 + fm.ab * 0.3); }
  // lights
  const night = TIMES[S.time].night; const on = AC_I.lights;
  const tt = S.t; const strobe = on && ((tt % 1.2) < 0.06 || ((tt % 1.2) > 0.14 && (tt % 1.2) < 0.2));
  P.nav.forEach(n => { n.visible = on; n.material.opacity = 0.4 + night * 0.6; });
  P.strobe.forEach(n => { n.visible = strobe; n.scale.setScalar((def.id === 'airliner' ? 3.5 : 2) * (0.6 + night)); });
  if (P.beacon) P.beacon.forEach((b, i) => { b.visible = on && Math.sin(tt * 6.3 + i * Math.PI) > 0.6; });
  AC_I.spot.intensity = on && (fm.gearPos > 0.5) ? 900 * (0.15 + night) : 0;
}

// ---------------------------------------------------------------- Cameras
const camState = { pos: new THREE.Vector3(), offset: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), shake: 0, fov: 62 };
function resetCamera() { const fm = AC_I.fm; const back = V3(0, 0, 1).applyQuaternion(fm.q); back.y = 0; back.normalize(); camState.offset.copy(back.multiplyScalar(AC_I.def.cam.dist)).add(V3(0, AC_I.def.cam.height, 0)); camState.up.set(0, 1, 0); }
function updateCamera(dt) {
  const { fm, def, model } = AC_I; const att = fm.tele.att || fm.attitude(); const L = Input.look;
  const inCockpit = S.cam === 'cockpit'; AC_I.cockpit.g.visible = inCockpit;
  camera.near = inCockpit ? 0.08 : 0.5;
  let fov = 62;
  const shake = camState.shake; camState.shake = Math.max(0, shake - dt * 2.5);
  const sh = () => (Math.random() - 0.5) * shake;
  if (S.cam === 'chase') {
    const fwd = V3(0, 0, -1).applyQuaternion(fm.q);
    const velDir = fm.vel.lengthSq() > 25 ? fm.vel.clone().normalize() : fwd;
    const dir = fwd.clone().lerp(velDir, 0.35).normalize();
    const dist = def.cam.dist * L.zoom * (1 + clamp((fm.tele.V || 0) / 600, 0, 0.3));
    const back = dir.clone().multiplyScalar(-dist);
    const upA = V3(0, 1, 0).applyQuaternion(fm.q);
    const target = back.add(upA.clone().lerp(V3(0, 1, 0), 0.5).normalize().multiplyScalar(def.cam.height * L.zoom));
    target.applyAxisAngle(V3(0, 1, 0), L.yaw);
    camState.offset.lerp(target, 1 - Math.exp(-dt * 5));
    camera.position.copy(fm.pos).add(camState.offset);
    const g = groundAt(camera.position.x, camera.position.z).h; if (camera.position.y < g + 1.5) camera.position.y = g + 1.5;
    camState.up.lerp(upA.clone().lerp(V3(0, 1, 0), 0.75).normalize(), 1 - Math.exp(-dt * 3));
    camera.up.copy(camState.up);
    camera.lookAt(fm.pos.clone().addScaledVector(fwd, def.b * 0.3).add(V3(0, def.cam.height * 0.25, 0)));
    camera.position.add(V3(sh(), sh(), sh()).multiplyScalar(0.3));
    fov = 60 + clamp(((fm.tele.V || 0) - 60) / 25, 0, 14);
  } else if (inCockpit) {
    const eye = AC_I.eye.clone().applyQuaternion(fm.q).add(fm.pos);
    // head moves with G
    const gOff = V3(0, -clamp((fm.nz - 1) * 0.012, -0.05, 0.08), 0).applyQuaternion(fm.q);
    camera.position.copy(eye).add(gOff).add(V3(sh(), sh(), sh()).multiplyScalar(0.02));
    camera.quaternion.copy(fm.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(L.pitch - 0.06, L.yaw, 0, 'YXZ')));
    camera.up.set(0, 1, 0).applyQuaternion(fm.q);
    fov = 68 / L.zoom;
  } else if (S.cam === 'orbit') {
    const r = def.cam.dist * 1.3 * L.zoom; const yaw = L.yaw + S.t * 0.0, pit = clamp(L.pitch + 0.25, -1.4, 1.4);
    camera.position.copy(fm.pos).add(V3(Math.sin(yaw) * Math.cos(pit) * r, Math.sin(pit) * r, Math.cos(yaw) * Math.cos(pit) * r));
    const g = groundAt(camera.position.x, camera.position.z).h; if (camera.position.y < g + 1.5) camera.position.y = g + 1.5;
    camera.up.set(0, 1, 0); camera.lookAt(fm.pos);
  } else if (S.cam === 'flyby') {
    if (!S.flyby || S.flyby.distanceTo(fm.pos) > def.b * 40 + 300) {
      const ahead = fm.vel.lengthSq() > 4 ? fm.vel.clone().normalize() : V3(0, 0, -1).applyQuaternion(fm.q);
      const side = V3(-ahead.z, 0, ahead.x).normalize();
      S.flyby = fm.pos.clone().addScaledVector(ahead, Math.max(60, (fm.tele.V || 0) * 4)).addScaledVector(side, def.b * 1.6 + 12).add(V3(0, def.b * 0.3 - 2, 0));
      const g = groundAt(S.flyby.x, S.flyby.z).h; S.flyby.y = Math.max(S.flyby.y, g + 2);
    }
    camera.position.copy(S.flyby); camera.up.set(0, 1, 0); camera.lookAt(fm.pos);
    fov = clamp(2 * Math.atan(def.b * 1.5 / Math.max(1, camera.position.distanceTo(fm.pos))) * RAD, 8, 70);
  } else if (S.cam === 'tower') {
    let best = AIRPORTS[0]; let bd = Infinity; for (const a of AIRPORTS) { const d2 = a.tower.distanceTo(fm.pos); if (d2 < bd) { bd = d2; best = a; } }
    camera.position.copy(best.tower); camera.up.set(0, 1, 0); camera.lookAt(fm.pos);
    fov = clamp(2 * Math.atan(def.b * 2.5 / Math.max(1, bd)) * RAD, 1.5, 60) / L.zoom;
  }
  camState.fov = damp(camState.fov, fov, 4, dt); camera.fov = camState.fov; camera.updateProjectionMatrix();
  // model visible except in cockpit for fighter canopy? keep visible
  model.root.visible = !fm.crashed || false;
}

// ---------------------------------------------------------------- Cockpit panel
function drawPanel(fm, cp) {
  const c = cp.ctx, W = cp.cv.width, H = cp.cv.height; const T = fm.tele; if (!T.att) return;
  c.fillStyle = '#16191d'; c.fillRect(0, 0, W, H);
  const id = fm.d.id;
  const dial = (x, y, r, label, val, min, max, fmt, arcs) => {
    c.save(); c.translate(x, y); c.fillStyle = '#0b0c0e'; c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill(); c.strokeStyle = '#555'; c.lineWidth = 4; c.stroke();
    const a0 = -Math.PI * 1.25, a1 = Math.PI * 0.25; const A = (v) => lerp(a0, a1, clamp((v - min) / (max - min), 0, 1));
    if (arcs) for (const [f, t, col] of arcs) { c.strokeStyle = col; c.lineWidth = 7; c.beginPath(); c.arc(0, 0, r - 8, A(f), A(t)); c.stroke(); }
    c.strokeStyle = '#ddd'; c.lineWidth = 2; for (let i = 0; i <= 10; i++) { const a = lerp(a0, a1, i / 10); c.beginPath(); c.moveTo(Math.cos(a) * (r - 4), Math.sin(a) * (r - 4)); c.lineTo(Math.cos(a) * (r - 16), Math.sin(a) * (r - 16)); c.stroke(); }
    c.fillStyle = '#ccc'; c.font = '600 15px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.fillText(label, 0, r * 0.45); c.font = '700 20px "IBM Plex Mono", monospace'; c.fillText(fmt(val), 0, r * 0.75);
    const a = A(val); c.strokeStyle = '#fff'; c.lineWidth = 4; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * (r - 14), Math.sin(a) * (r - 14)); c.stroke(); c.fillStyle = '#333'; c.beginPath(); c.arc(0, 0, 7, 0, 7); c.fill();
    c.restore();
  };
  const adi = (x, y, r) => {
    c.save(); c.translate(x, y); c.beginPath(); c.arc(0, 0, r, 0, 7); c.clip();
    c.rotate(-T.att.roll); const off = T.att.pitch * RAD * r / 30;
    c.fillStyle = '#2f7bd0'; c.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2); c.fillStyle = '#7a4a22'; c.fillRect(-r * 2, off, r * 4, r * 2);
    c.strokeStyle = '#fff'; c.lineWidth = 2; for (let p = -20; p <= 20; p += 10) { if (!p) continue; const yy = off - p * r / 30; c.beginPath(); c.moveTo(-r * 0.25, yy); c.lineTo(r * 0.25, yy); c.stroke(); }
    c.beginPath(); c.moveTo(-r * 2, off); c.lineTo(r * 2, off); c.stroke(); c.restore();
    c.save(); c.translate(x, y); c.strokeStyle = '#ffb23f'; c.lineWidth = 5; c.beginPath(); c.moveTo(-r * 0.55, 0); c.lineTo(-r * 0.15, 0); c.lineTo(0, r * 0.12); c.lineTo(r * 0.15, 0); c.lineTo(r * 0.55, 0); c.stroke(); c.strokeStyle = '#555'; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, r, 0, 7); c.stroke(); c.restore();
  };
  const r = H * 0.36, y = H * 0.5;
  const xs = id === 'fighter' ? [W * 0.2, W * 0.5, W * 0.8] : [W * 0.09, W * 0.255, W * 0.42, W * 0.585, W * 0.75, W * 0.915];
  if (id === 'fighter') {
    dial(xs[0], y, r, 'KIAS', T.ias * KT, 0, 800, v => Math.round(v)); adi(xs[1], y, r); dial(xs[2], y, r, 'RPM %', fm.n * 100 + fm.ab * 10, 0, 110, v => Math.round(v), [[90, 110, '#e8762a']]);
  } else {
    const vso = fm.d.vRef * KT / 1.3;
    dial(xs[0], y, r, 'KNOTS', T.ias * KT, 0, id === 'airliner' ? 400 : 180, v => Math.round(v), [[vso, vso * 1.9, '#3fbf5a'], [vso * 1.9, vso * 2.6, '#e0c040']]);
    adi(xs[1], y, r);
    dial(xs[2], y, r, 'ALT FT', (fm.pos.y * FT) % 1000, 0, 1000, () => String(Math.round(fm.pos.y * FT / 10) * 10));
    dial(xs[3], y, r, 'HDG', T.att.hdg, 0, 360, v => String(Math.round(v)).padStart(3, '0'));
    dial(xs[4], y, r, 'VS ×100', fm.vel.y * FPM / 100, -20, 20, v => (v >= 0 ? '+' : '') + v.toFixed(1));
    dial(xs[5], y, r, id === 'light' ? 'RPM' : 'N1 %', id === 'light' ? (fm.rpm || 0) : fm.n * 100, 0, id === 'light' ? 2800 : 105, v => Math.round(v), id === 'light' ? [[2100, 2700, '#3fbf5a']] : null);
  }
  cp.tex.needsUpdate = true;
}

// ---------------------------------------------------------------- Runway proximity, warnings, landing scoring
function analyzeRunway(fm) {
  let best = null;
  for (const r of runwayInfo) {
    const rel = fm.pos.clone().sub(r.thr); const along = -rel.dot(r.dir); // distance before threshold (positive on approach)
    const cross = rel.x * r.dir.z - rel.z * r.dir.x; // lateral
    const dist = Math.hypot(rel.x, rel.z);
    if (!best || dist < best.dist) {
      const h = fm.pos.y + fm.d.gear[1].p.y - r.ap.elev;
      const gsAngle = Math.atan2(h, Math.max(along, 1)) * RAD; const locAngle = Math.atan2(cross, Math.max(along, 1)) * RAD;
      const hd = fm.tele.att ? Math.abs(wrapPi((fm.tele.att.hdg - r.ap.hdg) * DEG)) * RAD : 180;
      best = { r, dist, along, cross: -cross, gsDev: gsAngle - 3, locDev: -locAngle, onApp: along > 200 && along < 20000 && hd < 35 && Math.abs(locAngle) < 10 };
    }
  }
  // carrier as a runway for the HUD
  return best;
}
function gradeLanding(L) {
  const fpm = L.vs * FPM; let g, t;
  if (fpm < 100) { g = 'A+'; t = 'נחיתת חמאה!'; } else if (fpm < 220) { g = 'A'; t = 'נחיתה מצוינת'; } else if (fpm < 380) { g = 'B'; t = 'נחיתה טובה'; } else if (fpm < 560) { g = 'C'; t = 'נחיתה קשה'; } else { g = 'D'; t = 'נחיתה קשה מאוד'; }
  if (L.carrier) { g = L.wire === 3 ? 'OK' : L.wire ? 'FAIR' : 'BOLTER'; t = L.wire ? `נלכד בכבל מספר ${L.wire}` : 'החמצת את הכבלים'; }
  else if (!L.runway) { t = 'נחיתת שדה'; }
  else if (Math.abs(L.cross) > L.wid / 2) { t = 'נחיתה מחוץ למסלול'; g = 'D'; }
  return { g, t };
}
function showLanding(L) {
  const { g, t } = gradeLanding(L);
  $('landTitle').textContent = t; $('landGrade').textContent = g;
  const rows = [['קצב שקיעה במגע', `${Math.round(L.vs * FPM)} רגל/דקה`], ['עומס במגע', `${L.g.toFixed(2)} G`], ['מהירות במגע', `${Math.round(L.ias * KT)} קשר`]];
  if (L.runway) { rows.push(['סטייה מקו האמצע', `${Math.abs(L.cross).toFixed(1)} מ׳`]); rows.push(['מרחק מהסף', `${Math.round(L.past)} מ׳`]); }
  if (L.carrier) rows.push(['כבל', L.wire ? `#${L.wire}` : '—']);
  rows.push(['עומס מרבי בטיסה', `${L.gmax.toFixed(1)} G`]);
  $('landStats').innerHTML = rows.map(([a, b]) => `<span>${a}</span><span class="num">${b}</span>`).join('');
  showDialog('dlgLand', true); S.state = 'landed'; Audio.beep(g.startsWith('A') || g === 'OK' ? 1200 : 700, 0.1, 0.1, 2);
}

function handleEvents(fm) {
  for (const e of fm.events) {
    if (e.t === 'touch') {
      const r = analyzeRunway(fm); const onRw = r && r.dist < r.r.ap.len + 200 && Math.abs(r.cross) < r.r.ap.wid / 2 + 30 && r.along < 0;
      const deck = onCarrierDeck(fm.pos.x, fm.pos.z);
      if (!S.pendingLanding && S.t > 2) S.pendingLanding = { vs: e.vs, g: Math.max(fm.nz, 1), ias: fm.tele.ias, runway: onRw, carrier: deck, cross: r ? r.cross : 0, past: r ? -r.along : 0, wid: r ? r.r.ap.wid : 60, gmax: fm.gmax, wire: 0 };
      camState.shake = Math.min(1.5, e.vs * 0.4);
      // tyre smoke
      for (const i of [1, 2]) { const p = fm.d.gear[i].p.clone().applyQuaternion(fm.q).add(fm.pos); for (let k = 0; k < 14; k++) smoke.emit({ x: p.x, y: p.y + 0.3, z: p.z, vx: fm.vel.x * 0.2 + (Math.random() - 0.5) * 3, vy: Math.random() * 1.5, vz: fm.vel.z * 0.2 + (Math.random() - 0.5) * 3, life: 2.5, s0: fm.d.b * 0.08, s1: fm.d.b * 0.4, r: 0.85, g: 0.85, b: 0.85, a: 0.45, drag: 1.4 }); }
      Audio.burst(0.35, 900, Math.min(0.8, 0.2 + e.vs * 0.2));
    } else if (e.t === 'trap') { if (S.pendingLanding) S.pendingLanding.wire = e.wire; fm.in.throttle = 0; toast(`נלכדת! כבל ${e.wire}`, 3); camState.shake = 1.2; Audio.burst(0.6, 400, 0.6, 'lowpass'); }
    else if (e.t === 'catend') { toast('באוויר! אסוף גלגלים G', 3); }
    else if (e.t === 'scrape') { Audio.burst(0.5, 2400, 0.4); }
    else if (e.t === 'crash') onCrash(fm, e);
  }
  fm.events.length = 0;
}
function onCrash(fm, e) {
  S.state = 'crashed'; S.crashT = 0; camState.shake = 3;
  explosion(fm.pos, e.kind === 'water'); if (e.kind !== 'water') spawnDebris(fm, AC_I.model.root); Audio.boom();
  AC_I.model.root.visible = false; S.cam = S.cam === 'cockpit' ? 'orbit' : S.cam;
  $('crashTitle').textContent = e.kind === 'water' ? 'נפילה לים' : 'התרסקות'; $('crashWhy').textContent = e.why;
}

let wasDescending = false;
function warnings(fm, dt) {
  const T = fm.tele; const agl = fm.pos.y + fm.d.gear[1].p.y - S.groundH;
  S.pullUp = false; S.gearWarn = false; S.bankWarn = false;
  if (fm.wow || fm.crashed) return;
  const vs = fm.vel.y; const ahead = fm.pos.clone().addScaledVector(fm.vel, 5); const gA = groundAt(ahead.x, ahead.z).h;
  const appMode = fm.gearPos > 0.9 && S.nearRunway && S.nearRunway.dist < 6000;
  if (!appMode && ((ahead.y < gA + 25 && vs < -5) || (agl < 120 && vs < -18))) S.pullUp = true;
  if (fm.d.retract && fm.gearPos < 0.5 && agl < 160 && vs < -2 && T.ias < fm.d.vRef * 1.4) S.gearWarn = true;
  if (fm.d.id === 'airliner' && Math.abs(T.att.roll) > 45 * DEG) S.bankWarn = true;
  const now = S.t;
  const say = (k, txt, every = 2.2) => { if (!S.lastCall || S.lastCall.k !== k || now - S.lastCall.t > every) { S.lastCall = { k, t: now }; Audio.say(txt); } };
  if (S.pullUp) say('pull', 'Pull up!', 1.6);
  else if (S.gearWarn) say('gear', 'Too low. Gear.', 3);
  else if (fm.stallWarn && fm.d.id !== 'light') say('stall', 'Stall. Stall.', 2.5);
  else if (S.bankWarn) say('bank', 'Bank angle.', 3);
  // radio altitude callouts on approach
  if (fm.gearPos > 0.9 && vs < -0.5) {
    const ft = agl * FT; const marks = fm.d.id === 'airliner' ? [1000, 500, 100, 50, 40, 30, 20, 10] : [100, 50, 30, 10];
    for (const m of marks) if (S.prevAglFt > m && ft <= m) { Audio.say(m === 1000 ? 'One thousand' : m === 500 ? 'Five hundred' : m === 100 ? 'One hundred' : String(m), 1.25); if (m === 20 && fm.d.id === 'airliner' && fm.in.throttle > 0.05) setTimeout(() => Audio.say('Retard', 1.2), 350); }
  }
  S.prevAglFt = agl * FT;
}

// ---------------------------------------------------------------- Wind
function windAt(fm, t) {
  const base = { calm: 0, light: 6, strong: 13 }[S.wind]; const from = 290 * DEG; // wind from WNW (crosswind for runway 36)
  const agl = Math.max(1, fm.pos.y - S.groundH);
  const prof = clamp(Math.log(agl / 0.3) / Math.log(300 / 0.3), 0.25, 1.2);
  const w = V3(-Math.sin(from), 0, Math.cos(from)).multiplyScalar(base * prof);
  const gust = { calm: 0.3, light: 1.6, strong: 4.2 }[S.wind] * (1 - smoothstep(1500, 4000, fm.pos.y) * 0.7) + (S.wx === 'overcast' ? 0.8 : 0) + (env.inCloud || 0) * 2.5;
  w.x += Noise.s2(t * 0.35, 3.1) * gust + Noise.s2(t * 1.3, 8.4) * gust * 0.4; w.y += Noise.s2(t * 0.5, 17.7) * gust * 0.55; w.z += Noise.s2(t * 0.4, 33.3) * gust;
  return w;
}

// ---------------------------------------------------------------- Main loop
const clock = new THREE.Clock(); const WENV = { wind: new THREE.Vector3(), groundH: 0, time: 0 };
let uiT = 0, panelT = 0, fpsAcc = 0, fpsN = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (S.state === 'loading') return;
  S.t += dt;
  const inp = pollInput(dt);
  const ac = AC_I; const fm = ac.fm;
  if (S.state === 'fly') {
    // controls -> flight model
    fm.in.pitch = Input.axes.pitch; fm.in.roll = Input.axes.roll; fm.in.yaw = Input.axes.yaw; fm.in.brake = Input.brake;
    if (Math.abs(Input.axes.pitch) > 0.3 || Math.abs(Input.axes.roll) > 0.3) { if (fm.ap) { fm.ap = null; Audio.beep(520, 0.25, 0.12, 3); toast('טייס אוטומטי — נותק בהתערבות'); } }
    if (Input.touch.thr !== null && isTouch) { fm.in.throttle = Input.touch.thr; Input.touch.thr = null; }
    fm.in.throttle = clamp(fm.in.throttle + Input.throttleDelta * dt, 0, 1);
    if (Input.throttleDelta && Input.setTouchThrottle) Input.setTouchThrottle(fm.in.throttle);
    if (fm.reverse && !fm.wow) fm.reverse = false;
    // auto ground spoilers for airliner
    if (fm.d.id === 'airliner' && fm.wow && fm.in.throttle < 0.08 && (fm.tele.gs || 0) > 30 && fm.airTimePrev > 2) fm.spoilers = 1;
    if (!fm.wow) fm.airTimePrev = (fm.airTimePrev || 0) + dt; else if ((fm.tele.gs || 0) < 5) fm.airTimePrev = 0;
    WENV.wind.copy(windAt(fm, S.t)); WENV.time = S.t;
    const sub = 6; const h = dt / sub;
    for (let i = 0; i < sub; i++) { WENV.groundH = S.groundH; fm.step(h, WENV); if (fm.crashed) break; }
    S.groundH = groundAt(fm.pos.x, fm.pos.z).h;
    handleEvents(fm);
    S.nearRunway = analyzeRunway(fm);
    warnings(fm, dt);
    // landing completion
    if (S.pendingLanding && fm.wow && !fm.crashed && (fm.tele.gs || 0) < 8) { const L = S.pendingLanding; S.pendingLanding = null; showLanding(L); }
    if (S.pendingLanding && !fm.wow && fm.airTime > 3) { if (S.pendingLanding.carrier) toast('BOLTER! מצערת מלאה וסיבוב נוסף', 3); S.pendingLanding = null; }
    // rings
    if (S.rings) {
      const r = S.rings[S.ringIdx]; S.ringT += dt;
      if (r) {
        const rel = fm.pos.clone().sub(r.pos); const along = rel.dot(r.normal); const lat = rel.clone().addScaledVector(r.normal, -along).length();
        S.ring = { pos: r.pos, dist: rel.length() };
        if (r.prevAlong !== undefined && r.prevAlong < 0 && along >= 0) {
          if (lat < r.radius) { r.done = true; r.mesh.material = ringDoneMat; S.ringIdx++; Audio.beep(1320, 0.08, 0.15, 2); toast(`טבעת ${S.ringIdx}/${S.rings.length} · ${S.ringT.toFixed(1)} שנ׳`, 1.6); }
          else { toast('פספוס! חזור לטבעת', 1.6); }
        }
        r.prevAlong = along;
        if (S.ringIdx >= S.rings.length) { S.ring = null; toast(`סיימת! זמן: ${S.ringT.toFixed(1)} שניות`, 8); S.rings.forEach(x => x.mesh.visible = false); }
      }
    } else S.ring = null;
    // effects tied to flight
    flightEffects(fm, dt);
  } else if (S.state === 'crashed') {
    S.crashT += dt; if (S.crashT > 2.4 && $('dlgCrash').classList.contains('hidden')) showDialog('dlgCrash', true);
    if (Math.random() < dt * 30) smoke.emit({ x: fm.pos.x + (Math.random() - 0.5) * 6, y: Math.max(fm.pos.y, S.groundH) + 1, z: fm.pos.z + (Math.random() - 0.5) * 6, vy: 6, life: 9, s0: 8, s1: 50, r: 0.07, g: 0.07, b: 0.07, a: 0.6, rise: 1.5, drag: 0.3 });
    if (Math.random() < dt * 20 && S.crashT < 25) fire.emit({ x: fm.pos.x + (Math.random() - 0.5) * 5, y: Math.max(fm.pos.y, S.groundH) + 1, z: fm.pos.z + (Math.random() - 0.5) * 5, vy: 5, life: 1, s0: 4, s1: 9, r: 3, g: 1.4, b: 0.4, r1: 1, g1: 0.2, b1: 0.05, a: 0.8, rise: 3 });
  } else if (S.state === 'menu') {
    S.menuT = (S.menuT || 0) + dt;
  }
  // visuals
  syncModel(S.state === 'paused' ? 0 : dt);
  if (S.state === 'menu') {
    const r = ac.def.cam.dist * 1.25; const a = S.menuT * 0.12 + 2.2;
    camera.position.copy(fm.pos).add(V3(Math.sin(a) * r, ac.def.cam.height * 0.5 + 1.5, Math.cos(a) * r)); camera.up.set(0, 1, 0); camera.lookAt(fm.pos.clone().add(V3(0, 0.5, 0)));
    camera.fov = 45; camera.near = 0.5; camera.updateProjectionMatrix(); ac.cockpit.g.visible = false; ac.model.root.visible = true;
  } else if (S.state !== 'paused') updateCamera(dt);
  // world streaming & sky
  updateTerrain(camera.position.x, camera.position.z, S.state === 'menu' ? 8 : 5);
  updateSky(camera.position, dt);
  smoke.update(dt); fire.update(dt); updateDebris(dt);
  vaporL.update(dt, 0.6); vaporR.update(dt, 0.6); contrails.forEach(c => c.update(dt, 0.25));
  updatePapi(); updateCarrierBall();
  if (carrierGroup && carrierGroup.userData.radar) carrierGroup.userData.radar.rotation.y += dt * 2;
  for (const a of AIRPORTS) if (a.sock) { const w = WENV.wind; a.sock.rotation.y = Math.atan2(w.z, -w.x) + 0; a.sock.rotation.z = -0.9 + smoothstep(0, 12, w.length()) * 0.9; }
  // shadow camera follows the aircraft
  const L = env.lightDir || sunDir; sun.position.copy(fm.pos).addScaledVector(L, 1500); sun.target.position.copy(fm.pos); sun.target.updateMatrixWorld();
  // post fx: G-induced grey/red-out
  const g = fm.nz; vignette.uniforms.uGrey.value = damp(vignette.uniforms.uGrey.value, S.state === 'fly' ? smoothstep(6.5, 9.5, g) : 0, 2, dt);
  vignette.uniforms.uRed.value = damp(vignette.uniforms.uRed.value, S.state === 'fly' ? smoothstep(-1.8, -3.2, g) : 0, 2, dt); vignette.uniforms.uTime.value = S.t % 10;
  lightPointMat.uniforms.uScale.value = innerHeight * renderer.getPixelRatio() * 0.5 * (62 / camera.fov);
  smoke.mat.uniforms.uScale.value = fire.mat.uniforms.uScale.value = innerHeight * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * DEG / 2));
  composer.render();
  // HUD and DOM
  drawHUD(fm, S);
  if (S.cam === 'cockpit' && S.state === 'fly') { panelT -= dt; if (panelT <= 0) { panelT = 0.08; drawPanel(fm, ac.cockpit); } }
  uiT -= dt; if (uiT <= 0 && S.state !== 'menu') { uiT = 0.1; updatePanel(fm); drawMinimap(fm, S); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
  Audio.update(fm, S.cam, dt);
}
function flightEffects(fm, dt) {
  const T = fm.tele; const d = fm.d; if (!T.att) return;
  // wingtip vapor under load / humid air
  const vap = smoothstep(d.id === 'fighter' ? 4 : 2, d.id === 'fighter' ? 7 : 3, fm.nz) * smoothstep(60, 140, T.V) + (d.id === 'airliner' ? smoothstep(10, 14, T.alpha * RAD) * (fm.flapPos > 1 ? 0.6 : 0) : 0);
  const tipL = d.hard[1].clone().applyQuaternion(fm.q).add(fm.pos), tipR = d.hard[2].clone().applyQuaternion(fm.q).add(fm.pos);
  const upW = V3(0, 1, 0).applyQuaternion(fm.q).multiplyScalar(0.12);
  if (vap > 0.02) { vaporL.push(tipL, upW, vap, 0.8); vaporR.push(tipR, upW, vap, 0.8); }
  // contrails at altitude for jets
  if (d.engine.type === 'jet' && fm.pos.y > 7000 && T.V > 100) {
    const src = d.id === 'airliner' ? [V3(-5.9, -2.45, -2), V3(5.9, -2.45, -2)] : [V3(0, 0.05, 8), V3(0, 0.05, 8)];
    src.forEach((s, i) => contrails[i].push(s.clone().applyQuaternion(fm.q).add(fm.pos), V3(0, 1, 0).applyQuaternion(fm.q).multiplyScalar(0.8), smoothstep(7000, 8500, fm.pos.y) * 0.9, 18));
  }
  // transonic vapor cone
  if (d.id === 'fighter' && T.mach > 0.96 && T.mach < 1.04 && fm.pos.y < 6000) {
    const c = V3(0, 0, 0.5).applyQuaternion(fm.q).add(fm.pos);
    for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28; const off = V3(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0).applyQuaternion(fm.q); smoke.emit({ x: c.x + off.x, y: c.y + off.y, z: c.z + off.z, vx: fm.vel.x, vy: fm.vel.y, vz: fm.vel.z, life: 0.25, s0: 3, s1: 5, a: 0.5, drag: 0 }); }
    if (!S.boomed) { S.boomed = true; setTimeout(() => Audio.boom(), 500); }
  }
  if (T.mach < 0.9) S.boomed = false;
  // spray over water when very low and fast
  const agl = fm.pos.y - S.groundH;
  if (agl < 22 && T.V > 60 && groundAt(fm.pos.x, fm.pos.z).water && Math.random() < 0.9) { for (let i = 0; i < 3; i++) smoke.emit({ x: fm.pos.x + (Math.random() - 0.5) * 8, y: 0.5, z: fm.pos.z + (Math.random() - 0.5) * 8, vx: fm.vel.x * 0.3, vy: 4 + Math.random() * 6, vz: fm.vel.z * 0.3, life: 1.8, s0: 3, s1: 12, r: 0.95, g: 0.97, b: 1, a: 0.35 * (1 - agl / 22), drag: 1.2, rise: -3 }); }
  // jet exhaust smoke at takeoff power (airliner) & prop dust on ground
  if (fm.wow && d.engine.type === 'jet' && fm.n > 0.8 && Math.random() < 0.5) { const src = d.id === 'airliner' ? [V3(-5.9, -2.45, -1.5), V3(5.9, -2.45, -1.5)] : [V3(0, 0, 8)]; src.forEach(s => { const p = s.applyQuaternion(fm.q).add(fm.pos); smoke.emit({ x: p.x, y: p.y, z: p.z, vx: -fm.vel.x * 0.1, vy: 0.5, vz: -fm.vel.z * 0.1, life: 1.5, s0: 2, s1: 9, r: 0.55, g: 0.53, b: 0.5, a: 0.08 }); }); }
  // camera shake sources
  camState.shake = Math.max(camState.shake, fm.stallLevel * 0.6, fm.wow ? smoothstep(10, 80, T.gs) * 0.08 : 0, fm.ab * 0.06, (fm.scrape || 0) * 0.8, smoothstep(0.92, 1.0, T.mach) * smoothstep(1.06, 1.0, T.mach) * 0.5);
}
function updatePanel(fm) {
  const d = fm.d; const thrPct = Math.round(fm.in.throttle * 100);
  $('thrFill').style.height = thrPct + '%'; $('thrBar').classList.toggle('ab', !!d.engine.ab);
  $('thrV').textContent = d.engine.ab && fm.in.throttle > 0.9 ? 'A/B' : thrPct;
  const engV = d.engine.type === 'prop' ? Math.round(fm.rpm || 0) : Math.round(fm.n * 100);
  $('engLbl').textContent = d.engine.type === 'prop' ? 'RPM' : 'N1'; $('engFill').style.height = (d.engine.type === 'prop' ? (fm.rpm || 0) / 2800 * 100 : fm.n * 100) + '%'; $('engV').textContent = engV;
  const nf = d.flaps.dCL.length - 1; $('flapFill').style.height = (fm.flapPos / nf * 100) + '%'; $('flapV').textContent = d.flaps.label[fm.flap];
  const gs = d.retract ? (fm.gearPos > 0.98 ? 'g' : fm.gearPos < 0.02 ? '' : 't') : 'g';
  ['gN', 'gL', 'gR'].forEach(id => $(id).className = gs); $('gearV').textContent = d.retract ? (fm.gearPos > 0.98 ? 'DN' : fm.gearPos < 0.02 ? 'UP' : '···') : 'FIX';
  const lamp = (id, on, cls = 'g') => { $(id).className = 'lamp' + (on ? ' ' + cls : ''); };
  lamp('lBrk', fm.in.brake > 0, 'a'); lamp('lPark', fm.parking, 'r'); lamp('lSpd', fm.spoilerPos > 0.1, 'a'); lamp('lAp', !!fm.ap, 'g'); lamp('lRev', fm.reverse, 'a'); lamp('lAb', fm.ab > 0.1, 'a');
  lamp('lHook', fm.hookPos > 0.5, 'a'); lamp('lLt', AC_I.lights, 'g'); lamp('lStall', fm.stallWarn, 'r');
  $('trimFill').style.width = (50 + fm.trim / 0.08 * 50) + '%'; $('trimV').textContent = (fm.trim * 100).toFixed(1);
  ['thrFill', 'engFill', 'flapFill'].forEach(id => { const el = $(id); el.style.width = el.style.height; });
  if (isTouch) {
    $('thrT').textContent = d.engine.ab && fm.in.throttle > 0.9 ? 'A/B' : thrPct + '%';
    const st = { parking: fm.parking, speedbrake: fm.spoilers > 0, reverse: fm.reverse, autopilot: !!fm.ap, hook: fm.hook, lights: AC_I.lights, hud: S.hudOn, sound: Audio.on };
    document.querySelectorAll('#tmore button').forEach(b => b.classList.toggle('on', !!st[b.dataset.a]));
    document.querySelector('#tbtns [data-k=gear]').classList.toggle('on', fm.gearDown && d.retract);
    document.querySelector('#tbtns [data-k=brake]').classList.toggle('on', fm.in.brake > 0);
  }
}

// ---------------------------------------------------------------- Parked traffic (static scenery)
function buildParked() {
  const ap = AIRPORTS[0];
  for (let i = 0; i < 4; i++) { const m = buildAirliner(); const p = ap.toW(ap.bx - 34, 0, -250 + i * 100 + 40); m.root.position.set(p.x, ap.elev + 4.0, p.z); m.root.rotation.y = -ap.hdg * DEG - Math.PI / 2; scene.add(m.root); m.P.nav.concat(m.P.strobe, m.P.beacon || []).forEach(s => s.visible = false); }
  const ap2 = AIRPORTS[1]; for (let i = 0; i < 2; i++) { const m = buildLight(); const p = ap2.toW(ap2.apronX + 10, 0, -10 + i * 16); m.root.position.set(p.x, ap2.elev + 1.25, p.z); m.root.rotation.y = -ap2.hdg * DEG - Math.PI / 2 + 0.3; scene.add(m.root); m.P.nav.concat(m.P.strobe).forEach(s => s.visible = false); }
  const C = WORLD.carrier; for (let i = 0; i < 3; i++) { const m = buildFighter(); m.root.position.set(C.x + 14, C.deck + 2.0, C.z - 100 + i * 22 + 60); m.root.rotation.y = -0.7; scene.add(m.root); m.P.flame.forEach(f => f.visible = false); m.P.nav.concat(m.P.strobe).forEach(s => s.visible = false); }
}

// ---------------------------------------------------------------- Boot
function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight, false); if (composer) { composer.setSize(innerWidth, innerHeight); } resizeHud(); }
addEventListener('resize', onResize);
if (isTouch) document.body.classList.add('touch');
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
async function boot() {
  const bar = $('loadbar'), txt = $('loadtxt');
  const step = async (p, t) => { bar.style.width = p + '%'; txt.textContent = t; await nextFrame(); };
  try {
    await step(5, 'מכין את המנוע הגרפי…'); resizeHud(); applyQuality(false);
    await step(15, 'שמיים ואטמוספירה…'); applyConditions(S.time, S.wx);
    await step(25, 'שדות תעופה…'); AIRPORTS.forEach(buildAirport);
    await step(38, 'העיר…'); buildCity();
    await step(48, 'נושאת המטוסים…'); buildCarrier();
    await step(55, 'מטוסים בחניה…'); buildParked();
    await step(58, 'ים ושוניות…'); buildDepthTexture();
    await step(60, 'מפה…'); buildMapImage();
    const ap = AIRPORTS[0]; let left = 999; let it = 0;
    while (left > 0 && it < 400) { left = updateTerrain(ap.x, ap.z, 40); it++; await step(60 + Math.min(38, it * 0.9), `שטח ויערות… ${left}`); }
    await document.fonts?.ready;
    buildMenu(); menuPreview(); applyConditions(S.time, S.wx);
    S.state = 'menu'; $('menu').classList.remove('hidden');
    $('loading').style.opacity = 0; setTimeout(() => $('loading').remove(), 900);
  } catch (err) { txt.textContent = 'שגיאה בטעינה: ' + err.message; console.error(err); }
}
requestAnimationFrame(frame);
boot();
