// Small shared helpers (kept separate from main.js to avoid import cycles).
export const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable (private mode) */ } },
};

// Some hosts (claude.ai artifacts) don't serve .glb / .gz; the artifact page installs
// globalThis.__assetMap to point at renamed copies. Loaders sniff magic bytes, not names.
export const assetUrl = (u) => (globalThis.__assetMap ? globalThis.__assetMap(u) : u);
