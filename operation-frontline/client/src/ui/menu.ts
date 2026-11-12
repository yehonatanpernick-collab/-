// Main menu: Play, Multiplayer lobby, Training, Loadout, Classes, Settings, Profile, Credits.
import { CLASSES, GADGETS, levelProgress, rankName } from '@shared/classes';
import { DIFFICULTY_NAMES, type MatchOptions } from '@shared/types';
import { ATTACHMENTS, ATTACHMENT_SLOTS, type AttachmentSlot, WEAPON_BY_ID, resolveWeapon } from '@shared/weapons';
import type { Input } from '../core/input';
import { ACTION_LABELS, type Action, DEFAULT_BINDINGS, type QualityLevel, type Store, keyLabel } from '../core/settings';
import { type JoinRequest, type RoomInfo, fetchRooms } from '../net/session';
import { esc, h } from './dom';

export interface MenuActions {
  training(opts: Partial<MatchOptions>): void;
  online(req: Omit<JoinRequest, 'name' | 'loadout' | 'level' | 'serverUrl'>): void;
  settingsChanged(): void;
  click(): void;
}

const TABS = ['play', 'multiplayer', 'training', 'loadout', 'classes', 'settings', 'profile', 'credits'] as const;
type Tab = (typeof TABS)[number];
const SLOT_NAMES: Record<AttachmentSlot, string> = { optic: 'Optic', muzzle: 'Muzzle', grip: 'Underbarrel', mag: 'Magazine', barrel: 'Barrel' };

export class Menu {
  readonly root: HTMLElement;
  private readonly content: HTMLElement;
  private readonly nav: HTMLElement;
  private tab: Tab = 'play';
  private training: Partial<MatchOptions> = { botDifficulty: 1, friendlyBots: 7, enemyBots: 8, environment: 0, vehicles: true, tickets: 150, warmup: 4 };
  private editing: 'primary' | 'secondary' = 'primary';
  private settingsTab = 'video';
  private rooms: RoomInfo[] | null = null;
  private roomsError = '';

  constructor(parent: HTMLElement, private readonly store: Store, private readonly input: Input, private readonly act: MenuActions, private readonly inGame = false) {
    this.nav = h('nav', { class: 'menu-nav' });
    this.content = h('div', { class: 'menu-content' });
    this.root = h('div', { class: `menu hidden${inGame ? ' ingame' : ''}` },
      h('div', { class: 'menu-side' },
        h('div', { class: 'logo' }, h('span', { text: 'OPERATION' }), h('b', { text: 'FRONTLINE' }), h('em', { text: 'KESTREL CROSSING — CONQUEST 8v8' })),
        this.nav,
        h('div', { class: 'menu-foot', text: 'v1.0 — PlayCanvas · Colyseus · TypeScript' })),
      this.content);
    parent.append(this.root);
    this.render();
  }

  show(on: boolean, tab?: Tab): void {
    this.root.classList.toggle('hidden', !on);
    if (tab) this.tab = tab;
    if (on) this.render();
  }

  private btn(label: string, fn: () => void, cls = 'btn'): HTMLElement {
    return h('button', { class: cls, onclick: () => { this.act.click(); fn(); } }, label);
  }

  render(): void {
    const tabs = this.inGame ? (['loadout', 'classes', 'settings'] as Tab[]) : [...TABS];
    if (!tabs.includes(this.tab)) this.tab = tabs[0];
    this.nav.replaceChildren(...tabs.map((t) => this.btn(t.toUpperCase(), () => { this.tab = t; this.render(); }, `nav-btn${t === this.tab ? ' active' : ''}`)));
    const c = this.content;
    c.replaceChildren();
    const title = (t: string, sub: string): void => { c.append(h('h1', { text: t }), h('p', { class: 'sub', text: sub })); };
    switch (this.tab) {
      case 'play': title('DEPLOY', 'Choose how you want to fight.'); this.play(c); break;
      case 'multiplayer': title('MULTIPLAYER', 'Public matchmaking, room browser and private matches — up to 16 players.'); this.lobby(c); break;
      case 'training': title('TRAINING', 'Offline conquest against AI. No server connection required.'); this.trainingPanel(c); break;
      case 'loadout': title('LOADOUT', 'Weapons and attachments for the selected class.'); this.loadout(c); break;
      case 'classes': title('CLASSES', 'Four roles, each with unique equipment.'); this.classes(c); break;
      case 'settings': title('SETTINGS', 'Video, controls, audio and mobile options.'); this.settings(c); break;
      case 'profile': title('PROFILE', 'Service record stored on this device.'); this.profile(c); break;
      case 'credits': title('CREDITS', 'Technology and asset sources.'); this.credits(c); break;
    }
  }

