// TrekAtlas app: globe, explore cards, trail-snapped planner, weather, trips.
(function () {
  'use strict';
  const G = window.TrekGeo;
  const $ = (s) => document.querySelector(s);
  const esc = G.escapeHtml;
  const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const DEM_Z = 12;
  const STORE_KEY = 'trekatlas.trips.v1';
  const OSRM = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
  const CAT_COLOR = { peak: '#e0553a', volcano: '#a8458f', canyon: '#d98a2b', park: '#2f9a55', water: '#2b8fd6', desert: '#c9a227', israel: '#3c6fd9' };
  const isPhone = () => matchMedia('(max-width: 760px)').matches;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    mode: 'explore', waypoints: [], markers: [], legs: [], profile: [], stats: null, stages: [],
    calcId: 0, detailId: 0, flying: false,
  };

  // ---------- map ----------
  const map = new maplibregl.Map({
    container: 'map', center: [55, 24], zoom: isPhone() ? 0.9 : 1.7, pitch: 0, maxPitch: 85,
    attributionControl: { compact: true },
    style: {
      version: 8,
      projection: { type: 'globe' },
      sources: {
        sat: { type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
        topo: { type: 'raster', tileSize: 256, maxzoom: 17,
          tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
          attribution: '© OpenStreetMap contributors, SRTM · OpenTopoMap (CC-BY-SA)' },
        dem: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: DEM_Z, tiles: [DEM_URL], attribution: 'Elevation: Mapzen Terrain Tiles' },
        demHs: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: DEM_Z, tiles: [DEM_URL] },
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } },
        { id: 'hillshade', type: 'hillshade', source: 'demHs', minzoom: 5,
          paint: { 'hillshade-exaggeration': 0.3, 'hillshade-shadow-color': '#0b1a12' } },
      ],
      sky: {
        'sky-color': '#5d9fd6', 'horizon-color': '#cfe6f5', 'fog-color': '#d8e8f0', 'sky-horizon-blend': 0.6,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.6, 10, 0],
      },
    },
  });
  window.trekMap = map; // handy for debugging from the console
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  const setTerrain = (on) => map.setTerrain(on ? { source: 'dem', exaggeration: 1.35 } : null);

  // MapLibre can leave the camera's ground elevation frozen after an animated
  // move with terrain, so the camera ends up inside high mountains. Unfreeze
  // after each move so the render loop re-reads the terrain height.
  map.on('moveend', () => {
    if (map.terrain && map._elevationFreeze) { map._elevationFreeze = false; map.triggerRepaint(); }
  });

  map.on('load', () => {
    setTerrain(true);
    document.querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show').forEach((el) => el.classList.remove('maplibregl-compact-show'));
    map.addSource('trails', { type: 'geojson', data: fc() });
    map.addLayer({ id: 'trails', type: 'line', source: 'trails',
      paint: { 'line-color': '#ffcf5a', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 16, 3], 'line-dasharray': [2, 1.3], 'line-opacity': 0.9 } });
    map.addSource('route', { type: 'geojson', data: fc() });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.85 } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', filter: ['!', ['get', 'straight']], layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#d23f2a', 'line-width': 4.5 } });
    map.addLayer({ id: 'route-straight', type: 'line', source: 'route', filter: ['get', 'straight'], layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#d23f2a', 'line-width': 4, 'line-dasharray': [1.2, 1.4] } });
    if (!loadFromHash()) startSpin();
  });

  function fc(features = []) { return { type: 'FeatureCollection', features }; }
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    clearTimeout(toastTimer);
    if (!msg) { t.hidden = true; return; }
    t.textContent = msg; t.hidden = false;
    if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------- slow spin on the globe until the user touches the map ----------
  let spinning = false;
  function startSpin() {
    if (reduceMotion) return;
    spinning = true; spinStep();
  }
  function spinStep() {
    if (!spinning || map.getZoom() > 3.5) return;
    const c = map.getCenter();
    map.easeTo({ center: [c.lng - 6, c.lat], duration: 3000, easing: (t) => t });
  }
  map.on('moveend', () => { if (spinning) spinStep(); });
  function stopSpin() { if (spinning) { spinning = false; map.stop(); } }
  ['mousedown', 'touchstart', 'wheel'].forEach((ev) => map.getCanvasContainer().addEventListener(ev, () => { stopSpin(); stopFly(); }, { passive: true }));

  // ---------- map chrome ----------
  function setPressed(btn, on) { btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function setBase(which) {
    map.setLayoutProperty('sat', 'visibility', which === 'sat' ? 'visible' : 'none');
    map.setLayoutProperty('topo', 'visibility', which === 'topo' ? 'visible' : 'none');
    setPressed($('#bSat'), which === 'sat'); setPressed($('#bTopo'), which === 'topo');
  }
  $('#bSat').onclick = () => setBase('sat');
  $('#bTopo').onclick = () => setBase('topo');
  $('#b3d').onclick = () => {
    const on = $('#b3d').getAttribute('aria-pressed') !== 'true';
    setPressed($('#b3d'), on); setTerrain(on);
    if (map.getZoom() > 5) map.easeTo({ pitch: on ? 60 : 0 });
  };
  $('#bGlobe').onclick = () => {
    stopFly();
    map.flyTo({ center: [map.getCenter().lng, 20], zoom: isPhone() ? 0.9 : 1.7, pitch: 0, bearing: 0, duration: 2500 });
    map.once('moveend', startSpin);
  };

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

  // ---------- panel / tabs / bottom sheet ----------
  const panel = $('#panel');
  if (!isPhone()) panel.classList.remove('collapsed');
  $('#sheetHandle').onclick = () => panel.classList.toggle('collapsed');
  const expandSheet = () => panel.classList.remove('collapsed');
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { showView(b.dataset.view); expandSheet(); }));
  function showView(v) {
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === `view-${v}`));
    state.mode = v === 'plan' ? 'plan' : 'explore';
    map.getCanvas().style.cursor = state.mode === 'plan' ? 'crosshair' : '';
    if (v === 'trips') renderTrips();
  }

  // ---------- weather helpers ----------
  const WX = (c) => c === 0 ? ['☀️', 'בהיר'] : c <= 2 ? ['⛅', 'מעונן חלקית'] : c === 3 ? ['☁️', 'מעונן'] : c <= 48 ? ['🌫️', 'ערפל']
    : c <= 57 ? ['🌦️', 'טפטוף'] : c <= 67 ? ['🌧️', 'גשם'] : c <= 77 ? ['❄️', 'שלג'] : c <= 82 ? ['🌦️', 'ממטרים'] : c <= 86 ? ['🌨️', 'שלג'] : ['⛈️', 'סופת רעמים'];
  const wxCache = new Map();
  function fetchJson(url) {
    if (!wxCache.has(url)) wxCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).catch((e) => { wxCache.delete(url); throw e; }));
    return wxCache.get(url);
  }

  // ---------- Wikipedia ----------
  async function wikiInfo(lang, title) {
    if (lang !== 'he') {
      const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=langlinks|pageimages|extracts&lllang=he&pithumbsize=800&exintro=1&explaintext=1&exsentences=4&titles=${encodeURIComponent(title)}`;
      const j = await fetchJson(u);
      const pg = Object.values((j.query && j.query.pages) || {})[0];
      if (!pg || 'missing' in pg) return null;
      const img = pg.thumbnail && pg.thumbnail.source;
      const he = pg.langlinks && pg.langlinks[0] && pg.langlinks[0]['*'];
      if (he) {
        const h = await wikiInfo('he', he).catch(() => null);
        if (h && h.extract) return { ...h, img: img || h.img };
      }
      return { title: pg.title, extract: pg.extract, img, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pg.title.replace(/ /g, '_'))}` };
    }
    const s = await fetchJson(`https://he.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (!s || s.type === 'disambiguation') return null;
    return { title: s.title, extract: s.extract, img: s.thumbnail && s.thumbnail.source, url: s.content_urls && s.content_urls.desktop.page, coords: s.coordinates };
  }
  async function wikiNearby(lon, lat) {
    const u = `https://he.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=geosearch&gsradius=10000&gslimit=8&gscoord=${lat.toFixed(5)}|${lon.toFixed(5)}`;
    const j = await fetchJson(u);
    return (j.query && j.query.geosearch) || [];
  }

  // ---------- explore: pins & list ----------
  let activeCat = 'all';
  const placePins = [];
  function renderCats() {
    $('#cats').innerHTML = Object.entries(window.TREK_CATS).map(([k, c]) =>
      `<button class="chip ${k === activeCat ? 'on' : ''}" data-cat="${k}">${k === 'all' ? '' : `<i style="background:${CAT_COLOR[k]}"></i>`}${c.he}</button>`).join('');
  }
  $('#cats').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    activeCat = c.dataset.cat; renderCats(); renderPlaces();
  });
  function visiblePlaces() { return window.TREK_PLACES.filter((p) => activeCat === 'all' || p.cat === activeCat); }
  function renderPlaces() {
    const list = visiblePlaces();
    $('#placeCount').textContent = list.length;
    $('#places').innerHTML = list.map((p) => {
      const i = window.TREK_PLACES.indexOf(p);
      return `<button class="place" data-i="${i}"><i style="background:${CAT_COLOR[p.cat]}"></i><span><b>${esc(p.he)}</b><small>${esc(p.country)}</small></span><span class="ele">${p.ele ? `${p.ele.toLocaleString('en-US')} מ׳` : ''}</span></button>`;
    }).join('');
    placePins.forEach((m) => m.remove());
    placePins.length = 0;
    list.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'pin';
      el.style.background = CAT_COLOR[p.cat];
      el.innerHTML = `<span>${esc(p.he)}</span>`;
      el.dataset.i = window.TREK_PLACES.indexOf(p);
      el.addEventListener('click', (ev) => { ev.stopPropagation(); goToPlace(p); });
      // fully hide pins on the far side of the globe or behind a ridge
      placePins.push(new maplibregl.Marker({ element: el, opacityWhenCovered: 0 }).setLngLat([p.lon, p.lat]).addTo(map));
    });
  }
  map.on('zoom', () => map.getContainer().classList.toggle('labels', map.getZoom() >= 3.6));
  $('#places').addEventListener('click', (e) => {
    const it = e.target.closest('.place');
    if (it) goToPlace(window.TREK_PLACES[+it.dataset.i]);
  });
  $('#surprise').onclick = () => {
    const list = visiblePlaces();
    goToPlace(list[Math.floor(Math.random() * list.length)]);
  };

  function flyTo(lon, lat, zoom = 12.3) {
    stopSpin(); stopFly();
    // never pass duration: undefined: MapLibre checks `'duration' in options` and gets NaN
    const opts = { center: [lon, lat], zoom, pitch: 62, bearing: Math.round(Math.random() * 90 - 45), maxDuration: 7000, essential: true };
    if (reduceMotion) opts.duration = 0;
    map.flyTo(opts);
  }
  function goToPlace(p) {
    showView('explore'); expandSheet();
    document.querySelectorAll('.pin.sel').forEach((el) => el.classList.remove('sel'));
    const pin = placePins.find((m) => +m.getElement().dataset.i === window.TREK_PLACES.indexOf(p));
    if (pin) pin.getElement().classList.add('sel');
    flyTo(p.lon, p.lat, ['park', 'canyon', 'desert', 'water'].includes(p.cat) ? 12 : 12.4);
    openDetail({ title: p.he, sub: `${p.en} · ${p.country}`, lon: p.lon, lat: p.lat, ele: p.ele, note: p.note, wiki: { lang: 'en', title: (window.TREK_WIKI || {})[p.en] || p.en } });
  }

  // ---------- detail card ----------
  async function openDetail(d) {
    const id = ++state.detailId;
    const box = $('#detail');
    box.innerHTML = `<article class="card">
      <div class="hero"><img id="dImg" alt="" hidden><div class="shade"></div>
        <button class="close" id="dClose" aria-label="סגור">✕</button>
        <div class="t"><h2>${esc(d.title)}</h2><div class="sub">${esc(d.sub || '')}</div></div></div>
      <div class="body">
        <div class="facts">
          <span class="fact">גובה <b id="dEle">…</b></span>
          <span class="fact" id="dWx">מזג אוויר <b>…</b></span>
          <span class="fact"><b>${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}</b></span>
        </div>
        ${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}
        <div id="dText"><div class="skeleton"></div><div class="skeleton" style="width:80%;margin-top:6px"></div><div class="skeleton" style="width:60%;margin-top:6px"></div></div>
        <div class="row"><button class="btn primary" id="dPlan">🥾 תכננו מסלול מכאן</button><a class="btn" id="dWiki" target="_blank" rel="noopener" hidden>ויקיפדיה ↗</a></div>
        <div><p class="label">בסביבה</p><div class="nearby" id="dNear"><div class="skeleton"></div></div></div>
      </div></article>`;
    box.scrollIntoView({ block: 'nearest' });
    $('#dClose').onclick = () => { box.innerHTML = ''; state.detailId++; };
    $('#dPlan').onclick = () => {
      showView('plan');
      if (!state.waypoints.length) addWaypoint([d.lon, d.lat]);
      toast('נקודת התחלה נוספה. לחצו על המפה כדי להמשיך את המסלול', 3500);
      if (isPhone()) panel.classList.add('collapsed');
    };
    const live = () => id === state.detailId;

    (d.ele ? Promise.resolve(d.ele) : elevationAt(d.lon, d.lat)).then((e) => {
      if (live()) $('#dEle').textContent = Number.isFinite(e) ? `${Math.round(e).toLocaleString('en-US')} מ׳` : '—';
      return e;
    }).then((e) => fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${d.lat.toFixed(3)}&longitude=${d.lon.toFixed(3)}${Number.isFinite(e) ? `&elevation=${Math.round(e)}` : ''}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`))
      .then((w) => {
        if (!live() || !w.current) return;
        const [ic, label] = WX(w.current.weather_code);
        $('#dWx').innerHTML = `${ic} ${label} <b>${Math.round(w.current.temperature_2m)}°</b> · רוח <b>${Math.round(w.current.wind_speed_10m)}</b> קמ״ש`;
      }).catch(() => { if (live()) $('#dWx').innerHTML = 'מזג אוויר <b>לא זמין</b>'; });

    const wikiP = d.wiki ? wikiInfo(d.wiki.lang, d.wiki.title).catch(() => null) : Promise.resolve(null);
    wikiP.then((w) => {
      if (!live()) return;
      const text = $('#dText');
      if (w && w.extract) {
        text.innerHTML = `<p class="extract" id="dExtract">${esc(w.extract)}</p>`;
        const ex = $('#dExtract');
        ex.onclick = () => ex.classList.toggle('open');
      } else text.innerHTML = d.wiki ? '<p class="note">לא נמצא תיאור בוויקיפדיה.</p>' : '';
      if (w && w.url) { const a = $('#dWiki'); a.href = w.url; a.hidden = false; }
      if (w && w.img) { const im = $('#dImg'); im.onload = () => { im.hidden = false; }; im.src = w.img; }
    });

    wikiNearby(d.lon, d.lat).then((list) => {
      if (!live()) return;
      const near = $('#dNear');
      const items = list.filter((x) => x.title !== d.title).slice(0, 6);
      if (!items.length) { near.innerHTML = '<p class="note">אין ערכים בוויקיפדיה העברית ברדיוס 10 ק״מ.</p>'; return; }
      near.innerHTML = items.map((x, i) => `<button data-i="${i}"><span>${esc(x.title)}</span><span>${G.formatDistance(x.dist)}</span></button>`).join('');
      near.onclick = (e) => {
        const b = e.target.closest('button[data-i]');
        if (!b) return;
        const x = items[+b.dataset.i];
        flyTo(x.lon, x.lat, 13);
        openDetail({ title: x.title, sub: 'מוויקיפדיה', lon: x.lon, lat: x.lat, wiki: { lang: 'he', title: x.title } });
      };
    }).catch(() => { if (live()) $('#dNear').innerHTML = '<p class="note">לא ניתן לטעון מקומות בסביבה.</p>'; });
  }

  // ---------- search (Nominatim: only on submit, per its usage policy) ----------
  $('#searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    const box = $('#searchResults');
    if (!q) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div class="skeleton"></div>';
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&extratags=1&accept-language=he,en&q=${encodeURIComponent(q)}`);
      const data = await r.json();
      if (!data.length) { box.innerHTML = '<p class="empty">לא נמצאו תוצאות. נסו שם באנגלית.</p>'; return; }
      box.innerHTML = data.map((d, i) => `<button class="place" data-i="${i}"><i style="background:var(--muted)"></i><span><b>${esc(d.name || d.display_name.split(',')[0])}</b><small>${esc(d.display_name)}</small></span><span class="ele">${d.extratags && d.extratags.ele ? `${esc(d.extratags.ele)} מ׳` : ''}</span></button>`).join('');
      box.onclick = (ev) => {
        const it = ev.target.closest('.place');
        if (!it) return;
        const d = data[+it.dataset.i];
        const lon = +d.lon, lat = +d.lat;
        const bb = d.boundingbox && d.boundingbox.map(Number);
        stopSpin();
        if (bb && (bb[1] - bb[0]) > 0.02) map.fitBounds([[bb[2], bb[0]], [bb[3], bb[1]]], { maxZoom: 13, pitch: 60, padding: 40 });
        else flyTo(lon, lat, 13);
        const wtag = d.extratags && d.extratags.wikipedia; // e.g. "en:Mount Everest"
        const m = wtag && /^([a-z-]+):(.+)$/.exec(wtag);
        box.hidden = true;
        openDetail({ title: d.name || d.display_name.split(',')[0], sub: d.display_name.split(',').slice(1, 3).join(','), lon, lat,
          ele: d.extratags && parseFloat(d.extratags.ele), wiki: m ? { lang: m[1], title: m[2] } : null });
      };
    } catch (err) {
      box.innerHTML = '<p class="empty">החיפוש נכשל. בדקו את החיבור לאינטרנט ונסו שוב.</p>';
    }
  });

  // ---------- map click ----------
  map.on('click', (e) => {
    const ll = [e.lngLat.lng, e.lngLat.lat];
    if (state.mode === 'plan') addWaypoint(ll);
    else if (map.getZoom() > 4) {
      expandSheet();
      openDetail({ title: 'נקודה במפה', sub: '', lon: ll[0], lat: ll[1] });
    }
  });

  // ---------- planner ----------
  function addWaypoint(ll) {
    state.waypoints.push(ll);
    syncMarkers(); recalc();
  }
  function syncMarkers() {
    state.markers.forEach((m) => m.remove());
    const n = state.waypoints.length;
    state.markers = state.waypoints.map((ll, i) => {
      const el = document.createElement('div');
      el.className = 'wp' + (i === 0 ? ' start' : i === n - 1 && n > 1 ? ' end' : '');
      el.textContent = i + 1;
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(ll).addTo(map);
      el.addEventListener('click', (ev) => ev.stopPropagation());
      m.on('dragend', () => { const p = m.getLngLat(); state.waypoints[i] = [p.lng, p.lat]; recalc(); });
      return m;
    });
    $('#wpCount').hidden = !n; $('#wpCount').textContent = n;
    $('#planSteps').hidden = n >= 2; $('#planBody').hidden = n < 2; $('#importEmpty').hidden = n >= 2;
    $('#wpList').innerHTML = state.waypoints.map((p, i) => `<div><span>${i + 1}</span><code>${p[1].toFixed(5)}, ${p[0].toFixed(5)}</code><button class="btn ghost small" data-i="${i}" aria-label="מחק נקודה ${i + 1}">✕</button></div>`).join('');
  }
  $('#wpList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    state.waypoints.splice(+b.dataset.i, 1); syncMarkers(); recalc();
  });
  $('#undoBtn').onclick = () => { state.waypoints.pop(); syncMarkers(); recalc(); };
  $('#clearBtn').onclick = () => {
    if (state.waypoints.length > 2 && !confirm('לנקות את כל המסלול?')) return;
    state.waypoints = []; syncMarkers(); recalc(); history.replaceState(null, '', location.pathname);
  };
  $('#reverseBtn').onclick = () => { state.waypoints.reverse(); syncMarkers(); recalc(); };
  $('#loopBtn').onclick = () => { if (state.waypoints.length > 1) { state.waypoints.push(state.waypoints[0].slice()); syncMarkers(); recalc(); } };
  $('#snap').onchange = () => recalc();
  ['#pace', '#maxHours'].forEach((s) => $(s).addEventListener('change', () => { computeStats(); loadDayWeather(); }));
  $('#startDate').addEventListener('change', () => { renderDays(); loadDayWeather(); });

  const legCache = new Map();
  function routeLeg(a, b) {
    if (!$('#snap').checked) return Promise.resolve({ coords: [a, b], straight: true });
    const key = `${a[0].toFixed(5)},${a[1].toFixed(5)};${b[0].toFixed(5)},${b[1].toFixed(5)}`;
    if (!legCache.has(key)) {
      legCache.set(key, fetch(`${OSRM}${a[0].toFixed(6)},${a[1].toFixed(6)};${b[0].toFixed(6)},${b[1].toFixed(6)}?overview=full&geometries=geojson`)
        .then((r) => r.json())
        .then((j) => {
          let c = G.parseOsrm(j);
          if (!c) return { coords: [a, b], straight: true };
          // waypoints off the path network: walk the last metres in a straight line
          if (G.haversine(a, c[0]) > 25) c = [a, ...c];
          if (G.haversine(c[c.length - 1], b) > 25) c = [...c, b];
          return { coords: c, straight: false };
        })
        .catch(() => { legCache.delete(key); return { coords: [a, b], straight: true, failed: true }; }));
    }
    return legCache.get(key);
  }

  function setRouteData(legs) {
    const src = map.getSource('route');
    if (src) src.setData(fc(legs.map((l) => ({ type: 'Feature', properties: { straight: !!l.straight }, geometry: { type: 'LineString', coordinates: l.coords } }))));
  }

  async function recalc() {
    const id = ++state.calcId;
    const wps = state.waypoints.slice();
    stopFly();
    if (wps.length < 2) { state.legs = []; state.profile = []; setRouteData([]); computeStats(); return; }
    // draw straight preview at once, then the snapped route when it arrives
    setRouteData(wps.slice(1).map((b, i) => ({ coords: [wps[i], b], straight: true })));
    toast('מחשב מסלול וגבהים…', 0);
    const legs = await Promise.all(wps.slice(1).map((b, i) => routeLeg(wps[i], b)));
    if (id !== state.calcId) return;
    state.legs = legs;
    setRouteData(legs);
    const line = G.mergeLegs(legs.map((l) => l.coords));
    const samples = G.resample(line, 30, 800);
    const eles = await Promise.all(samples.map((s) => elevationAt(s.lon, s.lat)));
    if (id !== state.calcId) return;
    let last = eles.find(Number.isFinite) ?? 0;
    state.profile = samples.map((s, i) => { if (Number.isFinite(eles[i])) last = eles[i]; return { ...s, ele: last }; });
    const straightN = legs.filter((l) => l.straight).length;
    const failed = legs.some((l) => l.failed);
    const note = $('#routeNote');
    note.hidden = !$('#snap').checked || !straightN;
    note.textContent = failed ? 'שירות השבילים לא זמין כרגע. הקטעים המקווקווים בקו ישר' : `${straightN} קטעים בלי שביל ידוע, בקו ישר (מקווקו)`;
    toast(eles.some((e) => !Number.isFinite(e)) ? 'חלק מנתוני הגובה לא נטענו' : '');
    computeStats();
    loadDayWeather();
    saveHash();
  }

  function computeStats() {
    const prof = state.profile;
    state.stats = G.routeStats(prof, { pace: +$('#pace').value });
    const st = state.stats;
    const maxH = Math.min(14, Math.max(1, +$('#maxHours').value || 6));
    state.stages = prof.length > 1 ? G.splitStages(prof, st.cumTime, maxH) : [];
    if (prof.length > 1) {
      const df = G.difficulty(st, state.stages, st.maxEle);
      $('#diff').className = `pill lv${df.level}`;
      const mg = G.maxGrade(prof);
      $('#diff').textContent = `${df.label} · שיפוע עד ${Math.min(100, Math.round(mg))}%${mg > 100 ? '+' : ''}`;
      const km = st.distance / 1000;
      const n = (v, u, l) => `<div><b>${v}<span>${u}</span></b><small>${l}</small></div>`;
      $('#big').innerHTML = [
        n(km >= 10 ? km.toFixed(1) : km.toFixed(2), 'ק״מ', 'מרחק'),
        n(G.formatDuration(st.timeH), 'ש׳', 'זמן הליכה'),
        n(state.stages.length, state.stages.length === 1 ? 'יום' : 'ימים', `עד ${maxH} ש׳ ביום`),
        n(`↑${Math.round(st.ascent).toLocaleString('en-US')}`, 'מ׳', 'עלייה מצטברת'),
        n(`↓${Math.round(st.descent).toLocaleString('en-US')}`, 'מ׳', 'ירידה מצטברת'),
        n(Math.round(st.maxEle).toLocaleString('en-US'), 'מ׳', 'נקודה גבוהה'),
      ].join('');
    }
    drawProfile();
    renderDays();
  }

  // ---------- days + weather ----------
  let dayWeather = [];
  function dayDate(i) {
    const v = $('#startDate').value;
    if (!v) return null;
    const d = new Date(v + 'T12:00');
    d.setDate(d.getDate() + i);
    return d;
  }
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function renderDays() {
    const el = $('#days');
    if (!state.stages.length) { el.innerHTML = ''; return; }
    el.innerHTML = state.stages.map((s, i) => {
      const date = dayDate(i);
      const w = dayWeather[i];
      let wx = '<small>—</small>', light = '';
      if (w && w.ok) {
        const [ic, label] = WX(w.code);
        wx = `${ic} <b>${w.tmin}°–${w.tmax}°</b><small>${label} · ${w.rain} מ״מ · רוח ${w.wind}</small>`;
        light = ` · 🌅 ${w.sunrise} 🌇 ${w.sunset}`;
        if (s.timeH * 1.25 > w.daylightH - 0.5) light += ' <span class="warn">· ארוך מאור היום</span>';
      } else if (w && w.far) wx = '<small>תחזית זמינה<br>16 יום מראש</small>';
      return `<div class="day"><div class="n">${i + 1}<small>${date ? date.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' }) : 'יום'}</small></div>
        <div class="m">${G.formatDistance(s.distance)} · ${G.formatDuration(s.timeH)} ש׳<br><span style="color:var(--muted)">↑${Math.round(s.ascent)} ↓${Math.round(s.descent)} מ׳${light}</span></div>
        <div class="w">${wx}</div></div>`;
    }).join('');
  }
  let wxTimer;
  function loadDayWeather() {
    clearTimeout(wxTimer);
    dayWeather = [];
    renderDays();
    wxTimer = setTimeout(async () => {
      const today = new Date(); today.setHours(12, 0, 0, 0);
      const stages = state.stages, prof = state.profile, calc = state.calcId;
      const res = await Promise.all(stages.map(async (s, i) => {
        const date = dayDate(i);
        if (!date) return null;
        const ahead = Math.round((date - today) / 864e5);
        if (ahead < 0 || ahead > 15) return { far: true };
        const p = prof[s.endIdx]; // where you finish / sleep that day
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}&elevation=${Math.round(p.ele)}` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunrise,sunset&timezone=auto&start_date=${ymd(date)}&end_date=${ymd(date)}`;
        try {
          const d = (await fetchJson(url)).daily;
          const hm = (t) => t.slice(11, 16);
          const toH = (t) => +t.slice(11, 13) + +t.slice(14, 16) / 60;
          return { ok: true, code: d.weather_code[0], tmax: Math.round(d.temperature_2m_max[0]), tmin: Math.round(d.temperature_2m_min[0]),
            rain: d.precipitation_sum[0], wind: Math.round(d.wind_speed_10m_max[0]), sunrise: hm(d.sunrise[0]), sunset: hm(d.sunset[0]),
            daylightH: toH(d.sunset[0]) - toH(d.sunrise[0]) };
        } catch { return null; }
      }));
      if (calc !== state.calcId) return;
      dayWeather = res;
      renderDays();
    }, 400);
  }

  // ---------- elevation profile (coloured by grade) ----------
  const canvas = $('#profile');
  let hoverMarker = null;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function profGeom() {
    const w = canvas.clientWidth, h = canvas.clientHeight, st = state.stats;
    const pad = { l: 6, r: 38, t: 16, b: 18 };
    const lo = st.minEle - (st.maxEle - st.minEle) * 0.08 - 5, hi = st.maxEle + (st.maxEle - st.minEle) * 0.08 + 5;
    return { w, h, pad,
      X: (d) => w - pad.r - (d / st.distance) * (w - pad.l - pad.r), // RTL: start on the right
      Y: (e) => pad.t + (1 - (e - lo) / (hi - lo)) * (h - pad.t - pad.b) };
  }
  function drawProfile(hoverIdx) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const prof = state.profile;
    if (prof.length < 2) return;
    const { pad, X, Y } = profGeom();
    const st = state.stats;
    const ink = css('--muted'), line = css('--line');
    // grid
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    [st.minEle, (st.minEle + st.maxEle) / 2, st.maxEle].forEach((e) => { ctx.beginPath(); ctx.moveTo(pad.l, Y(e)); ctx.lineTo(w - pad.r, Y(e)); ctx.stroke(); });
    // area
    const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    grad.addColorStop(0, 'rgba(150,102,59,.35)'); grad.addColorStop(1, 'rgba(150,102,59,.03)');
    ctx.beginPath(); ctx.moveTo(X(0), h - pad.b);
    prof.forEach((p) => ctx.lineTo(X(p.d), Y(p.ele)));
    ctx.lineTo(X(st.distance), h - pad.b); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    // line coloured by local grade (over ±3 samples)
    const colors = [css('--g0'), css('--g1'), css('--g2'), css('--g3')];
    ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    for (let i = 1; i < prof.length; i++) {
      const a = prof[Math.max(0, i - 3)], b = prof[Math.min(prof.length - 1, i + 2)];
      const g = b.d > a.d ? ((b.ele - a.ele) / (b.d - a.d)) * 100 : 0;
      ctx.strokeStyle = colors[G.gradeClass(g)];
      ctx.beginPath(); ctx.moveTo(X(prof[i - 1].d), Y(prof[i - 1].ele)); ctx.lineTo(X(prof[i].d), Y(prof[i].ele)); ctx.stroke();
    }
    // day boundaries
    ctx.setLineDash([3, 3]); ctx.strokeStyle = ink; ctx.lineWidth = 1;
    ctx.font = '600 10px Assistant, sans-serif'; ctx.fillStyle = ink; ctx.textAlign = 'center';
    state.stages.forEach((s, i) => {
      const x0 = X(prof[s.startIdx].d), x1 = X(prof[s.endIdx].d);
      if (state.stages.length > 1) ctx.fillText(`יום ${i + 1}`, (x0 + x1) / 2, 10);
      if (i < state.stages.length - 1) { ctx.beginPath(); ctx.moveTo(x1, pad.t); ctx.lineTo(x1, h - pad.b); ctx.stroke(); }
    });
    ctx.setLineDash([]);
    ctx.font = '500 10px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(Math.round(st.maxEle), w - pad.r + 4, Y(st.maxEle) + 3);
    ctx.fillText(Math.round(st.minEle), w - pad.r + 4, Y(st.minEle) + 3);
    ctx.textAlign = 'right'; ctx.fillText('0', X(0), h - 4);
    ctx.textAlign = 'left'; ctx.fillText(G.formatDistance(st.distance), pad.l, h - 4);
    if (hoverIdx != null) {
      const p = prof[hoverIdx];
      ctx.strokeStyle = css('--ink'); ctx.beginPath(); ctx.moveTo(X(p.d), pad.t); ctx.lineTo(X(p.d), h - pad.b); ctx.stroke();
      ctx.beginPath(); ctx.arc(X(p.d), Y(p.ele), 4.5, 0, 7); ctx.fillStyle = css('--trail'); ctx.fill();
      ctx.fillStyle = css('--ink'); ctx.font = '600 11px Assistant, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${G.formatDistance(p.d)} · ${Math.round(p.ele)} מ׳`, Math.min(w - 70, Math.max(70, X(p.d))), h - 4);
    }
  }
  function idxAtDistance(target) {
    const prof = state.profile;
    let lo = 0, hi = prof.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (prof[m].d < target) lo = m + 1; else hi = m; }
    return lo;
  }
  function showHover(idx) {
    const p = state.profile[idx];
    if (!hoverMarker) { const el = document.createElement('div'); el.className = 'hover-dot'; hoverMarker = new maplibregl.Marker({ element: el }); }
    hoverMarker.setLngLat([p.lon, p.lat]).addTo(map);
  }
  canvas.addEventListener('pointermove', (e) => {
    if (state.profile.length < 2 || state.flying) return;
    const r = canvas.getBoundingClientRect();
    const { pad } = profGeom();
    const frac = Math.min(1, Math.max(0, (r.width - pad.r - (e.clientX - r.left)) / (r.width - pad.l - pad.r)));
    const idx = idxAtDistance(frac * state.stats.distance);
    drawProfile(idx); showHover(idx);
  });
  canvas.addEventListener('pointerleave', () => { if (state.flying) return; drawProfile(); if (hoverMarker) hoverMarker.remove(); });
  new ResizeObserver(() => drawProfile()).observe(canvas);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawProfile());

  // ---------- fly-over ----------
  let flyRaf = 0;
  $('#flyBtn').onclick = () => (state.flying ? stopFly() : flyover());
  $('#flyStop').onclick = () => stopFly();
  function pointAt(d) {
    const prof = state.profile;
    const i = idxAtDistance(d);
    if (i === 0) return [prof[0].lon, prof[0].lat];
    const a = prof[i - 1], b = prof[i];
    const t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
    return [a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t];
  }
  function flyover() {
    const prof = state.profile;
    if (prof.length < 2) return;
    stopSpin();
    const total = prof[prof.length - 1].d;
    const dur = Math.min(70000, Math.max(16000, (total / 1000) * 2600));
    const zoom = total > 25000 ? 12.6 : total > 8000 ? 13.3 : 14;
    const look = Math.max(250, total * 0.04);
    let t0 = null, brg = G.bearing(pointAt(0), pointAt(look));
    state.flying = true;
    $('#flyBtn').textContent = '■ עצור טיסה';
    $('#flyStop').hidden = false;
    if (isPhone()) panel.classList.add('collapsed');
    map.easeTo({ center: pointAt(0), zoom, pitch: 64, bearing: brg, duration: 1500 });
    map.once('moveend', () => {
      if (!state.flying) return;
      const frame = (ts) => {
        if (!state.flying) return;
        if (t0 == null) t0 = ts;
        const k = Math.min(1, (ts - t0) / dur);
        const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const d = eased * total;
        const p = pointAt(d);
        const target = G.bearing(p, pointAt(Math.min(total, d + look)));
        let diff = ((target - brg + 540) % 360) - 180;
        brg = (brg + diff * 0.035 + 360) % 360;
        map.jumpTo({ center: p, bearing: brg });
        const idx = idxAtDistance(d);
        showHover(idx); drawProfile(idx);
        if (k < 1) flyRaf = requestAnimationFrame(frame);
        else stopFly();
      };
      flyRaf = requestAnimationFrame(frame);
    });
  }
  function stopFly() {
    if (!state.flying) return;
    state.flying = false;
    cancelAnimationFrame(flyRaf);
    $('#flyBtn').textContent = '▶ טיסה מעל המסלול';
    $('#flyStop').hidden = true;
    drawProfile();
  }

  // ---------- trails & peaks from OpenStreetMap (Overpass) ----------
  let overpassCtl = null, overpassTimer = null;
  const peakMarkers = [];
  $('#bTrails').onclick = () => {
    const on = $('#bTrails').getAttribute('aria-pressed') !== 'true';
    setPressed($('#bTrails'), on);
    if (on) { if (map.getZoom() < 12) toast('התקרבו לזום 12 ומעלה כדי לראות שבילים ופסגות', 3500); loadOsm(); }
    else { map.getSource('trails').setData(fc()); peakMarkers.forEach((m) => m.remove()); peakMarkers.length = 0; }
  };
  map.on('moveend', () => { clearTimeout(overpassTimer); overpassTimer = setTimeout(loadOsm, 800); });
  async function loadOsm() {
    if ($('#bTrails').getAttribute('aria-pressed') !== 'true' || map.getZoom() < 12 || state.flying) return;
    const b = map.getBounds();
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => v.toFixed(4)).join(',');
    const q = `[out:json][timeout:25];way["highway"~"^(path|footway|track|bridleway|steps)$"](${bbox});out geom 4000;node["natural"~"^(peak|volcano)$"]["name"](${bbox});out 80;`;
    if (overpassCtl) overpassCtl.abort();
    overpassCtl = new AbortController();
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
          div.className = 'osm-peak';
          div.textContent = `${t['name:he'] || t.name}${t.ele ? ` ${parseInt(t.ele, 10)}` : ''}`;
          peakMarkers.push(new maplibregl.Marker({ element: div, anchor: 'bottom' }).setLngLat([el.lon, el.lat]).addTo(map));
        }
      }
      map.getSource('trails').setData(fc(features));
    } catch (e) {
      if (e.name !== 'AbortError') toast('שרת השבילים עמוס. נסו שוב בעוד רגע');
    }
  }

  // ---------- saved trips (this browser only) ----------
  function readTrips() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } }
  function writeTrips(t) { try { localStorage.setItem(STORE_KEY, JSON.stringify(t)); return true; } catch { return false; } }
  $('#saveBtn').onclick = () => {
    if (state.waypoints.length < 2) return;
    const name = $('#tripName').value.trim() || `טיול ${new Date().toLocaleDateString('he-IL')}`;
    const st = state.stats;
    const df = G.difficulty(st, state.stages, st.maxEle);
    const trips = readTrips().filter((t) => t.name !== name);
    trips.unshift({ id: Date.now(), name, waypoints: state.waypoints, snap: $('#snap').checked, pace: $('#pace').value, maxHours: $('#maxHours').value,
      startDate: $('#startDate').value, summary: { d: st.distance, up: st.ascent, t: st.timeH, days: state.stages.length, top: st.maxEle, level: df.level, label: df.label } });
    if (writeTrips(trips)) { $('#tripName').value = name; toast(`"${name}" נשמר בהטיולים שלי`); }
    else toast('הדפדפן חוסם שמירה מקומית (מצב פרטי?). ייצאו GPX במקום', 4000);
  };
  function renderTrips() {
    const trips = readTrips();
    $('#tripsList').innerHTML = trips.length ? trips.map((t) => {
      const s = t.summary || {};
      return `<article class="trip" data-id="${t.id}"><div class="row" style="justify-content:space-between"><h3>${esc(t.name)}</h3>${s.label ? `<span class="pill lv${s.level}">${s.label}</span>` : ''}</div>
        <div class="facts"><span class="fact"><b>${G.formatDistance(s.d || 0)}</b></span><span class="fact">↑<b>${Math.round(s.up || 0)}</b> מ׳</span>
        <span class="fact"><b>${G.formatDuration(s.t || 0)}</b> ש׳</span><span class="fact"><b>${s.days || 1}</b> ימים</span>${s.top ? `<span class="fact">שיא <b>${Math.round(s.top)}</b> מ׳</span>` : ''}</div>
        <div class="row"><button class="btn small primary" data-act="open">פתח במפה</button><button class="btn small ghost" data-act="del">מחק</button></div></article>`;
    }).join('') : `<div class="empty"><p>עוד אין טיולים שמורים.</p><p>תכננו מסלול בלשונית "תכנן" ולחצו "שמור". הטיולים נשמרים בדפדפן הזה בלבד. לגיבוי אפשר לייצא GPX.</p></div>`;
  }
  $('#tripsList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = +b.closest('.trip').dataset.id;
    const trips = readTrips();
    const t = trips.find((x) => x.id === id);
    if (b.dataset.act === 'del') { if (confirm(`למחוק את "${t.name}"?`)) { writeTrips(trips.filter((x) => x.id !== id)); renderTrips(); } return; }
    $('#tripName').value = t.name; $('#pace').value = t.pace; $('#maxHours').value = t.maxHours;
    $('#snap').checked = t.snap !== false;
    if (t.startDate) $('#startDate').value = t.startDate;
    loadRoute(t.waypoints);
  });
  function loadRoute(wps) {
    stopSpin();
    state.waypoints = wps.map((p) => [+p[0], +p[1]]);
    showView('plan'); expandSheet(); syncMarkers(); recalc();
    const b = new maplibregl.LngLatBounds();
    state.waypoints.forEach((p) => b.extend(p));
    // cameraForBounds assumes flat ground; back off a bit so high terrain still fits
    const cam = map.cameraForBounds(b, { padding: isPhone() ? 40 : { top: 60, bottom: 60, left: 60, right: 460 }, maxZoom: 14 });
    if (cam) map.flyTo({ center: cam.center, zoom: cam.zoom - 0.7, pitch: 55, bearing: 0, essential: true, maxDuration: 6000 });
  }

  // ---------- GPX & share ----------
  $('#gpxBtn').onclick = () => {
    if (state.waypoints.length < 2) return;
    const name = $('#tripName').value.trim() || 'TrekAtlas route';
    const blob = new Blob([G.buildGPX(name, state.waypoints, state.profile)], { type: 'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[\\/:*?"<>|]+/g, '_') + '.gpx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  async function importGpx(e) {
    const f = e.target.files[0];
    if (!f) return;
    const { name, points } = G.parseGPX(await f.text());
    e.target.value = '';
    if (points.length < 2) { toast('לא נמצאו נקודות בקובץ'); return; }
    if (name) $('#tripName').value = name;
    $('#snap').checked = false; // an imported track already follows the trail
    loadRoute(G.thin(points, 120));
  }
  $('#gpxInput').onchange = importGpx;
  $('#gpxInput2').onchange = importGpx;
  $('#shareBtn').onclick = async () => {
    saveHash();
    try { await navigator.clipboard.writeText(location.href); toast('הקישור הועתק'); }
    catch { toast('העתיקו את הכתובת משורת הכתובת של הדפדפן', 3500); }
  };
  function saveHash() {
    if (state.waypoints.length < 2) return;
    const s = state.waypoints.map((p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(';');
    history.replaceState(null, '', `#r=${s}${$('#snap').checked ? '' : '&s=0'}`);
  }
  function loadFromHash() {
    const m = /#r=([-\d.,;]+)/.exec(location.hash);
    if (!m) return false;
    const wps = m[1].split(';').map((x) => x.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)).map(([la, lo]) => [lo, la]);
    if (wps.length < 2) return false;
    if (/&s=0/.test(location.hash)) $('#snap').checked = false;
    loadRoute(wps.slice(0, 200));
    return true;
  }

  // ---------- init ----------
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  $('#startDate').value = ymd(tomorrow);
  renderCats(); renderPlaces(); syncMarkers();
})();
