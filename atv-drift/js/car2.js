// Procedural Can-Am Maverick R–style buggy (no external model needed).
// Same rig interface as loadCar(): root (origin on ground between wheels, +Z forward),
// wheels[] {steer, spin, baseY, front, left}, paint, brake/reverse lights, flames, setPaint.
import * as THREE from 'three';

const WX = 0.82, WZ = 1.14, WR = 0.375;

function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o });
}

// side profile (z forward, y up) extruded across the width (centred on x = 0)
function profile(pts, width, bevel = 0.04) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 6 });
  g.rotateY(-Math.PI / 2);                 // shape x -> world z, extrusion -> -x
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

function tube(a, b, r, m) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m);
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return mesh;
}

export function buildMaverick() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paintM = new THREE.MeshPhysicalMaterial({ color: '#f2a900', roughness: 0.35, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.12 });
  const black = mat('#141416', { roughness: 0.55 });
  const plastic = mat('#26272b', { roughness: 0.8 });
  const steel = mat('#8b8d92', { metalness: 0.85, roughness: 0.32 });
  const cageM = mat('#16171a', { metalness: 0.6, roughness: 0.4 });
  const seatM = mat('#202125', { roughness: 0.9 });
  const seatAcc = mat('#c8102e', { roughness: 0.8 });
  const lampM = new THREE.MeshStandardMaterial({ color: '#fff7dd', emissive: '#fff2c4', emissiveIntensity: 2.2 });
  const tailDim = new THREE.MeshStandardMaterial({ color: '#701018', emissive: '#a00c18', emissiveIntensity: 0.9 });
  const brakeM = new THREE.MeshBasicMaterial({ color: '#ff1d2b' });
  const revM = new THREE.MeshBasicMaterial({ color: '#f2f6ff' });

  const add = (geo, m, x = 0, y = 0, z = 0, parent = body) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };

  // ---- lower tub & side sills (dark plastic)
  add(new THREE.BoxGeometry(1.34, 0.12, 2.5), black, 0, 0.36, -0.1);
  add(profile([[-1.35, 0.4], [-1.55, 0.52], [-1.62, 0.78], [-1.0, 0.92], [0.3, 0.86], [0.55, 0.7], [0.55, 0.4]], 1.36), plastic);
  // ---- painted hood / nose
  add(profile([[0.4, 0.5], [0.4, 0.92], [1.0, 0.98], [1.55, 0.86], [1.78, 0.7], [1.8, 0.52], [1.5, 0.42]], 1.34, 0.07), paintM);
  // ---- doors / side panels (low, open style)
  for (const sx of [1, -1]) {
    const door = add(profile([[-0.55, 0.42], [-0.5, 0.82], [0.1, 0.9], [0.45, 0.82], [0.45, 0.42]], 0.12, 0.035), paintM, 0.66 * sx, 0, 0.0);
    door.scale.x = 1;
    // side nets
    add(new THREE.BoxGeometry(0.02, 0.4, 0.75), plastic, 0.62 * sx, 1.08, -0.12).material = mat('#222', { transparent: true, opacity: 0.55 });
  }
  // ---- fenders over wheels
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const f = add(new THREE.BoxGeometry(0.42, 0.07, 0.8), paintM, WX * sx, 0.84, WZ * sz);
    f.rotation.x = 0;
    add(new THREE.BoxGeometry(0.07, 0.2, 0.7), paintM, (WX + 0.2) * sx, 0.77, WZ * sz);
  }
  // ---- rear deck
  add(profile([[-1.0, 0.85], [-1.2, 0.95], [-1.62, 0.84], [-1.65, 0.62], [-1.0, 0.6]], 1.2, 0.05), paintM);
  add(new THREE.BoxGeometry(1.0, 0.08, 0.6), plastic, 0, 0.95, -1.2);
  // ---- seats
  for (const sx of [0.3, -0.3]) {
    add(new THREE.BoxGeometry(0.46, 0.14, 0.5), seatM, sx, 0.62, -0.25);
    const bk = add(new THREE.BoxGeometry(0.46, 0.62, 0.14), seatM, sx, 0.95, -0.55); bk.rotation.x = -0.12;
    add(new THREE.BoxGeometry(0.1, 0.5, 0.04), seatAcc, sx, 0.97, -0.46);
    add(new THREE.BoxGeometry(0.34, 0.16, 0.12), seatM, sx, 1.34, -0.6);        // head rest
  }
  // dash + steering wheel
  add(new THREE.BoxGeometry(1.2, 0.2, 0.3), plastic, 0, 1.0, 0.5);
  const sw = add(new THREE.TorusGeometry(0.15, 0.025, 8, 18), black, 0.3, 1.1, 0.28); sw.rotation.x = 1.15;

  // ---- roll cage
  const cage = [
    [[0.58, 0.8, 0.5], [0.5, 1.5, 0.05]], [[0.5, 1.5, 0.05], [0.55, 1.5, -0.85]], [[0.55, 1.5, -0.85], [0.6, 0.8, -0.85]],
    [[0.5, 1.5, 0.05], [0.62, 1.05, 0.55]], [[0.6, 1.05, 0.0], [0.6, 1.05, -0.85]],
    [[0.58, 0.8, 0.5], [0.6, 1.05, 0.55]], [[0.55, 1.5, -0.85], [0.45, 1.0, -1.35]],
  ];
  for (const [a, b] of cage) for (const sx of [1, -1]) {
    body.add(tube([a[0] * sx, a[1], a[2]], [b[0] * sx, b[1], b[2]], 0.034, cageM));
  }
  body.add(tube([-0.5, 1.5, 0.05], [0.5, 1.5, 0.05], 0.03, cageM));
  body.add(tube([-0.55, 1.5, -0.85], [0.55, 1.5, -0.85], 0.03, cageM));
  body.add(tube([-0.5, 1.5, -0.4], [0.5, 1.5, -0.4], 0.03, cageM));
  // roof panel
  add(new THREE.BoxGeometry(1.05, 0.04, 0.85), paintM, 0, 1.53, -0.4);
  // roof light bar
  add(new THREE.BoxGeometry(0.9, 0.06, 0.07), black, 0, 1.56, 0.08);
  add(new THREE.BoxGeometry(0.84, 0.04, 0.02), lampM, 0, 1.56, 0.12);

  // ---- bumpers
  body.add(tube([-0.6, 0.55, 1.82], [0.6, 0.55, 1.82], 0.04, cageM));
  body.add(tube([-0.6, 0.55, 1.82], [-0.5, 0.82, 1.55], 0.032, cageM));
  body.add(tube([0.6, 0.55, 1.82], [0.5, 0.82, 1.55], 0.032, cageM));
  add(new THREE.BoxGeometry(1.0, 0.07, 0.5), steel, 0, 0.3, 1.5);                  // skid plate
  add(new THREE.BoxGeometry(0.9, 0.06, 0.4), steel, 0, 0.32, -1.5);
  body.add(tube([-0.55, 0.62, -1.7], [0.55, 0.62, -1.7], 0.04, cageM));

  // ---- lights
  for (const sx of [1, -1]) {
    add(new THREE.BoxGeometry(0.3, 0.07, 0.04), lampM, 0.42 * sx, 0.78, 1.8).rotation.y = 0;
    add(new THREE.BoxGeometry(0.2, 0.05, 0.03), tailDim, 0.48 * sx, 0.8, -1.64);
  }
  const brakeLights = [], reverseLights = [];
  for (const sx of [1, -1]) {
    const b = add(new THREE.BoxGeometry(0.22, 0.06, 0.04), brakeM, 0.48 * sx, 0.8, -1.66); b.visible = false; brakeLights.push(b);
    const r = add(new THREE.BoxGeometry(0.1, 0.04, 0.04), revM, 0.28 * sx, 0.7, -1.66); r.visible = false; reverseLights.push(r);
  }
  // exhaust
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12).rotateX(Math.PI / 2), steel, 0.2, 0.62, -1.7);
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12).rotateX(Math.PI / 2), steel, -0.2, 0.62, -1.7);

  // ---- wheels
  const tyreG = new THREE.CylinderGeometry(WR, WR, 0.34, 28).rotateZ(Math.PI / 2);
  const tyreM = mat('#0d0d0e', { roughness: 0.95 });
  const rimG = new THREE.CylinderGeometry(0.2, 0.2, 0.345, 20).rotateZ(Math.PI / 2);
  const rimM = mat('#d8dade', { metalness: 0.9, roughness: 0.25 });
  const hubG = new THREE.CylinderGeometry(0.07, 0.07, 0.36, 10).rotateZ(Math.PI / 2);
  const lugG = new THREE.BoxGeometry(0.34, 0.05, 0.07);
  const wheels = [];
  for (const [front, left] of [[true, true], [true, false], [false, true], [false, false]]) {
    const sxs = left ? 1 : -1;
    const steer = new THREE.Group();
    steer.position.set(WX * sxs, 0.374, front ? WZ : -WZ);
    root.add(steer);
    const spin = new THREE.Group(); steer.add(spin);
    const t = new THREE.Mesh(tyreG, tyreM); spin.add(t);
    for (let i = 0; i < 18; i++) {
      const lug = new THREE.Mesh(lugG, tyreM);
      const a = (i / 18) * Math.PI * 2;
      lug.position.set(0, Math.sin(a) * (WR + 0.01), Math.cos(a) * (WR + 0.01));
      lug.rotation.x = -a;
      spin.add(lug);
    }
    spin.add(new THREE.Mesh(rimG, rimM), new THREE.Mesh(hubG, black));
    for (let i = 0; i < 5; i++) {   // spokes
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.352, 0.03, 0.34), black);
      sp.rotation.x = (i / 5) * Math.PI; spin.add(sp);
    }
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.1), new THREE.MeshStandardMaterial({ color: '#e0a000', roughness: 0.4 }));
    cal.position.set(-0.08 * sxs, 0.06, 0.16); steer.add(cal);
    // A-arm toward the chassis (stays at ride height, purely visual)
    wheels.push({ steer, spin, baseY: 0.374, front, left });
    for (const m of [t]) { m.castShadow = true; }
  }
  // flames
  const flameTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(32, 30, 2, 32, 50, 60);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(120,220,255,1)');
    g.addColorStop(0.55, 'rgba(60,90,255,0.7)'); g.addColorStop(1, 'rgba(0,0,80,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 128);
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  })();
  const flames = [];
  for (const x of [0.2, -0.2]) {
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.4).translate(0, -0.6, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    sp.position.set(x, 0.62, -1.88);
    sp.visible = false;
    const sp2 = sp.clone(); sp2.rotation.z = Math.PI / 2; sp.add(sp2);
    root.add(sp); flames.push(sp);
  }

  root.traverse(o => { if (o.isMesh && !o.material.isMeshBasicMaterial) { o.castShadow = true; o.receiveShadow = true; } });
  return {
    root, wheels, paint: paintM, brakeLights, reverseLights, flames,
    setPaint(hex) { paintM.color.set(hex); },
  };
}
