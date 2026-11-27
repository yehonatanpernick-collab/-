// הגדרות נשמרות בדפדפן בלבד (localStorage).
const KEY = 'geophytes.settings.v1';
const DEFAULTS = {
  mode: 'direct',          // direct = מפתח אישי מהדפדפן; proxy = שרת server.js מחזיק את המפתח
  apiKey: '',
  model: 'claude-opus-5-5',
  threshold: 80,           // סף ביטחון מינימלי לאישור (0-100)
  saveLocation: false,
  year: 'current',         // 'current' | 'all' | מספר שנה
};

let cache = null;

export function getSettings() {
  if (cache) return cache;
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* storage unavailable */ }
  cache = { ...DEFAULTS, ...stored };
  return cache;
}

export function saveSettings(patch) {
  cache = { ...getSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage unavailable */ }
  return cache;
}

export function trackedYear() {
  const y = getSettings().year;
  if (y === 'all') return null;
  if (y === 'current') return new Date().getFullYear();
  return Number(y);
}
