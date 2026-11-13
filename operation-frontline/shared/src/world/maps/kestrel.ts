// KESTREL CROSSING — original urban conquest map for 8 v 8.
//
// Layout (X = east, Z = south, metres):
//   * Avenue (z -5..5) links the two team bases through objective B (the Crossing).
//   * North / South streets (|z| 37..45) and four cross streets form the flanking grid.
//   * A — Parkade: two-deck parking structure, south-west block.
//   * B — Crossing: central median with a monument, overlooked by the Bank (north)
//         and the Terminal Café (south); a pedestrian underpass crosses below the avenue.
//   * C — Construction site: unfinished concrete frame, north-east block.
//   * Residential blocks (north-west / south-east) with enterable apartments and shops.
// The street grid and filler blocks are rotationally symmetric for fairness; the three
// objective areas and the dressing are handcrafted.
import { TEAM_A, TEAM_B, type TeamId } from '../../config';
import { DEG } from '../../math';
import { type BuildingSpec, MapBuilder, type MapData, type Opening, type Side, type SpawnPoint } from '../MapBuilder';
import { F_NOCOLLIDE, F_WALL } from '../World';
import { MAT } from '../materials';

const G = 0.15; // sidewalk / block level

/** Applies an optional 180° rotation about the map origin to builder calls. */
class Flip {
  constructor(readonly b: MapBuilder, readonly s: 1 | -1) {}
  get f(): boolean { return this.s < 0; }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: number, flags: number = F_WALL, tint = 0): void {
    this.b.box(this.s * x0, y0, this.s * z0, this.s * x1, y1, this.s * z1, mat, flags, tint);
  }
  decor(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: number, tint = 0): void {
    this.box(x0, y0, z0, x1, y1, z1, mat, F_NOCOLLIDE, tint);
  }
  ramp(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, axis: 0 | 1, dir: 1 | -1, mat: number): void {
    this.b.ramp(this.s * x0, this.s * z0, this.s * x1, this.s * z1, y0, y1, axis, (dir * this.s) as 1 | -1, mat);
  }
  private ops(o: Opening[]): Opening[] {
    return this.f ? o.map((p) => ({ ...p, a0: -p.a1, a1: -p.a0 })) : o;
  }
  wallX(z: number, x0: number, x1: number, y0: number, y1: number, mat: number, tint = 0, openings: Opening[] = [], t = 0.3): void {
    if (this.f) this.b.wallX(-z - t, -x1, -x0, y0, y1, mat, tint, this.ops(openings), t);
    else this.b.wallX(z, x0, x1, y0, y1, mat, tint, openings, t);
  }
  wallZ(x: number, z0: number, z1: number, y0: number, y1: number, mat: number, tint = 0, openings: Opening[] = [], t = 0.3): void {
    if (this.f) this.b.wallZ(-x - t, -z1, -z0, y0, y1, mat, tint, this.ops(openings), t);
    else this.b.wallZ(x, z0, z1, y0, y1, mat, tint, openings, t);
  }
  building(o: BuildingSpec): void {
    if (!this.f) { this.b.building(o); return; }
    const flipSide: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };
    const flipStr = (str?: string): string | undefined => str?.split('').map((c) => flipSide[c as Side] ?? c).join('');
    this.b.building({
      ...o,
      x0: -o.x1, x1: -o.x0, z0: -o.z1, z1: -o.z0,
      doors: o.doors?.map((d) => ({ ...d, side: flipSide[d.side], at: -(d.at + (d.w ?? 2)) })),
      win: o.win ? { ...o.win, sides: flipStr(o.win.sides), shop: flipStr(o.win.shop) } : undefined,
      stairs: o.stairs ? { axis: o.stairs.axis, x: -(o.stairs.x + (o.stairs.axis === 'z' ? 4 : 6)), z: -(o.stairs.z + (o.stairs.axis === 'z' ? 6 : 4)) } : undefined,
      partitions: o.partitions?.map((p) => ({
        ...p, at: -(p.at + 0.2), door: -(p.door + 2),
        from: p.to !== undefined ? -p.to : undefined, to: p.from !== undefined ? -p.from : undefined,
      })),
    });
  }
  prop(model: string, x: number, y: number, z: number, yawDeg = 0, scale = 1, opts: Parameters<MapBuilder['prop']>[6] = {}): void {
    this.b.prop(model, this.s * x, y, this.s * z, yawDeg + (this.f ? 180 : 0), scale, opts);
  }
  barrel(x: number, y: number, z: number): void { this.b.barrel(this.s * x, y, this.s * z); }
  crate(x: number, y: number, z: number, yawDeg = 0, scale = 2): void { this.b.crate(this.s * x, y, this.s * z, yawDeg, scale); }
  sandbags(x0: number, z0: number, x1: number, z1: number, y: number, h = 1.1): void {
    this.b.sandbags(Math.min(this.s * x0, this.s * x1), Math.min(this.s * z0, this.s * z1), Math.max(this.s * x0, this.s * x1), Math.max(this.s * z0, this.s * z1), y, h);
  }
  container(x: number, y: number, z: number, alongX: boolean, tint: number): void { this.b.container(this.s * x, y, this.s * z, alongX, tint); }
  spawn(x: number, y: number, z: number, yawDeg: number): SpawnPoint {
    return { x: this.s * x, y, z: this.s * z, yaw: (yawDeg + (this.f ? 180 : 0)) * DEG };
  }
  light(x: number, y: number, z: number): void { this.b.light(this.s * x, y, this.s * z); }
}

const sp = (x: number, y: number, z: number, yawDeg: number): SpawnPoint => ({ x, y, z, yaw: yawDeg * DEG });

/** Jersey barrier (prop) – long axis along X at yaw 0. */
function barrier(f: Flip, x: number, y: number, z: number, yawDeg: number): void {
  f.prop('concrete_road_barrier', x, y, z, yawDeg, 1.45);
}

