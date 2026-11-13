# Alpine RZR Wilderness

An open-world mountain off-road simulator for a Polaris RZR XP 1000, running in the browser
on **three.js r160** (the engine this repository already uses). 64 km² of drivable mountains
inside a 40 km ring of giant ranges, ~45 km of roads and trails, lakes, rivers, waterfalls,
forests, villages, weather and a full vehicle-dynamics model.

## Run it

Any static server works. From the repository root:

```bash
node server.js            # then open http://localhost:8080/rzr/
# or
python3 -m http.server    # then open http://localhost:8000/rzr/
```

A desktop GPU is recommended (Settings → Quality: Low / Medium / High / Ultra).
First load downloads ~45 MB (terrain data, textures, models, vehicle).

### Controls

| Key | Action |
|---|---|
| W / S (↑ ↓) | Throttle / brake — hold S when stopped to reverse |
| A / D (← →) | Steer |
| Space | Handbrake (locks the rear for drifting) |
| Shift | Turbo power |
| Q | AWD ⇄ 2WD (rear, locked "spool" differential) |
| C | Chase / bumper / cockpit camera · mouse drag orbits · wheel zooms |
| L | Headlights (automatic at night) |
| R | Reset upright |
| T / Y | Time of day − / + |
| G | Cycle weather (clear, cloudy, fog, rain, snow) |
| M | World map — click to teleport |
| 1–9 | Points of interest (village, lake, drift track, pass, forest, rock garden, tarn, gorge, waterfall) |
| O / H | Settings / help |

Gamepads: right/left trigger, left stick, A/B handbrake, RB turbo, Y camera, X reset.

## The world

Designed geography (not random noise): every valley, massif, lake and river is an explicit
feature in `tools/bake_world.mjs`; noise only adds geological detail and a 1.5M-droplet
hydraulic-erosion pass carves drainage, gullies and fans.

* **Grünental** — wide U-shaped glacial valley (Swiss), the village *Alpendorf* and the
  off-road garage at the spawn, the 440 m **Silberfall** dropping from a hanging valley.
* **Turquoise Lake** — glacial cirque lake under the Dolomite-style *Torri di Sole* towers,
  fed by the 300 m **Hidden Falls** from the hanging *Hidden Valley* and its tarn.
* **Ice Pass** — switchback mountain road to a frozen lake at ~2,530 m below *Ice Crown*
  and *Pass Guardian*; a high traverse continues to the Hidden Tarn.
* **Dark Forest Valley** — narrow conifer valley with muddy tracks and a forest lake.
* **Drift Meadow** — open Kyrgyz-style steppe valley with the circular dirt **drift track**.
* **Rock Garden** — boulder-strewn plateau with extreme technical trails and a ridge route.
* **Stone Gorge** — narrow river gorge with a rocky riverbed trail.
* Far ring: 4–6 km peaks (Himalaya/Caucasus scale) form the horizon and the natural boundary.

Snow follows altitude, aspect (north faces hold more) and slope; forests follow a montane
band with a natural tree line; mud follows real drainage; scree collects below cliffs.

## Architecture

```
rzr/
  index.html, css/hud.css
  js/main.js                 bootstrap, 200 Hz fixed-step loop, POIs, scripted-drive QA hook
  js/world/heightfield.js    CPU terrain sampling (bicubic + micro-relief) — mirrored in GLSL
  js/world/loader.js         gzip + row-delta decoding of the baked grids
  js/world/collision.js      ground (terrain, bridge decks, ice), obstacles, surface types
  js/vehicle/physics.js      rigid body, suspension, tyres, CVT drivetrain, chassis contacts
  js/vehicle/model.js        rig for the supplied RZR models (wheels, steering, arms, lights)
  js/render/terrain.js       CDLOD terrain + PBR splat material
  js/render/glsl.js          GLSL twin of the CPU height function
  js/render/atmosphere.js    height fog / aerial perspective for every material
  js/render/sky.js           physical sky, sun/moon path, clouds, stars, environment light
  js/render/water.js         lakes, rivers, waterfalls, ice
  js/render/roads.js         road ribbons, drift track, bridges
  js/render/trees.js         procedural conifers in scanned materials
  js/render/vegetation.js    tree/rock/prop streaming, impostors, GPU grass, colliders
  js/render/structures.js    cabins, chapel, barn, garage, shelters, ruins
  js/render/effects.js       dust/mud/water/snow particles, tyre marks, rain/snow, mist
  js/render/wildlife.js      eagles and bird flocks
  js/weather.js, hud.js, audio.js, input.js, camera.js
  tools/                     offline pipeline (Node + Python), not needed to play
  assets/                    world data, textures, models, vehicles, original source files
```

