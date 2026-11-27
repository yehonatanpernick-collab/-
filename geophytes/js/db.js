// שמירת התצפיות (כולל תמונות) ב-IndexedDB, עם עותק בזיכרון לגישה מהירה.
const DB_NAME = 'geophytes';
const STORE = 'obs';
let dbPromise = null;
let all = [];

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('code', 'code');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  }));
}

export async function loadAll() {
  try {
    all = await tx('readonly', (s) => s.getAll());
  } catch (err) {
    console.warn('IndexedDB unavailable', err);
    all = [];
  }
  all.sort((a, b) => b.ts - a.ts);
  return all;
}

export function observations() { return all; }

export async function addObservation(obs) {
  const rec = { id: crypto.randomUUID(), ts: Date.now(), ...obs };
  await tx('readwrite', (s) => s.put(rec));
  all.unshift(rec);
  return rec;
}

export async function deleteObservation(id) {
  await tx('readwrite', (s) => s.delete(id));
  all = all.filter((o) => o.id !== id);
}

export async function clearAll() {
  await tx('readwrite', (s) => s.clear());
  all = [];
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

export async function exportJson() {
  const items = [];
  for (const o of all) items.push({ ...o, thumb: o.thumb ? await blobToDataUrl(o.thumb) : null });
  return JSON.stringify({ app: 'geophytes', version: 1, exported: new Date().toISOString(), items });
}

export async function importJson(text) {
  const data = JSON.parse(text);
  if (data.app !== 'geophytes' || !Array.isArray(data.items)) throw new Error('קובץ גיבוי לא מוכר');
  const known = new Set(all.map((o) => o.id));
  let added = 0;
  for (const item of data.items) {
    if (known.has(item.id)) continue;
    const thumb = item.thumb ? await (await fetch(item.thumb)).blob() : null;
    const rec = { ...item, thumb };
    await tx('readwrite', (s) => s.put(rec));
    all.push(rec);
    added++;
  }
  all.sort((a, b) => b.ts - a.ts);
  return added;
}