function dumpster(f: Flip, x: number, z: number, alongX: boolean, tint = 9): void {
  const hx = alongX ? 1.0 : 0.6, hz = alongX ? 0.6 : 1.0;
  f.box(x - hx, G, z - hz, x + hx, G + 1.2, z + hz, MAT.METAL, F_WALL, tint);
  f.decor(x - hx - 0.04, G + 1.2, z - hz - 0.04, x + hx + 0.04, G + 1.28, z + hz + 0.04, MAT.METAL, 12);
}

// ------------------------------------------------------------------ residential block (NW, mirrored to SE)
function residentialBlock(f: Flip): void {
  // Apartments: 3 floors, roof access
  f.building({
    x0: -56, z0: -35, x1: -44, z1: -17, floors: 3, mat: MAT.BRICK, tint: f.f ? 3 : 7, enterable: true,
    doors: [{ side: 'e', at: -29 }, { side: 's', at: -50 }],
    stairs: { x: -55, z: -32, axis: 'z' }, roofAccess: true,
    partitions: [{ axis: 'x', at: -24, door: -48.5, from: -51 }],
    win: { glass: 0.55 },
  });
  // Shops: 2 floors, storefront to the avenue side courtyard
  f.building({
    x0: -40, z0: -35, x1: -28, z1: -21, floors: 2, mat: MAT.PLASTER, tint: f.f ? 4 : 5, enterable: true, floorMat: MAT.TILES,
    doors: [{ side: 's', at: -35 }, { side: 'w', at: -29 }],
    stairs: { x: -37, z: -34, axis: 'x' }, roofAccess: true,
    win: { glass: 0.5, shop: 's' },
  });
  // shop counter + shelves
  f.box(-33.5, G + 0.04, -26, -29.5, G + 1.1, -25.3, MAT.WOOD);
  f.box(-28.9, G + 0.04, -29, -28.4, G + 1.9, -24, MAT.WOOD);
  // awning over the storefront
  f.decor(-39.6, G + 2.75, -21, -28.4, G + 2.85, -19.6, MAT.TARP, f.f ? 10 : 11);

  // alley dressing
  dumpster(f, -42.9, -21.5, false);
  f.prop('trashbag', -43.2, G, -24, 30, 1.2);
  f.prop('trashbag', -42.7, G, -24.8, 110, 1.0);
  f.prop('metal_trash_can', -41, G, -33.6, 0, 1);
  f.prop('utility_box_02', -43.6, G, -33, 90, 1.2);

  // courtyard facing the avenue: low wall with gaps, vehicles and crates as cover
  f.wallX(-8.4, -56, -50, G, G + 1.25, MAT.CONCRETE, 8, [], 0.4);
  f.wallX(-8.4, -46, -38, G, G + 1.25, MAT.CONCRETE, 8, [], 0.4);
  f.wallX(-8.4, -34, -28, G, G + 1.25, MAT.CONCRETE, 8, [], 0.4);
  f.prop('covered_car', -47, G, -13, 90, 1.08);
  f.prop('covered_car', -31, G, -16.5, 0, 1.08);
  f.crate(-37, G, -12, 20, 2.1);
  f.crate(-36.2, G, -13.6, 80, 1.7);
  f.barrel(-41.2, G, -16);
  f.prop('old_tyre', -52.5, G + 0.12, -15.5, 90, 1.2);
  f.prop('plastic_monobloc_chair_01', -53.5, G, -12, 40, 1);
  f.prop('street_lamp_01', -57.2, G, -20, 0, 1.25);
  f.prop('fire_hydrant', -27, G, -30, 0, 1);

  // apartment furniture (ground floor)
  f.prop('metal_office_desk', -47, G + 0.04, -20, 0, 1);
  f.prop('plastic_monobloc_chair_01', -47, G + 0.04, -21.3, 180, 1);
  f.prop('cardboard_box_01', -45.2, G + 0.04, -33.6, 15, 1.6);
  f.prop('cardboard_box_01', -46, G + 0.04, -33.9, 70, 1.3);
}

// ------------------------------------------------------------------ central buildings (Bank north, Café south)
function centralBuilding(f: Flip, floors: number, mat: number, tint: number): void {
  f.building({
    x0: -16, z0: -35, x1: 16, z1: -19, floors, mat, tint, enterable: true, floorMat: MAT.TILES,
    doors: [{ side: 's', at: -11 }, { side: 's', at: 9 }, { side: 'n', at: -12 }, { side: 'w', at: -27 }, { side: 'e', at: -27 }],
    stairs: { x: 6, z: -34, axis: 'x' }, roofAccess: true,
    partitions: [{ axis: 'z', at: -5, door: -27 }],
    win: { glass: 0.65, shop: 's', spacing: 3.4 },
  });
  // lobby counter and benches
  f.box(-3.5, G + 0.04, -29.2, 3.5, G + 1.1, -28.5, MAT.WOOD);
  f.box(-14.5, G + 0.04, -22.5, -12.5, G + 0.5, -21.8, MAT.WOOD);
  f.prop('metal_office_desk', 10, G + 0.04, -24, 90, 1);
  f.prop('plastic_monobloc_chair_01', 11.4, G + 0.04, -24, 270, 1);
  // front plaza planters (solid cover) and lamps
  for (const px of [-11, 11]) {
    f.box(px - 3, G, -9.6, px + 3, G + 0.85, -8.2, MAT.CONCRETE, F_WALL, 2);
    f.decor(px - 2.8, G + 0.85, -9.4, px + 2.8, G + 0.9, -8.4, MAT.DIRT);
  }
  f.prop('street_lamp_01', -17, G, -6.2, 0, 1.25);
  f.prop('street_lamp_01', 17, G, -6.2, 0, 1.25);
  f.prop('metal_trash_can', -15, G, -17.8, 0, 1);

  // underpass entrance: ramp pit x -3..3, z -18..-10 (high end at z = -18)
  f.ramp(-3, -18, 3, -10, -3.6, G, 1, -1, MAT.CONCRETE);
  f.box(-3.35, G, -18, -3, G + 1.0, -10, MAT.CONCRETE, F_WALL, 8);
  f.box(3, G, -18, 3.35, G + 1.0, -10, MAT.CONCRETE, F_WALL, 8);
  f.box(-3.35, G, -10, 3.35, G + 1.0, -9.65, MAT.CONCRETE, F_WALL, 8);
  f.decor(-3.4, G + 1.0, -18.05, -2.95, G + 1.05, -9.6, MAT.HAZARD);
  f.decor(2.95, G + 1.0, -18.05, 3.4, G + 1.05, -9.6, MAT.HAZARD);
  f.decor(-3.4, G + 1.0, -10.05, 3.4, G + 1.05, -9.6, MAT.HAZARD);
}

