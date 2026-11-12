// Asset loading (textures, GLB containers) with progress reporting, plus the
// material library built from the shared material table.
import { MATERIALS, type MaterialDef } from '@shared/world/materials';
import * as pc from 'playcanvas';
import type { Engine } from './engine';

/**
 * Static hosts that only serve text-like file types (e.g. the artifact viewer) get binary assets as
 * base64 `.b64.txt` files; they are decoded into blob URLs at load time. Enabled with VITE_B64=1.
 */
const B64 = (import.meta as unknown as { env: Record<string, string> }).env.VITE_B64 === '1';
async function resolveUrl(url: string): Promise<string> {
  if (!B64 || !/\.(glb|hdr)$/.test(url)) return url;
  const text = await (await fetch(`${url}.b64.txt`)).text();
  const bin = atob(text.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes]));
}

export const PROP_MODELS = [
  'Barrel_01', 'barrel_03', 'concrete_road_barrier', 'concrete_road_barrier_02', 'covered_car', 'fire_hydrant', 'metal_trash_can',
  'street_lamp_01', 'street_lamp_02', 'utility_box_01', 'utility_box_02', 'old_tyre', 'metal_jerrycan_green', 'portable_generator',
  'propane_tank', 'trashbag', 'wooden_crate_01', 'wooden_crate_02', 'old_military_crate', 'wooden_military_crate', 'ammo_box',
  'medical_box', 'cardboard_box_01', 'metal_office_desk', 'plastic_monobloc_chair_01', 'vintage_radio_transceiver', 'water_manhole_cover',
  'old_military_compressor',
];
export const WEAPON_MODELS = ['bolt_action_rifle_7_62', 'service_pistol', 'stick_grenade'];
/** Realistic gun models (Sketchfab, CC-BY), normalised by scripts/build-weapons.mjs. */
export const REAL_GUNS = ['m4a1', 'akm', 'mp5', 'm249'];

export class Assets {
  readonly textures = new Map<string, pc.Texture>();
  readonly containers = new Map<string, pc.Asset>();
  readonly materials: pc.StandardMaterial[] = [];
  private total = 0;
  private done = 0;
  onProgress: (fraction: number, label: string) => void = () => {};

  constructor(private readonly engine: Engine) {}

  private get app(): pc.Application { return this.engine.app; }

  private track<T>(label: string, p: Promise<T>): Promise<T> {
    this.total++;
    return p.finally(() => { this.done++; this.onProgress(this.done / Math.max(1, this.total), label); });
  }

  loadTexture = (url: string, opts: { srgb?: boolean; mipmaps?: boolean } = {}): Promise<pc.Texture> => {
    const cached = this.textures.get(url);
    if (cached) return Promise.resolve(cached);
    return this.track(url, resolveUrl(url).then((real) => new Promise<pc.Texture>((resolve, reject) => {
      const asset = new pc.Asset(url, 'texture', { url: real, filename: url.split('/').pop() }, { srgb: !!opts.srgb, mipmaps: opts.mipmaps ?? true });
      asset.once('load', () => {
        const tex = asset.resource as pc.Texture;
        if (opts.mipmaps !== false) {
          tex.addressU = pc.ADDRESS_REPEAT; tex.addressV = pc.ADDRESS_REPEAT;
          tex.minFilter = pc.FILTER_LINEAR_MIPMAP_LINEAR; tex.magFilter = pc.FILTER_LINEAR;
          tex.anisotropy = this.engine.preset.anisotropy;
        }
        this.textures.set(url, tex);
        resolve(tex);
      });
      asset.once('error', (err: unknown) => reject(new Error(`texture ${url}: ${String(err)}`)));
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    })));
  };

