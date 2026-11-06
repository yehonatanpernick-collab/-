# SAN FRANCISCO: SKYDRIVE

An open-world driving and flying game in a reconstruction of San Francisco built from real geographic data. You drive and fly a futuristic electric car that converts between road mode and flight mode.

- **Real city.** It uses 170,365 building footprints with real heights (95 % come from the dataset; the rest are estimated), 56,549 road edges, 70,793 footway edges, 10,823 real street trees, 2,281 real traffic-signal locations, 1,811 real street lamps, and the real coastline, parks and lakes. Terrain comes from the USGS 10 m elevation model, so the hills are real (Russian Hill, Nob Hill, Twin Peaks).
- **Landmarks** are placed from real coordinates and the real road geometry: the Golden Gate Bridge, the Bay Bridge west span (with "The Bay Lights"), Salesforce Tower, Transamerica Pyramid, Coit Tower, the Ferry Building clock tower, the City Hall dome, Sutro Tower, the Palace of Fine Arts, the Alcatraz lighthouse, the Lombard Street hedges and the Painted Ladies. The real Bay Area terrain (Marin Headlands, Mt Tamalpais, East Bay hills) forms the horizon.
- **Vehicle.** Driving uses Rapier raycast-vehicle physics. Flight uses a separate force-and-torque model. A state machine runs the transformation, and its animation is always in sync with the physics.
- **Living city.** Traffic AI drives on the real one-way road network and obeys signal phases at the real signal locations. Pedestrians walk the real sidewalk and crosswalk network.
- **Environment.** The game has a time-of-day cycle, weather (clear, cloudy, foggy, rain) and spatially varying fog that is thickest along the Pacific coast and the Golden Gate strait.
- **Platforms.** It runs on desktop and mobile, with a dedicated touch interface.

## Quick start

```bash
npm install
npm run dev          # → http://localhost:5173
npm run build        # production build in dist/ (static, deploy anywhere)
npm run preview      # serve the production build
```

The processed geographic data is already in `public/data/`, so you don't need to run the pipeline to play.

Useful URL parameters:

| Parameter | Effect |
|---|---|
| `?quality=low\|medium\|high\|ultra` | Forces a graphics preset (otherwise picked from the device) |
| `?h=18.3` | Sets the time of day (hours) |
| `?w=clear\|cloudy\|foggy\|rain` | Sets the weather |
| `?webgl` | Forces the WebGL2 backend |
| `?stats` | Shows the performance overlay (you can also press `L`) |
| `?touch` | Uses touch controls |
| `?spawn=x,z` | Spawn point in local metres |
| `?autostart` | Skips the menu |

## Controls

| Action | Keyboard / mouse | Touch | Gamepad |
|---|---|---|---|
| Accelerate / forward thrust | W, ↑ | GO | RT |
| Brake / reverse / air brake | S, ↓ | BRAKE | LT |
| Steer / yaw + bank | A D, ← → | steering wheel (drag) | left stick |
| Handbrake drift | Space | DRIFT | A |
| Boost | Shift | BOOST | B |
| **Transform (drive ⇄ fly, auto-landing)** | **F** | FLY / LAND | — |
| Ascend / descend | E / Q | ▲ / ▼ | RB / LB |
| Pitch (flight) | I / K | — | right stick |
| Camera: chase, cockpit, far, cinematic | C | CAM | — |
| Orbit / zoom camera | drag mouse, wheel (double-click for pointer lock) | drag the screen | — |
| Map; click it to set a GPS route | M | MAP | — |
| Landmark flyover | V | — | — |
| Time of day / weather | T / Y | (settings) | — |
| Reset onto the nearest street | R | — | — |
| Pause and settings | Esc | ❚❚ | — |

The **Challenges** are optional and never block free roam. They are built from real geography: *Golden Gate Run* (fly under the deck and around the towers), *Skyline Ascent* (the Transamerica spire and the Salesforce crown), *Fog Line* (Ocean Beach to Sutro Tower), and two driving courses routed with A\* over the real street graph (*Embarcadero Cruise* and *Hills of San Francisco*). The game also tracks which landmarks you have discovered.

