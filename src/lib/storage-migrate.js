// Saved fits and settings live ONLY in localStorage (see backup-io.js). Today they carry no schema
// stamp, so the day the fit shape changes, an old saved fit deserializes into the new code and
// crashes on render — and the user sees a blank page and assumes the app ate their fits.
//
// This puts a version stamp on the storage and runs ordered migrations on boot, BEFORE React reads
// any state. It does nothing today (v1 is the current shape); the point is that the FRAMEWORK exists
// so the next shape change ships with a migration instead of a crash.
//
// Pure core (`runMigrations`) is React- and DOM-free so the regression suite can exercise it in Node.

export const SCHEMA_VERSION = 3;
export const SCHEMA_KEY = "pyfa-schema-version";
// Saved fits are `pyfa-*`; app preferences, ESI tokens and graph state were `visviva_*` before the
// rename to Axis and are `axis_*` after it. All three prefixes must be snapshotted, or migration v1
// cannot see the keys it exists to rename.
const DATA_KEY_RE = /^(pyfa|visviva|axis)[-_]/i;
// The shape installs were on before this file existed. An unstamped store holding data is here.
const PRE_VERSIONING_SCHEMA = 1;

// MIGRATIONS[v] upgrades a store from schema version v to v+1. The store is a plain
// { key: rawJSONstring } map; a migration mutates it (edit values, add/delete keys).
//
// RULES:
//   • Append only. Never reorder, renumber, or delete an existing migration — a user can be sitting
//     on ANY past version, and the chain must run cleanly from there to current.
//   • Keep each migration total and defensive: bad/absent data must not throw (a throw here is the
//     exact blank-page failure this file exists to prevent). Wrap JSON.parse in try/catch.
//   • When you change the saved-fit shape, bump SCHEMA_VERSION and push the migration that rewrites
//     old fits into the new shape.
//
// Index 0 (v0 -> v1) is intentionally empty: installs that predate versioning already hold v1-shaped
// data, so migrateLocalStorage() stamps them as v1 without running anything (see below).
export const MIGRATIONS = [
  // (v0 -> v1) baseline — no-op.
  () => {},

  // (v1 -> v2) Visviva -> Axis rename. Preferences, ESI character tokens, open tabs, graph prefs
  // and price caches were all keyed `visviva_*`. Without this an updating user silently loses every
  // preference and gets logged out of ESI, which reads as "the update wiped my settings".
  // An existing `axis_*` key wins: it was written by the new code and is therefore newer.
  (store) => {
    for (const k of Object.keys(store)) {
      if (!/^visviva[-_]/i.test(k)) continue;
      const renamed = "axis" + k.slice("visviva".length);
      if (!(renamed in store)) store[renamed] = store[k];
      delete store[k];
    }
  },

  // (v2 -> v3) Fit tags. Every saved fit gains a `tags` array. `tagsOf` is defensive about a missing
  // or malformed one anyway, so this is not load-bearing for rendering — the point is that exactly
  // one shape exists in storage, so nothing downstream has to keep guessing which era a fit is from.
  (store) => {
    const raw = store["pyfa-fitsdb"];
    if (typeof raw !== "string") return;
    let db;
    try { db = JSON.parse(raw); } catch { return; }
    if (!db || typeof db !== "object") return;
    for (const fits of Object.values(db)) {
      if (!Array.isArray(fits)) continue;
      for (const f of fits) if (f && typeof f === "object" && !Array.isArray(f.tags)) f.tags = [];
    }
    store["pyfa-fitsdb"] = JSON.stringify(db);
  },
];

// Run migrations on a plain store map, in place, from `from` up to `to`. Returns the store.
export function runMigrations(store, { from, to = SCHEMA_VERSION } = {}) {
  let v = Math.max(0, from | 0);
  for (; v < to; v++) {
    const m = MIGRATIONS[v];
    if (typeof m === "function") {
      try { m(store); }
      catch (e) { console.error(`storage migration v${v}->v${v + 1} failed (skipped):`, e); }
    }
  }
  store[SCHEMA_KEY] = String(to);
  return store;
}

function hasDataKey(ls, external) {
  if (external && Object.keys(external).length) return true;
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k !== SCHEMA_KEY && DATA_KEY_RE.test(k)) return true;
  }
  return false;
}

// Boot-time entry point. Safe to call before React renders; safe if localStorage is unavailable.
//
// `external` is store data that no longer lives in localStorage — today that is `pyfa-fitsdb`, which
// moved to IndexedDB (see fits-store.js). It is merged into the snapshot so a migration still sees
// the WHOLE store and can keep being written the same way, and is handed back migrated for the
// caller to persist rather than being written to localStorage. Without this, the next fit-shape
// migration would run against a store with no fits in it and silently do nothing.
export function migrateLocalStorage(ls = (typeof localStorage !== "undefined" ? localStorage : null), { external = null } = {}) {
  const ext = external ?? {};
  if (!ls) return { external: { ...ext } };
  let from;
  try {
    const raw = ls.getItem(SCHEMA_KEY);
    if (raw != null) {
      from = Number(raw) || 0;
    } else {
      // Unstamped install. If it holds data it predates versioning, which means it is sitting on the
      // v1 shape and must run the chain from there — NOT be stamped current, which would skip every
      // migration it actually needs. (Both branches used to read SCHEMA_VERSION, which was harmless
      // only while SCHEMA_VERSION was 1.) A truly fresh install has nothing to migrate.
      from = hasDataKey(ls, ext) ? PRE_VERSIONING_SCHEMA : SCHEMA_VERSION;
    }
  } catch { return { external: { ...ext } }; } // storage blocked (private mode / disabled)

  if (from >= SCHEMA_VERSION) {
    try { ls.setItem(SCHEMA_KEY, String(SCHEMA_VERSION)); } catch {}
    return { external: { ...ext } };
  }

  // Snapshot the data keys, migrate the map, write it back (honouring deletions).
  const before = {};
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (DATA_KEY_RE.test(k)) before[k] = ls.getItem(k);
  }
  const after = runMigrations({ ...before, ...ext }, { from });
  const migratedExternal = {};
  for (const k of Object.keys(ext)) migratedExternal[k] = k in after ? after[k] : null;  // null = deleted
  try {
    for (const k of Object.keys(before)) {
      if (!(k in after)) ls.removeItem(k);
    }
    for (const [k, v] of Object.entries(after)) if (!(k in ext)) ls.setItem(k, v);
  } catch (e) {
    console.error("storage migration write-back failed:", e);
  }
  return { external: migratedExternal };
}
