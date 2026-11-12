# OPERATION: FRONTLINE

Browser-based multiplayer military FPS. Conquest, 8 v 8, four classes, seven weapons with attachments, AI bots, one drivable vehicle, desktop and mobile controls.

**Stack:** PlayCanvas Engine 2 (WebGPU with automatic WebGL 2 fallback) · TypeScript · Vite · Node.js + Colyseus (authoritative server over WebSockets) · Vitest.

## Quick start

```bash
cd operation-frontline
npm install
npm run dev          # game server on :2567 + client on http://localhost:5173
```

Open `http://localhost:5173`. **Training** works with no server at all; **Quick Match / Multiplayer** needs the server.

| Command | What it does |
| --- | --- |
| `npm run dev:client` | Vite dev server only (enough for Training) |
| `npm run dev:server` | Colyseus server only (`PORT`, default 2567) |
| `npm run build` | Production client (`client/dist`) + bundled server (`server/dist/index.js`) |
| `npm start` | Runs the built server; it also serves `client/dist`, so one process hosts the whole game |
| `npm run typecheck` | Strict TypeScript check of shared, server, client and tests |
| `npm test` | Unit, gameplay, multiplayer and performance tests (24 tests) |
| `npm run test:e2e` | Browser test against the production build (needs Playwright + Chromium, see below) |

### Testing multiplayer locally

1. `npm run dev`
2. Open `http://localhost:5173` in two or more browser windows and press **Quick Match** in each — they land in the same room, on balanced teams, with bots filling the rest of the 8 v 8.
3. Private match: **Multiplayer → Create private match** shows a 6-character code; the others use **Join with code**.
4. Other devices on your network: open `http://<your-ip>:5173` (the client talks to port 2567 on the same host). A different server can be set under **Multiplayer → Server**.

`npm run test:multiplayer` boots the real server and drives it with four simulated clients.

### Deployment

```bash
npm ci && npm run build
PORT=8080 npm start        # serves the game and the WebSocket endpoint from one port
```

Put it behind any reverse proxy that forwards WebSocket upgrades and terminates TLS (browsers require `wss://` on HTTPS pages). To host the client separately (CDN / static host), build it with `VITE_SERVER_URL=https://your-game-server npm run build -w client` and set `CORS_ORIGIN` on the server. Scaling beyond one process needs the Colyseus Redis presence/driver, which is not configured here.

## Controls

**Desktop** (rebindable in Settings): WASD move · mouse aim · LMB fire · RMB aim · Shift sprint (double-tap or V for tactical sprint) · Space jump · C crouch / slide while sprinting · R reload · 1–4 weapons and gadgets · G grenade · E enter/exit vehicle · Tab scoreboard · Esc pause.

**Mobile:** left thumb movement stick (push fully forward to sprint), right thumb look, on-screen fire / aim / reload / jump / crouch / grenade / swap / use buttons. Size, sensitivity, left-handed layout and auto-fire are in Settings → Mobile.

## What is in the game

- **Conquest** on the original map *Kestrel Crossing*: three objectives (two-deck parkade, central crossing with an underpass, construction site), enterable multi-storey buildings with stairs and roofs, two bases, tickets, bleed, 15-minute timer, deploy screen with spawn selection.
- **Classes:** Assault (stim, smoke), Engineer (RPG, repair torch), Support (ammo crate, medical crate), Recon (motion sensor, scope spotting).
- **Weapons:** KR-7, MX-4, AC-8, Viper-9, HMG-88, Longbow SR-762, P-12 — each with its own stats, recoil pattern and sound; optics, muzzle, grip, magazine and barrel attachments change stats and the model.
- **Bots** with navigation, line-of-sight perception, cover, burst control, grenades, role behaviour and four difficulty levels. They use the same input path as humans.
- **Vehicle:** one LTV per base (driver + passenger), server-simulated, repairable, destructible.
- **Destruction:** breakable glass, explosive barrels, destructible crates, bullet decals.
- **Presentation:** PBR materials, cascaded shadows, SSAO, bloom, colour grading, fog, two lighting presets (day / dusk), particles, tracers, spatial audio with occlusion and interior reverb.
- **UI:** main menu, room browser, training setup, loadout editor, class select, settings with key rebinding, profile with XP and ranks, HUD, minimap, scoreboard, end-of-match screen.

## Networking model

The server owns everything that matters: positions, health, damage, ammunition, kills, scores, objectives, tickets. Clients send only input commands (buttons, move axes, view angles). The same `GameSim` class runs on the server and, for Training, inside the browser. See `docs/ARCHITECTURE.md`.

## Project layout

```
shared/   simulation, weapons, classes, map, navigation, protocol (used by client and server)
server/   Colyseus room + HTTP API
client/   PlayCanvas renderer, prediction, audio, UI
assets/   manifest.json (every third-party asset, source and licence)
scripts/  asset pipeline (fetch + optimise), dev runner, debug tools
tests/    unit, gameplay, multiplayer, performance, e2e
docs/     architecture notes
```

## Assets

All third-party art is CC0 from **Poly Haven** (textures, HDRIs, props, the rifle, pistol and grenade), plus the Mixamo "Vanguard" soldier from the three.js examples. Full list: `assets/manifest.json`. The optimised files are committed under `client/public/assets`; to rebuild them run `npm run assets:fetch` then `node scripts/build-assets.mjs`.

Assault rifles, carbine, SMG, LMG, launcher, the vehicle and first-person arms are original models authored in code. All audio is synthesised at start-up — there are no audio files.

## Status

`CHECKLIST.md` lists every requirement with its state and how it was verified. The short version of what is **not** done or not verified:

- **Never run on a real GPU or a real phone.** Everything was verified in headless Chromium with software rendering (WebGL 2). The WebGPU path is implemented with fallback but untested; frame-rate targets are unmeasured.
- Interactive doors are not implemented.
- Bots do not drive vehicles.
- Third-person soldiers have idle / walk / run clips only; aiming, crouching and death are procedural, and there is no ragdoll or dedicated reload / jump animation.
- PlayCanvas' Ammo physics is not used; collision is a custom deterministic controller shared by client and server (see architecture notes for why).
- Kenney, Sketchfab and Mixamo could not be downloaded from the build environment, so no assets come from them directly.
- Progression (XP, unlocks) is stored in the browser only; there are no accounts.
- Textures are JPEG, not GPU-compressed; there are no mesh LODs beyond distance culling.

## E2E tests

`npm run test:e2e` needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`) and a prior `npm run build`. On machines without a GPU run it as `FRONTLINE_GL=llvmpipe xvfb-run -a node tests/e2e/run.mjs`.

## Realistic models (Sketchfab, CC BY 4.0)

The soldier, the four real-world guns and the HMMWV are CC BY 4.0 models from Sketchfab (authors are credited in `assets/manifest.json` and on the in-game Credits tab). To rebuild them:

```bash
SKETCHFAB_TOKEN=... node scripts/fetch-sketchfab.mjs   # downloads into assets/raw/sketchfab (git-ignored)
node scripts/build-character.mjs   # soldier + retargeted Mixamo clips -> client/public/assets/characters/operator.glb
node scripts/build-weapons.mjs     # m4a1 / akm / mp5 / m249 -> client/public/assets/weapons/
node scripts/build-vehicle.mjs     # HMMWV -> client/public/assets/vehicles/hmmwv.glb
```

`client/viewer.html?url=...` previews any GLB with its animation clips.
