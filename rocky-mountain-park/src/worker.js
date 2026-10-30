// Web Worker entry: builds the world off the main thread.
import { generate, bakeSun } from './worldgen.js';

let HC = null;
const buffers = (o, out = []) => {
  if (!o || typeof o !== 'object') return out;
  if (ArrayBuffer.isView(o)) { if (!out.includes(o.buffer)) out.push(o.buffer); return out; }
  for (const k in o) buffers(o[k], out);
  return out;
};
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'gen') {
    try {
      const r = generate(m.opts, (t, p) => self.postMessage({ type: 'progress', t, p }));
      HC = r.grids.HC.slice();
      self.postMessage({ type: 'done', r }, buffers(r));
    } catch (err) { self.postMessage({ type: 'error', message: String(err && err.stack || err) }); }
  } else if (m.type === 'sun' && HC) {
    const vis = bakeSun(HC, m.dir[0], m.dir[1], m.dir[2]);
    self.postMessage({ type: 'sun', vis, id: m.id }, [vis.buffer]);
  }
};
