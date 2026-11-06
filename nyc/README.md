# Skyway Manhattan

A drive-and-fly game set in real Midtown Manhattan (34th St to Central Park South, Hudson to 1st Ave),
built from New York City's own open data.

- **City:** NYC Open Data building footprints (real roof heights + construction year), street centerlines
  (lanes, one-ways, widths), planimetric sidewalks, parks, shoreline and the 2015 street-tree census.
  `tools/fetch.sh` downloads the data and `tools/build-world.mjs` turns it into 500 m GLB tiles (meshopt
  compressed) with facades, storefront bands, cornices, setbacks, curbs, lane paint and crosswalks.
- **Rendering:** three.js `WebGPURenderer` (WebGL 2 fallback), TSL node materials, cascaded shadows,
  GTAO, bloom and TRAA. Sky/IBL from Poly Haven HDRIs; facades and street textures from ambientCG and Poly Haven (CC0).
- **Physics:** Rapier ray-cast vehicle for driving (suspension, tire slip, power-limited torque, drag, downforce);
  custom flight forces (hover lift with ground effect, thrust, banking, attitude stabilisation) on the same body.
- **AI:** traffic on the real lane graph with IDM car-following and signal phases (green wave on the avenues);
  Yuka-steered pedestrians on the sidewalks that wait for the walk signal. Vehicles: Kenney Car Kit (CC0).

```
npm install
npm run data      # download NYC data (needs data.cityofnewyork.us) and build tiles
npm run dev       # local dev server
npm run build     # static build in dist/
```
Assets in `public/` are CC0 (Poly Haven, ambientCG, Kenney); map data © City of New York (NYC Open Data).