### Rendering
* **CDLOD terrain**: one instanced draw call, a 12-level quadtree over 65 km, 1 m vertices
  near the camera, per-vertex morphing between levels (no cracks or popping), frustum culling
  per node. Heights are sampled in the vertex shader from integer textures with the exact
  bicubic + micro-relief function the physics uses.
* **Materials**: 8 scanned PBR layers in texture arrays, top-3 height-blended per pixel, two
  scales + rotation against tiling, two-scale triplanar limestone on cliffs, strata and
  macro variation at range, wet/snow weather response, distant forest canopy tint.
* **Vegetation**: procedural spruce/fir/pine/larch built from Poly Haven's scanned twig and
  bark atlases (the source trees are 8–17M triangles); distant trees are impostors baked at
  load from the same trees (8 views) with a dithered cross-fade. ~20k–60k trees visible.
* **Atmosphere**: Preetham sky, solar path for 46° N, height fog with aerial perspective and
  sun in-scattering on every material, procedural cloud layer with self-shadowing, stars.

### Vehicle dynamics (`js/vehicle/physics.js`)
* 790 kg rigid body with measured wheelbase/track/tyre radius from the supplied model.
* Four independent long-travel suspensions (0.52 m travel), progressive bump stops, separate
  bump/rebound damping, front/rear anti-roll bars; wheels can also climb boulders.
* Combined-slip tyre model (Pacejka-style curves + friction ellipse) per surface:
  gravel, dirt, mud, grass, forest floor, rock, scree, snow, ice, water, bridge, drift track;
  rolling resistance and sinkage; rain reduces grip.
* CVT drivetrain (82 kW, 124 kW turbo), locked rear spool, open front diff, AWD/2WD,
  engine braking, reverse; brakes and handbrake.
* Chassis/roll-cage contact probes against terrain, trees, rocks, buildings and bridge rails;
  buoyancy and drag in water.

### Tests
`node tools/test_physics.mjs` runs 13 scenarios headlessly against the real baked world:
settling, 0–50/0–80 km/h, braking, steady cornering, handbrake drifts, and an autopilot on
every road class (valley road, pass switchbacks with bridge and ford, lake road, forest
track, extreme trail, ford trail, bridge road). Current result: **13/13 pass**
(0–50 km/h 2.9 s, 0–80 km/h 5.3 s).

### Rebuilding the world
```bash
cd rzr/tools && npm i               # gltf-transform, meshoptimizer, sharp
python3 fetch_assets.py             # Poly Haven downloads (CC0)
python3 prep_textures.py && node prep_models.mjs
node bake_world.mjs                 # ~90 s: heights, erosion, water, roads, masks, map
python3 debug_map.py out.png        # labelled debug map
```

## Status — what is done and what is not

Done and tested: everything above. Known limitations, stated plainly:

* **Ground wildlife (deer, ibex, foxes)** is not included: no photoreal CC0 animals were
  available without an account; see `ASSETS.md` for how to add them.
* **Water reflections** use the sky model (no planar/screen-space reflections of mountains).
* **Clouds** are a lit 2D layer with self-shadowing, not raymarched volumes.
* **Shadows** are a single 180 m cascade around the car; distant mountains do not cast
  shadows on each other.
* **The supplied terrain model is not used** — it is a flat 100 m plane (see
  `docs/ASSET_INSPECTION.md`).
* Visual QA was done with software rendering in a headless browser; frame rates on real
  GPUs have not been measured — use the quality presets if needed.