  // ------------------------------------------------------------------ play
  private play(c: HTMLElement): void {
    const cls = CLASSES[this.store.classId];
    c.append(h('div', { class: 'cards' },
      h('div', { class: 'card big', onclick: () => { this.act.click(); this.act.online({ mode: 'quick' }); } },
        h('h2', { text: 'QUICK MATCH' }), h('p', { text: 'Join a public 8v8 Conquest match. Bots hold the line until more players arrive.' }), h('span', { class: 'cta', text: 'FIND MATCH ▸' })),
      h('div', { class: 'card big', onclick: () => { this.act.click(); this.act.training(this.training); } },
        h('h2', { text: 'TRAINING' }), h('p', { text: 'Fight AI soldiers offline. Practise weapons, movement and capturing objectives.' }), h('span', { class: 'cta', text: 'START TRAINING ▸' })),
    ), h('div', { class: 'summary' },
      h('div', {}, h('label', { text: 'CALLSIGN' }), h('b', { text: this.store.settings.name })),
      h('div', {}, h('label', { text: 'CLASS' }), h('b', { text: cls.name })),
      h('div', {}, h('label', { text: 'PRIMARY' }), h('b', { text: WEAPON_BY_ID[this.store.loadout.primary].name })),
      h('div', {}, h('label', { text: 'RANK' }), h('b', { text: `${rankName(this.store.level)} · LVL ${this.store.level}` })),
    ), h('p', { class: 'hint', html: 'Desktop: <b>WASD</b> move · <b>Mouse</b> aim · <b>LMB</b> fire · <b>RMB</b> aim · <b>Shift</b> sprint · <b>C</b> crouch/slide · <b>E</b> vehicle · <b>G</b> grenade · <b>Tab</b> scoreboard. Mobile: on-screen controls.' }));
  }

  // ------------------------------------------------------------------ multiplayer lobby
  private lobby(c: HTMLElement): void {
    const list = h('div', { class: 'rooms' });
    const fill = (): void => {
      list.replaceChildren();
      if (this.roomsError) { list.append(h('div', { class: 'empty', text: `Server unreachable: ${this.roomsError}. Start it with "npm run dev:server" or set a server address below.` })); return; }
      if (!this.rooms) { list.append(h('div', { class: 'empty', text: 'Contacting server…' })); return; }
      if (this.rooms.length === 0) { list.append(h('div', { class: 'empty', text: 'No public rooms yet — Quick Match creates one.' })); return; }
      list.append(h('div', { class: 'room head' }, h('span', { text: 'ROOM' }), h('span', { text: 'MAP' }), h('span', { text: 'PLAYERS' }), h('span', { text: 'TEAMS' }), h('span', { text: 'STATUS' }), h('span', {})));
      for (const r of this.rooms) {
        list.append(h('div', { class: 'room' }, h('span', { text: r.name }), h('span', { text: r.map }), h('span', { text: `${r.clients} / ${r.maxClients}` }),
          h('span', { text: `${r.teamA} v ${r.teamB} (+${r.bots} AI)` }), h('span', { text: r.phase.toUpperCase() }),
          r.clients >= r.maxClients ? h('span', { class: 'full', text: 'FULL' }) : this.btn('JOIN', () => this.act.online({ mode: 'join', roomId: r.roomId }), 'btn small')));
      }
    };
    const refresh = (): void => {
      this.rooms = null; this.roomsError = ''; fill();
      fetchRooms(this.store.settings.serverUrl).then((r) => { this.rooms = r; fill(); }).catch((e: Error) => { this.roomsError = e.message; fill(); });
    };
    const code = h('input', { class: 'inp', placeholder: 'ROOM CODE', maxlength: 6 }) as HTMLInputElement;
    const url = h('input', { class: 'inp wide', placeholder: 'Server address (blank = default)', value: this.store.settings.serverUrl }) as HTMLInputElement;
    url.addEventListener('change', () => { this.store.settings.serverUrl = url.value.trim(); this.store.saveSettings(); refresh(); });
    c.append(h('div', { class: 'row' }, this.btn('QUICK MATCH', () => this.act.online({ mode: 'quick' }), 'btn primary'), this.btn('REFRESH', refresh),
      this.btn('CREATE PRIVATE MATCH', () => this.act.online({ mode: 'private-create' })), code,
      this.btn('JOIN WITH CODE', () => { if (code.value.trim()) this.act.online({ mode: 'private-join', code: code.value.trim().toUpperCase() }); })),
    list, h('div', { class: 'row' }, h('label', { text: 'SERVER' }), url));
    refresh();
  }

