// Debug page: /viewer.html?url=<glb>&yaw=30&label=... renders a GLB framed on a neutral stage (used for asset previews).
import * as pc from 'playcanvas';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const app = new pc.Application(canvas, { graphicsDevice: await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true }) });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW); app.setCanvasResolution(pc.RESOLUTION_AUTO); app.start();
app.scene.ambientLight = new pc.Color(0.45, 0.47, 0.5);
const cam = new pc.Entity(); cam.addComponent('camera', { clearColor: new pc.Color(0.16, 0.18, 0.2), fov: 35, toneMapping: pc.TONEMAP_ACES2, gammaCorrection: pc.GAMMA_SRGB, nearClip: 0.01, farClip: 100000 }); app.root.addChild(cam);
const sun = new pc.Entity(); sun.addComponent('light', { type: 'directional', intensity: 2.2, castShadows: true, shadowResolution: 2048, shadowDistance: 40 }); sun.setEulerAngles(50, 30, 0); app.root.addChild(sun);
const fill = new pc.Entity(); fill.addComponent('light', { type: 'directional', intensity: 0.7, color: new pc.Color(0.7, 0.8, 1) }); fill.setEulerAngles(-30, 200, 0); app.root.addChild(fill);
(document.getElementById('l') as HTMLElement).textContent = q.get('label') ?? '';
const asset = new pc.Asset('m', 'container', { url: q.get('url') as string });
app.assets.add(asset);
asset.once('load', () => {
  const e = (asset.resource as pc.ContainerResource).instantiateRenderEntity();
  app.root.addChild(e);
  const res = asset.resource as pc.ContainerResource & { animations: pc.Asset[] };
  if (res.animations?.length && q.get('anim') !== '0') {
    e.addComponent('anim', { activate: true });
    const t = res.animations[Number(q.get('clip') ?? 0)]?.resource as pc.AnimTrack;
    if (t) { (e.anim as pc.AnimComponent).assignAnimation('a', t); }
  }
  setTimeout(() => {
    const aabb = new pc.BoundingBox(); let first = true;
    for (const r of e.findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) { if (first) { aabb.copy(mi.aabb); first = false; } else aabb.add(mi.aabb); mi.cull = false; }
    const c = aabb.center, h = aabb.halfExtents, rad = Math.max(h.x, h.y, h.z) * 1.15;
    const yaw = Number(q.get('yaw') ?? 35) * pc.math.DEG_TO_RAD, pitch = Number(q.get('pitch') ?? 12) * pc.math.DEG_TO_RAD;
    const dist = rad / Math.sin(17.5 * pc.math.DEG_TO_RAD);
    cam.setPosition(c.x + Math.sin(yaw) * Math.cos(pitch) * dist, c.y + Math.sin(pitch) * dist, c.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(c);
    (window as unknown as Record<string, unknown>).__ready = true;
    (window as unknown as Record<string, unknown>).__info = { center: [c.x, c.y, c.z], half: [h.x, h.y, h.z] };
  }, Number(q.get('wait') ?? 300));
});
app.assets.load(asset);
