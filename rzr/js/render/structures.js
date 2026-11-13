// Alpine buildings assembled from scanned PBR materials (log walls, slate roofs,
// rubble-stone foundations, weathered planks). World-scaled UVs keep texel density right.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
function mat(name, opts = {}) {
  const t = (s, srgb) => { const x = loader.load(`assets/textures/${name}_${s}.jpg`); if (srgb) x.colorSpace = THREE.SRGBColorSpace; x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = 8; return x; };
  return new THREE.MeshStandardMaterial({ map: t('diff', true), normalMap: t('nor'), roughnessMap: t('arm'), aoMap: t('arm'), roughness: 1, ...opts });
}

// box with UVs in metres / tile
function box(w, h, d, tile = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const u = ax > 0.5 ? p.getZ(i) : p.getX(i), v = ay > 0.5 ? p.getZ(i) : p.getY(i);
    uv.setXY(i, u / tile, v / tile);
  }
  g.setAttribute('uv2', uv.clone());
  return g;
}

function gableRoof(w, d, rise, overhang, tile = 2) {
  // two sloped slabs meeting at the ridge (along z)
  const g = new THREE.BufferGeometry();
  const W = w / 2 + overhang, D = d / 2 + overhang, t = 0.18;
  const v = [], uv = [], idx = [];
  const quad = (a, b, c, e, uvs) => { const o = v.length / 3; v.push(...a, ...b, ...c, ...e); uv.push(...uvs); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  const slope = Math.hypot(W, rise);
  for (const s of [-1, 1]) {
    quad([0, rise, -D], [s * W, 0, -D], [s * W, 0, D], [0, rise, D], [0, 0, slope / tile, 0, slope / tile, 2 * D / tile, 0, 2 * D / tile]);
    quad([0, rise - t, D], [s * W, -t, D], [s * W, -t, -D], [0, rise - t, -D], [0, 0, slope / tile, 0, slope / tile, 2 * D / tile, 0, 2 * D / tile]);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function gableWall(w, rise) {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
  const g = new THREE.ShapeGeometry(s);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 2, p.getY(i) / 2);
  return g;
}

class Structures {
  constructor(game) {
    this.group = new THREE.Group();
    const M = {
      logs: mat('wood_logs'), slate: mat('roof_slate', { side: THREE.DoubleSide }), stone: mat('stone_wall'), planks: mat('planks'),
      dark: new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 0.6 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.08, metalness: 0.1, envMapIntensity: 1.2 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x5b3f2a, roughness: 0.8 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x6d7174, roughness: 0.45, metalness: 0.8 }),
    };
    this.M = M;
    for (const b of game.world.meta.buildings) {
      const grp = this['_' + b.type] ? this['_' + b.type](b) : this._cabin(b);
      grp.position.set(b.x, b.y, b.z);
      grp.rotation.y = b.rot;
      grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(grp);
      if (b.type !== 'ruin') game.collision.add({ type: 'box', x: b.x, z: b.z, y: b.y - 0.5, hy: 8, hx: b.w / 2 + 0.2, hz: b.d / 2 + 0.2, rot: b.rot });
      else game.collision.add({ type: 'box', x: b.x, z: b.z, y: b.y - 0.5, hy: 2.5, hx: b.w / 2, hz: b.d / 2, rot: b.rot });
    }
    // a fence line along the village meadow
    const v = game.world.meta.village;
    const field = game.world.field;
    for (let i = 0; i < 40; i++) {
      const x = v.x - 260 + i * 6, z = v.z + 300 + Math.sin(i * 0.3) * 6;
      if (field.mask(x, z, 4) > 0.2 || field.waterLevel(x, z) > field.baseHeight(x, z)) continue;
      const y = field.baseHeight(x, z);
      const post = new THREE.Mesh(box(0.14, 1.3, 0.14, 1), M.trim); post.position.set(x, y + 0.6, z); this.group.add(post);
      const rail = new THREE.Mesh(box(6, 0.1, 0.08, 2), M.planks); rail.position.set(x + 3, y + 1.0, z); this.group.add(rail);
    }
    game.scene.add(this.group);
  }

  _walls(g, w, d, h, wallMat, foundation = 0.6) {
    const M = this.M;
    const base = new THREE.Mesh(box(w + 0.3, foundation + 0.8, d + 0.3, 2), M.stone);
    base.position.y = foundation / 2 - 0.4; g.add(base);
    const walls = new THREE.Mesh(box(w, h, d, 2.2), wallMat);
    walls.position.y = foundation + h / 2; g.add(walls);
    // corner log ends
    if (wallMat === M.logs) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, h, 8), M.trim);
      c.position.set(sx * (w / 2 + 0.05), foundation + h / 2, sz * (d / 2 + 0.05)); g.add(c);
    }
    return foundation + h;
  }
  _windows(g, w, d, y0, n = 2) {
    const M = this.M;
    for (let i = 0; i < n; i++) {
      for (const side of [-1, 1]) {
        const fr = new THREE.Mesh(box(1.1, 1.0, 0.12, 1), M.trim);
        const x = -w / 2 + (i + 0.5) * w / n;
        fr.position.set(x, y0 + 1.4, side * (d / 2 + 0.02)); g.add(fr);
        const gl = new THREE.Mesh(box(0.9, 0.8, 0.13, 1), M.glass);
        gl.position.copy(fr.position); gl.position.z += side * 0.01; g.add(gl);
        const sh = new THREE.Mesh(box(0.5, 1.05, 0.06, 1), M.planks);
        sh.position.set(x - 0.82, y0 + 1.4, side * (d / 2 + 0.08)); g.add(sh);
      }
    }
  }

  _cabin(b, wallMat) {
    const g = new THREE.Group(), M = this.M;
    const w = b.w, d = b.d, h = b.type === 'hut' ? 2.6 : 3.1;
    const top = this._walls(g, w, d, h, wallMat || M.logs);
    const rise = w * 0.42;
    const roof = new THREE.Mesh(gableRoof(w, d, rise, 0.7), M.slate); roof.position.y = top + 0.05; g.add(roof);
    for (const s of [-1, 1]) { const gw = new THREE.Mesh(gableWall(w, rise), wallMat || M.logs); gw.position.set(0, top, s * d / 2); if (s < 0) gw.rotation.y = Math.PI; g.add(gw); }
    this._windows(g, w, d, 0.6, b.type === 'hut' ? 1 : 2);
    const door = new THREE.Mesh(box(1.0, 2.0, 0.1, 1), M.planks); door.position.set(w / 2 + 0.01, 0.6 + 1.0, 0); door.rotation.y = Math.PI / 2; g.add(door);
    const ch = new THREE.Mesh(box(0.7, 2.2, 0.7, 1), M.stone); ch.position.set(w * 0.22, top + rise * 0.5 + 0.6, -d * 0.2); g.add(ch);
    // woodpile
    const pile = new THREE.Mesh(box(2.2, 1.1, 0.7, 0.6), M.logs); pile.position.set(-w / 2 - 0.6, 0.55, 0); pile.rotation.y = Math.PI / 2; g.add(pile);
    return g;
  }
  _hut(b) { return this._cabin(b); }
  _barn(b) {
    const g = this._cabin(b, this.M.planks);
    return g;
  }
  _chapel(b) {
    const g = new THREE.Group(), M = this.M;
    const top = this._walls(g, b.w, b.d, 4.2, M.stone);
    const rise = b.w * 0.55;
    const roof = new THREE.Mesh(gableRoof(b.w, b.d, rise, 0.5), M.slate); roof.position.y = top; g.add(roof);
    for (const s of [-1, 1]) { const gw = new THREE.Mesh(gableWall(b.w, rise), M.stone); gw.position.set(0, top, s * b.d / 2); if (s < 0) gw.rotation.y = Math.PI; g.add(gw); }
    const tower = new THREE.Mesh(box(2.4, 9, 2.4, 2), M.stone); tower.position.set(0, 4.5, b.d / 2 + 1.0); g.add(tower);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.9, 4.5, 4), M.slate); spire.position.set(0, 11.2, b.d / 2 + 1.0); spire.rotation.y = Math.PI / 4; g.add(spire);
    return g;
  }
  _garage(b) {
    // open-front timber workshop / off-road rest area with a fuel tank and bench
    const g = new THREE.Group(), M = this.M, w = b.w, d = b.d, h = 3.6;
    for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, -d / 2], [0, d / 2]]) {
      const p = new THREE.Mesh(box(0.25, h, 0.25, 1), M.trim); p.position.set(x, h / 2, z); g.add(p);
    }
    const back = new THREE.Mesh(box(0.2, h, d, 2), M.planks); back.position.set(-w / 2, h / 2, 0); g.add(back);
    for (const s of [-1, 1]) { const side = new THREE.Mesh(box(w, h, 0.2, 2), M.planks); side.position.set(0, h / 2, s * d / 2); g.add(side); }
    const roof = new THREE.Mesh(box(w + 1.2, 0.2, d + 1.2, 2), M.metal); roof.position.set(0, h + 0.35, 0); roof.rotation.z = -0.12; g.add(roof);
    const slab = new THREE.Mesh(box(w + 2, 0.3, d + 2, 2), M.stone); slab.position.y = -0.12; g.add(slab);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0xa8321e, roughness: 0.5, metalness: 0.4 }));
    tank.rotation.z = Math.PI / 2; tank.position.set(-w / 2 + 1.2, 1.1, d / 2 - 1.2); g.add(tank);
    const bench = new THREE.Mesh(box(2.5, 0.9, 0.8, 1), M.planks); bench.position.set(-w / 2 + 0.6, 0.45, -d / 2 + 2); bench.rotation.y = Math.PI / 2; g.add(bench);
    return g;
  }
  _shelter(b) {
    const g = new THREE.Group(), M = this.M, w = b.w, d = b.d;
    const wall = new THREE.Mesh(box(w, 1.8, 0.5, 2), M.stone); wall.position.set(0, 0.9, -d / 2); g.add(wall);
    for (const s of [-1, 1]) { const sw = new THREE.Mesh(box(0.5, 1.8, d, 2), M.stone); sw.position.set(s * w / 2, 0.9, 0); g.add(sw); }
    const roof = new THREE.Mesh(box(w + 0.8, 0.18, d + 1, 2), M.slate); roof.position.set(0, 2.2, 0.2); roof.rotation.x = 0.18; g.add(roof);
    return g;
  }
  _ruin(b) {
    // abandoned: broken rubble walls, no roof
    const g = new THREE.Group(), M = this.M, w = b.w, d = b.d;
    const seg = [[0, -d / 2, w, 2.4], [-w / 2, 0, d * 0.7, 1.6], [w / 2, d * 0.1, d * 0.5, 0.9], [w * 0.15, d / 2, w * 0.6, 1.3]];
    seg.forEach(([x, z, L, h], i) => {
      const along = i === 1 || i === 2;
      const m = new THREE.Mesh(box(along ? 0.55 : L, h, along ? L : 0.55, 2), M.stone);
      m.position.set(x, h / 2 - 0.1, z); g.add(m);
    });
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(box(0.6 + Math.random(), 0.4, 0.5 + Math.random() * 0.6, 1), M.stone);
      r.position.set((Math.random() - 0.5) * w, 0.1, (Math.random() - 0.5) * d); r.rotation.set(Math.random() * 0.3, Math.random() * 3, 0); g.add(r);
    }
    const beam = new THREE.Mesh(box(0.25, 0.25, d, 1), M.trim); beam.position.set(0.5, 0.4, 0); beam.rotation.set(0.25, 0.1, 0.4); g.add(beam);
    return g;
  }
}

export function create(game) { return new Structures(game); }
