// TrekAtlas app: map, explore list, route planner, weather, saved trips.
(function () {
  'use strict';
  const G = window.TrekGeo;
  const $ = (s) => document.querySelector(s);
  const esc = G.escapeHtml;
  const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const DEM_Z = 12;
  const STORE_KEY = 'trekatlas.trips.v1';

  const state = {
    mode: 'explore',
    waypoints: [],   // [[lon, lat]]
    markers: [],
    profile: [],     // [{lon, lat, d, ele}]
    stats: null,
    stages: [],
    calcId: 0,
  };

  // ---------- map ----------
  const map = new maplibregl.Map({
    container: 'map',
    center: [35.4, 31.9], zoom: 6.5, pitch: 45, maxPitch: 80,
    attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        sat: { type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
        topo: { type: 'raster', tileSize: 256, maxzoom: 17,
          tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],
          attribution: '© OpenStreetMap contributors, SRTM · style © OpenTopoMap (CC-BY-SA)' },
        dem: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: DEM_Z, tiles: [DEM_URL],
          attribution: 'Elevation: Mapzen Terrain Tiles (AWS)' },
        demHs: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: DEM_Z, tiles: [DEM_URL] },
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } },
        { id: 'hillshade', type: 'hillshade', source: 'demHs',
          paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#0b1a12' } },
      ],
      sky: { 'sky-color': '#7db7e8', 'horizon-color': '#d8ecf7', 'fog-color': '#cfe3ee', 'sky-horizon-blend': 0.5 },
    },
  });
  window.trekMap = map; // handy for debugging from the console
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-left');

  const setTerrain = (on) => map.setTerrain(on ? { source: 'dem', exaggeration: 1.3 } : null);

  // MapLibre 4.7 freezes the camera's ground elevation at the start of every
  // flyTo/easeTo/fitBounds with terrain and never unfreezes it. If the DEM tiles
  // at the destination weren't loaded yet, the camera stays at sea level and ends
  // up inside high mountains (markers hidden, route off-screen). Unfreeze after
  // each move so the render loop re-reads the terrain height at the centre.
  map.on('moveend', () => {
    if (map.terrain && map._elevationFreeze) { map._elevationFreeze = false; map.triggerRepaint(); }
  });

  map.on('load', () => {
    setTerrain(true);
    // compact attribution starts expanded; collapse it so it doesn't cover the map on phones
    document.querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show').forEach((el) => el.classList.remove('maplibregl-compact-show'));
    map.addSource('trails', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'trails', type: 'line', source: 'trails',
      paint: { 'line-color': '#ff5a3c', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 16, 3], 'line-dasharray': [2, 1.2], 'line-opacity': 0.9 } });
    map.addSource('route', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#1b1208', 'line-width': 7, 'line-opacity': 0.6 } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#f2a541', 'line-width': 4 } });
    loadFromHash();
  });

  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }
  function status(msg) { const el = $('#status'); el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none'; }

  document.querySelectorAll('input[name=base]').forEach((r) => r.addEventListener('change', () => {
    map.setLayoutProperty('sat', 'visibility', r.value === 'sat' && r.checked ? 'visible' : 'none');
    map.setLayoutProperty('topo', 'visibility', r.value === 'topo' && r.checked ? 'visible' : 'none');
  }));
  $('#terrainToggle').addEventListener('change', (e) => {
    setTerrain(e.target.checked);
    map.easeTo({ pitch: e.target.checked ? 50 : 0 });
  });

  // ---------- elevation from terrarium tiles ----------
  const tileCache = new Map();
  function loadTile(x, y) {
    const key = `${x}/${y}`;
    if (!tileCache.has(key)) {
      tileCache.set(key, new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = 256;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          resolve(ctx.getImageData(0, 0, 256, 256).data);
        };
        img.onerror = () => { tileCache.delete(key); resolve(null); };
        img.src = DEM_URL.replace('{z}', DEM_Z).replace('{x}', x).replace('{y}', y);
      }));
    }
    return tileCache.get(key);
  }
  async function elevationAt(lon, lat) {
    const t = G.tileXY(lon, lat, DEM_Z);
    const px = await loadTile(t.x, t.y);
    if (!px) return NaN;
    const i = (t.py * 256 + t.px) * 4;
    return G.terrariumHeight(px[i], px[i + 1], px[i + 2]);
  }

  // ---------- tabs / mode ----------
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  function showView(v) {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === `view-${v}`));
    state.mode = v === 'plan' ? 'plan' : 'explore';
    $('#modeBadge').hidden = state.mode !== 'plan';
    map.getCanvas().style.cursor = state.mode === 'plan' ? 'crosshair' : '';
    if (v === 'trips') renderTrips();
  }

  // ---------- explore ----------
  let activeCat = 'all';
  const placeMarkers = [];
  function renderCats() {
    $('#cats').innerHTML = Object.entries(window.TREK_CATS).map(([k, c]) =>
      `<span class="chip ${k === activeCat ? 'on' : ''}" data-cat="${k}">${c.icon} ${c.he}</span>`).join('');
  }
  $('#cats').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    activeCat = c.dataset.cat;
    renderCats(); renderPlaces();
  });
  function renderPlaces() {
    const list = window.TREK_PLACES.filter((p) => activeCat === 'all' || p.cat === activeCat);
    $('#places').innerHTML = list.map((p) => {
      const i = window.TREK_PLACES.indexOf(p);
      return `<div class="item" data-i="${i}"><b>${window.TREK_CATS[p.cat].icon} ${esc(p.he)}${p.ele ? ` · ${p.ele.toLocaleString('he-IL')} מ׳` : ''}</b><small>${esc(p.country)} · ${esc(p.note)}</small></div>`;
    }).join('');
    placeMarkers.forEach((m) => m.remove());
    placeMarkers.length = 0;
    list.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'place-marker';
      el.textContent = window.TREK_CATS[p.cat].icon;
      el.title = p.he;
      el.addEventListener('click', (ev) => { ev.stopPropagation(); flyToPlace(p); });
      placeMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map));
    });
  }
  $('#places').addEventListener('click', (e) => {
    const it = e.target.closest('.item');
    if (it) flyToPlace(window.TREK_PLACES[+it.dataset.i]);
  });
  function flyToPlace(p) {
    map.flyTo({ center: [p.lon, p.lat], zoom: p.cat === 'canyon' || p.cat === 'park' || p.cat === 'desert' ? 12 : 12.5,
      pitch: 65, bearing: Math.round(Math.random() * 120 - 60), speed: 1.4, essential: true });
    showPointPopup([p.lon, p.lat], p);
  }

  let popup = null;
  async function showPointPopup(lngLat, place) {
    if (popup) popup.remove();
    const [lon, lat] = lngLat;
    const title = place ? `<b>${esc(place.he)}</b> <small style="color:var(--muted)">${esc(place.en)}</small><br><small>${esc(place.note)}</small><br>` : '';
    popup = new maplibregl.Popup({ offset: 14, maxWidth: '280px' }).setLngLat(lngLat)
      .setHTML(`${title}<small>${lat.toFixed(4)}, ${lon.toFixed(4)} · גובה: <span id="popEle">…</span></small><br>
        <button class="btn" id="popStart" style="margin-top:6px">🥾 התחל מסלול מכאן</button>`).addTo(map);
    $('#popStart').addEventListener('click', () => {
      popup.remove();
      showView('plan');
      if (!state.waypoints.length) addWaypoint(lngLat);
    });
    const ele = place && place.ele ? place.ele : await elevationAt(lon, lat);
    const el = document.getElementById('popEle');
    if (el) el.textContent = Number.isFinite(ele) ? `${Math.round(ele).toLocaleString('he-IL')} מ׳` : 'לא זמין';
  }

  // Search (OpenStreetMap Nominatim). Runs only on submit, per its usage policy.
  $('#searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    if (!q) return;
    const box = $('#searchResults');
    box.innerHTML = '<p class="hint">מחפש…</p>';
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=he,en&q=${encodeURIComponent(q)}`);
      const data = await r.json();
      if (!data.length) { box.innerHTML = '<p class="hint">לא נמצאו תוצאות.</p>'; return; }
      box.innerHTML = data.map((d, i) => `<div class="item" data-i="${i}"><b>${esc(d.name || d.display_name.split(',')[0])}</b><small>${esc(d.display_name)}</small></div>`).join('');
      box.onclick = (ev) => {
        const it = ev.target.closest('.item');
        if (!it) return;
        const d = data[+it.dataset.i];
        const bb = d.boundingbox && d.boundingbox.map(Number);
        if (bb) map.fitBounds([[bb[2], bb[0]], [bb[3], bb[1]]], { maxZoom: 13.5, pitch: 60, padding: 40 });
        else map.flyTo({ center: [+d.lon, +d.lat], zoom: 12 });
        showPointPopup([+d.lon, +d.lat]);
      };
    } catch (err) {
      box.innerHTML = '<p class="hint">החיפוש נכשל. בדקו חיבור לאינטרנט.</p>';
    }
  });

  // ---------- map click ----------
  map.on('click', (e) => {
    const ll = [e.lngLat.lng, e.lngLat.lat];
    if (state.mode === 'plan') addWaypoint(ll);
    else showPointPopup(ll);
  });

  // ---------- planner ----------
  function addWaypoint(ll) {
    state.waypoints.push(ll);
    syncMarkers(); recalc();
  }
  function syncMarkers() {
    state.markers.forEach((m) => m.remove());
    state.markers = state.waypoints.map((ll, i) => {
      const el = document.createElement('div');
      el.className = 'wp-marker' + (i === 0 ? ' start' : '');
      el.textContent = i + 1;
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(ll).addTo(map);
      el.addEventListener('click', (ev) => ev.stopPropagation());
      m.on('dragend', () => { const p = m.getLngLat(); state.waypoints[i] = [p.lng, p.lat]; recalc(); renderWpList(); });
      return m;
    });
    renderWpList();
  }
  function renderWpList() {
    $('#wpList').innerHTML = state.waypoints.length
      ? state.waypoints.map((p, i) => `<div class="wp"><span>${i + 1}. ${p[1].toFixed(4)}, ${p[0].toFixed(4)}</span><button data-i="${i}" title="מחק">✕</button></div>`).join('')
      : '<p class="hint">אין נקודות עדיין.</p>';
  }
  $('#wpList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    state.waypoints.splice(+b.dataset.i, 1);
    syncMarkers(); recalc();
  });
  $('#undoBtn').addEventListener('click', () => { state.waypoints.pop(); syncMarkers(); recalc(); });
  $('#clearBtn').addEventListener('click', () => {
    if (state.waypoints.length && !confirm('לנקות את כל המסלול?')) return;
    state.waypoints = []; syncMarkers(); recalc();
  });
  $('#reverseBtn').addEventListener('click', () => { state.waypoints.reverse(); syncMarkers(); recalc(); });
  $('#loopBtn').addEventListener('click', () => {
    if (state.waypoints.length > 1) { state.waypoints.push(state.waypoints[0].slice()); syncMarkers(); recalc(); }
  });
  ['#pace', '#maxHours'].forEach((s) => $(s).addEventListener('change', () => computeStats()));

  async function recalc() {
    const id = ++state.calcId;
    const wps = state.waypoints;
    const src = map.getSource('route');
    if (src) src.setData({ type: 'FeatureCollection', features: wps.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: wps } }] : [] });
    clearWeather();
    if (wps.length < 2) { state.profile = []; computeStats(); return; }
    status('מחשב גבהים…');
    const samples = G.resample(wps, 40, 600);
    const eles = await Promise.all(samples.map((s) => elevationAt(s.lon, s.lat)));
    if (id !== state.calcId) return; // a newer edit superseded this one
    status('');
    // fill tile gaps by carrying the neighbour value so stats stay finite
    let last = eles.find(Number.isFinite) ?? 0;
    state.profile = samples.map((s, i) => { if (Number.isFinite(eles[i])) last = eles[i]; return { ...s, ele: last }; });
    if (eles.some((e) => !Number.isFinite(e))) status('חלק מנתוני הגובה לא נטענו. ייתכן שהסטטיסטיקה חלקית.');
    computeStats();
    saveHash();
  }

  function computeStats() {
    const prof = state.profile;
    const pace = +$('#pace').value;
    state.stats = G.routeStats(prof, { pace });
    const st = state.stats;
    const maxH = Math.max(1, +$('#maxHours').value || 6);
    state.stages = prof.length > 1 ? G.splitStages(prof, st.cumTime, maxH) : [];
    const cell = (v, l) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`;
    $('#stats').innerHTML = prof.length > 1 ? [
      cell(G.formatDistance(st.distance), 'מרחק'),
      cell(`${Math.round(st.ascent).toLocaleString('he-IL')} מ׳`, 'עלייה מצטברת'),
      cell(`${Math.round(st.descent).toLocaleString('he-IL')} מ׳`, 'ירידה מצטברת'),
      cell(G.formatDuration(st.timeH), 'זמן הליכה (ש׳)'),
      cell(`${Math.round(st.maxEle).toLocaleString('he-IL')} מ׳`, 'נקודה גבוהה'),
      cell(state.stages.length, state.stages.length === 1 ? 'יום' : 'ימים'),
    ].join('') : '';
    drawProfile();
    renderStages();
  }

  function renderStages(weather) {
    const el = $('#stages');
    if (!state.stages.length) { el.innerHTML = '<p class="hint">הוסיפו לפחות שתי נקודות.</p>'; return; }
    const start = $('#startDate').value ? new Date($('#startDate').value + 'T00:00') : null;
    el.innerHTML = `<table><tr><th>יום</th><th>מרחק</th><th>↑/↓ מ׳</th><th>זמן</th><th>מזג אוויר</th></tr>` +
      state.stages.map((s, i) => {
        const date = start ? new Date(start.getTime() + i * 864e5) : null;
        const w = weather && weather[i];
        return `<tr><td>${i + 1}${date ? `<br><small style="color:var(--muted)">${date.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}</small>` : ''}</td>
          <td>${G.formatDistance(s.distance)}</td><td>${Math.round(s.ascent)}/${Math.round(s.descent)}</td>
          <td>${G.formatDuration(s.timeH)}</td><td>${w ? w : '–'}</td></tr>`;
      }).join('') + '</table>';
  }

  // ---------- elevation profile chart ----------
  const canvas = $('#profile');
  let hoverMarker = null;
  function drawProfile(hoverIdx) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const prof = state.profile;
    if (prof.length < 2) {
      ctx.fillStyle = '#94a89e'; ctx.font = '12px Rubik'; ctx.textAlign = 'center';
      ctx.fillText('פרופיל הגובה יופיע כאן', w / 2, h / 2);
      return;
    }
    const pad = { l: 8, r: 40, t: 12, b: 18 };
    const st = state.stats;
    const lo = st.minEle - 20, hi = st.maxEle + 20;
    const X = (d) => w - pad.r - (d / st.distance) * (w - pad.l - pad.r); // RTL: start on the right
    const Y = (e) => pad.t + (1 - (e - lo) / (hi - lo)) * (h - pad.t - pad.b);
    const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    grad.addColorStop(0, 'rgba(242,165,65,.55)'); grad.addColorStop(1, 'rgba(242,165,65,.05)');
    ctx.beginPath();
    ctx.moveTo(X(0), h - pad.b);
    prof.forEach((p) => ctx.lineTo(X(p.d), Y(p.ele)));
    ctx.lineTo(X(st.distance), h - pad.b);
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    prof.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p.d), Y(p.ele)));
    ctx.strokeStyle = '#f2a541'; ctx.lineWidth = 2; ctx.stroke();
    // day boundaries
    ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    state.stages.slice(0, -1).forEach((s) => { const x = X(prof[s.endIdx].d); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.fillStyle = '#94a89e'; ctx.font = '10px Rubik'; ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(st.maxEle)}`, w - pad.r + 4, Y(st.maxEle) + 3);
    ctx.fillText(`${Math.round(st.minEle)}`, w - pad.r + 4, Y(st.minEle) + 3);
    ctx.textAlign = 'center';
    ctx.fillText('0', X(0), h - 4);
    ctx.fillText(G.formatDistance(st.distance), X(st.distance) + 20, h - 4);
    if (hoverIdx != null) {
      const p = prof[hoverIdx];
      ctx.beginPath(); ctx.arc(X(p.d), Y(p.ele), 4, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.fillStyle = '#eef4f0'; ctx.font = '11px Rubik';
      ctx.fillText(`${G.formatDistance(p.d)} · ${Math.round(p.ele)} מ׳`, Math.min(w - 70, Math.max(60, X(p.d))), pad.t);
    }
  }
  canvas.addEventListener('mousemove', (e) => {
    const prof = state.profile;
    if (prof.length < 2) return;
    const r = canvas.getBoundingClientRect();
    const pad = { l: 8, r: 40 };
    const frac = Math.min(1, Math.max(0, (r.width - pad.r - (e.clientX - r.left)) / (r.width - pad.l - pad.r)));
    const target = frac * state.stats.distance;
    let idx = 0;
    while (idx < prof.length - 1 && prof[idx].d < target) idx++;
    drawProfile(idx);
    if (!hoverMarker) { const el = document.createElement('div'); el.className = 'hover-dot'; hoverMarker = new maplibregl.Marker({ element: el }); }
    hoverMarker.setLngLat([prof[idx].lon, prof[idx].lat]).addTo(map);
  });
  canvas.addEventListener('mouseleave', () => { drawProfile(); if (hoverMarker) hoverMarker.remove(); });
  window.addEventListener('resize', () => drawProfile());

  // ---------- weather (Open-Meteo, no key) ----------
  const WX = (c) => c === 0 ? '☀️' : c <= 3 ? '⛅' : c <= 48 ? '🌫️' : c <= 67 ? '🌧️' : c <= 77 ? '❄️' : c <= 82 ? '🌦️' : c <= 86 ? '🌨️' : '⛈️';
  function clearWeather() { renderStages(); }
  const today = new Date();
  $('#startDate').value = new Date(today.getTime() + 864e5).toISOString().slice(0, 10);
  $('#startDate').addEventListener('change', () => renderStages());
  $('#weatherBtn').addEventListener('click', async () => {
    if (!state.stages.length) return;
    const start = new Date($('#startDate').value + 'T00:00');
    const daysAhead = Math.round((start - new Date(today.toDateString())) / 864e5);
    if (daysAhead < 0 || daysAhead + state.stages.length > 16) {
      alert('תחזית זמינה רק ל-16 הימים הקרובים. בחרו תאריך יציאה קרוב יותר.');
      return;
    }
    status('טוען תחזית…');
    try {
      const out = await Promise.all(state.stages.map(async (s, i) => {
        const p = state.profile[s.endIdx]; // weather where you sleep/finish that day
        const day = new Date(start.getTime() + i * 864e5);
        const ds = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}&elevation=${Math.round(p.ele)}` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto&start_date=${ds}&end_date=${ds}`;
        const d = (await (await fetch(url)).json()).daily;
        if (!d || !d.time) return '?';
        return `${WX(d.weather_code[0])} ${Math.round(d.temperature_2m_min[0])}°–${Math.round(d.temperature_2m_max[0])}°<br><small style="color:var(--muted)">${d.precipitation_sum[0]} מ״מ · ${Math.round(d.wind_speed_10m_max[0])} קמ״ש</small>`;
      }));
      renderStages(out);
      status('');
    } catch (e) {
      status('טעינת התחזית נכשלה.');
    }
  });

  // ---------- trails & peaks from OpenStreetMap (Overpass) ----------
  let overpassCtl = null, overpassTimer = null;
  const peakMarkers = [];
  $('#trailsToggle').addEventListener('change', (e) => {
    if (e.target.checked) { loadOsm(); if (map.getZoom() < 12) status('התקרבו (זום 12+) כדי לראות שבילים ופסגות'); }
    else { map.getSource('trails').setData(emptyFC()); peakMarkers.forEach((m) => m.remove()); peakMarkers.length = 0; status(''); }
  });
  map.on('moveend', () => { clearTimeout(overpassTimer); overpassTimer = setTimeout(loadOsm, 700); });
  async function loadOsm() {
    if (!$('#trailsToggle').checked) return;
    if (map.getZoom() < 12) return;
    const b = map.getBounds();
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => v.toFixed(4)).join(',');
    const q = `[out:json][timeout:25];(way["highway"~"^(path|footway|track|bridleway|steps)$"](${bbox});)->.w;.w out geom 4000;node["natural"~"^(peak|volcano)$"]["name"](${bbox});out 80;`;
    if (overpassCtl) overpassCtl.abort();
    overpassCtl = new AbortController();
    status('טוען שבילים מ-OpenStreetMap…');
    try {
      const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: overpassCtl.signal });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      const features = [];
      peakMarkers.forEach((m) => m.remove()); peakMarkers.length = 0;
      for (const el of data.elements) {
        if (el.type === 'way' && el.geometry) {
          features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: el.geometry.map((g) => [g.lon, g.lat]) } });
        } else if (el.type === 'node') {
          const t = el.tags || {};
          const div = document.createElement('div');
          div.className = 'peak-marker';
          div.textContent = `${t['name:he'] || t.name}${t.ele ? ` ${parseInt(t.ele, 10)}` : ''}`;
          peakMarkers.push(new maplibregl.Marker({ element: div, anchor: 'bottom' }).setLngLat([el.lon, el.lat]).addTo(map));
        }
      }
      map.getSource('trails').setData({ type: 'FeatureCollection', features });
      status('');
    } catch (e) {
      if (e.name !== 'AbortError') status('שרת השבילים עמוס. נסו שוב בעוד רגע.');
    }
  }

  // ---------- saved trips (localStorage, this browser only) ----------
  function readTrips() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } }
  function writeTrips(t) { try { localStorage.setItem(STORE_KEY, JSON.stringify(t)); return true; } catch { return false; } }
  $('#saveBtn').addEventListener('click', () => {
    if (state.waypoints.length < 2) { alert('צריך לפחות שתי נקודות כדי לשמור.'); return; }
    const name = $('#tripName').value.trim() || `טיול ${new Date().toLocaleDateString('he-IL')}`;
    const trips = readTrips();
    trips.unshift({ id: Date.now(), name, waypoints: state.waypoints, pace: $('#pace').value, maxHours: $('#maxHours').value,
      startDate: $('#startDate').value, summary: state.stats ? { d: state.stats.distance, up: state.stats.ascent, t: state.stats.timeH, days: state.stages.length } : null });
    if (writeTrips(trips)) { $('#tripName').value = name; status('נשמר ✓'); setTimeout(() => status(''), 1500); }
    else alert('הדפדפן חוסם שמירה מקומית (מצב פרטי?). אפשר לייצא GPX במקום.');
  });
  function renderTrips() {
    const trips = readTrips();
    $('#tripsList').innerHTML = trips.length ? trips.map((t) => `<div class="item" data-id="${t.id}">
        <b>${esc(t.name)}</b>
        <small>${t.summary ? `${G.formatDistance(t.summary.d)} · ↑${Math.round(t.summary.up)} מ׳ · ${G.formatDuration(t.summary.t)} ש׳ · ${t.summary.days} ימים` : ''}</small>
        <div class="row" style="margin-top:6px"><button class="btn" data-act="open">פתח</button><button class="btn" data-act="del">מחק</button></div></div>`).join('')
      : '<p class="hint">עוד לא שמרתם טיולים. תכננו מסלול בלשונית "תכנן" ולחצו "שמור". הטיולים נשמרים בדפדפן הזה בלבד.</p>';
  }
  $('#tripsList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = +b.closest('.item').dataset.id;
    const trips = readTrips();
    const t = trips.find((x) => x.id === id);
    if (b.dataset.act === 'del') { if (confirm(`למחוק את "${t.name}"?`)) { writeTrips(trips.filter((x) => x.id !== id)); renderTrips(); } return; }
    $('#tripName').value = t.name; $('#pace').value = t.pace; $('#maxHours').value = t.maxHours;
    if (t.startDate) $('#startDate').value = t.startDate;
    loadRoute(t.waypoints);
  });
  function loadRoute(wps) {
    state.waypoints = wps.map((p) => [+p[0], +p[1]]);
    showView('plan'); syncMarkers(); recalc();
    const b = new maplibregl.LngLatBounds();
    state.waypoints.forEach((p) => b.extend(p));
    // cameraForBounds assumes flat ground; back off a bit so high terrain still fits
    const cam = map.cameraForBounds(b, { padding: 60, maxZoom: 14 });
    if (cam) map.flyTo({ center: cam.center, zoom: cam.zoom - 0.8, pitch: 55, bearing: 0, essential: true });
  }

  // ---------- GPX ----------
  $('#gpxBtn').addEventListener('click', () => {
    if (state.waypoints.length < 2) return;
    const name = $('#tripName').value.trim() || 'TrekAtlas route';
    const blob = new Blob([G.buildGPX(name, state.waypoints, state.profile)], { type: 'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[\\/:*?"<>|]+/g, '_') + '.gpx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#gpxInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const { name, points } = G.parseGPX(await f.text());
    e.target.value = '';
    if (points.length < 2) { alert('לא נמצאו נקודות בקובץ.'); return; }
    if (name) $('#tripName').value = name;
    loadRoute(G.thin(points, 80));
  });

  // ---------- share via URL hash ----------
  function saveHash() {
    if (state.waypoints.length < 2) return;
    const s = state.waypoints.map((p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(';');
    history.replaceState(null, '', `#r=${s}`);
  }
  function loadFromHash() {
    const m = /#r=([-\d.,;]+)/.exec(location.hash);
    if (!m) return;
    const wps = m[1].split(';').map((x) => x.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)).map(([la, lo]) => [lo, la]);
    if (wps.length > 1) loadRoute(wps.slice(0, 200));
  }

  renderCats(); renderPlaces(); renderWpList(); computeStats();
})();