// ------------------------------------------------------------------ team base (west, mirrored to east)
function base(f: Flip, team: TeamId, b: MapBuilder): void {
  // boundary wall at the map edge
  f.box(-104, 0, -72, -103, 5, 72, MAT.CONCRETE, F_WALL, 8);
  // Warehouse (north compound)
  f.building({
    x0: -100, z0: -35, x1: -74, z1: -13, floors: 1, floorH: 6.4, mat: MAT.CORRUGATED, tint: 6, enterable: true,
    doors: [{ side: 'e', at: -27, w: 6, h: 4.2 }, { side: 's', at: -92 }],
    win: { sill: 3.4, h: 1.5, spacing: 5.2, w: 3, glass: 0.3 },
  });
  f.container(-95, G + 0.04, -31, false, 11);
  f.container(-90, G + 0.04, -31, false, 10);
  f.crate(-80, G + 0.04, -32, 0, 2.2);
  f.crate(-81.6, G + 0.04, -32.4, 90, 2.2);
  f.prop('old_military_crate', -84, G + 0.04, -17, 20, 1.2);
  f.prop('wooden_military_crate', -78, G + 0.04, -16, 70, 1.4);
  f.prop('portable_generator', -97, G + 0.04, -16, 0, 1.3);
  f.barrel(-98, G + 0.04, -24);

  // Motor pool (south compound): tents, command post, vehicle pad
  const tent = (x: number, z: number): void => {
    for (const [px, pz] of [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]]) f.box(x + px - 0.06, G, z + pz - 0.06, x + px + 0.06, G + 2.5, z + pz + 0.06, MAT.METAL, F_WALL, 12);
    f.box(x - 3.3, G + 2.5, z - 2.8, x + 3.3, G + 2.62, z + 2.8, MAT.TARP, F_WALL, 9);
    f.box(x - 3.2, G, z + 2.55, x + 3.2, G + 2.5, z + 2.65, MAT.TARP, F_WALL, 9);
    f.light(x, G + 2.2, z);
  };
  tent(-94, 30);
  tent(-84, 30);
  f.prop('metal_office_desk', -94, G, 31.2, 0, 1);
  f.prop('vintage_radio_transceiver', -94.3, G + 0.79, 31.2, 0, 1);
  f.prop('plastic_monobloc_chair_01', -94, G, 29.8, 180, 1);
  f.prop('old_military_crate', -84.5, G, 31.4, 0, 1.2);
  f.prop('wooden_military_crate', -82.5, G, 29.5, 60, 1.4);
  f.prop('metal_jerrycan_green', -81.2, G, 31.6, 20, 1.2);
  f.prop('metal_jerrycan_green', -80.8, G, 31.2, 80, 1.2);
  f.prop('portable_generator', -98.5, G, 27, 90, 1.3);
  f.prop('old_military_compressor', -99, G, 14, 0, 1.2);
  f.container(-98, G, 20, false, 9);

  // perimeter (HESCO style) facing the city, with pedestrian gaps
  f.sandbags(-68, -35, -67, -24, G, 2.1);
  f.sandbags(-68, -20, -67, -9, G, 2.1);
  f.sandbags(-68, 9, -67, 20, G, 2.1);
  f.sandbags(-68, 24, -67, 35, G, 2.1);

  // Avenue checkpoint: chicane + guard booth + sandbag positions
  barrier(f, -69, 0, -3.3, 90); barrier(f, -69, 0, -1.2, 90);
  barrier(f, -78, 0, 3.3, 90); barrier(f, -78, 0, 1.2, 90);
  f.box(-75, G, -8.6, -72.4, G + 2.7, -6.2, MAT.PAINTED, F_WALL, 9);
  f.decor(-75.15, G + 2.7, -8.75, -72.25, G + 2.85, -6.05, MAT.METAL, 12);
  f.decor(-74.6, G + 1.1, -6.2, -72.8, G + 2.1, -6.15, MAT.DARKGLASS);
  f.sandbags(-72, 5.6, -68.5, 6.5, G);
  f.sandbags(-72, -6.5, -70, -5.6, G);
  f.prop('street_lamp_01', -76, G, 6.3, 0, 1.25);

  const spawns: SpawnPoint[] = [];
  for (let i = 0; i < 5; i++) {
    spawns.push(f.spawn(-91 + i * 3.4, G, 22.5, -90));
    spawns.push(f.spawn(-91 + i * 3.4, G, 18, -90));
  }
  b.bases.push({
    team, name: team === TEAM_A ? 'FOB WEST' : 'FOB EAST', x: f.s * -84, z: f.s * 20, spawns,
    vehicle: f.spawn(-80, G, 11.5, -90),
  });
}

