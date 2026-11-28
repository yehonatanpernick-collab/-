// דיווחים מרשתות חברתיות: טקסט שהמשתמש מדביק, שהבינה המלאכותית ממירה לנקודות לא מאומתות.
const KEY = 'geophytes.reports';

export function reports() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
export function addReports(items) {
  const list = reports();
  for (const it of items) list.unshift({ id: crypto.randomUUID(), ts: Date.now(), ...it });
  save(list);
  return list;
}
export function deleteReport(id) {
  const list = reports().filter((r) => r.id !== id);
  save(list);
  return list;
}
/** נקודות למפה של מין: [lat, lon, year, accuracyMeters, 'u'] */
export function reportPoints(code) {
  return reports().filter((r) => r.code === code && r.lat != null).map((r) => [r.lat, r.lon, r.year || 0, r.acc || 0, 'u']);
}
