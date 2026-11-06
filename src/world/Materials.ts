import * as THREE from 'three/webgpu';
import {
  abs, attribute, clamp, float, floor, fract, fwidth, hash, max, min, mix, mx_noise_float, normalWorld, normalMap,
  positionLocal, sin, smoothstep, step, texture, uv, vec2, vec3, vec4, instanceColor, select, length, cos, positionWorld,
} from 'three/tsl';
import { U, absPos } from '../core/Uniforms';

/**
 * Material library (TSL node materials).  All surface detail is procedural or from shared textures so that
 * 170k buildings / 56k road segments can be rendered with a handful of draw calls per tile.
 */
type N = any; // TSL nodes are loosely typed

const n01 = (p: N) => mx_noise_float(p).mul(0.5).add(0.5);

// ------------------------------------------------------------------ terrain
export function terrainMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const s: N = attribute('surf', 'vec4'); // grass, forest, sand, rock
  const p: N = absPos;
  const nLarge = n01(p.xz.mul(0.012));
  const nMid = n01(p.xz.mul(0.09));
  const nFine = n01(p.xz.mul(0.9));
  const urban = mix(vec3(0.33, 0.32, 0.30), vec3(0.42, 0.40, 0.37), nMid).mul(mix(0.85, 1.1, nFine));
  const yards = mix(vec3(0.19, 0.25, 0.12), vec3(0.30, 0.31, 0.18), nLarge);
  const urbanMix = mix(urban, yards, smoothstep(0.45, 0.75, nLarge).mul(0.55));
  const grass = mix(vec3(0.16, 0.27, 0.08), vec3(0.30, 0.38, 0.13), nMid).mul(mix(0.8, 1.15, nFine));
  const dry = vec3(0.47, 0.42, 0.26);
  const grassC = mix(grass, dry, smoothstep(0.55, 0.9, nLarge).mul(0.6));
  const forest = mix(vec3(0.09, 0.14, 0.06), vec3(0.16, 0.19, 0.09), nFine);
  const sand = mix(vec3(0.70, 0.64, 0.50), vec3(0.80, 0.74, 0.60), nMid);
  const rock = mix(vec3(0.36, 0.34, 0.31), vec3(0.50, 0.47, 0.42), nFine);
  const slope = smoothstep(0.32, 0.6, normalWorld.y.oneMinus());
  const sumW = clamp(s.x.add(s.y).add(s.z).add(s.w), 0, 1);
  let c: N = urbanMix.mul(sumW.oneMinus());
  c = c.add(grassC.mul(s.x)).add(forest.mul(s.y)).add(sand.mul(s.z)).add(rock.mul(s.w));
  c = mix(c, rock, slope.mul(s.z.oneMinus()).mul(0.7));
  // seabed / wet shoreline
  const under = smoothstep(0.6, -0.4, p.y);
  c = mix(c, mix(vec3(0.35, 0.33, 0.27), vec3(0.12, 0.14, 0.12), smoothstep(0, -8, p.y)), under);
  const wet = U.wet.mul(s.z.oneMinus());
  m.colorNode = c.mul(mix(1, 0.62, wet));
  m.roughnessNode = mix(mix(0.95, 0.85, s.z), 0.35, wet);
  m.metalnessNode = float(0);
  return m;
}

// ------------------------------------------------------------------ roads
/**
 * uv.x = lateral offset (m, +right of travel direction start→end), uv.y = distance along edge (m)
 * rinfo = (halfWidth, lanes, oneway, class)  rj = (dStart, dEnd, junctionRadiusStart, junctionRadiusEnd)
 */