## Architecture

The world is built from four systems, kept separate:

| System | Responsibility | Code |
|---|---|---|
| **A. Geographic data** | Decides where everything is: the projection, DEM, coastline, road graph, footprints, signals and trees | `scripts/*.py`, `src/data/`, `src/ai/RoadGraph.ts` |
| **B. Professional 3D models** | Decides how important objects look: the hero car, characters | `tools/build-assets.mjs`, `src/vehicle/VehicleModel.ts`, `src/ai/PedestrianManager.ts` |
| **C. Procedural generation** | Produces the bulk of the city: facades and roofs on real footprints, road surfaces and markings, sidewalks, bridge decks, vegetation, street furniture, traffic models | `src/world/TileWorker.ts`, `Materials.ts`, `Props.ts`, `src/ai/TrafficModels.ts` |
| **D. Manual enhancement** | Hand-built landmark structures, placed by real coordinates | `src/world/Landmarks.ts`, `Backdrop.ts` |

```
src/
  core/      Game (orchestrator, floating origin), Renderer (WebGPU→WebGL2, post-FX), Physics (Rapier, fixed step),
             Input (kbd/mouse/touch/gamepad), Quality (presets, device detection, adaptive resolution), Uniforms (TSL globals)
  data/      GeographicConfig (projection, kept in sync with scripts/geo.py), WorldData (DEM, rasters, graphs, queries)
  world/     WorldStreamer (500 m tiles, 4 LODs, predictive loading, worker pool, colliders, budgets),
             TileWorker (off-thread geometry + collider generation), Materials (TSL), Props (instanced trees/furniture),
             Landmarks, Backdrop
  vehicle/   VehicleModel (component rig, flight hardware, cockpit display), Vehicle (driving, flight, state machine)
  camera/    CameraRig (chase / cockpit / far / cinematic / flyover, collision avoidance)
  ai/        RoadGraph, TrafficManager (+SignalSystem), TrafficModels, PedestrianManager
  env/       Environment (sky, sun/moon, shadows, PMREM reflections, coastal fog, weather, rain, water)
  audio/     AudioEngine (procedural Web Audio)
  gameplay/  Navigation (A* GPS), Challenges (checkpoints, landmark discovery)
  ui/        Menu, HUD, minimap and full map (same data as the 3D world), MobileControls, styles
scripts/     data pipeline (Python)        tools/   asset pipeline, physics test harness, Playwright play-tests
```

### Coordinates and precision

- **Projection.** The game uses a local tangent-plane projection centred on Union Square, built from the WGS84 meridional and prime-vertical radii. In world space, X = east, Y = metres above sea level, Z = −north. Across the ±9 km map, the scale error is under 0.15 %. The Python pipeline (`scripts/geo.py`) and the runtime (`GeographicConfig.ts`) implement the same formulas.
- **Floating origin.** Everything is in absolute coordinates inside `worldRoot`. When the camera moves more than 1.5 km from the origin, `worldRoot` is shifted by −origin. Shaders recover absolute positions through `U.origin`.
- **Validation.** `build_world.py` compares named dataset buildings against the published landmark coordinates. Offsets: Salesforce Tower 1.3 m, Coit Tower 2.1 m, Transamerica 2.7 m, Palace of Fine Arts 3.2 m, City Hall 4.8 m. They are logged at startup. `scripts/validate_render.py` renders a top-down check of coastline, roads, buildings and landmarks.

### Rendering

