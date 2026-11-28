// עובדות מקומיות לבדיקת אתר: כמה רחוק הדיווח הקרוב של המין, כמה דיווחים באזור, והיישוב הקרוב.
import { loadOccurrences, loadPlaces } from './map.js';
import { REGIONS } from '../data/regions.js';

const DIRS = ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'];
const km = (lat1, lon1, lat2, lon2) => {
  const kx = Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot((lon2 - lon1) * kx, lat2 - lat1) * 111.2;
};

export const inIsraelBox = (lat, lon) => lat > 29.3 && lat < 33.6 && lon > 34.0 && lon < 36.1;

export async function siteFacts(sp, lat, lon) {
  const [occ, places] = await Promise.all([loadOccurrences(), loadPlaces()]);
  let near = null, n5 = 0, n15 = 0, n30 = 0, total = 0;
  for (const p of occ[sp.c] || []) {
    if (p[4] === 'x') continue;
    total++;
    const d = km(lat, lon, p[0], p[1]);
    if (d <= 5) n5++; if (d <= 15) n15++; if (d <= 30) n30++;
    if (!near || d < near.d) near = { d, year: p[5] ? p[5].slice(0, 4) : p[2] || 0, date: p[5] || '' };
  }
  let town = null;
  for (const [name, tlon, tlat] of places) {
    const d = km(lat, lon, tlat, tlon);
    if (!town || d < town.d) {
      const ang = (Math.atan2((lon - tlon) * Math.cos((lat * Math.PI) / 180), lat - tlat) * 180) / Math.PI;
      town = { name, d, dir: DIRS[Math.round(((ang + 360) % 360) / 45) % 8] };
    }
  }
  const regs = Object.keys(sp.r || {}).map((c) => REGIONS.find((r) => r.code === c)).filter(Boolean);
  const textLines = [
    near ? `- Nearest recorded sighting of this taxon: ${near.d.toFixed(1)} km away (${near.date || near.year || 'year unknown'}); sightings within 5 km: ${n5}, 15 km: ${n15}, 30 km: ${n30} (of ${total} recorded points in Israel).`
      : '- There are no recorded point sightings of this taxon in public databases.',
    town ? `- Nearest settlement: ${town.name}, ${town.d.toFixed(1)} km to the ${town.dir}.` : '',
    regs.length ? `- Regions where this taxon is listed: ${regs.map((r) => `${r.name} (altitude ${r.alt}, rain ${r.rain} mm)`).join('; ')}.` : '',
  ].filter(Boolean).join('\n');
  return { near, n5, n15, n30, total, town, regs, textLines };
}
