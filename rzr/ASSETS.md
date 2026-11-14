# Assets, sources and licences

## Supplied by the project owner

| File | Title / author | Licence | Attribution required |
|---|---|---|---|
| `assets/vehicles/rzr_xp1000_ccby.glb` | "polaris rzr xp 1000 eps high lifter" by amogusstrikesback2 — https://sketchfab.com/3d-models/polaris-rzr-xp-1000-eps-high-lifter-63b9966525974a2098ff82eae5df7d10 | CC-BY-4.0 | **Yes** |
| `assets/vehicles/rzr_xp1000_highlifter_ccbyncsa.glb` | "2016 Polaris RZR XP 1000 EPS High Lifter" by Ddiaz Design — https://sketchfab.com/3d-models/2016-polaris-rzr-xp-1000-eps-high-lifter-3c3cfe7efed342f1bbfcf809df5c7902 | CC-BY-NC-SA-4.0 | **Yes — and NON-COMMERCIAL only** |
| `assets/source/realistic_game_ready_terrain_environment.glb` | "Realistic Game-Ready Terrain Environment" by syedmutawasimali28 — https://sketchfab.com/3d-models/realistic-game-ready-terrain-environment-2b6d5fcb915d4693953e9f3439f3b137 | CC-BY-4.0 | Yes (if shipped) — currently not loaded |

"Polaris" and "RZR" are trademarks of Polaris Inc. The models are third-party fan models;
a commercial release would need a trademark review regardless of the model licences.

## Downloaded (Poly Haven — CC0, public domain, https://polyhaven.com/license)

All downloads were verified via the Poly Haven API and processed by `tools/prep_*.{py,mjs}`.
Raw downloads are git-ignored (`assets/_raw/`); `tools/fetch_assets.py` re-fetches them.

**Terrain materials (8-layer texture arrays):** rocky_terrain_02 (meadow), aerial_grass_rock
(tundra), forest_leaves_04 (forest floor), marble_cliff_05 (cliffs/bedrock), rocks_ground_02
(scree), brown_mud_rocks_01 (mud), snow_02 (snow), river_small_rocks (riverbeds/shores).

**Roads & buildings:** rocky_trail (gravel roads, drift track), muddy_tracks (forest tracks),
wood_trunk_wall (log cabins), roof_slates_02 (slate roofs), rustic_stone_wall (foundations,
stone bridges, chapel), weathered_planks (barns, wooden bridges).

**Trees (materials only; geometry generated in-game):** fir_tree_01 and pine_tree_01 bark +
twig atlases (the source tree meshes are 7.8M / 17.4M triangles — unusable in real time),
grass_medium_01 clump atlas.

**Models (decimated with meshoptimizer, textures resized):**

| Model | Source tris → game tris |
|---|---|
| rock_moss_set_01 / 02 | 63,127 / 57,647 → ~9,000 each (6–7 rocks per set) |
| rock_07, rock_09, stone_01 | 14,844 / 12,416 / 53,520 → 3,000 / 3,000 / 2,000 |
| mountainside, rock_face_01 | 153,472 / 20,174 → 14,000 / 5,000 |
| dead_tree_trunk, dead_tree_trunk_02 | 101,802 / 83,128 → 5,000 / 6,000 |
| tree_stump_01 / 02, pine_roots, dry_branches_medium_01 | → 2,500 / 2,500 / 6,000 / 3,400 |
| fern_02, shrub_03, shrub_04 | 6,232 / 8,287 / 27,327 → 6,232 / 5,000 / 4,800 |
| celandine_01, dandelion_01 | downloaded and processed, not yet placed in the world |

`boulder_01` was downloaded but dropped: its UV seams lock meshoptimizer (66k → 55k only).

## Not obtained (needs your action)

* **Animals (deer, ibex, chamois, fox).** Poly Haven has none; Quaternius / Kenney animals are
  low-poly/stylised (excluded by the brief). Good photoreal rigged options exist on Sketchfab
  (CC-BY) but downloading requires a Sketchfab account API token. If you want them, add a
  Sketchfab token to the environment (or download the glTFs yourself) and they can be
  integrated with simple wander/flee AI. Searching: https://sketchfab.com/search?features=downloadable&licenses=322a749bcfa841b29dff1e8a1bb74b0b&q=deer&type=models
* **Quixel Megascans:** requires an Epic/Fab account and its licence restricts use to
  Unreal Engine projects unless otherwise licensed — not used.

## Code libraries

| Library | Version | Licence | Use |
|---|---|---|---|
| three.js | r160 | MIT | renderer, post-processing passes (`vendor/three`) |
| N8AO | 1.9.4 | ISC (`vendor/n8ao/LICENSE`) | screen-space ambient occlusion on High/Ultra. The unused `postprocessing` (pmndrs) import is stubbed out in the vendored file; the `Pass` import points at the vendored three.js addon. |

## Rock outcrops (cliffs.js)

Poly Haven (CC0) scans, decimated by `tools/prep_cliffs.mjs` into two LODs each (`assets/models/cliffs/`):
Mountainside, Rock Face 01, Rock Face 02, Coastal Cliff 01, Namaqualand Cliff 02 — https://polyhaven.com/models
