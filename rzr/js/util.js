// Small shared helpers (kept separate from main.js to avoid import cycles).
export const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable (private mode) */ } },
};
