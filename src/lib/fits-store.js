// Saved fits, persisted to IndexedDB instead of localStorage.
//
// WHY THE MOVE. Fits used to be one JSON blob at localStorage["pyfa-fitsdb"], rewritten in full on
// every edit. Two ceilings made that untenable once importing a pyfa collection was on the table:
// localStorage caps around 5-10 MB depending on platform (a real 1,744-fit pyfa backup converts to
// 3.78 MB of our slot shape, so a second collection or a few more fits simply fails to save), and
// the write is synchronous — every keystroke that touched a fit re-stringified the whole library on
// the main thread. IndexedDB is async and its ceiling is orders of magnitude higher.
//
// ONE RECORD PER HULL, not per fit. The value at key "Rifter" is exactly the array `fitsDB["Rifter"]`
// already holds, so nothing above this file changes shape. Keying per fit would mean keying on
// `fit.id`, and ids are only unique by construction — mergeFitsDB has already shipped a bug where
// they collided — so a stale duplicate id would silently drop a fit on write. A hull name cannot
// collide with itself.
//
// WRITES ARE DIFFED BY REFERENCE. React state updates create a new array only for the hull that
// changed and a new object only for the fit that changed, so `prev[ship] !== next[ship]` identifies
// the changed hulls exactly, with no deep compare. Editing one fit writes one record.
//
// The pure core (`diffFitsDB`) is DOM- and IndexedDB-free so the regression suite can exercise it in
// Node, same split as storage-migrate.js.

const DB_NAME = "axis";
const DB_VERSION = 1;
const STORE = "fits";
export const FITS_KEY = "pyfa-fitsdb";   // the localStorage key it came from, and the backup-file key

// ── Pure core ────────────────────────────────────────────────────────────────

// Which hull records changed between two fitsDB snapshots. Returns hull names, not records, so the
// caller reads the values out of `next` itself and this stays free of any storage concern.
export function diffFitsDB(prev, next) {
  const puts = [], deletes = [];
  const p = prev ?? {}, n = next ?? {};
  for (const ship of Object.keys(n)) if (p[ship] !== n[ship]) puts.push(ship);
  for (const ship of Object.keys(p)) if (!(ship in n)) deletes.push(ship);
  return { puts, deletes };
}

// ── IndexedDB ────────────────────────────────────────────────────────────────

let _db = null;          // the open IDBDatabase, or null when we are on the localStorage fallback
let _cache = null;       // last loaded/persisted snapshot — what App.jsx reads synchronously at boot
let _fallback = false;   // IndexedDB unavailable (private mode, ancient webview, quota refusal)

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no indexedDB")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // A second tab holding an old version open blocks the upgrade forever; failing over to the
    // localStorage path is better than never rendering.
    req.onblocked = () => reject(new Error("indexedDB blocked"));
  });
}

function tx(mode) {
  const t = _db.transaction(STORE, mode);
  return { store: t.objectStore(STORE), done: new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }) };
}

function readAll() {
  return new Promise((resolve, reject) => {
    const { store } = tx("readonly");
    const keys = store.getAllKeys(), vals = store.getAll();
    let k = null, v = null;
    keys.onsuccess = () => { k = keys.result; if (v) resolve(Object.fromEntries(k.map((key, i) => [key, v[i]]))); };
    vals.onsuccess = () => { v = vals.result; if (k) resolve(Object.fromEntries(k.map((key, i) => [key, v[i]]))); };
    keys.onerror = vals.onerror = () => reject(keys.error ?? vals.error);
  });
}

// Every write in this file goes through here: one transaction for any number of hulls, which is what
// makes a 1,744-fit import a single commit rather than 316 of them.
async function writeRecords(db, puts, deletes) {
  const { store, done } = tx("readwrite");
  for (const ship of puts) store.put(db[ship], ship);
  for (const ship of deletes) store.delete(ship);
  await done;
}

// ── Boot ─────────────────────────────────────────────────────────────────────

