// Loads the baked world data. Binary grids are gzip + row-delta encoded (see tools/bake_world.mjs).
import { WORLD, HeightField } from './heightfield.js';

async function fetchProgress(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length; onBytes?.(value.length);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function gunzip(bytes) {
  // Some static servers send .gz with Content-Encoding: gzip, so the browser already inflated it.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function undelta(u8, n) {
  const a = new Uint16Array(u8.buffer, u8.byteOffset, u8.byteLength / 2);
  const out = new Uint16Array(a.length);
  for (let j = 0; j < n; j++) {
    let prev = 0;
    const row = j * n;
    for (let i = 0; i < n; i++) { prev = (prev + a[row + i]) & 0xffff; out[row + i] = prev; }
  }
  return out;
}

export async function loadWorld(base, progress) {
  const files = ['height.bin.gz', 'far.bin.gz', 'water.bin.gz', 'masks.bin.gz'];
  const raw = {};
  await Promise.all(files.map(async (f) => {
    raw[f] = await fetchProgress(base + f, (b) => progress?.(b));
  }));
  const meta = await (await fetch(base + 'world.json')).json();
  const height = undelta(await gunzip(raw['height.bin.gz']), WORLD.n);
  const far = undelta(await gunzip(raw['far.bin.gz']), WORLD.farN);
  const water = undelta(await gunzip(raw['water.bin.gz']), WORLD.n);
  const masks = await gunzip(raw['masks.bin.gz']);
  const field = new HeightField({ height, masks, water });
  return { meta, height, far, water, masks, field };
}
