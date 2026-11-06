/** Binary asset access. The claude.ai artifact host only serves web types, so the `artifact` build ships
 *  .glb/.hdr files as base64 text next to their original names (`x.glb.txt`) and decodes them here. */
const PACKED = import.meta.env.MODE === 'artifact';

function b64ToBuffer(s: string): ArrayBuffer {
  const bin = atob(s.trim()); const n = bin.length; const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function loadBinary(url: string): Promise<ArrayBuffer> {
  const r = await fetch(PACKED ? `${url}.txt` : url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return PACKED ? b64ToBuffer(await r.text()) : r.arrayBuffer();
}

/** directory part of a URL, for resolving a glTF's external textures */
export const dirOf = (url: string) => url.slice(0, url.lastIndexOf('/') + 1);
