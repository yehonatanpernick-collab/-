import type * as THREE from 'three/webgpu';

/**
 * Object3D.lookAt expects a WORLD-space target. Objects in the floating-origin worldRoot use absolute
 * coordinates for their local position, so convert the absolute target into world space first.
 */
export function lookAtAbs(o: THREE.Object3D, t: THREE.Vector3): void {
  const p = o.parent;
  if (p) { p.updateMatrixWorld(); o.lookAt(t.x + p.matrixWorld.elements[12], t.y + p.matrixWorld.elements[13], t.z + p.matrixWorld.elements[14]); }
  else o.lookAt(t);
}
