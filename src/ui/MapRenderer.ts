import type { WorldData } from '../data/WorldData';
import type { RoadGraph } from '../ai/RoadGraph';

/**
 * Map renderer built from the SAME geographic data as the 3D world: coastline (land polygons),
 * parks, the real street graph, landmarks and neighbourhood names. A high-resolution base map is
 * rasterised once; minimap and full-screen map are views onto it.
 */
export class MapRenderer {
  base: HTMLCanvasElement;
  readonly scale: number; // px per metre on the base map
  private x0: number; private z0: number;

  constructor(private world: WorldData, private graph: RoadGraph, size = 3072) {
    const g = world.meta.grid;
    const W = g.x1 - g.x0, H = g.z1 - g.z0;
    this.scale = size / Math.max(W, H);
    this.x0 = g.x0; this.z0 = g.z0;
    this.base = document.createElement('canvas');
    this.base.width = Math.round(W * this.scale); this.base.height = Math.round(H * this.scale);
    this.draw();
  }

  toPx(x: number, z: number): [number, number] { return [(x - this.x0) * this.scale, (z - this.z0) * this.scale]; }
  toWorld(px: number, py: number): [number, number] { return [px / this.scale + this.x0, py / this.scale + this.z0]; }

  private poly(ctx: CanvasRenderingContext2D, p: number[]): void {
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) { const [x, y] = this.toPx(p[i], p[i + 1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.closePath();
  }

  private draw(): void {
    const ctx = this.base.getContext('2d')!;
    const m = this.world.meta;
    ctx.fillStyle = '#0b1a26'; ctx.fillRect(0, 0, this.base.width, this.base.height);
    // land
    ctx.fillStyle = '#1a1f25';
    for (const c of m.coast) { this.poly(ctx, c); ctx.fill(); }
    // hillshade from the DEM (subtle)
    const g = m.grid;
    const img = ctx.getImageData(0, 0, this.base.width, this.base.height);
    const d = img.data;
    const step = 1 / this.scale;
    for (let py = 0; py < this.base.height; py += 1) {
      const z = this.z0 + py * step;
      for (let px = 0; px < this.base.width; px += 1) {
        const i = (py * this.base.width + px) * 4;
        if (d[i + 2] > 30 && d[i] < 20) continue; // water
        const x = this.x0 + px * step;
        const gi = Math.round((x - g.x0) / g.step), gj = Math.round((z - g.z0) / g.step);
        const h = this.world.heightGrid(gi, gj);
        const sh = (this.world.heightGrid(gi - 1, gj - 1) - this.world.heightGrid(gi + 1, gj + 1)) * 0.9;
        const v = Math.max(-18, Math.min(22, sh)) + Math.min(h, 280) * 0.05;
        d[i] = Math.max(0, d[i] + v); d[i + 1] = Math.max(0, d[i + 1] + v); d[i + 2] = Math.max(0, d[i + 2] + v);
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(52, 110, 64, 0.55)';
    for (const p of m.parks) { this.poly(ctx, p); ctx.fill(); }
    for (const l of m.lakes) { ctx.fillStyle = '#123247'; this.poly(ctx, l.p); ctx.fill(); }
    // roads by class (minor first)
    const styles: [number, string, number][] = [[7, '#2c333b', 0.6], [6, '#353d46', 0.8], [5, '#47515c', 1.1], [4, '#6b7480', 1.5], [3, '#8a929c', 1.9], [2, '#c7a96a', 2.3], [1, '#d9a24f', 2.6], [0, '#e8b04c', 3.0]];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [cls, col, w] of styles) {
      ctx.strokeStyle = col; ctx.lineWidth = w * Math.max(0.6, this.scale * 5);
      ctx.beginPath();
      for (const e of this.graph.edges) {
        if (e.cls !== cls || e.tunnel) continue;
        for (let k = 0; k < e.pts.length; k += 2) { const [x, y] = this.toPx(e.pts[k], e.pts[k + 1]); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      }
      ctx.stroke();
    }
    // neighbourhood labels
    ctx.font = `600 ${Math.round(11 * Math.max(1, this.scale * 5))}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200, 210, 222, 0.38)';
    for (const h of m.hoods) { if (h.k === 'm') continue; const [x, y] = this.toPx(h.x, h.z); ctx.fillText(h.n.toUpperCase(), x, y); }
  }

  /** draw landmarks, route, player etc. on top of a view */
  overlay(ctx: CanvasRenderingContext2D, toScreen: (x: number, z: number) => [number, number], k: number, player: { x: number; z: number; heading: number }, route: number[], target: { x: number; z: number } | null, checkpoint: { x: number; z: number } | null, showLabels: boolean): void {
    if (route.length >= 4) {
      ctx.strokeStyle = '#3fd6ff'; ctx.lineWidth = Math.max(3, k * 7); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(63,214,255,0.7)'; ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let i = 0; i < route.length; i += 2) { const [x, y] = toScreen(route[i], route[i + 1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke(); ctx.shadowBlur = 0;
    }
    for (const l of this.world.meta.landmarks) {
      if (['coit_hill', 'embarcadero'].includes(l.id)) continue;
      const [x, y] = toScreen(l.x, l.z);
      ctx.fillStyle = '#ffd36b'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      if (showLabels) { ctx.fillStyle = 'rgba(255,230,170,0.92)'; ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(l.n, x + 6, y + 4); }
    }
    if (target) { const [x, y] = toScreen(target.x, target.z); ctx.fillStyle = '#3fd6ff'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    if (checkpoint) { const [x, y] = toScreen(checkpoint.x, checkpoint.z); ctx.strokeStyle = '#3fd6ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke(); }
    const [px, py] = toScreen(player.x, player.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(player.heading);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#05070a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7.5, 8); ctx.lineTo(0, 4); ctx.lineTo(-7.5, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