  // ------------------------------------------------------------------ training
  private trainingPanel(c: HTMLElement): void {
    const t = this.training;
    const pick = (label: string, opts: [string, number | boolean][], get: () => unknown, set: (v: number | boolean) => void): HTMLElement =>
      h('div', { class: 'field' }, h('label', { text: label }), h('div', { class: 'seg' }, ...opts.map(([n, v]) => this.btn(n, () => { set(v); this.render(); }, `seg-btn${get() === v ? ' active' : ''}`))));
    c.append(
      pick('ENEMY DIFFICULTY', DIFFICULTY_NAMES.map((n, i) => [n, i]), () => t.botDifficulty, (v) => { t.botDifficulty = v as 0; }),
      pick('ENEMY SOLDIERS', [1, 2, 4, 6, 8].map((n) => [String(n), n]), () => t.enemyBots, (v) => { t.enemyBots = v as number; }),
      pick('FRIENDLY SOLDIERS', [0, 1, 3, 5, 7].map((n) => [String(n), n]), () => t.friendlyBots, (v) => { t.friendlyBots = v as number; }),
      pick('TICKETS', [75, 150, 300].map((n) => [String(n), n]), () => t.tickets, (v) => { t.tickets = v as number; }),
      pick('TIME OF DAY', [['Overcast Day', 0], ['Dusk Assault', 1]], () => t.environment, (v) => { t.environment = v as number; }),
      pick('VEHICLES', [['On', true], ['Off', false]], () => t.vehicles, (v) => { t.vehicles = v as boolean; }),
      h('div', { class: 'row' }, this.btn('START TRAINING', () => this.act.training(t), 'btn primary')),
      h('p', { class: 'hint', text: 'Tip: set enemy soldiers to 1 and difficulty to Recruit for a relaxed firing range, or 8 Elite for a full battle.' }));
  }

  // ------------------------------------------------------------------ loadout
  private bar(label: string, v: number): HTMLElement {
    return h('div', { class: 'stat' }, h('label', { text: label }), h('div', { class: 'stat-bar' }, h('i', { style: `width:${Math.round(Math.max(4, Math.min(100, v)))}%` })));
  }

