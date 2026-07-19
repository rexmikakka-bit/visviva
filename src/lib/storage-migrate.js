// Saved fits and settings live ONLY in localStorage (see backup-io.js). Today they carry no schema
// stamp, so the day the fit shape changes, an old saved fit deserializes into the new code and
// crashes on render — and the user sees a blank page and assumes the app ate their fits.
//
// This puts a version stamp on the storage and runs ordered migrations on boot, BEFORE React reads
// any state. It does nothing today (v1 is the current shape); the point is that the FRAMEWORK exists
// so the next shape change ships with a migration instead of a crash.
//
// Pure core (`runMigrations`) is React- and DOM-free so the regression suite can exercise it in Node.

export const SCHEMA_VERSION = 1;
export const SCHEMA_KEY = "pyfa-schema-version";
const DATA_KEY_RE = /^pyfa[-_]/i;

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

function hasDataKey(ls) {
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k !== SCHEMA_KEY && DATA_KEY_RE.test(k)) return true;
  }
  return false;
}

// Boot-time entry point. Safe to call before React renders; safe if localStorage is unavailable.
export function migrateLocalStorage(ls = (typeof localStorage !== "undefined" ? localStorage : null)) {
  if (!ls) return;
  let from;
  try {
    const raw = ls.getItem(SCHEMA_KEY);
    if (raw != null) {
      from = Number(raw) || 0;
    } else {
      // Unstamped install. If it holds pyfa-* data it predates versioning but is already the v1
      // shape, so there's nothing to migrate — just stamp it. A truly fresh install is also current.
      from = hasDataKey(ls) ? SCHEMA_VERSION : SCHEMA_VERSION;
    }
  } catch { return; } // storage blocked (private mode / disabled) — nothing we can do

  if (from >= SCHEMA_VERSION) {
    try { ls.setItem(SCHEMA_KEY, String(SCHEMA_VERSION)); } catch {}
    return;
  }

  // Snapshot the data keys, migrate the map, write it back (honouring deletions).
  const before = {};
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (DATA_KEY_RE.test(k)) before[k] = ls.getItem(k);
  }
  const after = runMigrations({ ...before }, { from });
  try {
    for (const k of Object.keys(before)) {
      if (!(k in after)) ls.removeItem(k);
    }
    for (const [k, v] of Object.entries(after)) ls.setItem(k, v);
  } catch (e) {
    console.error("storage migration write-back failed:", e);
  }
}