// ------------------------------------------------------------------ A: Parkade (south-west block)
function parkade(b: MapBuilder): void {
  const x0 = -56, x1 = -28, z0 = 9, z1 = 35;
  const L1 = 3.5, L2 = 7.0, T = 0.3, PH = 1.1;
  b.box(x0, G, z0, x1, G + 0.04, z1, MAT.FLOOR);
  const low = (y: number, gaps: { n?: [number, number]; s?: [number, number]; w?: [number, number]; e?: [number, number] }): void => {
    const g = (r?: [number, number]): Opening[] => (r ? [{ a0: r[0], a1: r[1], y0: y, y1: y + PH }] : []);
    b.wallX(z0, x0, x1, y, y + PH, MAT.CONCRETE, 0, g(gaps.n), T);
    b.wallX(z1 - T, x0, x1, y, y + PH, MAT.CONCRETE, 0, g(gaps.s), T);
    b.wallZ(x0, z0 + T, z1 - T, y, y + PH, MAT.CONCRETE, 0, g(gaps.w), T);
    b.wallZ(x1 - T, z0 + T, z1 - T, y, y + PH, MAT.CONCRETE, 0, g(gaps.e), T);
  };
  low(G, { n: [-46, -40], s: [-38, -34], w: [20, 24], e: [28, 32] });
  low(L1, {});
  low(L2, {});
  // hazard stripe on deck edges
  for (const y of [L1, L2]) b.decor(x0 - 0.05, y - 0.3, z0 - 0.05, x1 + 0.05, y - 0.12, z1 + 0.05, MAT.TRIM, 8);

  // ramps
  b.ramp(-54, 30, -42, 34.7, G, L1, 0, -1, MAT.CONCRETE, false);
  b.ramp(-33, 14, -28.3, 26, L1, L2, 1, 1, MAT.CONCRETE, false);
  // decks
  b.slab(x0, z0, x1, z1, L1 - 0.3, L1, MAT.FLOOR, [{ x0: -54, z0: 30, x1: -42, z1: 34.7 }]);
  b.slab(x0, z0, x1, z1, L2 - 0.3, L2, MAT.FLOOR, [{ x0: -33, z0: 14, x1: -28.3, z1: 26 }]);
  // guard rails around the ramp openings
  b.box(-54, L1, 29.8, -42, L1 + 1.0, 30, MAT.CONCRETE);
  b.box(-42, L1, 29.8, -41.8, L1 + 1.0, 34.7, MAT.CONCRETE);
  b.box(-33.2, L2, 14, -33, L2 + 1.0, 26, MAT.CONCRETE);
  b.box(-33.2, L2, 13.8, -28.3, L2 + 1.0, 14, MAT.CONCRETE);
  // side wall under the L1→L2 ramp so nobody walks into the wedge unseen
  // columns
  const colX = [-55.4, -49, -42, -35, -28.6], colZ = [9.6, 16, 22, 28.5, 34.4];
  for (const cx of colX) for (const cz of colZ) {
    const inRampG = cx > -54.5 && cx < -41.5 && cz > 29.5;
    const inRampL1 = cx > -33.5 && cz > 13.5 && cz < 26.5;
    if (inRampG) continue;
    b.box(cx - 0.3, G, cz - 0.3, cx + 0.3, inRampL1 ? L1 - 0.3 : L2 - 0.3, cz + 0.3, MAT.CONCRETE, F_WALL, 2);
  }
  // parked vehicles, barrels, crates
  b.prop('covered_car', -52, G + 0.04, 14, 0, 1.08);
  b.prop('covered_car', -37, G + 0.04, 13.5, 180, 1.08);
  b.prop('covered_car', -47.5, G + 0.04, 25.5, 90, 1.08);
  b.prop('covered_car', -51, L1, 14.5, 0, 1.08);
  b.prop('covered_car', -44, L1, 24, 90, 1.08);
  b.prop('covered_car', -38, L2, 30, 90, 1.08);
  b.prop('covered_car', -50, L2, 16, 0, 1.08);
  b.barrel(-36, G + 0.04, 30.5);
  b.barrel(-35, G + 0.04, 31.3);
  b.barrel(-52.5, L1, 26);
  b.crate(-39, G + 0.04, 20.5, 0, 2.2);
  b.crate(-44.5, G + 0.04, 18, 90, 2.0);
  barrier(new Flip(b, 1), -47, G + 0.04, 22, 0);
  barrier(new Flip(b, 1), -37, G + 0.04, 25, 90);
  b.prop('utility_box_01', -55.3, G + 0.04, 27, 90, 1.3);
  b.prop('metal_trash_can', -30, G + 0.04, 10.2, 0, 1);
  for (const [lx, lz] of [[-49, 16], [-35, 16], [-49, 28], [-35, 26], [-42, 22]]) {
    b.decor(lx - 0.6, L1 - 0.36, lz - 0.1, lx + 0.6, L1 - 0.3, lz + 0.1, MAT.LAMP);
    b.light(lx, L1 - 0.8, lz, [0.9, 0.95, 1], 12, 1.2);
    b.decor(lx - 0.6, L2 - 0.36, lz - 0.1, lx + 0.6, L2 - 0.3, lz + 0.1, MAT.LAMP);
    b.light(lx, L2 - 0.8, lz, [0.9, 0.95, 1], 12, 1.0);
  }
  b.interiors.push({ minX: x0, minY: G, minZ: z0, maxX: x1, maxY: L2 - 0.3, maxZ: z1 });

  // surrounding sidewalk dressing
  b.prop('street_lamp_01', -57.2, G, 22, 0, 1.25);
  b.prop('street_lamp_01', -26.8, G, 30, 180, 1.25);
  dumpster(new Flip(b, 1), -27.1, 12, false, 6);

  b.objectives.push({
    id: 'A', name: 'PARKADE', x: -42, y: G, z: 22, radius: 8.5,
    spawns: [sp(-52, G, 7.2, 180), sp(-34, G, 7.2, 180), sp(-57, G, 14, -90), sp(-57, G, 30, -90), sp(-27, G, 20, 90), sp(-48, G, 36, 0), sp(-31, G, 36, 0)],
  });
}

