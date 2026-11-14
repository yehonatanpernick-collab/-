// Height field + signed-distance field of the drivable city area.
// Pre-baked offline from the city geometry: 1 m cells, Int16 height (cm) + Int8 SDF (1/8 m).

async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { gunzipSync } = await import('fflate');
  return gunzipSync(bytes);
}

export class Grid {
  async load(gridB64) {
    const bin = atob(gridB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const raw = await gunzip(bytes);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    this.W = dv.getInt32(0, true);
    this.H = dv.getInt32(4, true);
    this.X0 = dv.getFloat32(8, true);
    this.Z0 = dv.getFloat32(12, true);
    const n = this.W * this.H;
    const buf = raw.buffer.slice(raw.byteOffset + 16, raw.byteOffset + 16 + n * 3);
    this.h = new Int16Array(buf, 0, n);
    this.s = new Int8Array(buf, n * 2, n);
  }
  _bilerp(arr, x, z, scale, outside) {
    const fx = x - this.X0 - 0.5, fz = z - this.Z0 - 0.5;
    let gx = Math.floor(fx), gz = Math.floor(fz);
    if (gx < 0 || gz < 0 || gx >= this.W - 1 || gz >= this.H - 1) return outside;
    const tx = fx - gx, tz = fz - gz, W = this.W, k = gz * W + gx;
    const a = arr[k], b = arr[k + 1], c = arr[k + W], d = arr[k + W + 1];
    return ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz) * scale;
  }
  height(x, z) { return this._bilerp(this.h, x, z, 0.01, -5); }
  sdf(x, z) { return this._bilerp(this.s, x, z, 0.125, -10); }
  grad(x, z, out) {
    const e = 0.5;
    out.x = this.sdf(x + e, z) - this.sdf(x - e, z);
    out.y = this.sdf(x, z + e) - this.sdf(x, z - e);
    const l = Math.hypot(out.x, out.y) || 1;
    out.x /= l; out.y /= l;
    return out;
  }
}
