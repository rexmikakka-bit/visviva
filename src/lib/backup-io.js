// Pure backup/restore logic — deliberately free of React so it can be unit-tested in Node.
// This code decides what happens to someone's saved fits, so it is covered by the regression suite
// (see "BACKUP / RESTORE" in src/regression.test.mjs). Do not move it back into the component.

const BACKUP_APP = "visviva";
const BACKUP_VERSION = 1;
const KEY_RE = /^pyfa[-_]/i;

function collect() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (KEY_RE.test(k)) data[k] = localStorage.getItem(k);
  }
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

function buildBackup() {
  return JSON.stringify({
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: collect(),
  }, null, 2);
}

// Merge imported fits into the existing DB instead of clobbering it. Fit IDs are per-ship and can
// collide across backups, so imported fits always get fresh IDs; same-name fits are suffixed rather
// than silently overwriting the one you already have.
function mergeFitsDB(currentRaw, incomingRaw) {
  let cur = {}, inc = {};
  try { cur = JSON.parse(currentRaw || "{}") || {}; } catch { cur = {}; }
  try { inc = JSON.parse(incomingRaw || "{}") || {}; } catch { inc = {}; }

  const out = { ...cur };
  for (const [ship, fits] of Object.entries(inc)) {
    if (!Array.isArray(fits)) continue;
    const existing = Array.isArray(out[ship]) ? [...out[ship]] : [];
    const names = new Set(existing.map((f) => f.name));
    let nextId = existing.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0) + 1;
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


export { BACKUP_APP, BACKUP_VERSION, KEY_RE, collect, countFits, buildBackup, mergeFitsDB };