// ------------------------------------------------------------------ C: Construction site (north-east block)
function construction(b: MapBuilder): void {
  const L1 = 3.55, L2 = 7.0;
  // perimeter fence (corrugated sheets) with gates
  const fh = 2.3;
  const gate = (a0: number, a1: number): Opening[] => [{ a0, a1, y0: G, y1: G + fh }];
  b.wallX(-6.15, 27, 57, G, G + fh, MAT.CORRUGATED, 6, gate(38, 44), 0.15);
  b.wallX(-36, 27, 57, G, G + fh, MAT.CORRUGATED, 6, gate(44, 48), 0.15);
  b.wallZ(27, -36, -6, G, G + fh, MAT.CORRUGATED, 6, gate(-25, -21), 0.15);
  b.wallZ(56.85, -36, -6, G, G + fh, MAT.CORRUGATED, 6, gate(-12, -8), 0.15);

  // concrete frame
  for (const cx of [30, 36, 42, 48, 54]) for (const cz of [-33, -27, -21, -15]) {
    b.box(cx - 0.25, G, cz - 0.25, cx + 0.25, cx >= 42 ? L2 - 0.3 : L1 - 0.3, cz + 0.25, MAT.CONCRETE, F_WALL, 2);
    if (cx < 42) b.decor(cx - 0.06, L1, cz - 0.06, cx + 0.06, L1 + 1.3, cz + 0.06, MAT.RUST); // exposed rebar
  }
  b.slab(29.75, -33.25, 54.25, -14.75, L1 - 0.3, L1, MAT.CONCRETE, [{ x0: 32, z0: -31, x1: 34, z1: -25 }], F_WALL, 2);
  b.slab(41.75, -33.25, 54.25, -14.75, L2 - 0.3, L2, MAT.CONCRETE, [{ x0: 50, z0: -23, x1: 52, z1: -17 }], F_WALL, 2);
  // scaffold stairs
  b.ramp(32, -31, 34, -25, G, L1, 1, 1, MAT.WOOD);
  b.ramp(50, -23, 52, -17, L1, L2, 1, -1, MAT.WOOD);
  b.box(31.9, L1, -31.1, 32, L1 + 1, -25, MAT.WOOD);
  b.box(34, L1, -31.1, 34.1, L1 + 1, -25, MAT.WOOD);
  b.box(31.9, L1, -31.1, 34.1, L1 + 1, -31, MAT.WOOD);
  b.box(49.9, L2, -23, 50, L2 + 1, -16.9, MAT.WOOD);
  b.box(52, L2, -23, 52.1, L2 + 1, -16.9, MAT.WOOD);
  b.box(49.9, L2, -17, 52.1, L2 + 1, -16.9, MAT.WOOD);

  // partial brick infill walls on the ground floor
  const H = L1 - 0.3;
  b.wallX(-33.25, 30.25, 35.75, G, H, MAT.BRICK, 7);
  b.wallX(-33.25, 36.25, 41.75, G, G + 1.2, MAT.BRICK, 7);
  b.wallX(-33.25, 48.25, 53.75, G, H, MAT.BRICK, 7, [{ a0: 50, a1: 52, y0: G + 1, y1: G + 2.4 }]);
  b.wallX(-15.05, 30.25, 33.75, G, H, MAT.BRICK, 7);
  b.wallX(-15.05, 40.25, 45.75, G, G + 1.2, MAT.BRICK, 7);
  b.wallX(-15.05, 46.25, 53.75, G, H, MAT.BRICK, 7, [{ a0: 48, a1: 50, y0: G + 1, y1: G + 2.4 }, { a0: 51, a1: 53, y0: G + 1, y1: G + 2.4 }]);
  b.wallZ(29.75, -32.75, -27.25, G, H, MAT.BRICK, 7);
  b.wallZ(29.75, -26.75, -21.25, G, G + 1.2, MAT.BRICK, 7);
  b.wallZ(29.75, -20.75, -15.25, G, H, MAT.BRICK, 7);
  b.wallZ(53.95, -32.75, -21.25, G, H, MAT.BRICK, 7, [{ a0: -31, a1: -29, y0: G + 1, y1: G + 2.4 }, { a0: -25, a1: -23, y0: G + 1, y1: G + 2.4 }]);
  // upper level: plank barriers and a half-built wall
  b.box(29.8, L1, -33.2, 41.7, L1 + 1.0, -33.1, MAT.WOOD);
  b.box(29.8, L1, -14.9, 38, L1 + 1.0, -14.8, MAT.WOOD);
  b.box(29.8, L1, -33.2, 29.9, L1 + 1.0, -24, MAT.WOOD);
  b.wallX(-33.25, 42.25, 53.75, L1, L2 - 0.3, MAT.BRICK, 7, [{ a0: 44, a1: 46, y0: L1 + 1, y1: L1 + 2.4 }, { a0: 49, a1: 51, y0: L1 + 1, y1: L1 + 2.4 }]);
  b.wallZ(53.95, -32.75, -15.25, L1, L1 + 1.2, MAT.BRICK, 7);
  b.box(41.8, L2, -33.2, 54.2, L2 + 0.9, -33.1, MAT.WOOD);
  b.box(54.1, L2, -33.2, 54.2, L2 + 0.9, -14.8, MAT.WOOD);
  b.box(41.8, L2, -33.2, 41.9, L2 + 0.9, -24, MAT.WOOD);
  // material stacks on the slabs (cover)
  b.box(37, L1, -22, 39.4, L1 + 0.9, -20.8, MAT.BRICK, F_WALL, 7);
  b.box(45, L2, -27, 47, L2 + 0.8, -26, MAT.WOOD);
  b.crate(46, L1, -29, 30, 2.0);

  // yard: containers, rubble, pipes, barrels
  b.container(33, G, -10.4, true, 11);
  b.container(49, G, -9.6, true, 10);
  b.container(49, G + 2.6, -9.6, true, 6);
  b.box(36, G, -24, 38.5, G + 0.7, -22.4, MAT.RUBBLE);
  b.box(44, G, -19.5, 46.8, G + 0.9, -18, MAT.RUBBLE);
  b.box(28.5, G, -31, 29.6, G + 0.6, -28, MAT.RUBBLE);
  // concrete pipe stack between the frame and the north fence
  for (let i = 0; i < 2; i++) b.box(36, G, -35.7 + i * 0.95, 42, G + 0.8, -34.9 + i * 0.95, MAT.CONCRETE, F_WALL, 2);
  b.box(36, G + 0.8, -35.2, 42, G + 1.55, -34.4, MAT.CONCRETE, F_WALL, 2);
  b.barrel(40.5, G, -16.5);
  b.barrel(52.3, G, -30.5);
  b.barrel(31.5, G, -18.5);
  b.crate(35.5, G, -19, 10, 2.2);
  b.crate(47.5, G, -24.5, 60, 2.0);
  b.prop('portable_generator', 44.6, G, -13.4, 0, 1.4);
  b.prop('old_military_compressor', 55, G, -20, 0, 1.2);
  b.prop('wooden_military_crate', 30.4, G, -8, 90, 1.5);
  b.prop('old_tyre', 55.4, G + 0.14, -9.6, 90, 1.3);
  b.prop('old_tyre', 55.5, G + 0.36, -9.4, 90, 1.3);
  // tower crane (lattice suggestion)
  const cxr = 55.2, czr = -34.2;
  b.box(cxr - 0.9, G, czr - 0.9, cxr + 0.9, G + 1.2, czr + 0.9, MAT.CONCRETE, F_WALL, 8);
  for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) b.decor(cxr + dx - 0.07, G + 1.2, czr + dz - 0.07, cxr + dx + 0.07, 27, czr + dz + 0.07, MAT.HAZARD);
  for (let y = 2.4; y < 27; y += 1.8) b.decor(cxr - 0.67, y, czr - 0.67, cxr + 0.67, y + 0.08, czr + 0.67, MAT.HAZARD);
  b.decor(cxr - 26, 27, czr - 0.5, cxr + 8, 27.5, czr + 0.5, MAT.HAZARD);
  b.decor(cxr - 0.8, 27, czr - 0.8, cxr + 0.8, 29.4, czr + 0.8, MAT.METAL, 8);
  b.decor(cxr + 5, 26, czr - 1, cxr + 8, 27, czr + 1, MAT.CONCRETE, 8);
  for (const [lx, lz] of [[36, -24], [48, -24], [48, -30]]) b.light(lx, L1 - 0.9, lz, [1, 0.8, 0.55], 11, 1.2);
  b.interiors.push({ minX: 30, minY: G, minZ: -33, maxX: 54, maxY: L1 - 0.3, maxZ: -15 });
  b.interiors.push({ minX: 42, minY: L1, minZ: -33, maxX: 54, maxY: L2 - 0.3, maxZ: -15 });

  b.objectives.push({
    id: 'C', name: 'CONSTRUCTION', x: 42, y: G, z: -24, radius: 8.5,
    spawns: [sp(34, G, -7.5, 0), sp(52, G, -7.3, 0), sp(57.4, G, -30, 90), sp(57.4, G, -18, 90), sp(26.6, G, -30, -90), sp(40, G, -36.4, 180), sp(52, G, -36.4, 180)],
  });
}

