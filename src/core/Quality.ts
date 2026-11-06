/** Graphics quality presets, device detection, budgets and adaptive resolution. */
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowRange: number;
  bloom: boolean;
  ao: boolean;
  viewDistance: number;        // metres of building geometry around the camera (driving)
  flightViewDistance: number;  // when flying
  detailDistance: number;      // full-detail (facade shader + rooftop details + furniture) radius
  colliderDistance: number;    // physics colliders radius
  treeDistance: number;
  maxTraffic: number;
  maxPeds: number;
  maxTileBuildsPerFrame: number;
  fogQuality: number;
  rainDrops: number;
}

export const PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { pixelRatio: 0.75, shadows: false, shadowMapSize: 1024, shadowRange: 80, bloom: false, ao: false, viewDistance: 1300, flightViewDistance: 2200, detailDistance: 450, colliderDistance: 350, treeDistance: 500, maxTraffic: 28, maxPeds: 12, maxTileBuildsPerFrame: 1, fogQuality: 0, rainDrops: 1500 },
  medium: { pixelRatio: 1, shadows: true, shadowMapSize: 1024, shadowRange: 110, bloom: true, ao: false, viewDistance: 1900, flightViewDistance: 3000, detailDistance: 650, colliderDistance: 400, treeDistance: 800, maxTraffic: 55, maxPeds: 26, maxTileBuildsPerFrame: 1, fogQuality: 1, rainDrops: 3500 },
  high: { pixelRatio: 1.25, shadows: true, shadowMapSize: 2048, shadowRange: 150, bloom: true, ao: false, viewDistance: 2600, flightViewDistance: 4200, detailDistance: 850, colliderDistance: 450, treeDistance: 1100, maxTraffic: 90, maxPeds: 40, maxTileBuildsPerFrame: 2, fogQuality: 2, rainDrops: 6000 },
  ultra: { pixelRatio: 2, shadows: true, shadowMapSize: 4096, shadowRange: 200, bloom: true, ao: true, viewDistance: 3400, flightViewDistance: 5600, detailDistance: 1100, colliderDistance: 500, treeDistance: 1500, maxTraffic: 130, maxPeds: 60, maxTileBuildsPerFrame: 3, fogQuality: 2, rainDrops: 9000 },
};

export const isTouchDevice = (): boolean =>
  'ontouchstart' in window || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;

export const isMobile = (): boolean => isTouchDevice() && Math.min(screen.width, screen.height) < 900;

export function detectQuality(): QualityLevel {
  const params = new URLSearchParams(location.search);
  const q = params.get('quality') as QualityLevel | null;
  if (q && q in PRESETS) return q;
  if (isMobile()) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory || 8;
  if (cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}

/** Adaptive resolution controller: scales the render resolution to hold the frame-time budget. */
export class AdaptiveResolution {
  scale = 1;
  private acc = 0;
  private frames = 0;
  enabled = true;
  constructor(public targetMs = 1000 / 55, public min = 0.5, public max = 1) {}
  update(dtMs: number): boolean {
    if (!this.enabled) return false;
    this.acc += dtMs; this.frames++;
    if (this.acc < 1000) return false;
    const avg = this.acc / this.frames;
    this.acc = 0; this.frames = 0;
    const old = this.scale;
    if (avg > this.targetMs * 1.15) this.scale = Math.max(this.min, this.scale - 0.1);
    else if (avg < this.targetMs * 0.8) this.scale = Math.min(this.max, this.scale + 0.05);
    return old !== this.scale;
  }
}