// Load the fit library into memory. Call once, before React renders — App.jsx reads storage
// synchronously inside useState initialisers and IndexedDB cannot serve that.
//
// `legacyBlob` is localStorage["pyfa-fitsdb"] as it stands after storage-migrate has run, so a
// first-boot-after-update import carries the already-migrated shape rather than a stale one.
// Returns the fitsDB object (possibly empty), never throws.
export async function initFitsStore(legacyBlob = null) {
  try {
    _db = await openDB();
    const stored = await readAll();
    if (Object.keys(stored).length > 0) { _cache = stored; return _cache; }

    // Empty store. Either a fresh install or the one-time move out of localStorage.
    let legacy = null;
    if (typeof legacyBlob === "string" && legacyBlob) { try { legacy = JSON.parse(legacyBlob); } catch {} }
    if (legacy && typeof legacy === "object" && Object.keys(legacy).length > 0) {
      await writeRecords(legacy, Object.keys(legacy), []);
      // Verify before dropping the only other copy. If the read-back disagrees we keep localStorage
      // authoritative and stay on the fallback path — losing someone's fit library to an optimistic
      // write is the one outcome this whole file has to rule out.
      const back = await readAll();
      if (Object.keys(back).length !== Object.keys(legacy).length) { _fallback = true; _cache = legacy; return _cache; }
      _cache = back;
      try { localStorage.removeItem(FITS_KEY); localStorage.setItem("pyfa-fitsdb-movedat", new Date().toISOString()); } catch {}
      return _cache;
    }
    _cache = {};
    return _cache;
  } catch (e) {
    // No IndexedDB: keep working exactly as before, blob and all.
    console.warn("fits store: falling back to localStorage —", e?.message ?? e);
    _fallback = true; _db = null;
    try { _cache = legacyBlob ? JSON.parse(legacyBlob) : JSON.parse(localStorage.getItem(FITS_KEY) || "{}"); } catch { _cache = {}; }
    if (!_cache || typeof _cache !== "object") _cache = {};
    return _cache;
  }
}

// The snapshot initFitsStore loaded. Synchronous on purpose — this is what App.jsx's useState
// initialisers call. Null before init, which only happens if something rendered too early.
export function getLoadedFitsDB() { return _cache; }

export function isFallbackMode() { return _fallback; }

// ── Persistence ──────────────────────────────────────────────────────────────

// Persist a new fitsDB. Writes only the hulls that changed. Fire-and-forget by design: the caller is
// a React effect and there is nothing useful it could do with a rejected promise.
export function persistFitsDB(next) {
  if (!next || typeof next !== "object") return Promise.resolve();
  if (_fallback || !_db) {
    _cache = next;
    try { localStorage.setItem(FITS_KEY, JSON.stringify(next)); } catch (e) { console.error("fits store: localStorage write failed", e); }
    return Promise.resolve();
  }
  const { puts, deletes } = diffFitsDB(_cache, next);
  _cache = next;
  if (!puts.length && !deletes.length) return Promise.resolve();
  return writeRecords(next, puts, deletes).catch(e => console.error("fits store: write failed", e));
}

// Replace the entire library — the "Replace everything" restore, and where a bulk import lands.
// One transaction regardless of size.
export async function replaceFitsDB(db) {
  const next = (db && typeof db === "object") ? db : {};
  if (_fallback || !_db) {
    _cache = next;
    try { localStorage.setItem(FITS_KEY, JSON.stringify(next)); } catch (e) { console.error("fits store: localStorage write failed", e); }
    return next;
  }
  const gone = Object.keys(_cache ?? {}).filter(s => !(s in next));
  await writeRecords(next, Object.keys(next), gone);
  _cache = next;
  return next;
}

// The library as the string a backup file carries, so the on-disk backup FORMAT is unchanged by the
// move — a backup written here still restores on a build that keeps fits in localStorage, and vice
// versa. Async because the source no longer is.
export async function exportFitsBlob() {
  if (_cache) return JSON.stringify(_cache);
  if (_db) return JSON.stringify(await readAll());
  try { return localStorage.getItem(FITS_KEY) || "{}"; } catch { return "{}"; }
}
