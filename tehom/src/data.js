import * as THREE from 'three';

export const FACTIONS = {
  player:  { id: 'player',  name: 'המשמרת', color: new THREE.Color('#ffb04a'), css: '#ffb04a', hull: '#a39c90' },
  enemy:   { id: 'enemy',   name: 'אופל',   color: new THREE.Color('#7cc8f0'), css: '#7cc8f0', hull: '#5f6b78' },
  neutral: { id: 'neutral', name: 'בלתי מסונף', color: new THREE.Color('#8b8a84'), css: '#8b8a84' },
};

// counters: corvette > dreadnought > frigate > corvette
export const SHIPS = {
  corvette: {
    id: 'corvette', idx: 0, name: 'צרעה', role: 'קורבטה · מהירה',
    cost: 35, build: 3.5, hp: 50, speed: 36, range: 26, rof: 0.3, dmg: 3.6,
    bonus: { dreadnought: 2.6 }, power: 1, capture: 1.2, aggro: 50, kind: 'bolt',
    blurb: 'להקות זולות. חודרות שריון של מצודות.',
  },
  frigate: {
    id: 'frigate', idx: 1, name: 'חנית', role: 'פריגטה · קרן',
    cost: 85, build: 7, hp: 150, speed: 23, range: 40, rof: 1.15, dmg: 17,
    bonus: { corvette: 2.2 }, power: 3, capture: 1, aggro: 62, kind: 'beam',
    blurb: 'קרני חיתוך. קוצרות צרעות.',
  },
  dreadnought: {
    id: 'dreadnought', idx: 2, name: 'מצודה', role: 'משחתת כבדה · ארטילריה',
    cost: 240, build: 16, hp: 640, speed: 12, range: 58, rof: 2.4, dmg: 26, guns: 3, splash: 7,
    bonus: { frigate: 2.0 }, power: 11, capture: 2, aggro: 78, kind: 'shell',
    blurb: 'פגזים בעלי רסס. שוברת קווי פריגטות.',
  },
};
export const SHIP_LIST = [SHIPS.corvette, SHIPS.frigate, SHIPS.dreadnought];

export const STRUCTURES = {
  yard:    { id: 'yard',    name: 'מספנה',       cost: 140, build: 14, blurb: 'מאפשרת בניית ספינות' },
  mine:    { id: 'mine',    name: 'מכרה עמוק',   cost: 110, build: 12, blurb: 'תפוקה ×1.6' },
  battery: { id: 'battery', name: 'סוללת חוף',   cost: 120, build: 12, blurb: 'מגינה על המסלול' },
};
export const STRUCT_LIST = [STRUCTURES.yard, STRUCTURES.mine, STRUCTURES.battery];

const C = (h) => new THREE.Color(h);

const PAL = {
  terranA: [C('#0e2a3c'), C('#4b5a34'), C('#7c6a48'), C('#9a9182')],
  terranB: [C('#123040'), C('#6f6440'), C('#a08458'), C('#c9c0ad')],
  arid:    [C('#8a5a36'), C('#c49464'), C('#5e3a26'), C('#e2c9a2')],
  arid2:   [C('#6b4a3a'), C('#a77d5f'), C('#3e2a22'), C('#cdb196')],
  ice:     [C('#9fb3bf'), C('#e3e9ec'), C('#4f6e82'), C('#c9d6dc')],
  ice2:    [C('#7f8f9c'), C('#cfd6da'), C('#3b4e5d'), C('#a9b8c0')],
  lava:    [C('#1b1412'), C('#3a2a24'), C('#ff5a10'), C('#ffc070')],
  gasA:    [C('#b7a07d'), C('#7d5e44'), C('#e6d8bd'), C('#a5523a')],
  gasB:    [C('#6f8691'), C('#3d505c'), C('#b6c5c9'), C('#d6c7a6')],
  ocean:   [C('#0b2236'), C('#2c4a3e'), C('#5f6a4c'), C('#93998a')],
};

