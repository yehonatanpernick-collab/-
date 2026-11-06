/**
 * Real geographic data system: loads the preprocessed San Francisco datasets
 * (terrain DEM, surface classes, road graph, pedestrian network, metadata) and answers spatial queries.
 * It decides WHERE things are; it never builds visuals.
 */
export interface Landmark { id: string; n: string; lon: number; lat: number; x: number; z: number; k: string }
export interface Hood { n: string; x: number; z: number; k: string }
export interface WorldMeta {
  name: string;
  source: { vector: string; dem: string };
  origin: { lat: number; lon: number; kx: number; ky: number };
  grid: { x0: number; z0: number; w: number; h: number; step: number; x1: number; z1: number };
  tile: number;
  tiles: Record<string, number>;
  landmarks: Landmark[];
  validation: Record<string, { dataset_name: string; offset_m: number; dataset_height: number }>;
  hoods: Hood[];
  lakes: { y: number; p: number[] }[];
  rail: { c: string; n: string; p: number[] }[];
  coast: number[][];
  parks: number[][];
  signals: number[][];
  stats: Record<string, number>;
}

/** raw road edge: [a, b, cls, width, lanes, oneway, bridge, tunnel, speed, pts, elev|null, name] */
export type RawEdge = [number, number, number, number, number, number, number, number, number, number[], number[] | null, string];
export interface RoadsData { nodes: number[]; sig: number[]; e: RawEdge[] }
/** raw ped edge: [a, b, kind, sub, pts] */
export type RawPedEdge = [number, number, number, number, number[]];
export interface PedsData { e: RawPedEdge[] }

export interface TileBuilding {
  r: number[][]; h: number; mh: number; b: number; bt: number; s: number; c: number; rf: number; e: number; id: number; n: string;
}
export interface TileData {
  i: number; j: number;
  b: TileBuilding[];
  rd: number[];
  t: number[][];   // trees [x,z,kind,scale]
  f: number[][];   // furniture [x,z,type,rot]
  pr: number[][];  // pier polygons
  pe: number[];
}

export enum Surface { Urban = 0, Grass = 1, Forest = 2, Sand = 3, Rock = 4, Scrub = 5, Sea = 6, Lake = 7, Golf = 8 }

export class WorldData {
  meta!: WorldMeta;
  heights!: Float32Array;
  surface!: Uint8Array;
  roads!: RoadsData;
  peds!: PedsData;
  private base: string;
  private packs = new Map<string, Promise<unknown>>();

  constructor(base = './data/') { this.base = base; }
  setBase(b: string): void { this.base = b; }

  async load(progress: (p: number, label: string) => void): Promise<void> {
    const get = async (f: string) => {
      const r = await fetch(this.base + f);
      if (!r.ok) throw new Error(`Failed to load ${f}: ${r.status}`);
      return r;
    };
    progress(0.02, 'Loading San Francisco geography');
    this.meta = await (await get('world.json')).json();
    progress(0.1, 'Loading USGS elevation model');
    const hb = await (await get('height.bin.png')).arrayBuffer();
    const i16 = new Int16Array(hb);
    this.heights = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) this.heights[i] = i16[i] / 10;
    progress(0.2, 'Loading land cover');
    this.surface = new Uint8Array(await (await get('surface.bin.png')).arrayBuffer());
    progress(0.3, 'Loading street network');
    this.roads = await (await get('roads.json')).json();
    progress(0.42, 'Loading pedestrian network');
    this.peds = await (await get('peds.json')).json();
    this.validate();
  }

  /** Geographic data validation (counts, grid consistency, landmark offsets). Logged to console. */
  validate(): void {
    const g = this.meta.grid;
    const ok = this.heights.length === g.w * g.h && this.surface.length === g.w * g.h;
    const lmk = Object.entries(this.meta.validation).map(([k, v]) => `${k}:${v.offset_m}m`).join(' ');
    console.info(`[WorldData] grid ${g.w}x${g.h} @${g.step}m ${ok ? 'OK' : 'MISMATCH'}; ${this.roads.e.length} road edges; ` +
      `${this.peds.e.length} footway edges; landmark offsets vs dataset: ${lmk}`);
    if (!ok) throw new Error('Terrain grid size mismatch');
  }

  get tileSize(): number { return this.meta.tile; }

  /** Terrain height with the exact triangulation used by terrain meshes & colliders. */
  heightAt(x: number, z: number): number {
    const g = this.meta.grid;
    const fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0) i = 0; else if (i > g.w - 2) i = g.w - 2;
    if (j < 0) j = 0; else if (j > g.h - 2) j = g.h - 2;
    let u = fx - i, v = fz - j;
    u = u < 0 ? 0 : u > 1 ? 1 : u; v = v < 0 ? 0 : v > 1 ? 1 : v;
    const H = this.heights, w = g.w;
    const h00 = H[j * w + i], h10 = H[j * w + i + 1], h01 = H[(j + 1) * w + i], h11 = H[(j + 1) * w + i + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  heightGrid(i: number, j: number): number {
    const g = this.meta.grid;
    i = Math.max(0, Math.min(g.w - 1, i)); j = Math.max(0, Math.min(g.h - 1, j));
    return this.heights[j * g.w + i];
  }

  surfaceGrid(i: number, j: number): number {
    const g = this.meta.grid;
    i = Math.max(0, Math.min(g.w - 1, i)); j = Math.max(0, Math.min(g.h - 1, j));
    return this.surface[j * g.w + i];
  }

  surfaceAt(x: number, z: number): Surface {
    const g = this.meta.grid;
    return this.surfaceGrid(Math.round((x - g.x0) / g.step), Math.round((z - g.z0) / g.step));
  }

  inBounds(x: number, z: number, margin = 0): boolean {
    const g = this.meta.grid;
    return x > g.x0 + margin && x < g.x1 - margin && z > g.z0 + margin && z < g.z1 - margin;
  }

  hasTileFile(i: number, j: number): boolean { return (this.meta.tiles[`${i}_${j}`] ?? 0) > 0; }

  async loadTile(i: number, j: number): Promise<TileData | null> {
    if (!this.hasTileFile(i, j)) return null;
    // tiles are packed into 2 km region bundles (4x4 tiles) to keep the file/request count low
    const key = `${Math.floor(i / 4)}_${Math.floor(j / 4)}`;
    let p = this.packs.get(key);
    if (!p) {
      p = fetch(`${this.base}packs/P_${key}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      this.packs.set(key, p);
      if (this.packs.size > 24) this.packs.delete(this.packs.keys().next().value!);
    }
    return ((await p) as Record<string, TileData>)[`${i}_${j}`] ?? null;
  }

  nearestHood(x: number, z: number): string {
    let best = '', bd = Infinity;
    for (const h of this.meta.hoods) {
      const d = (h.x - x) ** 2 + (h.z - z) ** 2;
      if (d < bd) { bd = d; best = h.n; }
    }
    return best;
  }
}
