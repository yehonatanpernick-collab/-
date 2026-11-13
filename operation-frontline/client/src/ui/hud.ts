// In-game heads-up display (DOM overlay).
import { CLASSES, GADGETS } from '@shared/classes';
import { MATCH, TEAM_A, TEAM_B, TEAM_SHORT } from '@shared/config';
import { PF_ALIVE, PF_INVEHICLE } from '@shared/types';
import { activeWeapon } from '@shared/weaponLogic';
import type { MapData } from '@shared/world/MapBuilder';
import * as pc from 'playcanvas';
import type { Engine } from '../core/engine';
import { IS_MOBILE, type Store, keyLabel } from '../core/settings';
import type { GameView } from '../game/game';
import { t as tr } from '../core/i18n';
import { fmtTime, h, setText, show, toggle } from './dom';
import { type MapLayer, Minimap, TEAM_CSS } from './minimap';

const DEG = Math.PI / 180;

export class Hud {
  readonly root: HTMLElement;
  private readonly minimap: Minimap;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly flags: HTMLElement[] = [];
  private readonly markers = new Map<string, HTMLElement>();
  private readonly cross: HTMLElement[] = [];
  private mapT = 0;
  private readonly v = new pc.Vec3();
  private readonly s = new pc.Vec3();

  constructor(parent: HTMLElement, private readonly store: Store, private readonly map: MapData, private readonly engine: Engine, layer: MapLayer) {
    this.minimap = new Minimap(layer);
    const e = this.el;
    const mk = (id: string, cls: string, ...kids: (Node | string)[]): HTMLElement => (e[id] = h('div', { class: cls }, ...kids));
    this.root = h('div', { class: 'hud hidden' },
      mk('markers', 'hud-markers'),
      h('div', { class: 'hud-top' },
        h('div', { class: 'tickets' },
          h('div', { class: 'tk tk-a' }, mk('tkaName', 'tk-name'), h('div', { class: 'tk-bar' }, mk('tkaFill', 'tk-fill')), mk('tka', 'tk-num')),
          h('div', { class: 'tk-mid' }, mk('timer', 'timer'), mk('flags', 'flags')),
          h('div', { class: 'tk tk-b' }, mk('tkb', 'tk-num'), h('div', { class: 'tk-bar' }, mk('tkbFill', 'tk-fill')), mk('tkbName', 'tk-name')),
        ),
        mk('capture', 'capture hidden', mk('capLabel', 'cap-label'), h('div', { class: 'cap-bar' }, mk('capFill', 'cap-fill'))),
        mk('notice', 'notice'),
      ),
      mk('feed', 'feed'),
      mk('perf', 'perf'),
      h('div', { class: 'hud-bl' }, h('div', { class: 'mini' }, this.minimap.canvas),
        h('div', { class: 'vitals' }, mk('cls', 'cls'), h('div', { class: 'hp-bar' }, mk('hpFill', 'hp-fill')), mk('hp', 'hp-num'))),
      h('div', { class: 'hud-br' },
        mk('veh', 'veh hidden'),
        mk('weapon', 'weapon-name'),
        h('div', { class: 'ammo' }, mk('ammo', 'ammo-mag'), mk('reserve', 'ammo-res')),
        mk('items', 'items'),
        h('div', { class: 'tac' }, mk('tacFill', 'tac-fill')),
      ),
      mk('crosshair', 'crosshair'),
      mk('hit', 'hitmarker'),
      mk('dmg', 'dmg-ring'),
      mk('scores', 'scores'),
      mk('prompt', 'prompt hidden'),
      mk('scope', 'scope hidden', h('div', { class: 'scope-h' }), h('div', { class: 'scope-v' })),
      mk('hurt', 'hurt'),
      mk('center', 'center-msg hidden'),
    );
    for (let i = 0; i < 4; i++) { const l = h('div', { class: `ch ch${i}` }); this.cross.push(l); e.crosshair.append(l); }
    e.crosshair.append(h('div', { class: 'ch-dot' }));
    map.objectives.forEach((o) => {
      const f = h('div', { class: 'flag' }, h('div', { class: 'flag-fill' }), h('span', { text: o.id }));
      this.flags.push(f); e.flags.append(f);
    });
    parent.append(this.root);
  }

