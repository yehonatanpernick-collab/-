
// =====================================================================
// The knight of the Grey Order
// =====================================================================
const player = {
  obj: new THREE.Group(), hp: 100, maxHp: 100, st: 100, stDelay: 0, facing: 0, vel: new V3(),
  atkT: -1, combo: 0, queued: false, comboReset: 0, hitDone: false,
  rollT: -1, rollDir: new V3(), drinkT: -1, flasks: 3, maxFlasks: 3, lastHurt: -10, flinch: 0, souls: 0, kills: 0, walkPhase: 0, stepAcc: 0,
};
scene.add(player.obj);
const P = player.obj;
const KP = {};   // knight parts

const KM = (() => {
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a9da4, metalness: 1, roughness: 0.36, map: grimeTex, roughnessMap: scratchTex, envMapIntensity: 1.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x45464c, metalness: 1, roughness: 0.42, map: grimeTex, roughnessMap: scratchTex });
  const mail = new THREE.MeshStandardMaterial({ color: 0x7a7c82, metalness: 1, roughness: 0.5, map: withRepeat(chainTex, 7, 7), normalMap: withRepeat(chainN, 7, 7), normalScale: new V2(1.4, 1.4), side: THREE.DoubleSide });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x8c6a3a, metalness: 1, roughness: 0.34, map: grimeTex });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a281d, roughness: 0.72, map: clothTex });
  const cloth = new THREE.MeshStandardMaterial({ color: 0xd2c7ae, roughness: 0.95, map: clothTex, normalMap: clothN, side: THREE.DoubleSide, alphaMap: tatterAlpha(64, 128, 0.82, 6, 5), alphaTest: 0.5 });
  const fur = new THREE.MeshStandardMaterial({ color: 0x5a4838, roughness: 1, map: furTex, normalMap: furN, normalScale: new V2(2.2, 2.2), side: THREE.DoubleSide });
  const cape = new THREE.MeshStandardMaterial({ color: 0x5e1a17, roughness: 0.9, map: clothTex, normalMap: clothN, side: THREE.DoubleSide, alphaMap: tatterAlpha(128, 256, 0.8, 26, 2), alphaTest: 0.5 });
  // surcoat with the order's sigil: a sword falling through a crescent moon
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#d9cfb8'; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(60,45,30,${Math.random() * 0.08})`; x.fillRect(Math.random() * 512, Math.random() * 256, 2, 2); }
  const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(40,30,20,0)'); gr.addColorStop(1, 'rgba(40,30,20,.45)'); x.fillStyle = gr; x.fillRect(0, 0, 512, 256);
  x.save(); x.translate(256, 120);
  x.fillStyle = '#8b1c16'; x.beginPath(); x.arc(0, 0, 46, 0, TAU); x.fill();
  x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(14, -10, 40, 0, TAU); x.fill(); x.globalCompositeOperation = 'source-over';
  x.fillStyle = '#8b1c16'; x.fillRect(-5, -70, 10, 130); x.fillRect(-26, -50, 52, 9); x.beginPath(); x.moveTo(-5, 60); x.lineTo(5, 60); x.lineTo(0, 78); x.fill();
  x.restore();
  for (let i = 0; i < 6; i++) { x.fillStyle = `rgba(70,10,8,${0.2 + Math.random() * 0.3})`; x.beginPath(); x.ellipse(Math.random() * 512, 150 + Math.random() * 100, 4 + Math.random() * 18, 3 + Math.random() * 10, Math.random() * 3, 0, TAU); x.fill(); }
  const surTex = new THREE.CanvasTexture(c); surTex.colorSpace = THREE.SRGBColorSpace;
  const surcoat = new THREE.MeshStandardMaterial({ map: surTex, roughness: 0.95, normalMap: clothN, side: THREE.DoubleSide });
  // shield paint
  const s = document.createElement('canvas'); s.width = 256; s.height = 384; const y = s.getContext('2d');
  y.fillStyle = '#5a1512'; y.fillRect(0, 0, 256, 384);
  for (let i = 0; i < 60; i++) { y.strokeStyle = `rgba(20,8,5,${Math.random() * 0.4})`; y.lineWidth = 1 + Math.random() * 2; y.beginPath(); y.moveTo(Math.random() * 256, 0); y.lineTo(Math.random() * 256, 384); y.stroke(); }
  y.fillStyle = '#cfc3a6'; y.fillRect(116, 40, 24, 300); y.fillRect(40, 130, 176, 22);
  y.beginPath(); y.arc(128, 141, 40, 0, TAU); y.fill(); y.fillStyle = '#5a1512'; y.beginPath(); y.arc(140, 132, 34, 0, TAU); y.fill();
  for (let i = 0; i < 300; i++) { y.fillStyle = `rgba(${Math.random() < 0.5 ? '200,190,170' : '10,5,3'},${Math.random() * 0.35})`; y.fillRect(Math.random() * 256, Math.random() * 384, 1 + Math.random() * 6, 1 + Math.random() * 2); }
  const shTex = new THREE.CanvasTexture(s); shTex.colorSpace = THREE.SRGBColorSpace; shTex.repeat.set(1 / 0.64, 1 / 0.95); shTex.offset.set(0.5, 0.6);
  const shield = new THREE.MeshStandardMaterial({ map: shTex, roughness: 0.75, normalMap: withRepeat(barkN, 1, 1), normalScale: new V2(0.4, 0.4) });
  const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.5, 2.2) });
  return { steel, dark, mail, bronze, leather, cloth, fur, cape, surcoat, shield, eye };
})();

