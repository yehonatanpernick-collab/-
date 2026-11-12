// UI controller: menu ↔ match flow, deploy screen, scoreboard, pause and end-of-match
// screens, and the glue between the Game runtime and the DOM.
import { CLASSES, levelProgress, rankName } from '@shared/classes';
import { TEAM_A, TEAM_B, TEAM_NAMES, type TeamId } from '@shared/config';
import type { MatchOptions, MatchPhase, RosterEntry } from '@shared/types';
import { WEAPON_BY_ID } from '@shared/weapons';
import type { MapData } from '@shared/world/MapBuilder';
import type { AudioEngine } from '../audio/audio';
import type { Engine } from '../core/engine';
import type { Input } from '../core/input';
import { IS_MOBILE, type Store } from '../core/settings';
import type { Game, GameUi } from '../game/game';
import { type JoinRequest, LocalSession, NetSession } from '../net/session';
import { fmtTime, h, show } from './dom';
import { Hud } from './hud';
import { Menu } from './menu';
import { MapLayer, TEAM_CSS, TacticalMap } from './minimap';
import { TouchControls } from './touch';

export class UiApp implements GameUi {
  private readonly menu: Menu;
  private readonly pauseMenu: Menu;
  private readonly hud: Hud;
  private readonly touch: TouchControls;
  private readonly tac: TacticalMap;
  private readonly deploy: HTMLElement;
  private readonly deployInfo: HTMLElement;
  private readonly deployBtn: HTMLElement;
  private readonly spawnLayer: HTMLElement;
  private readonly classRow: HTMLElement;
  private readonly board: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly end: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly busy: HTMLElement;
  private spawnPoint = -1;
  private paused = false;
  private showBoard = false;
  private endShown = false;
  private xpAwarded = false;
  private matchStart = 0;
  private boardT = 0;
  onEnvironment: (index: number) => Promise<void> = async () => {};