  setVisible(on: boolean): void { show(this.root, on); }

  // ------------------------------------------------------------------ events
  hitmarker(head: boolean, kill: boolean): void {
    const m = this.el.hit;
    m.className = `hitmarker show${kill ? ' kill' : ''}${head ? ' head' : ''}`;
    void m.offsetWidth;
    m.classList.add('fade');
  }

  damage(angle: number, amount: number): void {
    const d = h('div', { class: 'dmg-arc' });
    d.style.transform = `rotate(${(-angle / DEG).toFixed(1)}deg)`;
    this.el.dmg.append(d);
    setTimeout(() => d.remove(), 1400);
    const hurt = this.el.hurt;
    hurt.style.opacity = String(Math.min(0.85, 0.3 + amount / 80));
    setTimeout(() => { hurt.style.opacity = ''; }, 120);
  }

  killFeed(killer: string, kt: number, victim: string, vt: number, weapon: string, head: boolean, mine: boolean): void {
    const row = h('div', { class: `feed-row${mine ? ' mine' : ''}` },
      killer ? h('span', { class: `t${kt}`, text: killer }) : null,
      h('span', { class: 'feed-w', text: `${head ? '⌖ ' : ''}${weapon}` }),
      h('span', { class: `t${vt}`, text: victim }));
    this.el.feed.prepend(row);
    while (this.el.feed.children.length > 6) this.el.feed.lastElementChild?.remove();
    setTimeout(() => row.classList.add('out'), 5200);
    setTimeout(() => row.remove(), 6000);
  }

  score(amount: number, reason: string): void {
    const row = h('div', { class: 'score-row' }, h('b', { text: `+${amount}` }), h('span', { text: reason }));
    this.el.scores.prepend(row);
    while (this.el.scores.children.length > 5) this.el.scores.lastElementChild?.remove();
    setTimeout(() => row.remove(), 2600);
  }

