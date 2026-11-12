// Declarative list of every third-party asset pulled into the game.
// Every entry is CC0 (Poly Haven) unless stated otherwise. `scripts/fetch-assets.mjs`
// downloads the raw files, `scripts/optimize-assets.py` + `scripts/pack-models.mjs`
// turn them into web-ready textures / GLB files, and the manifest in
// `assets/manifest.json` is generated from this list.

export const POLYHAVEN_TEXTURES = [
  { id: 'asphalt_02', use: 'Road surface', size: 1024 },
  { id: 'concrete_pavement', use: 'Sidewalks and plaza paving', size: 1024 },
  { id: 'concrete_wall_008', use: 'Concrete walls, barriers, parking structure', size: 1024 },
  { id: 'brick_wall_001', use: 'Brick building facades', size: 1024 },
  { id: 'plastered_wall_04', use: 'Plaster building facades (tinted per building)', size: 1024 },
  { id: 'painted_concrete', use: 'Painted concrete facades and interiors', size: 1024 },
  { id: 'concrete_floor_worn_001', use: 'Interior floors, parking decks', size: 1024 },
  { id: 'floor_tiles_06', use: 'Shop / lobby interior floors', size: 1024 },
  { id: 'corrugated_iron', use: 'Sheds, shutters, containers, roofing', size: 1024 },
  { id: 'metal_plate', use: 'Metal structures, vehicle armour, stairs', size: 1024 },
  { id: 'rubble', use: 'Debris piles and collapsed sections', size: 1024 },
  { id: 'dirt', use: 'Construction site and planter ground', size: 1024 },
  { id: 'wood_planks_dirt', use: 'Crates, scaffolding planks, doors', size: 1024 },
  { id: 'rusty_metal_02', use: 'Rusted metal props and wrecks', size: 512 },
];

export const POLYHAVEN_HDRIS = [
  { id: 'kloofendal_48d_partly_cloudy_puresky', use: 'Environment lighting + sky ("Overcast Day" preset)' },
  { id: 'industrial_sunset_puresky', use: 'Environment lighting + sky ("Dusk Assault" preset)' },
];

// tris = triangle budget after simplification, tex = max texture edge after resize
export const POLYHAVEN_MODELS = [
  { id: 'bolt_action_rifle_7_62', use: 'Sniper rifle (Longbow SR-762) first/third person model', tris: 20000, tex: 1024 },
  { id: 'service_pistol', use: 'Combat pistol (P-12 Service) first/third person model', tris: 14000, tex: 1024 },
  { id: 'stick_grenade', use: 'Frag grenade projectile / first person model', tris: 4000, tex: 512 },
  { id: 'Barrel_01', use: 'Explosive barrel (destructible)', tris: 1800, tex: 512 },
  { id: 'barrel_03', use: 'Static barrel prop', tris: 1400, tex: 512 },
  { id: 'concrete_road_barrier', use: 'Jersey barrier cover', tris: 1500, tex: 512 },
  { id: 'concrete_road_barrier_02', use: 'Low concrete barrier cover', tris: 1500, tex: 512 },
  { id: 'covered_car', use: 'Parked covered car (cover)', tris: 6000, tex: 1024 },
  { id: 'fire_hydrant', use: 'Street furniture', tris: 2500, tex: 512 },
  { id: 'metal_trash_can', use: 'Street furniture', tris: 2500, tex: 512 },
  { id: 'street_lamp_01', use: 'Street lighting', tris: 4000, tex: 512 },
  { id: 'street_lamp_02', use: 'Street lighting', tris: 4000, tex: 512 },
  { id: 'utility_box_01', use: 'Street utility box', tris: 2000, tex: 512 },
  { id: 'utility_box_02', use: 'Street utility box', tris: 2500, tex: 512 },
  { id: 'old_tyre', use: 'Debris / checkpoint dressing', tris: 1400, tex: 512 },
  { id: 'metal_jerrycan_green', use: 'Military dressing', tris: 2500, tex: 512 },
  { id: 'portable_generator', use: 'Military equipment', tris: 6000, tex: 512 },
  { id: 'propane_tank', use: 'Industrial dressing', tris: 2000, tex: 512 },
  { id: 'trashbag', use: 'Street debris', tris: 1500, tex: 512 },
  { id: 'wooden_crate_01', use: 'Destructible crate', tris: 2000, tex: 512 },
  { id: 'wooden_crate_02', use: 'Destructible crate', tris: 2000, tex: 512 },
  { id: 'old_military_crate', use: 'Military supply crate (cover)', tris: 3000, tex: 512 },
  { id: 'wooden_military_crate', use: 'Military supply crate / ammo crate deployable', tris: 4000, tex: 512 },
  { id: 'ammo_box', use: 'Ammo crate deployable / dressing', tris: 2500, tex: 512 },
  { id: 'medical_box', use: 'Medical crate deployable', tris: 2500, tex: 512 },
  { id: 'cardboard_box_01', use: 'Interior dressing', tris: 2000, tex: 512 },
  { id: 'metal_office_desk', use: 'Interior furniture', tris: 3000, tex: 512 },
  { id: 'plastic_monobloc_chair_01', use: 'Interior furniture', tris: 2000, tex: 512 },
  { id: 'vintage_radio_transceiver', use: 'Command post dressing / motion sensor', tris: 4000, tex: 512 },
  { id: 'water_manhole_cover', use: 'Street detail', tris: 800, tex: 512 },
  { id: 'old_military_compressor', use: 'Military equipment', tris: 8000, tex: 512 },
  { id: 'modular_fire_escape', use: 'Facade detail', tris: 11322, tex: 512 },
];

export const OTHER_ASSETS = [
  {
    name: 'Soldier.glb',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb',
    out: 'characters/soldier.glb',
    source: 'three.js examples (mrdoob/three.js, examples/models/gltf/Soldier.glb) — "Vanguard" character and Idle/Walk/Run clips from Adobe Mixamo',
    license: 'three.js repository is MIT; the character/animations originate from Adobe Mixamo, which Adobe licenses royalty-free for personal and commercial projects (the raw files may not be redistributed standalone outside a project).',
    format: 'GLB (skinned mesh + 4 animation clips)',
    use: 'Third-person soldier body for remote players and bots',
  },
];