  constructor(private readonly root: HTMLElement, private readonly store: Store, private readonly engine: Engine, private readonly input: Input,
    private readonly audio: AudioEngine, private readonly game: Game, private readonly map: MapData) {
    const layer = new MapLayer(map);
    this.tac = new TacticalMap(layer);
    this.hud = new Hud(root, store, map, engine, layer);
    const actions = {
      training: (o: Partial<MatchOptions>) => { void this.startTraining(o); },
      online: (r: Omit<JoinRequest, 'name' | 'loadout' | 'level' | 'serverUrl'>) => { void this.startOnline(r); },
      settingsChanged: () => this.applySettings(),
      click: () => { void this.audio.resume(); this.audio.play('ui_click', { volume: 0.5 }); },
    };
    this.menu = new Menu(root, store, input, actions);

    // ---- deploy screen
    this.spawnLayer = h('div', { class: 'spawn-layer' });
    this.deployInfo = h('div', { class: 'deploy-info' });
    this.classRow = h('div', { class: 'seg' });
    this.deployBtn = h('button', { class: 'btn primary big', onclick: () => this.doDeploy() }, 'DEPLOY');
    this.deploy = h('div', { class: 'overlay deploy hidden' },
      h('div', { class: 'deploy-map' }, this.tac.canvas, this.spawnLayer),
      h('div', { class: 'deploy-side' }, h('h2', { text: 'DEPLOYMENT' }), this.deployInfo, h('label', { text: 'CLASS' }), this.classRow,
        this.deployBtn,
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => this.openPauseTab() }, 'LOADOUT'), h('button', { class: 'btn', onclick: () => this.game.switchTeam() }, 'SWITCH TEAM'),
          h('button', { class: 'btn danger', onclick: () => this.leave() }, 'LEAVE'))));
    // ---- scoreboard, pause, end
    this.board = h('div', { class: 'overlay board hidden' });
    this.pauseMenu = new Menu(root, store, input, actions, true);
    this.pause = h('div', { class: 'overlay pause hidden' }, h('div', { class: 'pause-box' }, h('h2', { text: 'PAUSED' }),
      h('button', { class: 'btn primary', onclick: () => this.setPaused(false) }, 'RESUME'),
      h('button', { class: 'btn', onclick: () => this.openPauseTab() }, 'LOADOUT & SETTINGS'),
      h('button', { class: 'btn', onclick: () => { this.game.switchTeam(); this.setPaused(false); } }, 'SWITCH TEAM'),
      h('button', { class: 'btn danger', onclick: () => this.leave() }, 'LEAVE MATCH')));
    this.end = h('div', { class: 'overlay end hidden' });
    this.toast = h('div', { class: 'toast hidden' });
    this.busy = h('div', { class: 'overlay busy hidden' }, h('div', { class: 'spinner' }), h('p', { text: 'CONNECTING…' }));
    this.touch = new TouchControls(root, input, store);
    this.touch.onPause = () => this.setPaused(!this.paused);
    this.touch.onScoreboard = () => { this.showBoard = !this.showBoard; };
    root.append(this.deploy, this.board, this.pause, this.end, this.busy, this.toast);
    this.pauseMenu.root.append(h('button', { class: 'btn primary close-menu', onclick: () => { this.pauseMenu.show(false); this.game.session?.setLoadout(this.store.loadout); } }, 'BACK TO BATTLE'));
    game.ui = this;
    this.applySettings();
    this.showMenu();
  }

  private applySettings(): void {
    const s = this.store.settings;
    this.audio.setVolumes(s.masterVolume, s.sfxVolume, s.musicVolume);
    this.engine.applyQuality();
    this.touch.apply();
  }

  private say(text: string): void {
    this.toast.textContent = text;
    show(this.toast, true);
    window.setTimeout(() => show(this.toast, false), 5000);
  }

  // ------------------------------------------------------------------ flow
  showMenu(): void {
    this.menu.show(true);
    this.hud.setVisible(false);
    this.touch.setVisible(false);
    for (const o of [this.deploy, this.board, this.pause, this.end]) show(o, false);
    this.audio.music(true);
  }

  private enterMatch(): void {
    this.menu.show(false);
    this.hud.setVisible(true);
    this.paused = false; this.endShown = false; this.xpAwarded = false; this.spawnPoint = -1;
    this.matchStart = performance.now();
    this.audio.music(false);
  }

  async startTraining(o: Partial<MatchOptions>): Promise<void> {
    await this.audio.resume();
    show(this.busy, true);
    try {
      await this.onEnvironment(o.environment ?? 0);
      const session = new LocalSession({ ...o, fillBots: false, seed: Math.floor(Math.random() * 1e6) }, this.map, this.store.settings.name, this.store.loadout, this.store.level);
      this.game.start(session);
      this.enterMatch();
    } finally { show(this.busy, false); }
  }

  async startOnline(r: Omit<JoinRequest, 'name' | 'loadout' | 'level' | 'serverUrl'>): Promise<void> {
    await this.audio.resume();
    show(this.busy, true);
    try {
      const session = await NetSession.connect({ ...r, name: this.store.settings.name, loadout: this.store.loadout, level: this.store.level, serverUrl: this.store.settings.serverUrl });
      await this.onEnvironment(session.options.environment ?? 0);
      this.game.start(session);
      this.enterMatch();
      if (session.roomCode) this.say(`PRIVATE ROOM CODE: ${session.roomCode} — share it with your squad`);
    } catch (e) {
      this.say(`Could not join: ${(e as Error).message || 'server unreachable'}`);
    } finally { show(this.busy, false); }
  }

  leave(): void {
    this.game.stop();
    this.pauseMenu.show(false);
    this.showMenu();
  }

  private setPaused(on: boolean): void {
    this.paused = on;
    show(this.pause, on);
    const s = this.game.session;
    if (s instanceof LocalSession) s.paused = on;
    if (on) this.input.exitLock(); else if (this.game.view.alive) this.input.requestLock();
    this.input.enabled = !on && this.game.view.alive;
  }

  private openPauseTab(): void { show(this.pause, false); this.pauseMenu.show(true, 'loadout'); }

  private doDeploy(): void {
    void this.audio.resume();
    this.game.deploy(this.spawnPoint);
    if (!IS_MOBILE) this.input.requestLock();
  }

  // ------------------------------------------------------------------ GameUi
  hitmarker(head: boolean, kill: boolean): void { this.hud.hitmarker(head, kill); }
  damage(angle: number, amount: number): void { this.hud.damage(angle, amount); }
  killFeed(k: string, kt: number, v: string, vt: number, w: string, head: boolean, mine: boolean): void { this.hud.killFeed(k, kt, v, vt, w, head, mine); }
  score(amount: number, reason: string): void { this.hud.score(amount, reason); }
  notice(text: string, tone: 'good' | 'bad' | 'neutral'): void { this.hud.notice(text, tone); }
  phase(phase: MatchPhase, _winner: TeamId): void { if (phase === 'warmup') { this.endShown = false; this.xpAwarded = false; show(this.end, false); this.matchStart = performance.now(); } }
  spawned(): void { show(this.deploy, false); }
  died(): void { this.input.enabled = false; }
  status(status: string, detail?: string): void { if (status === 'disconnected') { this.say(detail || 'Disconnected from server.'); this.leave(); } }

  // ------------------------------------------------------------------ per frame
  update(dt: number): void {
    const g = this.game, v = g.view;
    if (!g.active) return;
    this.hud.update(v, dt);
    if (this.input.wasPressed('menu')) {
      if (!this.pauseMenu.root.classList.contains('hidden')) { this.pauseMenu.show(false); g.session?.setLoadout(this.store.loadout); }
      else this.setPaused(!this.paused);
    }
    const ended = v.phase === 'ended';
    const wantDeploy = !v.alive && !ended && !this.paused && this.pauseMenu.root.classList.contains('hidden');
    show(this.deploy, wantDeploy);
    this.touch.setVisible((IS_MOBILE || this.input.touchActive) && v.alive && !this.paused && !ended);
    if (wantDeploy) this.updateDeploy();
    const board = (this.input.isHeld('scoreboard') || this.showBoard) && !ended;
    show(this.board, board);
    this.boardT -= dt;
    if (board && this.boardT <= 0) { this.boardT = 0.3; this.board.replaceChildren(this.table(v.roster, v.myId, v.myTeam, `${fmtTime(v.timeLeft)} — KESTREL CROSSING`)); }
    if (ended && !this.endShown && v.result) this.showEnd();
    if (ended) { const t = this.end.querySelector('.next'); if (t) t.textContent = `NEXT MATCH IN ${Math.ceil(v.timeLeft)}`; }
    if (!v.alive || ended) this.input.clearPressed();
  }

  private updateDeploy(): void {
    const v = this.game.view;
    this.tac.draw(v);
    const cls = CLASSES[this.store.classId];
    const points: { id: number; name: string; x: number; z: number; ok: boolean }[] = [];
    const base = this.map.bases.find((b) => b.team === v.myTeam) ?? this.map.bases[0];
    points.push({ id: -1, name: 'HQ', x: base.x, z: base.z, ok: true });
    this.map.objectives.forEach((o, i) => points.push({ id: i, name: o.id, x: o.x, z: o.z, ok: v.objectives[i]?.owner === v.myTeam }));
    if (!points.find((p) => p.id === this.spawnPoint)?.ok) this.spawnPoint = -1;
    const key = points.map((p) => `${p.id}${p.ok}${p.id === this.spawnPoint}`).join('|') + v.myTeam;
    if (this.spawnLayer.dataset.k !== key) {
      this.spawnLayer.dataset.k = key;
      this.spawnLayer.replaceChildren(...points.filter((p) => p.ok).map((p) => {
        const n = this.tac.norm(p.x, p.z);
        const b = h('button', { class: `spawn${p.id === this.spawnPoint ? ' active' : ''}`, onclick: () => { this.spawnPoint = p.id; this.audio.play('ui_click', { volume: 0.5 }); } }, p.name);
        b.style.left = `${n.u * 100}%`; b.style.top = `${n.v * 100}%`; b.style.setProperty('--c', TEAM_CSS[v.myTeam]);
        return b;
      }));
    }
    const ck = `${this.store.classId}`;
    if (this.classRow.dataset.k !== ck) {
      this.classRow.dataset.k = ck;
      this.classRow.replaceChildren(...CLASSES.map((k) => h('button', { class: `seg-btn${k.index === this.store.classId ? ' active' : ''}`, onclick: () => { this.store.classId = k.index; this.store.saveLoadouts(); this.game.session?.setLoadout(this.store.loadout); } }, k.name.toUpperCase())));
    }
    const lo = this.store.loadout;
    const info = `<b style="color:${TEAM_CSS[v.myTeam]}">${TEAM_NAMES[v.myTeam]}</b><span>${cls.role}</span><span>${WEAPON_BY_ID[lo.primary].name} · ${WEAPON_BY_ID[lo.secondary].name}</span>${v.deathBy ? `<span class="killed">KILLED BY ${v.deathBy.toUpperCase()}</span>` : ''}`;
    if (this.deployInfo.dataset.k !== info) { this.deployInfo.dataset.k = info; this.deployInfo.innerHTML = info; }
    const wait = v.phase === 'warmup' ? Math.ceil(v.timeLeft) : Math.ceil(v.respawnT);
    const label = v.phase === 'warmup' ? `MATCH STARTS IN ${wait}` : wait > 0 ? `DEPLOY IN ${wait}` : 'DEPLOY';
    if (this.deployBtn.textContent !== label) this.deployBtn.textContent = label;
    this.deployBtn.classList.toggle('disabled', v.phase === 'warmup');
  }

  private table(roster: RosterEntry[], myId: number, myTeam: TeamId, title: string): HTMLElement {
    const team = (t: TeamId): HTMLElement => {
      const rows = roster.filter((r) => r.team === t).sort((a, b) => b.score - a.score);
      return h('div', { class: 'team' }, h('h3', { text: `${TEAM_NAMES[t]}${t === myTeam ? ' — YOUR TEAM' : ''}`, style: `color:${TEAM_CSS[t]}` }),
        h('div', { class: 'trow head' }, ...['SOLDIER', 'CLASS', 'K', 'D', 'A', 'CAP', 'SCORE', 'PING'].map((x) => h('span', { text: x }))),
        ...rows.map((r) => h('div', { class: `trow${r.id === myId ? ' me' : ''}` }, h('span', { text: `${r.name}${r.bot ? ' [AI]' : ''}` }), h('span', { text: CLASSES[r.classId].name }),
          h('span', { text: String(r.kills) }), h('span', { text: String(r.deaths) }), h('span', { text: String(r.assists) }), h('span', { text: String(r.captures) }),
          h('span', { text: String(r.score) }), h('span', { text: r.bot ? '—' : String(r.ping) }))));
    };
    return h('div', { class: 'board-box' }, h('h2', { text: title }), h('div', { class: 'teams' }, team(TEAM_A), team(TEAM_B)));
  }

  private showEnd(): void {
    const v = this.game.view, res = v.result;
    if (!res) return;
    this.endShown = true;
    this.input.exitLock();
    const me = res.roster.find((r) => r.id === v.myId);
    const won = res.winner === v.myTeam, draw = res.winner === 0;
    const xp = me ? me.score + (won ? 500 : 150) : 0;
    const p = this.store.profile;
    if (me && !this.xpAwarded) {
      this.xpAwarded = true;
      p.xp += xp; p.matches++; if (won) p.wins++;
      p.kills += me.kills; p.deaths += me.deaths; p.assists += me.assists; p.captures += me.captures; p.headshots += me.headshots;
      p.bestScore = Math.max(p.bestScore, me.score);
      p.playSeconds += Math.round((performance.now() - this.matchStart) / 1000);
      this.store.saveProfile();
    }
    const lp = levelProgress(p.xp);
    const cell = (l: string, val: string): HTMLElement => h('div', { class: 'cell' }, h('label', { text: l }), h('b', { text: val }));
    this.end.replaceChildren(h('div', { class: 'end-box' },
      h('h1', { class: draw ? '' : won ? 'win' : 'lose', text: draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT' }),
      h('p', { class: 'sub', text: `${TEAM_NAMES[TEAM_A]} ${res.tickets[0]} — ${res.tickets[1]} ${TEAM_NAMES[TEAM_B]}  ·  ${fmtTime(res.duration)}` }),
      me ? h('div', { class: 'grid' }, cell('KILLS', String(me.kills)), cell('DEATHS', String(me.deaths)), cell('ASSISTS', String(me.assists)), cell('CAPTURES', String(me.captures)),
        cell('SCORE', String(me.score)), cell('XP EARNED', `+${xp}`)) : null,
      h('div', { class: 'rank' }, h('b', { text: `${rankName(lp.level).toUpperCase()} — LEVEL ${lp.level}` }), h('div', { class: 'stat-bar' }, h('i', { style: `width:${(lp.into / lp.need) * 100}%` })), h('span', { text: `${lp.into} / ${lp.need} XP` })),
      this.table(res.roster, v.myId, v.myTeam, 'FINAL SCOREBOARD'),
      h('div', { class: 'row' }, h('span', { class: 'next' }), h('button', { class: 'btn primary', onclick: () => this.leave() }, 'RETURN TO MENU'))));
    show(this.end, true);
  }
}