  loadContainer(name: string, url: string): Promise<pc.Asset> {
    const cached = this.containers.get(name);
    if (cached) return Promise.resolve(cached);
    return this.track(url, resolveUrl(url).then((real) => new Promise<pc.Asset>((resolve, reject) => {
      const asset = new pc.Asset(name, 'container', { url: real, filename: url.split('/').pop() });
      asset.once('load', () => { this.containers.set(name, asset); resolve(asset); });
      asset.once('error', (err: unknown) => reject(new Error(`model ${url}: ${String(err)}`)));
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    })));
  }

  /** Instantiate a loaded GLB as a render hierarchy. */
  instantiate(name: string): pc.Entity {
    const asset = this.containers.get(name);
    if (!asset) throw new Error(`model ${name} not loaded`);
    return (asset.resource as pc.ContainerResource).instantiateRenderEntity();
  }

  /** Preload everything a match needs. */
  async loadGameAssets(): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    for (const m of MATERIALS) {
      if (!m.tex) continue;
      const base = `assets/textures/${m.tex}`;
      jobs.push(this.loadTexture(`${base}_diff.jpg`, { srgb: true }), this.loadTexture(`${base}_nor.jpg`), this.loadTexture(`${base}_arm.jpg`));
    }
    for (const p of PROP_MODELS) jobs.push(this.loadContainer(p, `assets/models/${p}.glb`));
    for (const w of WEAPON_MODELS) jobs.push(this.loadContainer(w, `assets/models/${w}.glb`));
    for (const w of REAL_GUNS) jobs.push(this.loadContainer(`gun_${w}`, `assets/weapons/${w}.glb`));
    jobs.push(this.loadContainer('soldier', 'assets/characters/operator.glb'));
    jobs.push(this.loadContainer('hmmwv', 'assets/vehicles/hmmwv.glb'));
    await Promise.all(jobs);
    this.buildMaterials();
  }

  private buildMaterials(): void {
    this.materials.length = 0;
    for (const def of MATERIALS) this.materials.push(this.makeMaterial(def));
  }

  private makeMaterial(def: MaterialDef): pc.StandardMaterial {
    const m = new pc.StandardMaterial();
    m.name = def.name;
    m.diffuse = new pc.Color(def.color[0], def.color[1], def.color[2]);
    m.diffuseVertexColor = true;
    m.useMetalness = true;
    m.metalness = def.metalness ?? 0;
    m.gloss = def.gloss ?? 0.35;
    if (def.tex) {
      const base = `assets/textures/${def.tex}`;
      m.diffuseMap = this.textures.get(`${base}_diff.jpg`) ?? null;
      m.normalMap = this.textures.get(`${base}_nor.jpg`) ?? null;
      m.bumpiness = 1;
      const arm = this.textures.get(`${base}_arm.jpg`) ?? null;
      if (arm) {
        m.aoMap = arm; m.aoMapChannel = 'r';
        m.glossMap = arm; m.glossMapChannel = 'g'; m.glossInvert = true; m.gloss = 1;
        if ((def.metalness ?? 0) > 0) { m.metalnessMap = arm; m.metalnessMapChannel = 'b'; m.metalness = 1; }
      }
    }
    if (def.emissive) {
      m.emissive = new pc.Color(def.color[0], def.color[1], def.color[2]);
      m.emissiveIntensity = def.emissive;
    }
    if (def.opacity !== undefined) {
      m.opacity = def.opacity;
      m.blendType = pc.BLEND_NORMAL;
      m.depthWrite = false;
      m.useLighting = true;
      m.cull = pc.CULLFACE_NONE;
      m.opacityFadesSpecular = false;
    }
    m.update();
    return m;
  }

  /** Small procedural textures (soft particle, bullet hole, …) drawn with canvas 2D. */
  canvasTexture(name: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void, srgb = true): pc.Texture {
    const cached = this.textures.get(name);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    draw(ctx, size);
    const tex = new pc.Texture(this.engine.device, {
      name, width: size, height: size, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    });
    if (!srgb) tex.format;
    tex.setSource(canvas);
    this.textures.set(name, tex);
    return tex;
  }
}