// type: 0 temperate, 1 arid, 2 frozen, 3 molten, 4 gas
// Pairs share an orbit radius 180° apart, so the map stays point-symmetric as it turns.
export const BODY_DEFS = [
  { key: 'kur',     name: 'כּוּר',      type: 3, r: 4.2, orbit: 74,  phase: 95,  incl: 3,  prod: 3, pal: 'lava',   atmo: '#ff6a2a', cloud: 0 },
  { key: 'remetz',  name: 'רֶמֶץ',      type: 3, r: 4.0, orbit: 74,  phase: 275, incl: 3,  prod: 3, pal: 'lava',   atmo: '#ff6a2a', cloud: 0 },
  { key: 'arava',   name: 'עֲרָבָה',    type: 1, r: 5.0, orbit: 124, phase: 42,  incl: -4, prod: 2, pal: 'arid',   atmo: '#d79a62', cloud: 0.15 },
  { key: 'yaara',   name: 'יַעֲרָה',    type: 1, r: 5.0, orbit: 124, phase: 222, incl: -4, prod: 2, pal: 'arid2',  atmo: '#c9a07a', cloud: 0.15 },
  { key: 'shahar',  name: 'שַׁחַר',      type: 0, r: 7.0, orbit: 205, phase: 0,   incl: 1,  prod: 5, pal: 'terranA', atmo: '#7fb2e0', cloud: 0.55, sea: 0.02, home: 'player' },
  { key: 'ofel',    name: 'אוֹפֶל',     type: 0, r: 7.0, orbit: 205, phase: 180, incl: 1,  prod: 5, pal: 'terranB', atmo: '#9cc0d8', cloud: 0.5, sea: 0.05, home: 'enemy' },
  { key: 'tarshish',name: 'תַּרְשִׁישׁ',  type: 0, r: 6.0, orbit: 315, phase: 128, incl: 6,  prod: 3, pal: 'ocean',  atmo: '#6aa6d6', cloud: 0.7, sea: 0.22 },
  { key: 'metzula', name: 'מְצוּלָה',    type: 2, r: 5.6, orbit: 315, phase: 308, incl: 6,  prod: 3, pal: 'ice',    atmo: '#bcd8ea', cloud: 0.2 },
  { key: 'gilad',   name: 'גִּלְעָד',    type: 4, r: 15,  orbit: 420, phase: 62,  incl: -3, prod: 4, pal: 'gasA',   atmo: '#e4c9a0', cloud: 0, rings: '#c7b394' },
  { key: 'kidron',  name: 'קִדְרוֹן',    type: 4, r: 14,  orbit: 420, phase: 242, incl: -3, prod: 4, pal: 'gasB',   atmo: '#a9c8d6', cloud: 0 },
  { key: 'levana',  name: 'לְבָנָה',     type: 2, r: 2.8, orbit: 34,  phase: 0,   incl: 12, prod: 2, pal: 'ice2',   atmo: '#c0ccd4', cloud: 0, parent: 'gilad' },
  { key: 'agur',    name: 'עָגוּר',      type: 1, r: 2.8, orbit: 34,  phase: 180, incl: 12, prod: 2, pal: 'arid2',  atmo: '#b89a80', cloud: 0, parent: 'kidron' },
  { key: 'even',    name: 'אֶבֶן־שֶׁקֶט',  type: 2, r: 4.6, orbit: 540, phase: 160, incl: 9,  prod: 4, pal: 'ice2',   atmo: '#b6c6d0', cloud: 0, garrison: 2 },
  { key: 'zohar',   name: 'זֹהַר',       type: 1, r: 4.6, orbit: 540, phase: 340, incl: 9,  prod: 4, pal: 'arid',   atmo: '#d7a46e', cloud: 0, garrison: 2 },
];
export { PAL };

export const STAR = { name: 'הַגַּחֶלֶת', r: 26 };
export const BELT = { inner: 252, outer: 282, count: 2200 };

export const DIFFICULTY = [
  { id: 0, name: 'שומר',   note: 'יריב זהיר. מקום ללמוד.', income: 0.75, think: 3.2, aggression: 0.7 },
  { id: 1, name: 'קצין',   note: 'יריב מאוזן ועקבי.',    income: 1.0,  think: 2.2, aggression: 1.0 },
  { id: 2, name: 'אדמירל', note: 'יריב חמדן. לא סולח.',   income: 1.3,  think: 1.4, aggression: 1.35 },
];