export function roadMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
  const ri: N = attribute('rinfo', 'vec4');
  const rj: N = attribute('rj', 'vec4');
  const x: N = uv().x, y: N = uv().y;
  const hw = ri.x, lanes = ri.y, oneway = ri.z, cls = ri.w;
  const p: N = absPos;
  const ax = abs(x);
  const fw = max(fwidth(x), 0.02);
  const line = (center: N, width: N) => clamp(width.mul(0.5).sub(abs(x.sub(center))).div(fw).add(0.5), 0, 1);

  const inJ = max(step(rj.x, rj.z), step(rj.y, rj.w)); // inside a junction box
  const keep = inJ.oneMinus();
  const major = step(cls, 4.5);
  // centre double-yellow (two-way major roads)
  const dbl = max(line(float(0.13), float(0.11)), line(float(-0.13), float(0.11))).mul(oneway.oneMinus()).mul(major);
  // edge lines
  const edge = line(hw.sub(0.45), float(0.13)).add(line(hw.sub(0.45).negate(), float(0.13))).mul(step(cls, 3.5));
  // lane dividers (dashed)
  const laneW = select(oneway.greaterThan(0.5), hw.mul(2).div(max(lanes, 1)), hw.div(max(lanes, 1)));
  const off = select(oneway.greaterThan(0.5), x.add(hw), ax);
  const kf = off.div(laneW);
  const nearB = abs(kf.sub(floor(kf.add(0.5)))).mul(laneW);
  const kIdx = floor(kf.add(0.5));
  const validK = step(0.5, kIdx).mul(step(kIdx, lanes.sub(0.5)));
  const dash = step(fract(y.div(9.0)), 0.36);
  const div = clamp(float(0.06).sub(nearB).div(fw).add(0.5), 0, 1).mul(validK).mul(dash).mul(step(lanes, 6)).mul(step(1.5, lanes));
  // crosswalks (continental ladder) just outside junction boxes at signalised/major junctions
  const cwS = step(rj.z, rj.x).mul(step(rj.x, rj.z.add(3.4))).mul(step(0.5, rj.z));
  const cwE = step(rj.w, rj.y).mul(step(rj.y, rj.w.add(3.4))).mul(step(0.5, rj.w));
  const zebra = step(fract(x.div(1.1)), 0.5).mul(max(cwS, cwE)).mul(step(ax, hw.sub(0.3)));
  // stop line for traffic approaching the end node (right-hand side)
  const stopE = step(rj.w.add(3.9), rj.y).mul(step(rj.y, rj.w.add(4.35))).mul(step(0.5, rj.w))
    .mul(select(oneway.greaterThan(0.5), float(1), step(0, x))).mul(step(ax, hw.sub(0.3)));
  const stopS = step(rj.z.add(3.9), rj.x).mul(step(rj.x, rj.z.add(4.35))).mul(step(0.5, rj.z))
    .mul(select(oneway.greaterThan(0.5), float(0), step(x, 0))).mul(step(ax, hw.sub(0.3)));
  const wear = n01(vec2(x.mul(2.0), y.mul(0.35))).mul(0.5).add(0.5);
  const white = clamp(edge.add(div).mul(keep).add(zebra).add(stopE).add(stopS), 0, 1).mul(smoothstep(0.25, 0.6, wear));
  const yellow = dbl.mul(keep).mul(smoothstep(0.2, 0.5, wear));

  // asphalt
  const nPatch = n01(p.xz.mul(0.045));
  const nGrain = n01(p.xz.mul(3.1));
  const nMid = n01(p.xz.mul(0.4));
  let asph: N = mix(vec3(0.085, 0.085, 0.09), vec3(0.13, 0.128, 0.125), nMid).mul(mix(0.82, 1.12, nGrain));
  asph = mix(asph, asph.mul(1.35), step(0.68, nPatch)); // repaved patches
  // tyre polish in lane centres
  const lanePos = fract(off.div(laneW));
  const tyre = smoothstep(0.12, 0.0, abs(lanePos.sub(0.3))).add(smoothstep(0.12, 0.0, abs(lanePos.sub(0.7)))).mul(0.12);
  asph = asph.mul(float(1).sub(tyre));
  // gutter / curb darkening
  asph = mix(asph, asph.mul(0.7), smoothstep(hw.sub(0.6), hw, ax));
  const puddle = smoothstep(0.55, 0.7, n01(p.xz.mul(0.13))).mul(U.wet);
  const paintWhite = vec3(0.82, 0.82, 0.78), paintYellow = vec3(0.85, 0.62, 0.12);
  let col: N = mix(asph, paintWhite, white);
  col = mix(col, paintYellow, yellow);
  col = col.mul(mix(1, 0.55, U.wet.mul(0.85)));
  m.colorNode = col;
  m.roughnessNode = mix(mix(0.88, 0.62, max(white, yellow)), mix(0.22, 0.04, puddle), U.wet);
  m.metalnessNode = float(0);
  return m;
}

