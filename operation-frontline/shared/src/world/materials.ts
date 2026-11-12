// Surface material table shared by the map builder (ids), the simulation
// (bullet impact / footstep surface types) and the client renderer (textures).

export type SurfaceKind = 'concrete' | 'asphalt' | 'brick' | 'metal' | 'wood' | 'dirt' | 'glass' | 'fabric' | 'tile';

export interface MaterialDef {
  id: number;
  name: string;
  /** Texture set id under client/public/assets/textures, or null for flat colour. */
  tex: string | null;
  /** World metres covered by one texture repeat. */
  uv: number;
  surface: SurfaceKind;
  /** Linear-ish base colour multiplier (sRGB 0..1). */
  color: [number, number, number];
  metalness?: number;
  gloss?: number;
  emissive?: number;
  opacity?: number;
}

export const MAT = {
  ASPHALT: 0,
  SIDEWALK: 1,
  CONCRETE: 2,
  BRICK: 3,
  PLASTER: 4,
  PAINTED: 5,
  FLOOR: 6,
  TILES: 7,
  CORRUGATED: 8,
  METAL: 9,
  RUBBLE: 10,
  DIRT: 11,
  WOOD: 12,
  RUST: 13,
  GLASS: 14,
  DARKGLASS: 15,
  SANDBAG: 16,
  TARP: 17,
  LINE: 18,
  TRIM: 19,
  LAMP: 20,
  HAZARD: 21,
} as const;

export const MATERIALS: MaterialDef[] = [
  { id: 0, name: 'asphalt', tex: 'asphalt_02', uv: 5, surface: 'asphalt', color: [0.62, 0.62, 0.64] },
  { id: 1, name: 'sidewalk', tex: 'concrete_pavement', uv: 3.2, surface: 'concrete', color: [0.86, 0.85, 0.82] },
  { id: 2, name: 'concrete', tex: 'concrete_wall_008', uv: 4, surface: 'concrete', color: [0.82, 0.82, 0.8] },
  { id: 3, name: 'brick', tex: 'brick_wall_001', uv: 2.6, surface: 'brick', color: [0.92, 0.86, 0.82] },
  { id: 4, name: 'plaster', tex: 'plastered_wall_04', uv: 3.4, surface: 'concrete', color: [0.95, 0.93, 0.88] },
  { id: 5, name: 'painted', tex: 'painted_concrete', uv: 3.4, surface: 'concrete', color: [0.9, 0.92, 0.94] },
  { id: 6, name: 'floor', tex: 'concrete_floor_worn_001', uv: 3.5, surface: 'concrete', color: [0.8, 0.8, 0.8] },
  { id: 7, name: 'tiles', tex: 'floor_tiles_06', uv: 2.4, surface: 'tile', color: [0.9, 0.9, 0.9] },
  { id: 8, name: 'corrugated', tex: 'corrugated_iron', uv: 2.2, surface: 'metal', color: [0.78, 0.8, 0.82], metalness: 0.75 },
  { id: 9, name: 'metal', tex: 'metal_plate', uv: 2.2, surface: 'metal', color: [0.6, 0.62, 0.64], metalness: 0.9 },
  { id: 10, name: 'rubble', tex: 'rubble', uv: 3, surface: 'concrete', color: [0.85, 0.83, 0.8] },
  { id: 11, name: 'dirt', tex: 'dirt', uv: 4, surface: 'dirt', color: [0.8, 0.76, 0.7] },
  { id: 12, name: 'wood', tex: 'wood_planks_dirt', uv: 2, surface: 'wood', color: [0.85, 0.8, 0.72] },
  { id: 13, name: 'rust', tex: 'rusty_metal_02', uv: 2, surface: 'metal', color: [0.8, 0.78, 0.76], metalness: 0.7 },
  { id: 14, name: 'glass', tex: null, uv: 1, surface: 'glass', color: [0.55, 0.68, 0.74], gloss: 0.96, opacity: 0.32 },
  { id: 15, name: 'darkglass', tex: null, uv: 1, surface: 'glass', color: [0.05, 0.07, 0.09], gloss: 0.94, metalness: 0.4 },
  { id: 16, name: 'sandbag', tex: 'dirt', uv: 1.2, surface: 'dirt', color: [0.78, 0.7, 0.54] },
  { id: 17, name: 'tarp', tex: 'painted_concrete', uv: 3, surface: 'fabric', color: [0.3, 0.36, 0.26] },
  { id: 18, name: 'line', tex: null, uv: 1, surface: 'asphalt', color: [0.86, 0.85, 0.8], gloss: 0.3 },
  { id: 19, name: 'trim', tex: 'concrete_wall_008', uv: 3, surface: 'concrete', color: [0.5, 0.5, 0.52] },
  { id: 20, name: 'lamp', tex: null, uv: 1, surface: 'glass', color: [1, 0.93, 0.78], emissive: 6 },
  { id: 21, name: 'hazard', tex: null, uv: 1, surface: 'metal', color: [0.85, 0.62, 0.08], gloss: 0.45, metalness: 0.2 },
];