  private loadout(c: HTMLElement): void {
    const store = this.store, cls = CLASSES[store.classId], lo = store.loadout, level = store.level;
    const which = this.editing;
    const wid = which === 'primary' ? lo.primary : lo.secondary;
    const att = which === 'primary' ? lo.primaryAtt : lo.secondaryAtt;
    const st = resolveWeapon(wid, att);
    const def = WEAPON_BY_ID[wid];
    const classRow = h('div', { class: 'seg' }, ...CLASSES.map((k) => this.btn(k.name.toUpperCase(), () => { store.classId = k.index; store.saveLoadouts(); this.render(); }, `seg-btn${k.index === store.classId ? ' active' : ''}`)));
    const slotRow = h('div', { class: 'seg' }, this.btn('PRIMARY', () => { this.editing = 'primary'; this.render(); }, `seg-btn${which === 'primary' ? ' active' : ''}`),
      this.btn('SIDEARM', () => { this.editing = 'secondary'; this.render(); }, `seg-btn${which === 'secondary' ? ' active' : ''}`));
    const weapons = h('div', { class: 'wlist' }, ...(which === 'primary' ? cls.primaries : cls.secondaries).map((id) => {
      const w = WEAPON_BY_ID[id];
      return h('div', { class: `witem${id === wid ? ' active' : ''}`, onclick: () => { this.act.click(); store.setLoadout({ ...lo, [which]: id }); this.render(); } },
        h('b', { text: w.name }), h('span', { text: w.cls.toUpperCase() }), h('p', { text: w.desc }));
    }));
    const atts = h('div', { class: 'atts' }, ...ATTACHMENT_SLOTS.filter((s) => def.allowed[s].length > 1).map((slot) => h('div', { class: 'att-slot' }, h('label', { text: SLOT_NAMES[slot].toUpperCase() }),
      h('div', { class: 'att-list' }, ...def.allowed[slot].map((id) => {
        const a = ATTACHMENTS[id], locked = a.level > level;
        return h('button', { class: `att${att[slot] === id ? ' active' : ''}${locked ? ' locked' : ''}`, title: a.desc, onclick: () => {
          if (locked) return;
          this.act.click();
          const key = which === 'primary' ? 'primaryAtt' : 'secondaryAtt';
          store.setLoadout({ ...lo, [key]: { ...att, [slot]: id } });
          this.render();
        } }, a.name, locked ? h('small', { text: `LVL ${a.level}` }) : null);
      })))));
    const stats = h('div', { class: 'stats' }, h('h3', { text: st.name }),
      this.bar('DAMAGE', st.damage * (st.cls === 'sniper' ? 1 : 2.6)), this.bar('FIRE RATE', st.rpm / 10), this.bar('RANGE', st.rangeEnd / 2.2),
      this.bar('ACCURACY', 100 - st.adsSpread * 160 - st.hipSpread * 6), this.bar('CONTROL', 100 - st.recoil.v * 28 - st.recoil.h * 40),
      this.bar('HANDLING', 100 - st.adsTime * 170), this.bar('MOBILITY', st.moveFactor * 90),
      h('p', { class: 'hint', text: `${st.magSize} rounds · ${st.reloadTime.toFixed(1)}s reload · ${st.zoom}x optic${st.suppressed ? ' · suppressed' : ''}` }));
    const gad = h('div', { class: 'gadgets' }, h('label', { text: 'CLASS EQUIPMENT' }),
      ...cls.gadgets.filter(Boolean).map((g) => h('div', { class: 'gadget' }, h('b', { text: GADGETS[g as keyof typeof GADGETS].name }), h('span', { text: GADGETS[g as keyof typeof GADGETS].desc }))),
      h('div', { class: 'gadget' }, h('b', { text: `Frag Grenade ×${cls.grenades}` }), h('span', { text: 'Thrown explosive with a 2.8 second fuse.' })));
    c.append(classRow, slotRow, h('div', { class: 'loadout-grid' }, h('div', {}, weapons, gad), h('div', {}, stats, atts)));
  }

  // ------------------------------------------------------------------ classes
  private classes(c: HTMLElement): void {
    c.append(h('div', { class: 'cards four' }, ...CLASSES.map((k) => h('div', { class: `card${k.index === this.store.classId ? ' active' : ''}`, onclick: () => { this.act.click(); this.store.classId = k.index; this.store.saveLoadouts(); this.render(); } },
      h('h2', { text: k.name.toUpperCase() }), h('em', { text: k.role }), h('p', { text: k.desc }),
      h('ul', {}, ...k.primaries.map((w) => h('li', { text: WEAPON_BY_ID[w].name })), ...k.gadgets.filter(Boolean).map((g) => h('li', { text: GADGETS[g as keyof typeof GADGETS].name }))),
      h('p', { class: 'trait', text: k.trait }), h('span', { class: 'cta', text: k.index === this.store.classId ? 'SELECTED' : 'SELECT ▸' })))));
  }