{
  const mk = (geo, mat, parent, x = 0, y = 0, z = 0) => addMesh(parent, geo, mat, x, y, z);
  const lathe = (pts, seg = 24, ps = 0) => new THREE.LatheGeometry(pts.map(q => new V2(q[0], q[1])), seg, ps);
  const rollPivot = new THREE.Group(); rollPivot.position.y = 0.85; P.add(rollPivot); KP.rollPivot = rollPivot;
  const body = new THREE.Group(); body.position.y = -0.85; rollPivot.add(body); KP.body = body;

  // ---------------- hips ----------------
  const hips = new THREE.Group(); hips.position.y = 1.0; body.add(hips); KP.hips = hips;
  mk(lathe([[0.41, -0.44], [0.385, -0.3], [0.31, -0.1], [0.275, 0.02], [0.23, 0.08]], 26), KM.mail, hips);
  const belt = mk(new THREE.TorusGeometry(0.27, 0.032, 8, 30), KM.leather, hips, 0, 0.04, 0); belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.82, 1);
  mk(new THREE.BoxGeometry(0.09, 0.075, 0.03), KM.bronze, hips, 0, 0.04, 0.235);
  mk(new THREE.BoxGeometry(0.12, 0.14, 0.07), KM.leather, hips, -0.24, -0.04, 0.1).rotation.y = 0.5;
  KP.tabards = [];
  for (const sd of [1, -1]) {
    const tg = new THREE.Group(); tg.position.set(0, 0.02, sd * 0.235); hips.add(tg);
    const g = new THREE.PlaneGeometry(0.38, 0.7, 2, 6); g.translate(0, -0.35, 0);
    const m = mk(g, KM.cloth, tg); if (sd < 0) m.rotation.y = Math.PI;
    KP.tabards.push({ g: tg, sd });
  }
  // ---------------- legs ----------------
  KP.legs = [];
  for (const sd of [1, -1]) {
    const th = new THREE.Group(); th.position.set(sd * 0.13, -0.05, 0); hips.add(th);
    mk(new THREE.CylinderGeometry(0.105, 0.09, 0.46, 14).translate(0, -0.23, 0), KM.mail, th);
    mk(new THREE.CylinderGeometry(0.11, 0.1, 0.22, 14, 1, true, -1.2, 2.4).translate(0, -0.3, 0), KM.dark, th);   // cuisse
    const knee = mk(new THREE.SphereGeometry(0.085, 14, 10), KM.steel, th, 0, -0.46, 0.035); knee.scale.set(1.05, 0.95, 0.9);
    const fan = mk(new THREE.CylinderGeometry(0.1, 0.1, 0.015, 14, 1, false, 0, Math.PI), KM.steel, th, sd * 0.04, -0.46, 0.02); fan.rotation.z = Math.PI / 2; fan.rotation.y = sd * 0.4;
    const sh = new THREE.Group(); sh.position.y = -0.46; th.add(sh);
    mk(new THREE.CylinderGeometry(0.092, 0.075, 0.42, 14).translate(0, -0.21, 0), KM.steel, sh);
    mk(new THREE.BoxGeometry(0.02, 0.36, 0.02), KM.dark, sh, 0, -0.2, 0.088);
    const boot = mk(new THREE.BoxGeometry(0.15, 0.1, 0.28), KM.dark, sh, 0, -0.45, 0.04);
    const toe = mk(new THREE.CylinderGeometry(0.0, 0.075, 0.16, 4).rotateX(Math.PI / 2), KM.steel, sh, 0, -0.455, 0.24); toe.rotation.z = Math.PI / 4;
    mk(new THREE.BoxGeometry(0.16, 0.025, 0.32), KM.leather, sh, 0, -0.5, 0.05);
    KP.legs.push({ th, sh, sd });
  }
  // ---------------- torso ----------------
  const torso = new THREE.Group(); torso.position.y = 1.02; body.add(torso); KP.torso = torso;
  const chest = mk(lathe([[0.0, -0.02], [0.22, 0.0], [0.25, 0.12], [0.3, 0.3], [0.315, 0.42], [0.28, 0.53], [0.17, 0.61], [0.0, 0.62]], 28), KM.steel, torso); chest.scale.set(1, 1, 0.8);
  const sur = mk(lathe([[0.245, -0.02], [0.268, 0.12], [0.318, 0.3], [0.333, 0.42], [0.31, 0.5]], 32, Math.PI), KM.surcoat, torso); sur.scale.set(1, 1, 0.82);
  const wb = mk(new THREE.TorusGeometry(0.26, 0.03, 8, 30), KM.leather, torso, 0, 0.06, 0); wb.rotation.x = Math.PI / 2; wb.scale.set(1, 0.82, 1);
  mk(new THREE.CylinderGeometry(0.13, 0.17, 0.12, 16), KM.dark, torso, 0, 0.63, 0);
  // fur mantle
  const mg = lathe([[0.46, 0.4], [0.44, 0.48], [0.36, 0.58], [0.24, 0.66], [0.15, 0.69]], 32);
  { const p = mg.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const a = Math.atan2(z, x); const n = 1 + (fbm(a * 3 + 5, y * 9) - 0.5) * 0.22; p.setXYZ(i, x * n, y + (y < 0.45 ? (fbm(a * 5, 2) - 0.5) * 0.08 : 0), z * n); } mg.computeVertexNormals(); }
  const mantle = mk(mg, KM.fur, torso); mantle.scale.set(1, 1, 0.84);
  // pauldrons
  for (const sd of [1, -1]) {
    const pg = new THREE.Group(); pg.position.set(sd * 0.35, 0.53, 0); pg.rotation.z = -sd * 0.42; torso.add(pg);
    for (let k = 0; k < 3; k++) { const m = mk(new THREE.SphereGeometry(0.2 - k * 0.02, 20, 10, 0, TAU, 0, Math.PI * 0.5), k === 0 ? KM.steel : KM.dark, pg, 0, -k * 0.07, 0); m.material = m.material.clone(); m.material.side = THREE.DoubleSide; m.scale.set(1.08, 0.7 + k * 0.05, 1.12); }
    const rim = mk(new THREE.TorusGeometry(0.205, 0.012, 6, 28), KM.bronze, pg); rim.rotation.x = Math.PI / 2; rim.scale.set(1.08, 1.12, 1);
    for (let k = 0; k < 3; k++) mk(new THREE.SphereGeometry(0.014, 6, 5), KM.bronze, pg, Math.cos(k * 1.2 - 1.2) * 0.2, 0.02, Math.sin(k * 1.2 - 1.2) * 0.2);
  }
  // ---------------- great helm ----------------
  const head = new THREE.Group(); head.position.y = 0.67; torso.add(head); KP.head = head;
  const helm = mk(lathe([[0.0, -0.03], [0.152, -0.03], [0.168, 0.08], [0.172, 0.24], [0.166, 0.33], [0.12, 0.357], [0.0, 0.362]], 30), KM.steel, head); helm.scale.set(1, 1, 1.07);
  mk(new THREE.BoxGeometry(0.26, 0.024, 0.06), blackMat, head, 0, 0.205, 0.165);
  mk(new THREE.BoxGeometry(0.038, 0.33, 0.03), KM.dark, head, 0, 0.17, 0.181);
  mk(new THREE.BoxGeometry(0.34, 0.03, 0.03), KM.dark, head, 0, 0.245, 0.17).scale.z = 1;
  for (const yy of [0.02, 0.32]) { const b = mk(new THREE.TorusGeometry(0.17, 0.01, 6, 30), KM.bronze, head, 0, yy, 0); b.rotation.x = Math.PI / 2; b.scale.set(1, 1.07, 1); }
  for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) mk(new THREE.BoxGeometry(0.012, 0.012, 0.04), blackMat, head, sd * (0.05 + i * 0.022), 0.07 + j * 0.026, 0.168);
  for (const sd of [-1, 1]) { const e = mk(new THREE.SphereGeometry(0.008, 6, 5), KM.eye, head, sd * 0.05, 0.205, 0.15); e.castShadow = false; }
  const crestPivot = new THREE.Group(); crestPivot.position.set(0, 0.35, -0.08); head.add(crestPivot); KP.crest = crestPivot;
  const crestGeo = new THREE.PlaneGeometry(0.09, 0.75, 1, 8); crestGeo.translate(0, -0.375, 0);
  mk(crestGeo, KM.cape, crestPivot).rotation.x = 0.2;
  // ---------------- arms ----------------
  const makeArm = (sd) => {
    const sh = new THREE.Group(); sh.position.set(sd * 0.37, 0.5, 0); sh.rotation.order = 'YXZ'; torso.add(sh);
    mk(new THREE.CylinderGeometry(0.08, 0.072, 0.3, 12).translate(0, -0.15, 0), KM.mail, sh);
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    mk(new THREE.SphereGeometry(0.07, 12, 10), KM.steel, el);
    const couter = mk(new THREE.ConeGeometry(0.06, 0.1, 8), KM.steel, el, 0, 0, -0.07); couter.rotation.x = -Math.PI / 2;
    mk(new THREE.CylinderGeometry(0.08, 0.066, 0.25, 12).translate(0, -0.13, 0), KM.steel, el);
    mk(new THREE.CylinderGeometry(0.088, 0.08, 0.05, 12), KM.bronze, el, 0, -0.03, 0);
    mk(new THREE.BoxGeometry(0.105, 0.1, 0.115), KM.dark, el, 0, -0.3, 0);
    for (let i = 0; i < 3; i++) mk(new THREE.BoxGeometry(0.1, 0.026, 0.11), KM.steel, el, 0, -0.36 - i * 0.03, 0.005 + i * 0.008);
    return { sh, el };
  };
  const AL = makeArm(1), AR = makeArm(-1);
  KP.armL = AL.sh; KP.elbowL = AL.el; KP.armR = AR.sh; KP.elbowR = AR.el;
  // ---------------- kite shield ----------------
  const ks = new THREE.Shape(); ks.moveTo(-0.3, 0.35); ks.quadraticCurveTo(0, 0.42, 0.3, 0.35); ks.quadraticCurveTo(0.31, -0.15, 0, -0.55); ks.quadraticCurveTo(-0.31, -0.15, -0.3, 0.35);
  const shG = new THREE.ExtrudeGeometry(ks, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.022, bevelSegments: 2, curveSegments: 16 });
  const shield = new THREE.Mesh(shG, [KM.shield, KM.bronze]); shield.castShadow = true; shield.receiveShadow = true;
  const shieldG = new THREE.Group(); shieldG.position.set(0.1, -0.16, 0.02); shieldG.rotation.set(0, Math.PI / 2, 0.08); AL.el.add(shieldG); shieldG.add(shield);
  shield.userData.keep = true;
  const boss = mk(new THREE.SphereGeometry(0.06, 12, 8, 0, TAU, 0, Math.PI / 2), KM.steel, shieldG, 0, -0.02, 0.04); boss.rotation.x = Math.PI / 2;
  // ---------------- lantern on the belt ----------------
  const lantern = new THREE.Group(); lantern.position.set(0.3, -0.02, -0.12); hips.add(lantern); KP.lantern = lantern;
  mk(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 4), KM.dark, lantern, 0, -0.05, 0);
  for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + Math.PI / 4; mk(new THREE.BoxGeometry(0.012, 0.16, 0.012), KM.dark, lantern, Math.cos(a) * 0.055, -0.19, Math.sin(a) * 0.055); }
  mk(new THREE.ConeGeometry(0.085, 0.07, 4), KM.dark, lantern, 0, -0.08, 0).rotation.y = Math.PI / 4;
  mk(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 4), KM.dark, lantern, 0, -0.27, 0).rotation.y = Math.PI / 4;
  const lcore = mk(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.7, 0.2) }), lantern, 0, -0.19, 0); lcore.castShadow = false;
  KP.lanternLight = new THREE.PointLight(0xffa868, 6, 18, 1.6); KP.lanternLight.position.set(1.3, 2.4, 1.3); P.add(KP.lanternLight);
  // ---------------- longsword ----------------
  const sword = new THREE.Group(); sword.position.set(0, -0.33, 0.0); AR.el.add(sword); KP.sword = sword;
  const bs = new THREE.Shape(); bs.moveTo(-0.042, 0); bs.lineTo(0.042, 0); bs.lineTo(0.036, -0.98); bs.quadraticCurveTo(0.02, -1.12, 0, -1.2); bs.quadraticCurveTo(-0.02, -1.12, -0.036, -0.98); bs.closePath();
  const bg = new THREE.ExtrudeGeometry(bs, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.011, bevelSegments: 1, curveSegments: 6 });
  bg.translate(0, -0.13, -0.002);
  const blade = mk(bg, new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 1, roughness: 0.2, map: grimeTex, roughnessMap: scratchTex, envMapIntensity: 1.8 }), sword);
  for (const zz of [-0.0115, 0.0115]) mk(new THREE.BoxGeometry(0.012, 0.75, 0.002), KM.dark, sword, 0, -0.55, zz);
  KP.runeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.3, 1.8) });
  for (const zz of [-0.0125, 0.0125]) for (let i = 0; i < 4; i++) mk(new THREE.BoxGeometry(i % 2 ? 0.02 : 0.008, i % 2 ? 0.006 : 0.03, 0.002), KM.runeMat || KP.runeMat, sword, 0, -0.2 - i * 0.05, zz).castShadow = false;
  const guard = mk(new THREE.BoxGeometry(0.34, 0.035, 0.05), KM.dark, sword, 0, -0.12, 0);
  for (const sd of [-1, 1]) { const q = mk(new THREE.CylinderGeometry(0.014, 0.022, 0.09, 6), KM.dark, sword, sd * 0.19, -0.145, 0); q.rotation.z = sd * 0.5; }
  mk(new THREE.CylinderGeometry(0.024, 0.028, 0.22, 8), KM.leather, sword, 0, 0, 0);
  for (let i = 0; i < 5; i++) { const w = mk(new THREE.TorusGeometry(0.027, 0.005, 4, 10), KM.leather, sword, 0, -0.08 + i * 0.04, 0); w.rotation.x = Math.PI / 2; }
  const pom = mk(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14), KM.dark, sword, 0, 0.13, 0); pom.rotation.z = Math.PI / 2;
  KP.tip = new THREE.Object3D(); KP.tip.position.y = -1.32; sword.add(KP.tip);
  KP.base = new THREE.Object3D(); KP.base.position.y = -0.3; sword.add(KP.base);
  bake(P);
}