// ------------------------------------------------------------------ streets: markings, cover and furniture
function streets(b: MapBuilder): void {
  const rng = b.rng;
  const f1 = new Flip(b, 1);
  const line = (x0: number, z0: number, x1: number, z1: number): void => { b.decor(x0, 0.004, z0, x1, 0.014, z1, MAT.LINE); };
  const onCross = (x: number): boolean => { const a = Math.abs(x); return (a > 16 && a < 28) || (a > 56 && a < 68); };
  // dashed centre lines
  for (const zc of [0, -41, 41]) for (let x = -100; x < 100; x += 7) {
    if (onCross(x) || onCross(x + 3.2) || (zc === 0 && Math.abs(x + 1.6) < 9)) continue;
    line(x, zc - 0.07, x + 3.2, zc + 0.07);
  }
  for (const xc of [-62, -22, 22, 62]) for (let z = -68; z < 68; z += 7) {
    const a = Math.abs(z + 1.6);
    if (a < 8 || (a > 34 && a < 48)) continue;
    line(xc - 0.07, z, xc + 0.07, z + 3.2);
  }
  // crosswalks at the avenue intersections
  for (const xc of [-62, -22, 22, 62]) for (const zs of [-7.2, 5.6]) for (let i = 0; i < 6; i++) line(xc - 3.6 + i * 1.3, zs, xc - 3.0 + i * 1.3, zs + 1.6);

  // street lamps + furniture along sidewalks
  for (let x = -52; x <= 52; x += 26) {
    if (Math.abs(x) < 20) continue;
    b.prop('street_lamp_01', x, G, 6.2, 0, 1.25);
    b.prop('street_lamp_01', x + 6, G, -36.2, 180, 1.25);
    b.prop('street_lamp_01', x - 6, G, 36.2, 0, 1.25);
  }
  for (const [mx, mz] of [[-40, 1.8], [36, -2.1], [-8, 41.5], [10, -40.6], [62, 20], [-62, -22]]) b.prop('water_manhole_cover', mx, 0.0, mz, rng.range(0, 360), 1.3);
  b.prop('fire_hydrant', -17, G, 16, 0, 1);
  b.prop('fire_hydrant', 27, G, 6.6, 90, 1);
  b.prop('utility_box_01', 17.2, G, -34, 90, 1.3);
  b.prop('utility_box_02', -27, G, 34, 90, 1.2);
  b.prop('metal_trash_can', 27.2, G, 14, 90, 1);

  // road cover: wrecks, barriers, crates. Rotationally symmetric list (x, z, kind).
  const cover: [number, number, string][] = [
    [-50, 3.6, 'car0'], [-36, -3.5, 'car0'], [-12, 3.8, 'barrier'], [-9, -3.4, 'car20'],
    [-62, -14, 'car90'], [-60.2, 26, 'barrier90'], [-22, -22, 'car90'], [-23.8, 14, 'crates'],
    [-44, -43.2, 'car0'], [-8, -38.8, 'car0'], [-30, -40, 'barrier90'], [-14, 43.3, 'car0'], [-48, 39, 'crates'],
    [-22, 41, 'barrier'], [-62, 41, 'car20'],
  ];
  for (const s of [1, -1] as const) {
    const f = new Flip(b, s);
    for (const [x, z, kind] of cover) {
      if (kind === 'car0') f.prop('covered_car', x, 0, z, 90, 1.08);
      else if (kind === 'car90') f.prop('covered_car', x, 0, z, 0, 1.08);
      else if (kind === 'car20') f.prop('covered_car', x, 0, z, 70, 1.08);
      else if (kind === 'barrier') { barrier(f, x, 0, z, 0); barrier(f, x + 2.4, 0, z + 0.3, 8); }
      else if (kind === 'barrier90') { barrier(f, x, 0, z, 90); barrier(f, x + 0.3, 0, z + 2.4, 82); }
      else if (kind === 'crates') { f.crate(x, 0, z, 0, 2.2); f.crate(x + 1.5, 0, z + 0.4, 70, 1.9); f.prop('wooden_military_crate', x + 0.4, 0, z - 1.3, 20, 1.5); }
    }
  }

  // B: median island, monument and fighting positions
  b.box(-6, 0, -1.1, 6, 0.3, 1.1, MAT.SIDEWALK, F_WALL, 0);
  b.box(-1.5, 0.3, -1, 1.5, 0.95, 1, MAT.CONCRETE, F_WALL, 2);
  b.box(-0.75, 0.95, -0.7, 0.75, 7.2, 0.7, MAT.CONCRETE, F_WALL, 2);
  b.decor(-0.95, 7.2, -0.9, 0.95, 7.5, 0.9, MAT.TRIM, 0);
  b.decor(-0.5, 7.5, -0.45, 0.5, 8.6, 0.45, MAT.METAL, 8);
  f1.sandbags(-5.6, -1, -3.2, -0.2, 0.3, 0.8);
  f1.sandbags(3.2, 0.2, 5.6, 1, 0.3, 0.8);
  barrier(f1, 8.5, 0, -4, 0); barrier(f1, -8.5, 0, 4, 0);
  b.barrel(4.5, 0.3, -0.4);
  b.objectives.push({
    id: 'B', name: 'CROSSING', x: 0, y: 0, z: 0, radius: 9,
    spawns: [sp(-12, G, -16.5, 180), sp(12, G, -16.5, 180), sp(-12, G, 16.5, 0), sp(12, G, 16.5, 0), sp(-2, G + 0.04, -24, 180), sp(2, G + 0.04, 24, 0)],
  });
}

