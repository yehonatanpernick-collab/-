// TrekAtlas — pure geo/hiking logic. No DOM, no network: runs in the browser
// (window.TrekGeo) and in Node (require) so it can be unit-tested.
(function (root) {
  'use strict';

  const R = 6371008.8; // mean Earth radius, metres
  const toRad = (d) => (d * Math.PI) / 180;

  // Great-circle distance in metres between [lon, lat] points.
  function haversine(a, b) {
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function pathLength(points) {
    let d = 0;
    for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
    return d;
  }

  // Resample a polyline to roughly even spacing. Returns [{lon, lat, d}] where d is
  // the distance from the start. Spacing grows if needed so we never exceed maxPts.
  function resample(points, stepM = 50, maxPts = 500) {
    if (!points || points.length === 0) return [];
    if (points.length === 1) return [{ lon: points[0][0], lat: points[0][1], d: 0 }];
    const total = pathLength(points);
    const step = Math.max(stepM, total / (maxPts - 1));
    const out = [{ lon: points[0][0], lat: points[0][1], d: 0 }];
    let acc = 0;      // distance at start of current segment
    let next = step;  // distance of the next sample
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const seg = haversine(a, b);
      while (seg > 0 && next < acc + seg) {
        const t = (next - acc) / seg;
        out.push({ lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, d: next });
        next += step;
      }
      acc += seg;
      // keep every user waypoint so turns are preserved exactly
      const last = out[out.length - 1];
      if (acc - last.d > 0.5) out.push({ lon: b[0], lat: b[1], d: acc });
    }
    return out;
  }

  // Terrarium DEM encoding (AWS elevation tiles): metres above sea level.
  function terrariumHeight(r, g, b) {
    return r * 256 + g + b / 256 - 32768;
  }

  // Web-mercator tile coordinates for a point. x/y are integer tile indices and
  // px/py the pixel inside a tile of `size` pixels.
  function tileXY(lon, lat, z, size = 256) {
    const n = 2 ** z;
    const latR = toRad(Math.max(-85.05112878, Math.min(85.05112878, lat)));
    const fx = ((lon + 180) / 360) * n;
    const fy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
    const x = Math.floor(fx), y = Math.floor(fy);
    return {
      x: ((x % n) + n) % n, y: Math.min(n - 1, Math.max(0, y)),
      px: Math.min(size - 1, Math.floor((fx - x) * size)),
      py: Math.min(size - 1, Math.floor((fy - y) * size)),
    };
  }

  // Tobler's hiking function: walking speed (km/h) for a slope dh/dx.
  function toblerKmh(slope) {
    return 6 * Math.exp(-3.5 * Math.abs(slope + 0.05));
  }

  // profile: [{d, ele}] ordered by d. pace: 1 = average hiker, <1 slower, >1 faster.
  // Ascent/descent use a 5 m hysteresis so DEM noise does not inflate the totals.
  function routeStats(profile, { pace = 1, noise = 5 } = {}) {
    const cumTime = [0];
    if (!profile || profile.length === 0) {
      return { distance: 0, ascent: 0, descent: 0, minEle: 0, maxEle: 0, timeH: 0, cumTime };
    }
    let ascent = 0, descent = 0, ref = profile[0].ele;
    let minEle = profile[0].ele, maxEle = profile[0].ele, t = 0;
    for (let i = 1; i < profile.length; i++) {
      const p = profile[i], q = profile[i - 1];
      const dx = p.d - q.d;
      const dh = p.ele - q.ele;
      if (dx > 0) {
        // cap extreme slopes from DEM artefacts at cliffs (±100%)
        const slope = Math.max(-1, Math.min(1, dh / dx));
        t += (dx / 1000) / (toblerKmh(slope) * pace);
      }
      cumTime.push(t);
      if (p.ele - ref >= noise) { ascent += p.ele - ref; ref = p.ele; }
      else if (ref - p.ele >= noise) { descent += ref - p.ele; ref = p.ele; }
      if (p.ele < minEle) minEle = p.ele;
      if (p.ele > maxEle) maxEle = p.ele;
    }
    return {
      distance: profile[profile.length - 1].d,
      ascent, descent, minEle, maxEle, timeH: t, cumTime,
    };
  }

  // Split into day stages of at most maxHours of walking. A stage always has at
  // least one segment so a single long segment can't create an infinite loop.
  function splitStages(profile, cumTime, maxHours) {
    const stages = [];
    if (!profile || profile.length < 2 || !(maxHours > 0)) return stages;
    let start = 0;
    while (start < profile.length - 1) {
      let end = start + 1;
      while (end < profile.length - 1 && cumTime[end + 1] - cumTime[start] <= maxHours) end++;
      const sub = profile.slice(start, end + 1).map((p) => ({ d: p.d - profile[start].d, ele: p.ele }));
      const s = routeStats(sub);
      stages.push({
        startIdx: start, endIdx: end,
        distance: s.distance, ascent: s.ascent, descent: s.descent,
        timeH: cumTime[end] - cumTime[start],
      });
      start = end;
    }
    return stages;
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  }

  // waypoints: [[lon,lat]], track: [{lon,lat,ele?}]
  function buildGPX(name, waypoints, track) {
    const n = escapeXml(name || 'TrekAtlas route');
    const wpts = (waypoints || []).map((p, i) =>
      `  <wpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}"><name>${i + 1}</name></wpt>`).join('\n');
    const trkpts = (track || []).map((p) =>
      `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">` +
      (Number.isFinite(p.ele) ? `<ele>${p.ele.toFixed(1)}</ele>` : '') + '</trkpt>').join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TrekAtlas" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${n}</name></metadata>
${wpts}
  <trk><name>${n}</name><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>
`;
  }

  // Returns {name, points:[[lon,lat]]}: track points if present, else route
  // points, else waypoints. Regex-based so it also works without DOMParser.
  function parseGPX(text) {
    const nameM = /<name>([^<]*)<\/name>/.exec(text || '');
    const grab = (tag) => {
      const re = new RegExp(`<${tag}\\b([^>]*)>`, 'g');
      const pts = [];
      let m;
      while ((m = re.exec(text))) {
        const lat = /\blat\s*=\s*["']([-\d.eE+]+)["']/.exec(m[1]);
        const lon = /\blon\s*=\s*["']([-\d.eE+]+)["']/.exec(m[1]);
        if (lat && lon) {
          const la = parseFloat(lat[1]), lo = parseFloat(lon[1]);
          if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) pts.push([lo, la]);
        }
      }
      return pts;
    };
    let points = grab('trkpt');
    if (!points.length) points = grab('rtept');
    if (!points.length) points = grab('wpt');
    return { name: nameM ? nameM[1].trim() : '', points };
  }

  // Keep at most maxPts points (evenly spaced, always keeping both ends) so
  // imported tracks stay editable as waypoints.
  function thin(points, maxPts = 60) {
    if (points.length <= maxPts) return points.slice();
    const out = [];
    for (let i = 0; i < maxPts; i++) out.push(points[Math.round((i * (points.length - 1)) / (maxPts - 1))]);
    return out;
  }

  function formatDuration(h) {
    const mins = Math.round(h * 60);
    return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
  }

  function formatDistance(m) {
    return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} ק״מ` : `${Math.round(m)} מ׳`;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  // Steepest sustained grade (%), measured over ~windowM so one noisy DEM
  // pixel at a cliff doesn't dominate.
  function maxGrade(profile, windowM = 200) {
    let best = 0, j = 0;
    for (let i = 1; i < profile.length; i++) {
      while (j < i && profile[i].d - profile[j].d > windowM) j++;
      const k = Math.max(0, j - 1);
      const dx = profile[i].d - profile[k].d;
      if (dx >= windowM / 2) best = Math.max(best, Math.abs(profile[i].ele - profile[k].ele) / dx);
    }
    return best * 100;
  }

  // Grade class for colouring the profile: 0 easy … 3 very steep.
  function gradeClass(pct) {
    const a = Math.abs(pct);
    return a < 8 ? 0 : a < 15 ? 1 : a < 25 ? 2 : 3;
  }

  // Difficulty from "effort kilometres" (Swiss Alpine Club style: 1 km flat
  // ≈ 100 m of ascent) for the hardest day, plus top altitude.
  function difficulty(stats, stages, maxEle) {
    const day = (stages && stages.length)
      ? stages.reduce((m, s) => Math.max(m, s.distance / 1000 + s.ascent / 100 + s.descent / 300), 0)
      : stats.distance / 1000 + stats.ascent / 100 + stats.descent / 300;
    let level = day < 10 ? 0 : day < 20 ? 1 : day < 30 ? 2 : 3;
    if (maxEle > 3500 && level < 2) level = 2; // altitude alone makes it demanding
    if (maxEle > 5000) level = 3;
    return { level, effortKm: day, label: ['קל', 'בינוני', 'מאתגר', 'קשה מאוד'][level] };
  }

  // Join routed legs ([[lon,lat],...] each) into one line without duplicate joints.
  function mergeLegs(legs) {
    const out = [];
    for (const leg of legs) {
      for (let i = 0; i < leg.length; i++) {
        const p = leg[i], q = out[out.length - 1];
        if (q && Math.abs(q[0] - p[0]) < 1e-7 && Math.abs(q[1] - p[1]) < 1e-7) continue;
        out.push(p);
      }
    }
    return out;
  }

  // OSRM response -> coordinates, or null when no route was found.
  function parseOsrm(json) {
    if (!json || json.code !== 'Ok' || !json.routes || !json.routes.length) return null;
    const c = json.routes[0].geometry && json.routes[0].geometry.coordinates;
    return Array.isArray(c) && c.length > 1 ? c : null;
  }

  // Initial compass bearing (degrees) from a to b, for the fly-over camera.
  function bearing(a, b) {
    const φ1 = toRad(a[1]), φ2 = toRad(b[1]), Δλ = toRad(b[0] - a[0]);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  const api = {
    haversine, pathLength, resample, terrariumHeight, tileXY, toblerKmh,
    routeStats, splitStages, buildGPX, parseGPX, thin, formatDuration, formatDistance, escapeHtml,
    maxGrade, gradeClass, difficulty, mergeLegs, parseOsrm, bearing,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrekGeo = api;
})(typeof window !== 'undefined' ? window : globalThis);