// ---------------------------------------------------------------------
// Verlet cape
// ---------------------------------------------------------------------
const Cape = (() => {
  const CW = 7, CH = 12, LEN = 1.38, N = CW * CH;
  const geo = new THREE.PlaneGeometry(1, 1, CW - 1, CH - 1);
  const mesh = new THREE.Mesh(geo, KM.cape); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; scene.add(mesh);
  const p = new Float32Array(N * 3), o = new Float32Array(N * 3), cons = [];
  const anchorLocal = []; for (let i = 0; i < CW; i++) { const u = i / (CW - 1) * 2 - 1; anchorLocal.push(new V3(u * 0.3, 0.57, -0.24 - (1 - u * u) * 0.04)); }
  const w = (r) => lerp(0.6, 1.0, r / (CH - 1)) / (CW - 1), dy = LEN / (CH - 1);
  for (let r = 0; r < CH; r++) for (let c = 0; c < CW; c++) {
    const i = r * CW + c;
    if (c < CW - 1) cons.push([i, i + 1, w(r)]);
    if (r < CH - 1) cons.push([i, i + CW, dy]);
    if (r < CH - 1 && c < CW - 1) { cons.push([i, i + CW + 1, Math.hypot(w(r), dy)]); cons.push([i + 1, i + CW, Math.hypot(w(r), dy)]); }
    if (r < CH - 2) cons.push([i, i + 2 * CW, dy * 2]);
  }
  const tmp = new V3(), lp = new V3(), invT = new THREE.Matrix4(), anchors = anchorLocal.map(() => new V3()), spheres = [];
  let ready = false;
  function place() {
    KP.torso.updateWorldMatrix(true, false);
    for (let r = 0; r < CH; r++) for (let c = 0; c < CW; c++) {
      const a = anchorLocal[c]; tmp.set(a.x * lerp(1, 1.6, r / (CH - 1)), a.y - r * dy, a.z - r * 0.03).applyMatrix4(KP.torso.matrixWorld);
      const i = (r * CW + c) * 3; p[i] = o[i] = tmp.x; p[i + 1] = o[i + 1] = tmp.y; p[i + 2] = o[i + 2] = tmp.z;
    }
    ready = true;
  }
  function step(dt, time) {
    if (!ready) place();
    KP.torso.updateWorldMatrix(true, false); KP.hips.updateWorldMatrix(true, false);
    anchorLocal.forEach((a, i) => anchors[i].copy(a).applyMatrix4(KP.torso.matrixWorld));
    if (anchors[0].distanceTo(tmp.set(p[0], p[1], p[2])) > 3) place();
    spheres.length = 0;
    spheres.push([new V3(0, 0.3, 0.05).applyMatrix4(KP.torso.matrixWorld), 0.29]);
    spheres.push([new V3(0, 0.08, 0.0).applyMatrix4(KP.torso.matrixWorld), 0.32]);
    spheres.push([new V3(0, -0.2, 0).applyMatrix4(KP.hips.matrixWorld), 0.42]);
    for (const L of KP.legs) { L.th.updateWorldMatrix(true, false); spheres.push([new V3(0, -0.3, -0.02).applyMatrix4(L.th.matrixWorld), 0.17]); }
    invT.copy(KP.torso.matrixWorld).invert();
    const sub = 2, h = Math.min(dt, 1 / 30) / sub, wind = Math.sin(time * 0.7) * 0.6 + Math.sin(time * 2.3) * 0.25;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < N; i++) {
        if (i < CW) continue; const j = i * 3;
        const vx = (p[j] - o[j]) * 0.985, vy = (p[j + 1] - o[j + 1]) * 0.985, vz = (p[j + 2] - o[j + 2]) * 0.985;
        o[j] = p[j]; o[j + 1] = p[j + 1]; o[j + 2] = p[j + 2];
        p[j] += vx + wind * 0.8 * h * h; p[j + 1] += vy - 9.8 * h * h; p[j + 2] += vz + Math.cos(time * 0.5) * 0.4 * h * h;
      }
      for (let c = 0; c < CW; c++) { const j = c * 3; p[j] = anchors[c].x; p[j + 1] = anchors[c].y; p[j + 2] = anchors[c].z; }
      for (let it = 0; it < 4; it++) {
        for (const [a, b, rest] of cons) {
          const ja = a * 3, jb = b * 3, dx = p[jb] - p[ja], dyy = p[jb + 1] - p[ja + 1], dz = p[jb + 2] - p[ja + 2];
          const d = Math.sqrt(dx * dx + dyy * dyy + dz * dz) || 1e-6, diff = (d - rest) / d;
          const wa = a < CW ? 0 : 0.5, wb = b < CW ? 0 : 0.5, k = diff / Math.max(wa + wb, 1e-6);
          p[ja] += dx * k * wa; p[ja + 1] += dyy * k * wa; p[ja + 2] += dz * k * wa;
          p[jb] -= dx * k * wb; p[jb + 1] -= dyy * k * wb; p[jb + 2] -= dz * k * wb;
        }
        for (let i = CW; i < N; i++) {
          const j = i * 3;
          for (const [c, r] of spheres) {
            const dx = p[j] - c.x, dyy = p[j + 1] - c.y, dz = p[j + 2] - c.z, d = Math.sqrt(dx * dx + dyy * dyy + dz * dz);
            if (d < r && d > 1e-5) { const k = r / d; p[j] = c.x + dx * k; p[j + 1] = c.y + dyy * k; p[j + 2] = c.z + dz * k; }
          }
          // keep the cloth behind the back and below the shoulders (never over the helm)
          lp.set(p[j], p[j + 1], p[j + 2]).applyMatrix4(invT);
          const row = Math.floor(i / CW), maxZ = -0.22 - row * 0.012;
          if (lp.z > maxZ || lp.y > 0.58) { lp.z = Math.min(lp.z, maxZ); lp.y = Math.min(lp.y, 0.58); lp.applyMatrix4(KP.torso.matrixWorld); p[j] = lp.x; p[j + 1] = lp.y; p[j + 2] = lp.z; }
          const gy = heightAt(p[j], p[j + 2]) + 0.03; if (p[j + 1] < gy) p[j + 1] = gy;
        }
      }
    }
    geo.attributes.position.array.set(p); geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
  }
  return { step, place, p, mesh };
})();

