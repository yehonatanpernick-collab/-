// מטמון לעבודה בשטח גם בלי קליטה (הבינה המלאכותית עצמה דורשת אינטרנט).
const CACHE = 'geophytes-v3';
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/ai.js', 'js/db.js', 'js/settings.js',
  'data/species.js', 'data/genera.js', 'data/regions.js', 'vendor/anthropic-sdk.mjs', 'icon.svg', 'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/anthropic/')) return;
  // רשת קודם (כדי לקבל עדכונים), מטמון כגיבוי.
  e.respondWith(
    fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match(e.request)),
  );
});