  // ------------------------------------------------------------------ settings
  private settings(c: HTMLElement): void {
    const s = this.store.settings;
    const save = (): void => { this.store.saveSettings(); this.act.settingsChanged(); };
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt = (v: number): string => v.toFixed(2)): HTMLElement => {
      const out = h('span', { class: 'val', text: fmt(get()) });
      const inp = h('input', { type: 'range', min, max, step, value: get() }) as HTMLInputElement;
      inp.addEventListener('input', () => { set(Number(inp.value)); out.textContent = fmt(Number(inp.value)); save(); });
      return h('div', { class: 'field' }, h('label', { text: label }), inp, out);
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement =>
      h('div', { class: 'field' }, h('label', { text: label }), h('div', { class: 'seg' },
        this.btn('ON', () => { set(true); save(); this.render(); }, `seg-btn${get() ? ' active' : ''}`), this.btn('OFF', () => { set(false); save(); this.render(); }, `seg-btn${!get() ? ' active' : ''}`)));
    const tabs = ['video', 'controls', 'audio', 'mobile'];
    c.append(h('div', { class: 'seg' }, ...tabs.map((t) => this.btn(t.toUpperCase(), () => { this.settingsTab = t; this.render(); }, `seg-btn${t === this.settingsTab ? ' active' : ''}`))));
    const p = h('div', { class: 'panel' });
    c.append(p);
    if (this.settingsTab === 'video') {
      p.append(h('div', { class: 'field' }, h('label', { text: 'GRAPHICS QUALITY' }), h('div', { class: 'seg' }, ...(['low', 'medium', 'high', 'ultra'] as QualityLevel[]).map((q) =>
        this.btn(q.toUpperCase(), () => { s.quality = q; save(); this.render(); }, `seg-btn${s.quality === q ? ' active' : ''}`)))),
      h('div', { class: 'field' }, h('label', { text: 'RENDERER' }), h('div', { class: 'seg' },
        this.btn('AUTO (WebGPU → WebGL 2)', () => { s.renderer = 'auto'; save(); this.render(); }, `seg-btn${s.renderer === 'auto' ? ' active' : ''}`),
        this.btn('WebGL 2', () => { s.renderer = 'webgl2'; save(); this.render(); }, `seg-btn${s.renderer === 'webgl2' ? ' active' : ''}`))),
      check('ADAPTIVE RESOLUTION', () => s.adaptiveResolution, (v) => { s.adaptiveResolution = v; }),
      slider('FIELD OF VIEW', 60, 105, 1, () => s.fov, (v) => { s.fov = v; }, (v) => `${v}°`),
      check('SHOW FPS', () => s.showFps, (v) => { s.showFps = v; }),
      h('p', { class: 'hint', text: 'Quality controls shadows, ambient occlusion, bloom, anti-aliasing, particle density, light count and prop draw distance. Renderer changes apply after a reload.' }));
    } else if (this.settingsTab === 'controls') {
      p.append(slider('MOUSE SENSITIVITY', 0.2, 3, 0.05, () => s.sensitivity, (v) => { s.sensitivity = v; }),
        slider('ADS SENSITIVITY', 0.2, 1.5, 0.05, () => s.adsSensitivity, (v) => { s.adsSensitivity = v; }),
        check('INVERT Y', () => s.invertY, (v) => { s.invertY = v; }), check('TOGGLE CROUCH', () => s.toggleCrouch, (v) => { s.toggleCrouch = v; }),
        check('TOGGLE AIM', () => s.toggleAds, (v) => { s.toggleAds = v; }));
      const binds = h('div', { class: 'binds' });
      for (const a of Object.keys(ACTION_LABELS) as Action[]) {
        const b = h('button', { class: 'bind', text: keyLabel(s.bindings[a]) });
        b.addEventListener('click', () => {
          b.textContent = 'PRESS A KEY…'; b.classList.add('listening');
          this.input.captureNext((code) => { if (code !== 'Escape' || a === 'menu') s.bindings[a] = code; save(); this.render(); });
        });
        binds.append(h('div', { class: 'bind-row' }, h('span', { text: ACTION_LABELS[a] }), b));
      }
      p.append(h('h3', { text: 'KEY BINDINGS' }), binds, h('div', { class: 'row' }, this.btn('RESET BINDINGS', () => { s.bindings = { ...DEFAULT_BINDINGS }; save(); this.render(); })));
    } else if (this.settingsTab === 'audio') {
      const pct = (v: number): string => `${Math.round(v * 100)}%`;
      p.append(slider('MASTER VOLUME', 0, 1, 0.01, () => s.masterVolume, (v) => { s.masterVolume = v; }, pct),
        slider('EFFECTS', 0, 1, 0.01, () => s.sfxVolume, (v) => { s.sfxVolume = v; }, pct), slider('MUSIC', 0, 1, 0.01, () => s.musicVolume, (v) => { s.musicVolume = v; }, pct));
    } else {
      p.append(slider('TOUCH LOOK SENSITIVITY', 0.3, 2.5, 0.05, () => s.touchSensitivity, (v) => { s.touchSensitivity = v; }),
        slider('BUTTON SIZE', 0.7, 1.4, 0.05, () => s.touchScale, (v) => { s.touchScale = v; }),
        check('LEFT-HANDED LAYOUT', () => s.touchLeftHanded, (v) => { s.touchLeftHanded = v; }),
        check('AUTO FIRE ON TARGET', () => s.autoFire, (v) => { s.autoFire = v; }));
    }
    c.append(h('div', { class: 'row' }, this.btn('RESTORE DEFAULTS', () => { this.store.resetSettings(); this.act.settingsChanged(); this.render(); })));
  }