- **Renderer.** `WebGPURenderer` uses the WebGPU backend when the browser supports it and falls back to WebGL2 automatically. All materials are TSL node materials.
- **Post-processing pipeline.** Scene pass → bloom (thresholded in exposed space) → colour grade and vignette → ACES tone mapping → FXAA.
- **Procedural facade shader.** One material covers all buildings, with nine styles: glass curtain wall, office, masonry, Victorian/Edwardian, stucco, brick, industrial, Chinatown, Painted Ladies. Each style has its own floor heights, bay widths, trim and cornices. Windows are lit by occupancy at night, and the facade pattern fades to its average colour when it would otherwise alias.
- **Roads.** Road markings are shader-generated from lane data: double yellow lines, dashed lane dividers, edge lines, continental crosswalks and stop lines at junctions. Asphalt has repaved patches, tyre polish and wet puddles.
- **Water.** The water shader reads depth from the DEM and adds shoreline foam.
- **Lighting and atmosphere.** Physical sky with clouds, PMREM environment reflections regenerated as the sky changes, texel-snapped sun shadows, and exponential height fog multiplied by a coastal density field (Pacific coast, Golden Gate, north waterfront) and drifting patches.

### Streaming and performance

- **Tiles.** The map is split into 500 m tiles. Each tile can load at 4 LODs, with hysteresis between them. The streamer predicts where you are going from your velocity, looking 2 s ahead when driving and 4 s ahead when flying, with a longer view distance at altitude. Tiles are built in a worker pool, and only a limited number are uploaded per frame. Far tiles are unloaded and their GPU memory released.
- **Physics colliders** (terrain, building, bridge and pier trimeshes) exist only near the player.
- **Repeated objects are instanced:** trees (near and far LODs), furniture, traffic bodies, wheels and lamps. Traffic simulation is reduced for far agents, and pedestrians beyond the nearest N have no model and animate at half rate.
- **Presets** (Low, Medium, High, Ultra) set the budgets: view distance, detail distance, collider radius, tree distance, traffic and pedestrian caps, shadow map size and range, bloom, rain particles. Adaptive resolution holds the frame-time target, and mobile devices default to Low.

### Vehicle physics

- **Driving** uses Rapier's `DynamicRayCastVehicleController`: per-wheel raycasts, spring/damper suspension and tyre friction. Added on top are an electric-motor torque curve (constant torque, then constant power), AWD split, regenerative braking, aerodynamic drag and downforce, speed-sensitive steering, weight-transfer-aware grip, a handbrake drift mode, a yaw-rate stability controller, an anti-roll damper, and grip that depends on the surface (road, wet, grass, sand). Measured in `tools/physics-test.mjs`: 0–100 km/h in 3.4 s, 249 km/h top speed, 100–0 km/h in 40.5 m.
- **Flight** applies forces to the same rigid body:
  - hover thrust with a vertical-speed controller
  - vectored forward thrust
  - quadratic drag in the body frame (low forward, high lateral and vertical, which gives coordinated turns)
  - an attitude PD controller acting through the inertia tensor (heading rate, bank, pitch)
  - a ground cushion and an altitude ceiling
  - battery drain
  - automatic emergency stabilisation when tumbling
- **Transformation.** `driving → preparingFlight → transformingToFlight → flight → preparingLanding → transformingToDriving` (+ `emergency`).
  - Wheels fold flat and become glowing hub turbines.
  - Rear vectoring thrusters and side winglets deploy.
  - Hover authority ramps up with the fold, and the wheel raycasts are switched off once the fold passes 50 %.
  - Conflicting requests are ignored.

## Data pipeline

```bash
pip install duckdb pyarrow shapely numpy pillow   # (duckdb optional)
npm run data
```

The pipeline steps:

1. `overture_index.py` reads only the parquet footers on S3 to find the row groups that cover San Francisco. This avoids downloading 270 GB.
2. `fetch_overture.py` downloads those row groups and filters them to the bounding box (`data/raw/*.parquet`).
3. `fetch_dem.py` fetches the AWS Terrain Tiles (Terrarium z14).
4. `build_world.py` does the processing:
   - projection
   - DEM resampling at 10 m
   - land and water conditioning so the 3D coastline follows the vector coastline
   - surface classes
   - lake levels
   - road graph: segments split at connectors, one-way flags from access restrictions, bridge deck profiles, junction degree, signalised junctions
   - building cleaning, heights and styles
   - real and procedural trees
   - real and procedural lamps
   - furniture
   - piers
   - 500 m tiles
   - landmark validation
