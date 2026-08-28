// Pure backup/restore logic — deliberately free of React so it can be unit-tested in Node.
// This code decides what happens to someone's saved fits, so it is covered by the regression suite
// (see "BACKUP / RESTORE" in src/regression.test.mjs). Do not move it back into the component.

const BACKUP_APP = "axis";
// Files written before the Visviva -> Axis rename carry the old tag. Rejecting them would mean a
// user who reinstalls and restores their only backup is told it isn't a backup file, so import
// tests membership of this set — never equality with BACKUP_APP.
const BACKUP_APP_ACCEPTED = ["axis", "visviva"];
const BACKUP_VERSION = 1;
const KEY_RE = /^pyfa[-_]/i;

function isBackupApp(app) {
  return BACKUP_APP_ACCEPTED.includes(String(app ?? "").toLowerCase());
}

// `fitsBlob` is the fit library, which lives in IndexedDB rather than localStorage (fits-store.js).
// It is injected rather than imported so this file stays React-, DOM- and IndexedDB-free and the
// regression suite can keep driving it with a plain object. The backup FILE FORMAT is unchanged:
// fits still travel under the `pyfa-fitsdb` key, so a file written here restores on a build that
// keeps them in localStorage and vice versa.
function collect(fitsBlob = null) {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (KEY_RE.test(k)) data[k] = localStorage.getItem(k);
  }
  if (typeof fitsBlob === "string") data["pyfa-fitsdb"] = fitsBlob;
  return data;
}

function countFits(db) {
  try {
    const parsed = typeof db === "string" ? JSON.parse(db) : db;
    if (!parsed || typeof parsed !== "object") return { fits: 0, ships: 0 };
    const ships = Object.keys(parsed);
    return { fits: ships.reduce((n, s) => n + (parsed[s]?.length ?? 0), 0), ships: ships.length };
  } catch { return { fits: 0, ships: 0 }; }
}

function buildBackup(fitsBlob = null) {
  return JSON.stringify({
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: collect(fitsBlob),
  }, null, 2);
}

// Merge imported fits into the existing DB instead of clobbering it. Imported fits always get fresh
// IDs; same-name fits are suffixed rather than silently overwriting the one you already have.
//
// The counter is DB-WIDE, not per-ship. Allocating per-ship restarted at 1 for every ship with no
// existing fits, so restoring a backup into a fresh install gave the first fit of all 30 ships the
// id 1. That is invisible everywhere fits are listed per-ship (every id is unique within its own
// ship), and breaks the moment something flattens the DB: the projected/command fit pickers do, and
// with React keys colliding their list stopped re-rendering when you typed in the search box.
function mergeFitsDB(currentRaw, incomingRaw) {
  let cur = {}, inc = {};
  try { cur = JSON.parse(currentRaw || "{}") || {}; } catch { cur = {}; }
  try { inc = JSON.parse(incomingRaw || "{}") || {}; } catch { inc = {}; }

  const out = { ...cur };
  let nextId = Object.values(out).flat()
    .reduce((m, f) => Math.max(m, Number(f?.id) || 0), 0) + 1;
  for (const [ship, fits] of Object.entries(inc)) {
    if (!Array.isArray(fits)) continue;
    const existing = Array.isArray(out[ship]) ? [...out[ship]] : [];
    const names = new Set(existing.map((f) => f.name));
    for (const f of fits) {
      let name = f.name ?? "Imported Fit";
      if (names.has(name)) {
        let n = 2;
        while (names.has(`${name} (${n})`)) n++;
        name = `${name} (${n})`;
      }
      names.add(name);
      existing.push({ ...f, id: nextId++, name });
    }
    out[ship] = existing;
  }
  return JSON.stringify(out);
}


export { BACKUP_APP, BACKUP_APP_ACCEPTED, isBackupApp, BACKUP_VERSION, KEY_RE, collect, countFits, buildBackup, mergeFitsDB };
