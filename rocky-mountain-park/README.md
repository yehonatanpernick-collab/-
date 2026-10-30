# קיץ בהרי הרוקי — Rocky Mountain Summer

A walkable 3D simulation inspired by Rocky Mountain National Park, Colorado, in summer. It runs in the browser on phones and desktops, using three.js r160 loaded from jsDelivr.

## Build

```sh
npm install
npm run build      # writes park.html (artifact body) and index.html (standalone page)
```

Open `index.html` in a browser. Sources live in `src/` and are bundled by esbuild into a single page. The world generator is bundled separately and runs in a Web Worker.

| File | What it does |
| --- | --- |
| `src/shared.js` | Noise, base terrain function, lake/river/trail definitions (shared by worker and page) |
| `src/worldgen.js`, `src/worker.js` | Heightfield, droplet hydraulic + thermal erosion, glacial troughs and cirques, lakes, creeks, biomes, baked AO and mountain shadows, scatter data, procedural ground textures |
| `src/atmos.js` | Rayleigh/Mie sky LUT, clouds with matching ground shadows, stars, moon, aerial perspective, time of day, thunderstorms, and the lighting patch applied to every lit material |
| `src/terrain.js` | Chunked LOD terrain, distant mountain ring, splatted ground materials, triplanar cliffs, caustics under water |
| `src/vegetation.js` | Painted branch-card trees, lit impostors for distant forest, interactive grass, wildflowers, boulders, logs |
| `src/water.js` | Lakes, flowing creeks, planar reflection, waterfall mist |
| `src/wildlife.js` | Jointed animals with gaits and herd behaviour, birds, butterflies, jumping trout |
| `src/trails.js` | Trails, bridges, signs with real mileage, cairns, pond lilies |
| `src/ui.js`, `src/player.js`, `src/audio.js`, `src/post.js` | HUD, maps, journal, guided hikes, photo mode; movement and input; synthesised spatial audio; post-processing |

## Controls

- **Desktop:** WASD + mouse (click to lock the pointer), Shift to run, Space to jump, F to fly, M for map and guided hikes, J for the field journal, P for photo mode, T to step the time of day.
- **Phone:** left-thumb joystick, right-thumb look, buttons for run, jump, fly and map.

Graphics quality has four tiers. It starts at medium on phones and high on desktops, then lowers resolution or tier when frames run slow and steps up one tier when the device has headroom.