export function sidewalkMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
  const y: N = uv().y, x: N = uv().x;
  const p: N = absPos;
  const joint = smoothstep(0.03, 0.0, abs(fract(y.div(1.5)).sub(0.5)).sub(0.47)).mul(0.25);
  const curb = smoothstep(0.25, 0.0, x); // x = 0 at curb edge
  const base = mix(vec3(0.52, 0.51, 0.48), vec3(0.62, 0.60, 0.56), n01(p.xz.mul(0.7)));
  m.colorNode = mix(base.mul(float(1).sub(joint)), vec3(0.66, 0.64, 0.6), curb.mul(0.5)).mul(mix(1, 0.6, U.wet));
  m.roughnessNode = mix(0.85, 0.3, U.wet);
  return m;
}

// ------------------------------------------------------------------ buildings
/**
 * Procedural facades. Attributes:
 *   uv = (u metres along the facade perimeter, v metres above the building base)
 *   binfo = (style, seed 0..1, floor height, kind 0 wall / 1 roof / 2 trim)
 *   color = facade base colour
 * styles: 0 glass tower, 1 modern office, 2 classic masonry, 3 victorian, 4 stucco, 5 brick, 6 industrial, 7 chinatown, 8 painted lady
 */
export function buildingMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.vertexColors = true;
  const bi: N = attribute('binfo', 'vec4');
  const base: N = attribute('color', 'vec3');
  const st = bi.x, seed = bi.y, flH = bi.z, kind = bi.w;
  const u: N = uv().x, v: N = uv().y;
  const is = (k: number) => step(abs(st.sub(k)), 0.5);
  const glass = is(0), office = is(1), mason = is(2), vict = max(is(3), is(8)), stucco = is(4), brick = is(5), indus = is(6), china = is(7);
  // bay width per style
  const bw: N = glass.mul(1.6).add(office.mul(2.1)).add(mason.mul(2.4)).add(vict.mul(1.55)).add(stucco.mul(2.6))
    .add(brick.mul(2.8)).add(indus.mul(5.0)).add(china.mul(2.3));
  const fl = floor(v.div(flH));
  const fv = fract(v.div(flH));
  const col = floor(u.div(bw));
  const fu = fract(u.div(bw));
  // window extents per style (horizontal margin, sill, head)
  const mh: N = glass.mul(0.04).add(office.mul(0.16)).add(mason.mul(0.26)).add(vict.mul(0.24)).add(stucco.mul(0.24))
    .add(brick.mul(0.22)).add(indus.mul(0.1)).add(china.mul(0.2));
  const sill: N = glass.mul(0.1).add(office.mul(0.3)).add(mason.mul(0.28)).add(vict.mul(0.2)).add(stucco.mul(0.3))
    .add(brick.mul(0.25)).add(indus.mul(0.55)).add(china.mul(0.3));
  const head: N = glass.mul(0.97).add(office.mul(0.86)).add(mason.mul(0.82)).add(vict.mul(0.86)).add(stucco.mul(0.8))
    .add(brick.mul(0.8)).add(indus.mul(0.85)).add(china.mul(0.8));
  // per-building column skipping for residential variety (blank wall bays)
  const skip = step(0.82, hash(col.add(seed.mul(911.0)))).mul(stucco.add(vict).add(brick));
  const ground = step(fl, 0.5);
  const shop = ground.mul(glass.add(office).add(mason).add(china).add(brick.mul(0.6)));
  const winH = smoothstep(mh.sub(0.015), mh, fu).mul(smoothstep(mh.sub(0.015), mh, fu.oneMinus()));
  const winV = select(shop.greaterThan(0.5), step(0.08, fv).mul(step(fv, 0.9)), smoothstep(sill.sub(0.01), sill, fv).mul(smoothstep(head.add(0.01), head, fv)));
  let win: N = winH.mul(winV).mul(skip.oneMinus());
  // anti-aliasing: blend the pattern towards its average when the facade is far away
  const aa = clamp(max(fwidth(u).div(bw), fwidth(v).div(flH)).mul(2.5).sub(0.4), 0, 1);
  const fillRatio = float(1).sub(mh.mul(2)).mul(head.sub(sill));
  win = mix(win, fillRatio, aa);
  const isWall = step(kind, 0.5);
  win = win.mul(isWall);
  // facade colour with weathering
  const p: N = absPos;
  const grime = n01(vec2(u.mul(0.15), v.mul(0.05)).add(seed.mul(40))).mul(0.25);
  const dirtBottom = smoothstep(3.0, 0.0, v).mul(0.18);
  let wall: N = base.mul(float(1).sub(grime).sub(dirtBottom));
  // spandrels for curtain walls / office floor bands
  const band = smoothstep(0.1, 0.08, fv).mul(glass.add(office.mul(0.6)));
  wall = mix(wall, wall.mul(0.55), band);
  // brick texture (coarse)
  const brickRow = floor(v.div(0.09));
  const brickN = hash(floor(u.div(0.24).add(brickRow.mul(0.5))).add(brickRow.mul(17.0)));
  wall = mix(wall, wall.mul(mix(0.85, 1.1, brickN)), brick.mul(aa.oneMinus()));
  // victorian / painted lady white trim: window surrounds + cornice
  const frameW = winH.mul(winV).oneMinus().mul(
    smoothstep(mh.sub(0.08), mh.sub(0.05), fu).mul(smoothstep(mh.sub(0.08), mh.sub(0.05), fu.oneMinus()))
      .mul(smoothstep(sill.sub(0.07), sill.sub(0.04), fv)).mul(smoothstep(head.add(0.07), head.add(0.04), fv)));
  const cornice = smoothstep(0.93, 0.95, fv);
  const trim = clamp(frameW.add(cornice), 0, 1).mul(vict.add(stucco.mul(0.35)).add(mason.mul(0.5)).add(china.mul(0.4))).mul(aa.oneMinus()).mul(isWall);
  const trimCol = select(is(8).greaterThan(0.5), vec3(0.95, 0.93, 0.88), mix(vec3(0.93, 0.92, 0.88), base.mul(0.6), china));
  wall = mix(wall, trimCol, trim);
  // chinatown red accents on lower floors
  wall = mix(wall, vec3(0.55, 0.08, 0.06), china.mul(smoothstep(0.95, 1.0, fv)).mul(step(fl, 2.5)).mul(isWall));

  // glass colour: sky-tinted, varies per pane
  const pane = hash(col.mul(13.1).add(fl.mul(71.7)).add(seed.mul(1000)));
  const glassCol = mix(vec3(0.05, 0.07, 0.09), vec3(0.16, 0.22, 0.27), pane.mul(0.6).add(glass.mul(0.4)));
  // roof
  const roofN = n01(p.xz.mul(0.35));
  const roofCol = mix(vec3(0.24, 0.24, 0.23), vec3(0.38, 0.37, 0.35), roofN).mul(mix(1, 0.6, U.wet));
  const isRoof = step(0.5, kind).mul(step(kind, 1.5));
  let c: N = mix(wall, glassCol, win);
  c = mix(c, roofCol, isRoof);
  // night-time lit windows (warm residential, cool office)
  const litRand = hash(col.mul(3.7).add(fl.mul(19.3)).add(seed.mul(523.0)).add(floor(U.time.mul(0.003).add(seed))));
  const occupancy = mix(0.35, 0.6, glass.add(office));
  const lit = step(litRand, occupancy).mul(win).mul(isWall);
  const warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), glass.add(office).mul(0.7));
  const shopGlow = shop.mul(win).mul(0.6);
  const emi = warm.mul(lit.mul(mix(0.6, 1.6, hash(fl.add(col.mul(2.3)))) ).add(shopGlow)).mul(U.night).mul(0.75);
  m.colorNode = c;
  m.emissiveNode = emi;
  m.roughnessNode = mix(mix(0.85, 0.7, stucco), mix(0.06, 0.14, pane), win).add(isRoof.mul(0.1));
  m.metalnessNode = win.mul(mix(0.55, 0.85, glass));
  return m;
}