  // ------------------------------------------------------------------ profile / credits
  private profile(c: HTMLElement): void {
    const p = this.store.profile, lp = levelProgress(p.xp);
    const name = h('input', { class: 'inp wide', value: this.store.settings.name, maxlength: 16 }) as HTMLInputElement;
    name.addEventListener('change', () => { this.store.settings.name = name.value.trim().slice(0, 16) || 'Soldier'; this.store.saveSettings(); });
    const cell = (l: string, v: string): HTMLElement => h('div', { class: 'cell' }, h('label', { text: l }), h('b', { text: v }));
    c.append(h('div', { class: 'field' }, h('label', { text: 'CALLSIGN' }), name),
      h('div', { class: 'rank' }, h('b', { text: `${rankName(lp.level).toUpperCase()} — LEVEL ${lp.level}` }), h('div', { class: 'stat-bar' }, h('i', { style: `width:${(lp.into / lp.need) * 100}%` })), h('span', { text: `${lp.into} / ${lp.need} XP` })),
      h('div', { class: 'grid' }, cell('MATCHES', String(p.matches)), cell('WINS', String(p.wins)), cell('KILLS', String(p.kills)), cell('DEATHS', String(p.deaths)),
        cell('K/D', (p.kills / Math.max(1, p.deaths)).toFixed(2)), cell('ASSISTS', String(p.assists)), cell('CAPTURES', String(p.captures)), cell('HEADSHOTS', String(p.headshots)),
        cell('BEST SCORE', String(p.bestScore)), cell('TIME PLAYED', `${Math.floor(p.playSeconds / 3600)}h ${Math.floor((p.playSeconds % 3600) / 60)}m`)),
      h('p', { class: 'hint', text: 'XP unlocks weapon attachments. Progress is saved in this browser.' }));
  }

  private credits(c: HTMLElement): void {
    c.append(h('div', { class: 'panel credits', html: `
      <h3>GAME</h3><p>OPERATION: FRONTLINE — an original browser FPS. Design, code, level, procedural weapon / vehicle models and all synthesised audio are original to this project.</p>
      <h3>TECHNOLOGY</h3><p>${esc('PlayCanvas Engine (MIT) · Colyseus (MIT) · TypeScript · Vite')}</p>
      <h3>THIRD-PARTY ASSETS</h3>
      <p><b>Poly Haven</b> (CC0) — PBR texture sets, HDRI skies, and 3D models including the bolt-action rifle, service pistol, grenade, barriers, vehicles and street props.</p>
      <p><b>Soldier character</b> — "Vanguard" model with Idle / Walk / Run animation clips from Adobe Mixamo, via the three.js examples repository.</p>
      <p>The complete manifest with sources and licences is in <code>assets/manifest.json</code>.</p>` }));
  }
}