// ------------------------------------------------------------------ boundary rows + skyline
function boundaryRows(b: MapBuilder): void {
  const rng = b.rng;
  const mats = [MAT.BRICK, MAT.PLASTER, MAT.PAINTED, MAT.CONCRETE, MAT.PLASTER, MAT.BRICK];
  const lots: [number, number][] = [[-102, -66], [-58, -26], [-18, 18], [26, 58], [66, 102]];
  for (const s of [1, -1] as const) {
    for (const [lx0, lx1] of lots) {
      let x = lx0;
      while (x < lx1 - 0.5) {
        let w = rng.int(12, 20);
        if (lx1 - (x + w) < 9) w = lx1 - x;
        const zFront = 48 + rng.int(0, 2), floors = rng.int(3, 6);
        const z0 = s > 0 ? zFront : -70, z1 = s > 0 ? 70 : -zFront;
        b.building({ x0: x, z0, x1: x + w, z1, floors, floorH: 3.5, mat: rng.pick(mats), tint: rng.int(1, 7) });
        // rooftop clutter
        b.decor(x + 2, 0.15 + floors * 3.5, (z0 + z1) / 2 - 2, x + 5, 0.15 + floors * 3.5 + 1.6, (z0 + z1) / 2 + 1, MAT.METAL, 8);
        x += w;
      }
    }
    // closed-off cross streets
    for (const xc of [-62, -22, 22, 62]) {
      b.box(xc - 4, 0, s * 58, xc + 4, 3.6, s * 58 + s * 0.5, MAT.CONCRETE, F_WALL, 8);
      b.decor(xc - 4.1, 3.6, s * 57.9, xc + 4.1, 3.75, s * 58.6 + (s > 0 ? 0 : -0.7), MAT.HAZARD);
      const f = new Flip(b, 1);
      barrier(f, xc - 1.6, 0, s * 55.5, 4); barrier(f, xc + 1.3, 0, s * 55.2, -6);
    }
  }
  // far skyline (render only)
  const sky = (x0: number, z0: number, w: number, d: number, h: number, tint: number): void => {
    b.decor(x0, 0, z0, x0 + w, h, z0 + d, MAT.CONCRETE, tint);
    for (let y = 4.4; y < h - 2; y += 3.6) b.decor(x0 - 0.05, y, z0 - 0.05, x0 + w + 0.05, y + 1.1, z0 + d + 0.05, MAT.SKYGLASS);
    b.decor(x0 + w * 0.3, h, z0 + d * 0.3, x0 + w * 0.7, h + 2.2, z0 + d * 0.7, MAT.CONCRETE, 8);
  };
  for (let i = 0; i < 26; i++) {
    const along = -130 + i * 10.5 + rng.range(-2, 2);
    const h = rng.range(22, 58);
    sky(along, -112 - rng.range(0, 26), rng.range(10, 18), rng.range(12, 20), h, rng.pick([2, 6, 8, 12]));
    sky(along, 92 + rng.range(0, 26), rng.range(10, 18), rng.range(12, 20), rng.range(22, 58), rng.pick([2, 6, 8, 12]));
  }
  for (let i = 0; i < 16; i++) {
    const along = -95 + i * 12.5 + rng.range(-2, 2);
    sky(-150 - rng.range(0, 20), along, rng.range(12, 20), rng.range(10, 16), rng.range(20, 50), rng.pick([2, 6, 8, 12]));
    sky(122 + rng.range(0, 20), along, rng.range(12, 20), rng.range(10, 16), rng.range(20, 50), rng.pick([2, 6, 8, 12]));
  }
}