/** Simple far-LOD building material (no facade pattern, averaged window tone + night speckle). */
export function buildingFarMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.vertexColors = true;
  const bi: N = attribute('binfo', 'vec4');
  const base: N = attribute('color', 'vec3');
  const st = bi.x, kind = bi.w;
  const glassy = step(abs(st), 0.5).add(step(abs(st.sub(1)), 0.5).mul(0.5));
  const avgWin = mix(0.32, 0.72, glassy);
  const glassCol = vec3(0.1, 0.13, 0.16);
  const wall = mix(base.mul(0.9), glassCol, avgWin);
  const isRoof = step(0.5, kind);
  const c = mix(wall, vec3(0.3, 0.3, 0.29), isRoof);
  m.colorNode = c;
  const v: N = uv().y, u: N = uv().x;
  const speck = step(hash(floor(u.div(2.0)).add(floor(v.div(3.4)).mul(37.0)).add(bi.y.mul(100))), 0.4);
  m.emissiveNode = vec3(1.0, 0.8, 0.55).mul(speck.mul(avgWin).mul(isRoof.oneMinus())).mul(U.night).mul(0.45);
  m.roughnessNode = mix(0.85, 0.25, avgWin.mul(isRoof.oneMinus()));
  m.metalnessNode = avgWin.mul(0.5).mul(isRoof.oneMinus());
  return m;
}