// ---------------------------------------------------------------------
// Knight animation
// ---------------------------------------------------------------------
const SWINGS = [
  { dur: 0.46, wind: { x: -1.0, y: -1.9, z: -0.3, el: -0.7, ty: 0.55, tx: 0.05 }, hit: { x: -1.45, y: 1.55, z: 0, el: -0.05, ty: -0.6, tx: 0.12 }, dmg: 1, reach: 3.0, arc: -0.1 },
  { dur: 0.46, wind: { x: -1.5, y: 1.6, z: 0.0, el: -0.9, ty: -0.55, tx: 0.05 }, hit: { x: -1.3, y: -1.75, z: -0.2, el: -0.1, ty: 0.6, tx: 0.12 }, dmg: 1, reach: 3.0, arc: -0.1 },
  { dur: 0.62, wind: { x: -3.0, y: -0.15, z: -0.1, el: -0.5, ty: 0.1, tx: -0.2 }, hit: { x: -0.5, y: -0.1, z: 0, el: 0, ty: 0, tx: 0.5 }, dmg: 2, reach: 3.5, arc: 0.35 },
];
function animateKnight(dt, time, k) {
  const ph = player.walkPhase, sw = Math.sin(ph) * k;
  const rolling = player.rollT >= 0, dead = player.hp <= 0;
  // legs
  for (const L of KP.legs) {
    const lp = ph + (L.sd > 0 ? 0 : Math.PI);
    let tx = -Math.sin(lp) * 0.8 * k, sx = Math.max(0, Math.sin(lp - 1.3)) * 1.15 * k + 0.05;
    if (rolling) { tx = -1.3; sx = 1.9; }
    L.th.rotation.x = damp(L.th.rotation.x, tx, 25, dt); L.sh.rotation.x = damp(L.sh.rotation.x, sx, 25, dt);
  }
  for (const T of KP.tabards) T.g.rotation.x = damp(T.g.rotation.x, T.sd * (-Math.abs(Math.sin(ph)) * 0.6 * k - 0.03) - (rolling ? T.sd * 0.8 : 0), 15, dt);
  // body
  if (rolling) {
    const t = player.rollT;
    KP.rollPivot.rotation.x = easeInOut(t) * TAU; KP.rollPivot.position.y = 0.85 - Math.sin(t * Math.PI) * 0.4;
  } else if (dead) {
    KP.rollPivot.rotation.x = damp(KP.rollPivot.rotation.x, -1.45, 3, dt); KP.rollPivot.position.y = damp(KP.rollPivot.position.y, 0.3, 3, dt);
  } else {
    KP.rollPivot.rotation.x = 0; KP.rollPivot.position.y = 0.85;
  }
  KP.body.position.y = -0.85 + Math.abs(Math.cos(ph)) * 0.06 * k - 0.035 * k + Math.sin(time * 2) * 0.006;
  // attack pose
  let A = { x: -0.25 + sw * 0.35, y: -0.15, z: -0.12, el: -0.45, ty: Math.sin(ph) * 0.12 * k, tx: 0.1 * k };
  if (player.atkT >= 0) {
    const S = SWINGS[player.combo], t = player.atkT, rest = A;
    const mix = (a, b, f) => ({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f), el: lerp(a.el, b.el, f), ty: lerp(a.ty, b.ty, f), tx: lerp(a.tx, b.tx, f) });
    A = t < 0.24 ? mix(rest, S.wind, easeOut(t / 0.24)) : t < 0.52 ? mix(S.wind, S.hit, easeInOut((t - 0.24) / 0.28)) : mix(S.hit, rest, easeInOut((t - 0.52) / 0.48));
  }
  if (player.drinkT >= 0) A = { x: -2.25, y: 0.55, z: 0, el: -2.25, ty: 0.1, tx: -0.12 };
  if (rolling) A = { x: -1.2, y: 0, z: -0.3, el: -1.6, ty: 0, tx: 0 };
  const sp = player.atkT >= 0 ? 40 : 14;
  KP.armR.rotation.x = damp(KP.armR.rotation.x, A.x, sp, dt); KP.armR.rotation.y = damp(KP.armR.rotation.y, A.y, sp, dt); KP.armR.rotation.z = damp(KP.armR.rotation.z, A.z, sp, dt);
  KP.elbowR.rotation.x = damp(KP.elbowR.rotation.x, A.el, sp, dt);
  KP.sword.rotation.x = damp(KP.sword.rotation.x, player.atkT >= 0 ? -0.25 : -0.55, 12, dt);
  KP.torso.rotation.y = damp(KP.torso.rotation.y, A.ty, sp * 0.6, dt);
  KP.torso.rotation.x = damp(KP.torso.rotation.x, A.tx + (player.flinch > 0 ? -0.35 * player.flinch : 0), 14, dt);
  KP.torso.scale.y = 1 + Math.sin(time * 2) * 0.008;
  KP.head.rotation.x = -KP.torso.rotation.x * 0.5; KP.head.rotation.y = -KP.torso.rotation.y * 0.4;
  // shield arm: held in a guard
  const guard = player.atkT >= 0 || rolling ? 1 : 0;
  KP.armL.rotation.x = damp(KP.armL.rotation.x, -0.35 - guard * 0.35 + sw * 0.3, 10, dt); KP.armL.rotation.z = damp(KP.armL.rotation.z, 0.22, 10, dt); KP.armL.rotation.y = damp(KP.armL.rotation.y, -0.2 * guard, 10, dt);
  KP.elbowL.rotation.x = damp(KP.elbowL.rotation.x, -1.0 - guard * 0.3, 10, dt);
  KP.lantern.rotation.x = Math.sin(ph) * 0.45 * k; KP.lantern.rotation.z = Math.sin(time * 1.5) * 0.06;
  KP.crest.rotation.x = 0.25 + k * 0.6 + Math.sin(time * 5 + ph) * 0.08;
  KP.lanternLight.intensity = 6 + Math.sin(time * 13) * 0.5 + Math.sin(time * 23.7) * 0.4;
}
