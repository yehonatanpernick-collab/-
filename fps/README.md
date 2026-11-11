# IRON HORIZON

A large-scale combined-arms multiplayer FPS for PC and mobile browsers. Original game in the
"all-out warfare" genre: 5-flag Conquest, four classes, squads, revives, tanks and destructible
buildings. Everything (terrain, town, textures, soldiers, weapons, tank, sound) is generated
procedurally at load time; the only external dependency is three.js from a CDN.

## Play

```bash
cd fps
node server.js            # Node 18+, no npm install needed
# open http://localhost:8080
```

- **Quick Match** runs the full authoritative simulation in your browser against AI (works offline).
- **Multiplayer** joins the dedicated server that served the page. Friends on your network join via
  `http://<your-LAN-IP>:8080`. Empty slots are filled with AI soldiers.

Server options: `PORT=9000 BOTS=32 SKILL=0.7 MAX_PLAYERS=32 SERVER_NAME="My Server" node server.js`

## Controls

| PC | |
|---|---|
| WASD / Shift / Space | move / sprint / jump |
| C (sprinting: slide) · Ctrl | crouch toggle · hold |
| LMB / RMB | fire / aim down sights |
| R · 1 2 3 / wheel · G | reload · weapon/gadget · frag grenade |
| E | enter tank · hold to revive a downed teammate |
| Q · Tab · Esc | spot enemy · scoreboard · menu |
| Tank | WASD drive, mouse turret, LMB cannon, RMB zoom, 2 coax MG, E exit |

Mobile: left thumb moves (push up to sprint), right side looks, ◉ fires (drag while firing to aim),
plus AIM / jump / crouch / reload / grenade / swap / gadget / use buttons.

## Game

- **Map – Varesh Crossing:** 510 × 680 m playable area. A gridded town (≈120 buildings with
  enterable floors and stairs), market, plaza with a 9-storey tower, construction site, foundry yard
  with containers, farmstead and rail depot outside town, both HQs.
- **Conquest:** flags A–E, capture speed scales with attacker advantage, ticket bleed when the
  enemy holds the majority, 400 tickets, round reset.
- **Classes:** Assault (VK-30 + GL-40 launcher), Engineer (RX-9 + AT-7 rockets), Support (HM-250 LMG +
  supply crate, fast revives), Recon (SR-338 bolt-action + squad spawn beacon). All carry a P-19 and frags.
- **Ballistics:** projectile bullets with velocity, drag and drop; damage falloff; head/limb
  multipliers; server-side lag compensation; glass breaks and lets rounds through.
- **Destruction:** every wall panel is destructible by explosives or tanks ramming through; buildings
  collapse when their ground floor is gutted (crushing anyone inside), leaving rubble.
- **Vehicles:** one MBT per team: terrain-following hull, independent turret, 125 mm cannon with
  drop, coax MG, runs over walls and infantry.
- **AI:** A* navigation, objective selection, perception with line of sight, reaction times, aim
  error that tightens over time, strafing, grenades/launchers, revives, crates, tank driving.
- **Squads, spotting (Q), downed/revive, spawn on squad/flags/HQ/beacon/tank, scoreboard, kill feed.**

## Graphics & audio

Physically based rendering (ACES, image-based lighting from the sky), shadow cascade following the
camera, world-space triplanar materials with normal maps, splat-blended terrain, wind-animated
foliage and grass, volumetric-looking clouds, GTAO (Ultra), bloom, FXAA, film grade with
suppression blur / chromatic aberration / damage vignette. Instanced particles for smoke, fire,
sparks and dust; physics debris and brass; decals; tracers. All audio is synthesized: 3D HRTF
panning, air absorption, speed-of-sound delay, reverb, distant battle ambience.

Quality presets: LOW (mobile default), MEDIUM, HIGH (desktop default), ULTRA. Settings also
include render scale, FOV, sensitivity, and volume.

## Code layout

```
server.js              dedicated server: static files + RFC 6455 WebSocket + 20 Hz sim
src/shared/            runs on server and client
  world.js             map generation, collision grid, raycasts, destruction state
  sim.js               authoritative match: conquest, damage, projectiles, bots, tanks
  movement.js          character controller   vehicle.js  tank physics   nav.js  A* grid
src/client/            three.js client
  game.js              snapshots, interpolation, events, local tank, HUD wiring
  player.js            local soldier: movement feel, weapons, viewmodel animation
  gfx.js materials.js textures.js worldview.js soldier.js guns.js tankview.js
  effects.js audio.js hud.js ui.js input.js net.js main.js
```
