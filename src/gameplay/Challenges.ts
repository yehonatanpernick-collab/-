import * as THREE from 'three/webgpu';
import { vec3, sin, time, uv, smoothstep, abs, float } from 'three/tsl';
import type { WorldData } from '../data/WorldData';
import type { LandmarkSystem } from '../world/Landmarks';
import type { Navigation } from './Navigation';
import { lonLatToWorld } from '../data/GeographicConfig';
import { lookAtAbs } from '../core/lookAtAbs';

/**
 * Optional exploration challenges (never block free roam) + landmark discovery.
 * Checkpoint courses are generated from real geography (landmark coordinates, the Golden Gate's
 * tower positions, GPS routes on the real street graph).
 */
export interface Challenge {
  id: string; name: string; desc: string; mode: 'drive' | 'fly' | 'any';
  points: THREE.Vector3[]; radius: number; best: number | null;
}

export class Challenges {
  list: Challenge[] = [];
  active: Challenge | null = null;
  idx = 0;
  timer = 0;
  group = new THREE.Group();
  private ring: THREE.Mesh;
  private beacon: THREE.Mesh;
  discovered = new Set<string>();
  onEvent?: (msg: string, sub?: string) => void;

  constructor(private world: WorldData, private landmarks: LandmarkSystem, private nav: Navigation) {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    m.colorNode = vec3(0.25, 0.85, 1.0).mul(sin(time.mul(4)).mul(0.25).add(1.1));
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 12, 64), m);
    const bm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    bm.colorNode = vec3(0.3, 0.8, 1.0).mul(float(0.6));
    bm.opacityNode = smoothstep(1, 0, uv().y).mul(abs(sin(uv().y.mul(30).sub(time.mul(3)))).mul(0.4).add(0.3));
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true), bm);
    this.group.add(this.ring, this.beacon);
    this.group.visible = false;
    try { const s = JSON.parse(localStorage.getItem('skydrive.best') || '{}'); this.bests = s; } catch { /* storage unavailable */ }
    try { JSON.parse(localStorage.getItem('skydrive.found') || '[]').forEach((x: string) => this.discovered.add(x)); } catch { /* */ }
  }
  private bests: Record<string, number> = {};

  build(): void {
    const W = (lon: number, lat: number, y: number) => { const p = lonLatToWorld(lon, lat); return new THREE.Vector3(p.x, y, p.z); };
    const gg = this.landmarks.ggb;
    if (gg) {
      const [n, s] = gg.towers;
      const mid = n.clone().add(s).multiplyScalar(0.5);
      const ax = gg.axis;
      const side = new THREE.Vector3(ax.z, 0, -ax.x);
      this.list.push({
        id: 'ggrun', name: 'Golden Gate Run', desc: 'Fly from the Marina, under the Golden Gate deck, around the towers and over the top.', mode: 'fly', radius: 22, best: null,
        points: [W(-122.4420, 37.8075, 40), W(-122.4620, 37.8100, 35), mid.clone().addScaledVector(side, 600).setY(30), mid.clone().setY(30),
          mid.clone().addScaledVector(side, -500).setY(45), s.clone().addScaledVector(side, -200).setY(120), s.clone().setY(245), mid.clone().setY(150), n.clone().addScaledVector(side, 250).setY(110)],
      });
    }
    this.list.push({
      id: 'skyline', name: 'Skyline Ascent', desc: 'Climb past the Transamerica spire to the crown of Salesforce Tower.', mode: 'fly', radius: 25, best: null,
      points: [W(-122.4058, 37.8024, 120), W(-122.40279, 37.79519, 280), W(-122.3990, 37.7925, 220), W(-122.39694, 37.78977, 345), W(-122.3936, 37.7955, 90)],
    });
    this.list.push({
      id: 'twinpeaks', name: 'Fog Line', desc: 'Race through Karl the Fog: Ocean Beach to Twin Peaks and Sutro Tower.', mode: 'fly', radius: 28, best: null,
      points: [W(-122.5105, 37.7600, 40), W(-122.4950, 37.7650, 90), W(-122.4700, 37.7600, 180), W(-122.4477, 37.7544, 300), W(-122.45277, 37.75523, 330)],
    });
    // driving routes along real streets (A* on the road graph)
    const route = (pts: [number, number][]) => {
      const out: THREE.Vector3[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = lonLatToWorld(pts[i][0], pts[i][1]), b = lonLatToWorld(pts[i + 1][0], pts[i + 1][1]);
        this.nav.plan(a.x, a.z, b.x, b.z);
        const r = this.nav.route;
        let acc = 0;
        for (let k = 2; k < r.length; k += 2) {
          acc += Math.hypot(r[k] - r[k - 2], r[k + 1] - r[k - 1]);
          if (acc > 260 || k === r.length - 2) { acc = 0; out.push(new THREE.Vector3(r[k], 0, r[k + 1])); }
        }
      }
      this.nav.clear();
      out.forEach((p) => p.setY(this.world.heightAt(p.x, p.z) + 3));
      return out;
    };
    this.list.push({ id: 'embarcadero', name: 'Embarcadero Cruise', desc: 'Union Square → Market Street → Ferry Building → Pier 39 on real streets.', mode: 'drive', radius: 16, best: null,
      points: route([[-122.40744, 37.78799], [-122.3960, 37.7935], [-122.3940, 37.7960], [-122.4098, 37.8080]]) });
    this.list.push({ id: 'hills', name: 'Hills of San Francisco', desc: 'Russian Hill, Lombard Street and Nob Hill — feel the gradients.', mode: 'drive', radius: 16, best: null,
      points: route([[-122.4170, 37.8005], [-122.41874, 37.80207], [-122.4160, 37.7980], [-122.4130, 37.7920], [-122.4100, 37.7905]]) });
    for (const c of this.list) c.best = this.bests[c.id] ?? null;
  }

  start(id: string): void {
    const c = this.list.find((x) => x.id === id);
    if (!c || !c.points.length) return;
    this.active = c; this.idx = 0; this.timer = 0;
    this.group.visible = true;
    this.onEvent?.(c.name, c.desc);
  }

  stop(): void { this.active = null; this.group.visible = false; }

  get next(): THREE.Vector3 | null { return this.active ? this.active.points[this.idx] : null; }

  update(dt: number, p: THREE.Vector3, flying: boolean, camPos: THREE.Vector3): void {
    // landmark discovery
    for (const l of this.world.meta.landmarks) {
      if (this.discovered.has(l.id)) continue;
      if (Math.hypot(l.x - p.x, l.z - p.z) < (l.k === 'bridge' ? 700 : 220)) {
        this.discovered.add(l.id);
        this.onEvent?.('Landmark discovered', l.n);
        try { localStorage.setItem('skydrive.found', JSON.stringify([...this.discovered])); } catch { /* */ }
      }
    }
    const c = this.active;
    if (!c) return;
    this.timer += dt;
    const t = c.points[this.idx];
    const r = c.radius;
    this.ring.position.copy(t);
    this.ring.scale.setScalar(r);
    lookAtAbs(this.ring, this.idx + 1 < c.points.length ? c.points[this.idx + 1] : camPos);
    this.beacon.position.set(t.x, t.y + 300, t.z);
    this.beacon.scale.set(r * 0.25, 600, r * 0.25);
    if (p.distanceTo(t) < r * 1.05 && (c.mode === 'any' || (c.mode === 'fly') === flying || c.mode === 'drive')) {
      this.idx++;
      if (this.idx >= c.points.length) {
        const time = this.timer;
        const best = this.bests[c.id];
        const rec = !best || time < best;
        if (rec) { this.bests[c.id] = time; c.best = time; try { localStorage.setItem('skydrive.best', JSON.stringify(this.bests)); } catch { /* */ } }
        this.onEvent?.(`${c.name} complete`, `${time.toFixed(1)} s${rec ? ' — new best!' : ''}`);
        this.stop();
      } else this.onEvent?.('Checkpoint', `${this.idx} / ${c.points.length}`);
    }
  }
}