  notice(text: string, tone: string): void {
    const n = this.el.notice;
    n.textContent = tr(text);
    n.className = `notice show ${tone}`;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => n.classList.remove('show'), 3800);
  }
  private noticeTimer = 0;

  // ------------------------------------------------------------------ per frame
  private marker(key: string, cls: string): HTMLElement {
    let m = this.markers.get(key);
    if (!m) { m = h('div', { class: `mk ${cls}` }, h('i'), h('span')); this.markers.set(key, m); this.el.markers.append(m); }
    m.dataset.seen = '1';
    return m;
  }

  private place(m: HTMLElement, x: number, y: number, z: number, clampEdge: boolean, label: string): void {
    const cam = this.engine.camera, camC = cam.camera as pc.CameraComponent;
    this.v.set(x, y, z);
    const w = window.innerWidth, hh = window.innerHeight;
    const rel = this.s.sub2(this.v, cam.getPosition());
    const front = rel.dot(cam.forward) > 0.1;
    camC.worldToScreen(this.v, this.s);
    let sx = this.s.x, sy = this.s.y;
    let off = !front || sx < 30 || sx > w - 30 || sy < 60 || sy > hh - 60;
    if (off) {
      if (!clampEdge) { m.style.display = 'none'; return; }
      if (!front) { sx = w - sx; sy = hh; }
      sx = Math.max(34, Math.min(w - 34, sx)); sy = Math.max(120, Math.min(hh - 150, sy));
    } else off = false;
    m.style.display = '';
    m.style.transform = `translate(${sx.toFixed(0)}px,${sy.toFixed(0)}px)`;
    toggle(m, 'edge', off);
    setText(m.lastElementChild as HTMLElement, label);
  }

  update(view: GameView, dt: number): void {
    const e = this.el, s = view.state, st = this.store.settings;
    const alive = view.alive;
    // ---- top bar
    const mine = view.myTeam, other = mine === TEAM_A ? TEAM_B : TEAM_A;
    setText(e.tkaName, TEAM_SHORT[mine]); setText(e.tkbName, TEAM_SHORT[other]);
    e.tkaName.style.color = TEAM_CSS[mine]; e.tkbName.style.color = TEAM_CSS[other];
    const ta = view.tickets[mine - 1] ?? 0, tb = view.tickets[other - 1] ?? 0;
    setText(e.tka, String(ta)); setText(e.tkb, String(tb));
    e.tkaFill.style.width = `${Math.min(100, (ta / MATCH.TICKETS) * 100)}%`; e.tkaFill.style.background = TEAM_CSS[mine];
    e.tkbFill.style.width = `${Math.min(100, (tb / MATCH.TICKETS) * 100)}%`; e.tkbFill.style.background = TEAM_CSS[other];
    setText(e.timer, view.phase === 'warmup' ? `STARTS ${Math.ceil(view.timeLeft)}` : fmtTime(view.timeLeft));
    let inZone = -1;
    view.objectives.forEach((o, i) => {
      const f = this.flags[i];
      if (!f) return;
      f.style.borderColor = TEAM_CSS[o.owner];
      f.style.color = o.owner === 0 ? '#fff' : TEAM_CSS[o.owner];
      const fill = f.firstElementChild as HTMLElement;
      fill.style.height = `${Math.abs(o.control) * 100}%`;
      fill.style.background = TEAM_CSS[o.control > 0 ? TEAM_A : TEAM_B];
      toggle(f, 'contested', o.contested);
      const def = this.map.objectives[i];
      if (alive && Math.hypot(s.x - def.x, s.z - def.z) < def.radius && s.y - def.y > -2 && s.y - def.y < MATCH.CAPTURE_HEIGHT) inZone = i;
    });
    show(e.capture, inZone >= 0);
    if (inZone >= 0) {
      const o = view.objectives[inZone], def = this.map.objectives[inZone];
      const ours = (mine === TEAM_A ? o.control : -o.control);
      setText(e.capLabel, o.contested ? `CONTESTED — ${def.id}` : o.owner === mine && ours >= 1 ? `SECURED — ${def.id} ${def.name}` : ours >= 0 ? `CAPTURING ${def.id}` : `NEUTRALIZING ${def.id}`);
      e.capFill.style.width = `${Math.abs(o.control) * 100}%`;
      e.capFill.style.background = TEAM_CSS[o.control > 0 ? TEAM_A : TEAM_B];
    }
    // ---- vitals / weapon
    setText(e.hp, String(Math.max(0, Math.round(view.health))));
    e.hpFill.style.width = `${Math.max(0, Math.min(100, view.health))}%`;
    toggle(e.hpFill, 'low', view.health < 35);
    toggle(this.root, 'lowhp', alive && view.health < 30);
    const cls = CLASSES[view.loadout.classId];
    setText(e.cls, cls.name.toUpperCase());
    const w = activeWeapon(s, view.ctx);
    const gun = s.slot < 2;
    const g0 = GADGETS[cls.gadgets[0]], g1 = cls.gadgets[1] ? GADGETS[cls.gadgets[1]] : null;
    setText(e.weapon, gun ? w.name.toUpperCase() : (s.slot === 2 ? g0.name : g1?.name ?? '').toUpperCase());
    setText(e.ammo, gun ? String(s.slot === 0 ? s.ammo0 : s.ammo1) : s.slot === 2 ? (s.gadget0 < 0 ? '∞' : String(s.gadget0)) : (s.gadget1 < 0 ? '∞' : String(s.gadget1)));
    setText(e.reserve, gun ? `/ ${s.slot === 0 ? s.reserve0 : s.reserve1}` : '');
    toggle(e.ammo, 'low', gun && (s.slot === 0 ? s.ammo0 : s.ammo1) <= w.magSize * 0.25);
    const b = st.bindings;
    const items = `<span class="${s.slot === 0 ? 'on' : ''}">${keyLabel(b.primary)} ${view.ctx.primary.name}</span><span class="${s.slot === 1 ? 'on' : ''}">${keyLabel(b.secondary)} ${view.ctx.secondary.name}</span>`
      + `<span class="${s.slot === 2 ? 'on' : ''}">${keyLabel(b.gadget1)} ${tr(g0.name)}${g0.ammo > 0 ? ` ×${s.gadget0}` : ''}</span>`
      + (g1 ? `<span class="${s.slot === 3 ? 'on' : ''}">${keyLabel(b.gadget2)} ${tr(g1.name)}${g1.ammo > 0 ? ` ×${s.gadget1}` : ''}</span>` : '')
      + `<span>${keyLabel(b.grenade)} ${tr('Frag')} ×${s.grenades}</span>`;
    if (e.items.dataset.t !== items) { e.items.dataset.t = items; e.items.innerHTML = items; }
    e.tacFill.style.width = `${(s.tacT / 3.2) * 100}%`;
    // vehicle
    const veh = view.inVehicle ? view.vehicles.find((x) => x.driver === view.myId || x.passenger === view.myId) : null;
    show(e.veh, !!veh);
    if (veh) setText(e.veh, `LTV  ${Math.round(Math.abs(veh.speed) * 3.6)} KM/H   ARMOR ${Math.round((veh.health / 600) * 100)}%`);
    // ---- crosshair
    const showCross = alive && !view.scoped && !(gun && s.ads > 0.55) && !view.inVehicle;
    show(e.crosshair, showCross || (alive && view.inVehicle && view.seat === 1));
    if (showCross) {
      const camC = this.engine.camera.camera as pc.CameraComponent;
      const gap = Math.max(4, (Math.tan(view.spread * DEG) / Math.tan((camC.fov * DEG) / 2)) * (window.innerHeight / 2));
      const g = gap.toFixed(1);
      this.cross[0].style.transform = `translate(-50%, ${-gap - 9}px)`;
      this.cross[1].style.transform = `translate(-50%, ${g}px)`;
      this.cross[2].style.transform = `translate(${-gap - 9}px, -50%)`;
      this.cross[3].style.transform = `translate(${g}px, -50%)`;
      e.crosshair.style.color = st.crosshairColor;
    }
    show(e.scope, view.scoped);
    // ---- prompts / messages
    show(e.prompt, alive && view.usePrompt !== '');
    if (view.usePrompt) setText(e.prompt, `${IS_MOBILE ? 'USE' : `[${keyLabel(b.use)}]`}  ${view.usePrompt}`);
    const reloading = alive && gun && s.reloadT > 0;
    const empty = alive && gun && !reloading && (s.slot === 0 ? s.ammo0 + s.reserve0 : s.ammo1 + s.reserve1) === 0;
    show(e.center, reloading || empty || view.status !== '');
    setText(e.center, view.status === 'reconnecting' ? 'CONNECTION LOST — RECONNECTING…' : reloading ? 'RELOADING' : empty ? 'OUT OF AMMO' : '');
    if (st.showFps) setText(e.perf, `${Math.round(view.fps)} FPS${view.ping ? `  ${view.ping} MS` : ''}`); else setText(e.perf, view.ping > 0 ? `${view.ping} MS` : '');
    toggle(e.perf, 'bad', view.ping > 140);

    // ---- minimap (20 Hz)
    this.mapT -= dt;
    if (this.mapT <= 0) { this.mapT = 0.05; const cam = this.engine.camera.getPosition(); this.minimap.draw(view, alive ? s.x : cam.x, alive ? s.z : cam.z, view.yaw); }

    // ---- world markers
    for (const m of this.markers.values()) m.dataset.seen = '';
    const cam = this.engine.camera.getPosition();
    this.map.objectives.forEach((o, i) => {
      const stt = view.objectives[i];
      const m = this.marker(`o${i}`, 'mk-obj');
      m.style.setProperty('--c', TEAM_CSS[stt?.owner ?? 0]);
      (m.firstElementChild as HTMLElement).textContent = o.id;
      this.place(m, o.x, o.y + 6.5, o.z, true, `${Math.round(Math.hypot(o.x - cam.x, o.z - cam.z))}m`);
    });
    for (const p of view.players) {
      if (p.id === view.myId || !(p.flags & PF_ALIVE) || (p.flags & PF_INVEHICLE)) continue;
      const r = view.roster.find((q) => q.id === p.id);
      if (!r) continue;
      const friend = r.team === mine;
      if (!friend && !view.spotted.includes(p.id)) continue;
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (friend && d > 90) continue;
      const m = this.marker(`p${p.id}`, friend ? 'mk-friend' : 'mk-enemy');
      this.place(m, p.x, p.y + 2.05, p.z, false, friend && d < 28 ? r.name : '');
    }
    for (const [k, m] of this.markers) if (!m.dataset.seen) { m.remove(); this.markers.delete(k); }
  }
}
