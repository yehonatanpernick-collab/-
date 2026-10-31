import * as THREE from 'three';
// Lazy texture loading (adapted for Realms of Aetheria): only color/normal maps are shipped.
const loader = new THREE.TextureLoader();
const base = new URL('../../assets/nature/', import.meta.url).href;
const cache = {};
const load = (name, srgb) => {
  if (!cache[name]) { const t = loader.load(base + name); if (srgb) t.colorSpace = THREE.SRGBColorSpace; cache[name] = t; }
  return cache[name];
};
const barkMap = { willow: 'oak' };
export function getBarkTexture(barkType, fileType, scale = { x: 1, y: 1 }) {
  if (fileType !== 'color' && fileType !== 'normal') return null;
  const b = barkMap[barkType] || barkType;
  const t = load(`${b}_${fileType}_1k.jpg`, fileType === 'color').clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(scale.x, 1 / scale.y); t.needsUpdate = true;
  return t;
}
export function getLeafTexture(leafType) { return load(`${leafType}_color.png`, true); }