export function buildKestrel(seed = 20261111): MapData {
  const b = new MapBuilder(seed);

  // ---------------------------------------------------------------- ground
  const xs = [-104, -66, -58, -26, -18, -3, 3, 18, 26, 58, 66, 104];
  const zs = [-72, -45, -37, -18, -10, -5, 5, 10, 18, 37, 45, 72];
  b.ground(xs, zs, -0.6, (cx, cz) => {
    const ax = Math.abs(cx), az = Math.abs(cz);
    if (ax < 3 && az > 10 && az < 18) return null;
    if (az < 5 || (az > 37 && az < 45) || (ax > 18 && ax < 26) || (ax > 58 && ax < 66)) return { mat: MAT.ASPHALT, top: 0 };
    if (cx > 26 && cx < 58 && cz > -37 && cz < -5) return { mat: MAT.DIRT, top: G };
    if ((cx < -66 && cz > 5 && cz < 37) || (cx > 66 && cz < -5 && cz > -37)) return { mat: MAT.FLOOR, top: G };
    if (ax < 18 && az < 37) return { mat: MAT.SIDEWALK, top: G, tint: 5 };
    return { mat: MAT.SIDEWALK, top: G };
  });

  // ---------------------------------------------------------------- underpass below the avenue
  b.box(-3, -4, -10, 3, -3.6, 10, MAT.FLOOR);
  b.box(-3.4, -4, -18, -3, -0.6, 18, MAT.TILES, F_WALL, 2);
  b.box(3, -4, -18, 3.4, -0.6, 18, MAT.TILES, F_WALL, 2);
  for (const z of [-7, 0, 7]) {
    b.decor(-0.6, -0.68, z - 0.12, 0.6, -0.6, z + 0.12, MAT.LAMP);
    b.light(0, -1.1, z, [0.85, 0.95, 1], 9, 1.3);
  }
  b.box(-2.9, -3.6, -2, -2.2, -2.7, 2, MAT.CONCRETE, F_WALL, 8);
  b.interiors.push({ minX: -3, minY: -3.6, minZ: -14, maxX: 3, maxY: -0.6, maxZ: 14 });

  // ---------------------------------------------------------------- symmetric areas
  for (const s of [1, -1] as const) {
    const f = new Flip(b, s);
    residentialBlock(f);
    base(f, s > 0 ? TEAM_A : TEAM_B, b);
  }
  centralBuilding(new Flip(b, 1), 3, MAT.PLASTER, 2);
  centralBuilding(new Flip(b, -1), 2, MAT.BRICK, 3);

  // ---------------------------------------------------------------- handcrafted objectives
  parkade(b);
  streets(b);
  construction(b);
  boundaryRows(b);
  // ---------------------------------------------------------------- battlefield dressing: armour and wrecks (mirrored pairs,
  // placed only where they leave the streets passable and keep clear of objectives / spawns)
  const dress: [string, number, number, number][] = [
    ['tank_m1a2', -62, 24, 0], ['tank_m1a2', -62, 30, 2], ['tank_m1a2', -84, 0, 90],
    ['tank_t80', -40, -41, 92], ['tank_t80', -78, -41, 88],
    ['wreck_cars', -48, 41, 0], ['wreck_cars', -30, 0, 10], ['wreck_cars', -88, 41, 0],
    ['wreck_sedan', -6, -41, 97], ['wreck_sedan', -62, -14, 8], ['wreck_sedan', -22, 30, 175],
    ['van_izh', -22, 18, 4], ['van_izh', -70, 41, 91], ['van_izh', -62, 52, 182],
    ['pickup_c10', -62, -28, 186], ['pickup_c10', -36, 41, 270], ['pickup_c10', -22, -56, 3],
  ];
  for (const [m, x, z, yaw] of dress) b.propPairIfFree(m, x, z, yaw);
  // one Abrams pair: first free spot from the candidates
  for (const [x, z, yaw] of [[-42, 2, 90], [-62, -62, 0], [-22, -62, 0], [-62, 62, 0], [-96, -41, 90], [-8, 41, 90], [-50, 41, 90], [-70, -2, 90]]) {
    if (b.propPairIfFree('tank_m1a2', x, z, yaw, 1, 0.5)) break;
  }
  b.scatterTrees(9, 34, { x0: -104, z0: -72, x1: 104, z1: 72 });
  // objectives are pushed A, B, C in that order
  b.objectives.sort((p, q) => p.id.localeCompare(q.id));

  // ---------------------------------------------------------------- overwatch positions (recon bots)
  const FH = 3.4;
  b.overwatch.push(
    sp(-8, G + 3 * FH, -21, 180), sp(8, G + 3 * FH, -21, 180), sp(-13, G + FH, -20.5, 180),
    sp(-8, G + 2 * FH, 21, 0), sp(8, G + 2 * FH, 21, 0), sp(13, G + FH, 20.5, 0),
    sp(-46, G + 3 * FH, -19, 180), sp(46, G + 3 * FH, 19, 0),
    sp(-40, 7, 11, 0), sp(-30.5, 7, 32, 90),
    sp(44, 7, -16.5, 180), sp(46, 3.55, -31.5, 180),
    sp(-34, G + 2 * FH, -22.5, 180), sp(34, G + 2 * FH, 22.5, 0),
  );

  return b.finish('kestrel', 'KESTREL CROSSING', 'Urban conquest — 16 players', { x0: -104, z0: -72, x1: 104, z1: 72 });
}
