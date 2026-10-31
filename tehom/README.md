# תהום — TEHOM

A real-time 3D fleet strategy game in a single HTML file. Fourteen worlds orbit a dying star; two fleets fight over them.

**Play:** open `tehom/index.html` in a modern desktop browser (Chrome / Edge / Firefox / Safari). No server needed.

## Controls
| | |
|---|---|
| Left click | select a world and the fleet in its orbit |
| Left drag | box-select ships |
| Right click | send selected ships to a world (or a point in space) |
| Right drag | rotate camera · wheel: zoom · WASD / arrows: pan · double-click: follow a world |
| Z / X / C | build corvette / frigate / dreadnought at the selected shipyard |
| Space · 1 2 3 | tactical pause · game speed |
| F · H · M · Esc | focus selection · home · mute · deselect |

Counters: corvettes break dreadnoughts, frigates cut down corvettes, dreadnoughts shatter frigates.

## Development
```
npm install
npm run build        # bundles src/ into index.html
```
`test/sim.js` runs headless AI-vs-AI matches for balance checks:
`npx esbuild test/sim.js --bundle --platform=node --format=esm --outfile=/tmp/sim.mjs && node /tmp/sim.mjs 1 1`