5. `build_backdrop.py` builds the 72 × 72 km Bay Area backdrop from the z11 DEM.
6. `node tools/build-assets.mjs` runs the glTF-Transform pipeline (dedup, prune, weld, meshopt, WebP) and writes `public/assets/manifest.json`.

## Data sources and licences

| Data | Source | Licence |
|---|---|---|
| Buildings, roads, footways, signals, lamps, trees, land use, water, piers, neighbourhoods | Overture Maps Foundation release 2026-10-21.0, which aggregates © OpenStreetMap contributors, Esri Community Maps, Microsoft and Meta | ODbL / CDLA-Permissive (see overturemaps.org) |
| Terrain and bathymetry | AWS Terrain Tiles (USGS 3DEP / NED, NOAA) | Public domain / open |
| Hero vehicle base | Khronos glTF-Sample-Assets "CarConcept", based on "Free Concept Car 004" by Unity Fan (CC0) | CC-BY 4.0 (Khronos logos removed) |
| Pedestrians | three.js example characters (Xbot, Soldier), from Adobe Mixamo | Mixamo terms |
| Water normal map | three.js examples `waternormals.jpg` | MIT (three.js) |

The full asset manifest is in `public/assets/manifest.json`. It includes assets that were evaluated and then rejected, with the reason.

## Limitations

- **Asset libraries were blocked.** The build environment's network policy blocked Sketchfab, Poly Haven, ambientCG, Kenney, threejs.org and the OSM Overpass API, and no Blender install was available. So:
  - Models came from GitHub-hosted open repositories (Khronos, three.js).
  - Most surface detail is procedural TSL rather than scanned textures.
  - Asset changes were made with glTF Transform and procedural geometry.
- **Buildings are procedural, not photogrammetry.** They are extruded from real footprints with real heights. Landmarks are simplified hand-built models placed at real coordinates. Google Photorealistic 3D Tiles were not used because they need an API key.
- **Tunnels are not drivable.** These include the Broadway, Stockton and Yerba Buena tunnels. Their segments are excluded from roads and traffic.
- **Bridge geometry is partly derived.**
  - The Golden Gate tower positions come from the shoreline crossings along the real bridge axis combined with the published 1,280 m main span, so they are accurate to within tens of metres.
  - Only the west suspension span of the Bay Bridge is modelled.
  - Elevated freeway decks are interpolated between their real ground connection points.
- **Traffic simplifications.** Traffic follows real lanes, one-way rules and signal locations. Signal phases are inferred, because the data has no timing plans. There are no lane-level turn restrictions, and conflicts inside a junction are resolved only by signals and stop logic.
- **Only two pedestrian rigs are used**, varied by tint and scale. A third candidate, Michelle, only shipped a dance clip and failed visual QA when its animations were retargeted from another rig.
- **Yuka and Pathfinding.js were not used.** A custom IDM car-following model, a signal controller and A\* over the real directed graph were a better fit for a real-world lane graph.
- **Testing was done on software rendering.** Automated browser testing ran headless Chromium on the WebGL2 backend with SwiftShader, at about 1 fps. Absolute performance on real GPUs and on the WebGPU backend was not measured in this environment. The same code paths, presets and adaptive resolution apply.

## Testing tools

- `node tools/physics-test.mjs`: headless measurement of vehicle acceleration, top speed, braking and steering.
- `node tools/play.mjs "<query>" <outPrefix> "<script>"`: scripted Playwright play-test (key holds, waits, screenshots, JS probes).
- `?maxdt=0.4`: test-only setting that lets the fixed-step physics catch up on slow software renderers.
- `python3 scripts/validate_render.py 1.0 out.png`: top-down geographic validation render.

Binary files (`*.bin`, `*.glb`) carry an extra `.png` suffix (e.g. `height.bin.png`) so they can be served by hosts that only allow standard web media types; the loaders parse them by content, not by extension.

The previous `index.html` app (LifeOS) is kept at `legacy/lifeos.html`.