/** Tint palette referenced by Box.tint (index 0 = untinted). */
export const TINTS: [number, number, number][] = [
  [1, 1, 1],
  [0.86, 0.78, 0.66], // sand
  [0.72, 0.76, 0.8],  // cool grey
  [0.82, 0.64, 0.52], // terracotta
  [0.62, 0.7, 0.66],  // sage
  [0.9, 0.86, 0.74],  // cream
  [0.58, 0.6, 0.66],  // slate
  [0.7, 0.56, 0.5],   // rose brick
  [0.45, 0.47, 0.5],  // dark concrete
  [0.34, 0.4, 0.3],   // olive drab
  [0.55, 0.3, 0.24],  // oxide red
  [0.24, 0.34, 0.5],  // container blue
  [0.3, 0.3, 0.32],   // charcoal
];

/** Static prop models (GLB) and their bounds in model space, used for colliders. */
export interface PropDef { min: [number, number, number]; max: [number, number, number]; solid: boolean; surface: SurfaceKind }

export const PROPS: Record<string, PropDef> = {
  Barrel_01: { min: [-0.282, -0.007, -0.282], max: [0.282, 0.873, 0.282], solid: true, surface: 'metal' },
  barrel_03: { min: [-0.317, 0, -0.319], max: [0.317, 0.93, 0.319], solid: true, surface: 'metal' },
  concrete_road_barrier: { min: [-0.774, -0.008, -0.295], max: [0.77, 0.822, 0.344], solid: true, surface: 'concrete' },
  concrete_road_barrier_02: { min: [-0.775, -0.002, -0.254], max: [0.787, 1.108, 0.188], solid: true, surface: 'concrete' },
  covered_car: { min: [-0.847, 0.006, -2.166], max: [0.941, 1.411, 2.209], solid: true, surface: 'fabric' },
  fire_hydrant: { min: [-0.442, 0, -0.126], max: [0.433, 0.799, 0.191], solid: true, surface: 'metal' },
  metal_trash_can: { min: [-0.953, 0, -0.274], max: [0.824, 0.906, 0.276], solid: true, surface: 'metal' },
  street_lamp_01: { min: [-0.352, 0, -0.193], max: [0.352, 3.871, 0.193], solid: false, surface: 'metal' },
  street_lamp_02: { min: [-0.193, -0.394, 0], max: [0.192, 1.28, 0.806], solid: false, surface: 'metal' },
  utility_box_01: { min: [-0.26, 0, -0.21], max: [0.26, 1.12, 0.222], solid: true, surface: 'metal' },
  utility_box_02: { min: [-0.46, 0, -0.21], max: [0.46, 1.12, 0.222], solid: true, surface: 'metal' },
  old_tyre: { min: [-0.3, -0.3, -0.083], max: [0.3, 0.3, 0.082], solid: false, surface: 'dirt' },
  metal_jerrycan_green: { min: [-0.188, 0, -0.085], max: [0.172, 0.5, 0.085], solid: false, surface: 'metal' },
  portable_generator: { min: [-0.415, 0.002, -0.282], max: [0.4, 0.577, 0.282], solid: true, surface: 'metal' },
  propane_tank: { min: [-0.169, 0, -0.169], max: [0.169, 0.554, 0.169], solid: false, surface: 'metal' },
  trashbag: { min: [-0.26, -0.001, -0.24], max: [0.263, 0.571, 0.223], solid: false, surface: 'fabric' },
  wooden_crate_01: { min: [-0.412, -0.006, -0.195], max: [0.412, 0.341, 0.212], solid: true, surface: 'wood' },
  wooden_crate_02: { min: [-0.265, -0.01, -0.583], max: [0.265, 0.454, 0.583], solid: true, surface: 'wood' },
  old_military_crate: { min: [-0.91, 0, -0.666], max: [0.902, 0.301, 0.309], solid: true, surface: 'wood' },
  wooden_military_crate: { min: [-0.621, 0, -0.26], max: [0.621, 0.464, 0.26], solid: true, surface: 'wood' },
  ammo_box: { min: [-0.043, 0, -0.129], max: [0.043, 0.177, 0.129], solid: false, surface: 'metal' },
  medical_box: { min: [-0.263, 0, -0.172], max: [0.263, 0.098, 0.178], solid: false, surface: 'metal' },
  cardboard_box_01: { min: [-0.192, -0.007, -0.225], max: [0.194, 0.335, 0.291], solid: false, surface: 'wood' },
  metal_office_desk: { min: [-1, 0, -0.469], max: [1, 0.788, 0.478], solid: true, surface: 'metal' },
  plastic_monobloc_chair_01: { min: [-0.321, 0, -0.336], max: [0.321, 0.88, 0.292], solid: false, surface: 'wood' },
  vintage_radio_transceiver: { min: [-0.329, -0.001, -0.138], max: [0.245, 0.433, 0.274], solid: false, surface: 'metal' },
  water_manhole_cover: { min: [-0.345, -0.029, -0.345], max: [0.345, 0.039, 0.345], solid: false, surface: 'metal' },
  old_military_compressor: { min: [-0.72, 0, -5.053], max: [-0.124, 1.177, -3.383], solid: true, surface: 'metal' },
  modular_fire_escape: { min: [-2.401, -3.649, -0.785], max: [4.26, 6.108, 0.636], solid: false, surface: 'metal' },
};
