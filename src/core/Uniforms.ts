import * as THREE from 'three/webgpu';
import { uniform, positionWorld } from 'three/tsl';

/**
 * Global shader uniforms shared by all TSL materials.
 * uOrigin: floating-origin offset — absolute world position = positionWorld + uOrigin.
 */
export const U = {
  origin: uniform(new THREE.Vector3()),
  time: uniform(0),
  night: uniform(0),        // 0 day .. 1 full night (drives window lights, lamps)
  wet: uniform(0),          // road wetness 0..1
  fogDensity: uniform(0.00012),
  fogHeight: uniform(120),
  fogColor: uniform(new THREE.Color(0xc8d4de)),
  coastFog: uniform(0.0),   // extra Karl-the-fog density along the Pacific / Golden Gate
  sunDir: uniform(new THREE.Vector3(0.4, 0.8, 0.3)),
  sunColor: uniform(new THREE.Color(1, 1, 1)),
  rain: uniform(0),
  camPosAbs: uniform(new THREE.Vector3()),
  lampIntensity: uniform(0),
  detail: uniform(1),
};

/** absolute world-space position node (floating origin corrected) */
export const absPos = positionWorld.add(U.origin);
