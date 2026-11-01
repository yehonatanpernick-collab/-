// Move table. Times in seconds. Impact happens at the end of `startup`.
// reach = max distance between fighter centres for the strike to connect.
export const MOVES = {
  jab:       { name: 'JAB',        kind: 'punch', hand: 'L', startup: 0.11, active: 0.07, recovery: 0.16, dmg: 4.5, stam: 3,  reach: 1.02, target: 'head', power: 0.5 },
  cross:     { name: 'CROSS',      kind: 'punch', hand: 'R', startup: 0.16, active: 0.07, recovery: 0.24, dmg: 8.5, stam: 6,  reach: 1.06, target: 'head', power: 0.85 },
  hook:      { name: 'HOOK',       kind: 'punch', hand: 'L', startup: 0.18, active: 0.07, recovery: 0.26, dmg: 9.5, stam: 7,  reach: 0.86, target: 'head', power: 0.95 },
  uppercut:  { name: 'UPPERCUT',   kind: 'punch', hand: 'R', startup: 0.2,  active: 0.07, recovery: 0.3,  dmg: 11,  stam: 8,  reach: 0.8,  target: 'head', power: 1.0 },
  lowkick:   { name: 'LOW KICK',   kind: 'kick',  leg: 'R',  startup: 0.24, active: 0.08, recovery: 0.32, dmg: 6,   stam: 8,  reach: 1.12, target: 'leg',  power: 0.7 },
  bodykick:  { name: 'BODY KICK',  kind: 'kick',  leg: 'R',  startup: 0.28, active: 0.08, recovery: 0.38, dmg: 12,  stam: 12, reach: 1.15, target: 'body', power: 1.0 },
  highkick:  { name: 'HEAD KICK',  kind: 'kick',  leg: 'R',  startup: 0.36, active: 0.09, recovery: 0.48, dmg: 21,  stam: 17, reach: 1.12, target: 'head', power: 1.6 },
  teep:      { name: 'PUSH KICK',  kind: 'kick',  leg: 'L',  startup: 0.22, active: 0.08, recovery: 0.3,  dmg: 5,   stam: 7,  reach: 1.2,  target: 'body', power: 0.6, push: 1.1 },
};
// body-shot variants of punches
for (const k of ['jab', 'cross', 'hook', 'uppercut']) {
  const m = MOVES[k];
  MOVES[k + '_body'] = { ...m, name: 'BODY ' + m.name, target: 'body', dmg: m.dmg * 0.85, reach: m.reach - 0.04, stamDmg: m.dmg * 1.4, base: k };
}
for (const [k, m] of Object.entries(MOVES)) { m.id = k; m.base = m.base || k; m.total = m.startup + m.active + m.recovery; }