// ------------------------------------------------------------------ water
export function waterMaterial(normalTex: THREE.Texture, heightTex: THREE.Texture, grid: { x0: number; z0: number; w: number; h: number; step: number }): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
  const p: N = absPos;
  const t: N = U.time;
  const uv1 = p.xz.mul(1 / 38).add(vec2(t.mul(0.011), t.mul(0.007)));
  const uv2 = p.xz.mul(1 / 13).add(vec2(t.mul(-0.016), t.mul(0.012)));
  const uv3 = p.xz.mul(1 / 160).add(vec2(t.mul(0.003), t.mul(-0.004)));
  const nA: N = texture(normalTex, uv1).xyz;
  const nB: N = texture(normalTex, uv2).xyz;
  const nC: N = texture(normalTex, uv3).xyz;
  const nrm = nA.add(nB).add(nC).div(3);
  m.normalNode = normalMap(vec4(nrm, 1), vec2(mix(0.55, 0.9, U.rain)));
  // depth from terrain heightmap → shallow colour + shoreline foam
  const huv = vec2(p.x.sub(grid.x0).div(grid.step * (grid.w - 1)), p.z.sub(grid.z0).div(grid.step * (grid.h - 1)));
  const ground: N = texture(heightTex, huv).r;
  const depth = clamp(ground.negate(), 0, 60);
  const deep = vec3(0.025, 0.065, 0.08);
  const mid = vec3(0.05, 0.13, 0.13);
  const shallow = vec3(0.16, 0.24, 0.20);
  let c: N = mix(shallow, mid, smoothstep(0.0, 4.0, depth));
  c = mix(c, deep, smoothstep(4.0, 30.0, depth));
  const foamN = n01(p.xz.mul(0.4).add(vec2(t.mul(0.05), 0)));
  const foam = smoothstep(1.6, 0.2, depth).mul(smoothstep(0.35, 0.7, foamN.add(sin(depth.mul(4.0).sub(t.mul(1.3))).mul(0.25))));
  c = mix(c, vec3(0.85, 0.88, 0.88), foam.mul(0.8));
  m.colorNode = c;
  m.roughnessNode = mix(0.035, 0.12, U.rain).add(foam.mul(0.5));
  m.metalnessNode = float(0);
  m.ior = 1.333;
  m.specularIntensity = 1;
  return m;
}

// ------------------------------------------------------------------ vegetation
export function foliageMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.vertexColors = true;
  const p: N = absPos;
  const h = positionLocal.y;
  const sway = sin(U.time.mul(1.4).add(p.x.mul(0.05)).add(p.z.mul(0.07))).mul(0.08).mul(h.mul(0.1)).mul(mix(1, 3, U.rain));
  m.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.6)));
  const vc: N = attribute('color', 'vec3');
  const nn = n01(p.xyz.mul(0.8));
  m.colorNode = vc.mul(mix(0.75, 1.15, nn)); // per-instance tint applied automatically
  m.roughnessNode = float(0.85);
  return m;
}

export function barkMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.vertexColors = true;
  const vc: N = attribute('color', 'vec3');
  m.colorNode = vc.mul(mix(0.8, 1.1, n01(absPos.mul(vec3(4, 0.6, 4)))));
  m.roughnessNode = float(0.95);
  return m;
}

export function concreteMaterial(color = 0x9a978f, rough = 0.9): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const p: N = absPos;
  const c = new THREE.Color(color);
  m.colorNode = vec3(c.r, c.g, c.b).mul(mix(0.8, 1.1, n01(p.mul(0.3)))).mul(mix(1, 0.7, U.wet));
  m.roughnessNode = float(rough);
  return m;
}

export function paintedMetal(color: number, rough = 0.45, metal = 0.6): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color, roughness: rough, metalness: metal });
  return m;
}

/** emissive lamp heads: glow at night */
export function lampMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0xfff4dd, roughness: 0.3 });
  m.emissiveNode = vec3(1.0, 0.82, 0.55).mul(U.lampIntensity.mul(6.0));
  return m;
}

export { length, cos, positionWorld };
