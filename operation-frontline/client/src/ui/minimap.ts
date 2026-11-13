// Minimap / tactical map rendering on 2D canvases. The static level layer is
// rasterised once from the collision world; dynamic markers are drawn each frame.
import { TEAM_A, TEAM_B } from '@shared/config';
import { PF_ALIVE, PF_INVEHICLE } from '@shared/types';
import type { MapData } from '@shared/world/MapBuilder';
import { F_NOCOLLIDE, F_NORENDER } from '@shared/world/World';
import { MAT } from '@shared/world/materials';
import type { GameView } from '../game/game';

const PPM = 3; // pixels per metre in the static layer
export const TEAM_CSS: Record<number, string> = { 0: '#d8d8d8', [TEAM_A]: '#4da3ff', [TEAM_B]: '#ff6b43' };

export class MapLayer {
  readonly canvas: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;

  constructor(readonly map: MapData) {
    const wd = map.world;
    this.w = Math.round((wd.maxX - wd.minX) * PPM);
    this.h = Math.round((wd.maxZ - wd.minZ) * PPM);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    const ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#20252b';
    ctx.fillRect(0, 0, this.w, this.h);
    const boxes = wd.boxes.filter((b) => !(b.flags & (F_NOCOLLIDE | F_NORENDER)) && b.maxX <= wd.maxX + 1 && b.minX >= wd.minX - 1).sort((a, b) => a.maxY - b.maxY);
    for (const b of boxes) {
      let c: string;
      if (b.mat === MAT.ASPHALT) c = '#2b3138';
      else if (b.maxY <= 0.2) c = b.mat === MAT.DIRT ? '#4a4338' : '#3b424a';
      else if (b.maxY < 1.6) c = '#6d7680';
      else { const k = Math.min(1, b.maxY / 16); c = `rgb(${Math.round(92 + k * 60)},${Math.round(100 + k * 60)},${Math.round(110 + k * 60)})`; }
      ctx.fillStyle = c;
      ctx.fillRect((b.minX - wd.minX) * PPM, (b.minZ - wd.minZ) * PPM, Math.max(1, (b.maxX - b.minX) * PPM), Math.max(1, (b.maxZ - b.minZ) * PPM));
    }
  }

  px(x: number): number { return (x - this.map.world.minX) * PPM; }
  pz(z: number): number { return (z - this.map.world.minZ) * PPM; }
}

function drawObjectives(ctx: CanvasRenderingContext2D, layer: MapLayer, view: GameView, scale: number, upright: number): void {
  layer.map.objectives.forEach((o, i) => {
    const st = view.objectives[i];
    const x = layer.px(o.x), y = layer.pz(o.z);
    const col = TEAM_CSS[st?.owner ?? 0];
    ctx.strokeStyle = col; ctx.lineWidth = 2 / scale;
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(x, y, o.radius * PPM, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.16; ctx.fillStyle = col; ctx.fill();
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(upright); ctx.scale(1 / scale, 1 / scale);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(11, 0); ctx.lineTo(0, 11); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0b0d10'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.id, 0, 1);
    ctx.restore();
  });
}

function drawUnits(ctx: CanvasRenderingContext2D, layer: MapLayer, view: GameView, scale: number): void {
  for (const v of view.vehicles) {
    if (!v.alive) continue;
    ctx.save();
    ctx.translate(layer.px(v.x), layer.pz(v.z)); ctx.rotate(-v.yaw); ctx.scale(1 / scale, 1 / scale);
    ctx.fillStyle = v.driver >= 0 ? '#ffd27a' : '#9aa3ad';
    ctx.fillRect(-4, -7, 8, 14);
    ctx.restore();
  }
  for (const p of view.players) {
    if (!(p.flags & PF_ALIVE) || p.id === view.myId) continue;
    const r = view.roster.find((q) => q.id === p.id);
    if (!r) continue;
    const friend = r.team === view.myTeam;
    if (!friend && !view.spotted.includes(p.id)) continue;
    if (p.flags & PF_INVEHICLE) continue;
    ctx.save();
    ctx.translate(layer.px(p.x), layer.pz(p.z)); ctx.rotate(-p.yaw); ctx.scale(1 / scale, 1 / scale);
    ctx.fillStyle = friend ? TEAM_CSS[view.myTeam] : '#ff3b30';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

/** Player-centred rotating minimap. */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size = 196;

  constructor(private readonly layer: MapLayer) {
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.canvas.height = this.size * dpr;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.ctx.scale(dpr, dpr);
  }

  draw(view: GameView, x: number, z: number, yaw: number): void {
    const ctx = this.ctx, s = this.size, layer = this.layer;
    const zoom = 0.82; // screen px per layer px → ~80 m across
    ctx.save();
    ctx.clearRect(0, 0, s, s);
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#14181d'; ctx.fillRect(0, 0, s, s);
    ctx.translate(s / 2, s / 2);
    ctx.rotate(yaw);
    ctx.scale(zoom, zoom);
    ctx.translate(-layer.px(x), -layer.pz(z));
    ctx.globalAlpha = 0.92;
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.globalAlpha = 1;
    drawObjectives(ctx, layer, view, zoom, -yaw);
    drawUnits(ctx, layer, view, zoom);
    ctx.restore();
    // own arrow + ring
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2); ctx.stroke();
    // north tick
    ctx.save();
    ctx.translate(s / 2, s / 2); ctx.rotate(yaw);
    ctx.fillStyle = '#ffb23e'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N', 0, -s / 2 + 14);
    ctx.restore();
  }
}

/** Full tactical map used on the deploy screen. Returns canvas-space positions for spawn buttons. */
export class TacticalMap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly layer: MapLayer) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = layer.w; this.canvas.height = layer.h;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  draw(view: GameView): void {
    const ctx = this.ctx, layer = this.layer;
    ctx.clearRect(0, 0, layer.w, layer.h);
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.fillStyle = 'rgba(8,10,13,0.25)'; ctx.fillRect(0, 0, layer.w, layer.h);
    for (const b of layer.map.bases) {
      ctx.fillStyle = TEAM_CSS[b.team]; ctx.globalAlpha = 0.22;
      ctx.fillRect(layer.px(b.x) - 60, layer.pz(b.z) - 60, 120, 120);
      ctx.globalAlpha = 1;
    }
    drawObjectives(ctx, layer, view, 1, 0);
    drawUnits(ctx, layer, view, 0.8);
  }

  /** Normalised (0..1) position of a world point on the map canvas. */
  norm(x: number, z: number): { u: number; v: number } {
    return { u: this.layer.px(x) / this.layer.w, v: this.layer.pz(z) / this.layer.h };
  }
}
