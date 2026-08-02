/**
 * gen_structure_fits.mjs — generate structure fit SPECS for the oracle to diff.
 *
 *     node scripts/oracle/gen_structure_fits.mjs > scripts/oracle/_structfits.jsonl
 *     /c/Python314/python scripts/oracle/oracle_batch.py scripts/oracle/_structfits.jsonl \
 *         > scripts/oracle/_struct.jsonl
 *     node scripts/oracle/oracle_compare.mjs scripts/oracle/_struct.jsonl
 *
 * WHY GENERATE IN NODE
 * --------------------
 * Legality (canFitShipType/Group, rigSize, slot counts, the structure-module/ship-module category
 * rule) is logic this repo already has on the JS side. Reimplementing it in Python would be a
 * second copy to keep correct, and a generator bug would masquerade as an engine bug — the worst
 * possible failure mode for an oracle.
 *
 * PHASE 1: ONE MODULE PER FIT.
 * Every structure module, on every hull it legally fits, alone. The point is interpretability: with
 * a single module per fit, any mismatch NAMES ITS OWN CULPRIT — no bisection, no guessing which of
 * eight modules caused it. It also yields a coverage list (which structure modules have never been
 * exercised against eos at all).
 *
 * Weapons get their charges enumerated too (--charges), because charge-driven divergence is a known
 * weak spot: the Azbel DPS bug and the 3195-vs-1418 km range bug were BOTH charge-related.
 */

import { TYPES, tidByName } from '../../src/calc.js';

const args = process.argv.slice(2);
const withCharges = args.includes('--charges');
const limit = Number((args.find(a => a.startsWith('--limit=')) || '=0').split('=')[1]);
// PHASE 3: --random=N builds N multi-module fits instead. This is the ONLY automated way at the
// interaction bugs one-module-per-fit is blind to — a Ballistic Control System alone has no weapon
// to boost, which is exactly how the Standup BCS double-count survived the single-module sweep and
// had to be found in a real saved fit. Seeded so any failure is reproducible from its id alone.
const randomN = Number((args.find(a => a.startsWith('--random=')) || '=0').split('=')[1]);
const seed = Number((args.find(a => a.startsWith('--seed=')) || '=12345').split('=')[1]);

// mulberry32 — small, fast, and deterministic across machines (Math.random is not seedable).
function rng(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── the hulls ────────────────────────────────────────────────────────────────
const STRUCTURE_CAT = 65, STRUCTURE_MOD_CAT = 66;
const HULL_GROUPS = new Set(['Citadel', 'Engineering Complex', 'Refinery']);
const hulls = [];
for (const [tid, t] of Object.entries(TYPES)) {
  if ((t.c ?? t.category) !== STRUCTURE_CAT) continue;
  if (!HULL_GROUPS.has(t.gn) || !t.n) continue;
  hulls.push({ typeID: Number(tid), name: t.n, group: t.gn,
               rigSize: t.a?.rigSize ?? null, groupID: t.g ?? null });
}
hulls.sort((a, b) => a.name.localeCompare(b.name));

// ── legality, mirroring checkFitRestriction in components/tabs.jsx ────────────
const GK = [...Array(20)].map((_, i) => 'canFitShipGroup' + String(i + 1).padStart(2, '0'));
const TK = [...Array(12)].map((_, i) => 'canFitShipType' + (i + 1));

function canFit(modType, hull) {
  const a = modType.a ?? {};
  // rigSize must match EXACTLY when the module declares one.
  if (a.rigSize != null && hull.rigSize != null && a.rigSize !== hull.rigSize) return false;
  // Explicit CCP whitelist. An empty whitelist means "no restriction".
  const groups = GK.map(k => a[k]).filter(v => v != null);
  const types = TK.map(k => a[k]).filter(v => v != null);
  if (a.fitsToShipType != null) types.push(a.fitsToShipType);
  if (!groups.length && !types.length) return true;
  return groups.includes(hull.groupID) || types.includes(hull.typeID);
}

// Which rack a structure module belongs in. Service slot is marked by effect 6306; the rest follow
// the usual power attributes. Rigs are identified by rigSize (structure rigs carry no *Power attr).
function rackOf(t) {
  const e = t.e ?? t.effectIDs ?? [];
  const a = t.a ?? {};
  if (e.includes(6306)) return 'services';
  if (a.rigSize != null) return 'rigs';
  if (e.includes(12)) return 'high';
  if (e.includes(13)) return 'mid';
  if (e.includes(11)) return 'low';
  return null;
}

// ── charges a weapon accepts: match chargeGroupN against the charge's groupID ──
const CHARGE_GROUP_KEYS = [...Array(5)].map((_, i) => 'chargeGroup' + (i + 1));
const chargesByGroup = new Map();
for (const [tid, t] of Object.entries(TYPES)) {
  if ((t.c ?? t.category) !== 8) continue;           // 8 = Charge
  const g = t.g;
  if (g == null || !t.n) continue;
  if (!chargesByGroup.has(g)) chargesByGroup.set(g, []);
  chargesByGroup.get(g).push({ typeID: Number(tid), name: t.n, volume: t.a?.volume ?? 0 });
}
function chargesFor(t) {
  const a = t.a ?? {};
  const out = [];
  for (const k of CHARGE_GROUP_KEYS) {
    const g = a[k];
    if (g == null) continue;
    for (const c of (chargesByGroup.get(g) ?? [])) out.push(c);
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

// ── the modules ──────────────────────────────────────────────────────────────
const mods = [];
for (const [tid, t] of Object.entries(TYPES)) {
  if ((t.c ?? t.category) !== STRUCTURE_MOD_CAT || !t.n) continue;
  const rack = rackOf(t);
  if (!rack) continue;                                // not a fittable rack module
  mods.push({ typeID: Number(tid), name: t.n, rack, type: t });
}
mods.sort((a, b) => a.name.localeCompare(b.name));

// ── PHASE 3: random multi-module fits ────────────────────────────────────────
if (randomN > 0) {
  const rand = rng(seed);
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const SECS = ['hisec', 'lowsec', 'nullsec', 'wspace'];
  const RACK_SLOT_ATTR = { high: 'hiSlots', mid: 'medSlots', low: 'lowSlots',
                           rigs: 'rigSlots', services: 'serviceSlots' };
  // Pre-bucket legal modules per hull per rack so the inner loop is cheap.
  const byHull = new Map();
  for (const h of hulls) {
    const buckets = { high: [], mid: [], low: [], rigs: [], services: [] };
    for (const m of mods) if (canFit(m.type, h)) buckets[m.rack].push(m);
    byHull.set(h.typeID, buckets);
  }

  let made = 0;
  for (let i = 0; made < randomN && i < randomN * 20; i++) {
    const hull = pick(hulls);
    const buckets = byHull.get(hull.typeID);
    const ha = hull.typeID != null ? (TYPES[String(hull.typeID)]?.a ?? {}) : {};
    const slots = { high: [], mid: [], low: [], rigs: [], services: [] };
    // Resource budgets. Exceeding them wouldn't change eos's arithmetic, but an over-CPU fit is not
    // a fit anyone would build, and keeping them legal means a failure is worth chasing.
    let cpuLeft = ha.cpuOutput ?? Infinity;
    let pgLeft  = ha.powerOutput ?? Infinity;
    let calLeft = ha.upgradeCapacity ?? Infinity;
    const groupCount = new Map();   // groupID -> fitted count, for maxGroupFitted

    for (const rack of ['high', 'mid', 'low', 'rigs', 'services']) {
      const capacity = ha[RACK_SLOT_ATTR[rack]] ?? 0;
      const pool = buckets[rack];
      if (!capacity || !pool.length) continue;
      // Leave some slots empty at random — real fits aren't always full, and empty racks exercise
      // different code paths (e.g. no service module = Low Power State).
      const want = Math.floor(rand() * (capacity + 1));
      for (let s = 0; s < want; s++) {
        const m = pick(pool);
        const a = m.type.a ?? {};
        const gid = m.type.g;
        // maxGroupFitted is honoured where CCP encodes it (structure combat rigs mostly). It is
        // ABSENT on service modules, so a generated fit can carry two Cloning Centers — unrealistic,
        // but eos applies the same rule (none), so both engines agree and it costs the sweep nothing.
        const maxGrp = a.maxGroupFitted;
        if (maxGrp != null && (groupCount.get(gid) ?? 0) >= maxGrp) continue;
        const cpu = a.cpu ?? 0, pg = a.power ?? 0, cal = a.upgradeCost ?? 0;
        if (cpu > cpuLeft || pg > pgLeft || cal > calLeft) continue;
        cpuLeft -= cpu; pgLeft -= pg; calLeft -= cal;
        groupCount.set(gid, (groupCount.get(gid) ?? 0) + 1);
        const entry = { typeID: m.typeID, name: m.name, state: 'active' };
        const ch = chargesFor(m.type);
        if (ch.length) entry.ammo = pick(ch).name;
        slots[rack].push(entry);
      }
    }
    const total = Object.values(slots).reduce((n, r) => n + r.length, 0);
    if (total < 2) continue;    // the whole point is INTERACTION; a 0- or 1-module fit adds nothing
    const sec = pick(SECS);
    process.stdout.write(JSON.stringify({
      id: `rnd${seed}_${made}`,
      name: `random ${hull.name} (${total} mods, ${sec})`,
      ship: hull.name,
      spec: { ship: { typeID: hull.typeID, name: hull.name },
              slots, drones: [], implants: [], boosters: [], systemSecurity: sec },
      meta: { hull: hull.name, hullGroup: hull.group, modules: total, systemSecurity: sec, seed },
    }) + '\n');
    made++;
  }
  process.stderr.write(`generated ${made} random multi-module structure fits (seed ${seed})\n`);
  process.exit(0);
}

// ── emit ─────────────────────────────────────────────────────────────────────
// One record per (module, hull) — plus one per charge when --charges is on. `active` state so
// weapons actually fire; eos downgrades to the best legal state if active isn't allowed.
const EMPTY_SLOTS = () => ({ high: [], mid: [], low: [], rigs: [], services: [] });
let emitted = 0, skipped = 0;
const seenMods = new Set();

outer:
for (const m of mods) {
  const legal = hulls.filter(h => canFit(m.type, h));
  if (!legal.length) { skipped++; continue; }
  seenMods.add(m.name);
  // One hull is enough for the single-module sweep — the smallest legal one keeps eos fast and the
  // fit unambiguous. Hull-specific bonuses are Phase 3's job, not this sweep's.
  const hull = legal[0];
  const charges = withCharges ? chargesFor(m.type) : [];
  const variants = charges.length ? charges : [null];
  for (const ch of variants) {
    const slots = EMPTY_SLOTS();
    const entry = { typeID: m.typeID, name: m.name, state: 'active' };
    if (ch) entry.ammo = ch.name;
    slots[m.rack].push(entry);
    const rec = {
      id: `${m.typeID}${ch ? '_' + ch.typeID : ''}@${hull.typeID}`,
      name: `${m.name}${ch ? ' + ' + ch.name : ''} on ${hull.name}`,
      ship: hull.name,
      spec: {
        ship: { typeID: hull.typeID, name: hull.name },
        slots, drones: [], implants: [], boosters: [],
      },
      meta: { module: m.name, moduleTypeID: m.typeID, rack: m.rack,
              charge: ch?.name ?? null, hull: hull.name, hullGroup: hull.group,
              legalHulls: legal.length },
    };
    process.stdout.write(JSON.stringify(rec) + '\n');
    if (limit && ++emitted >= limit) break outer;
    emitted++;
  }
}

process.stderr.write(
  `generated ${emitted} structure fit specs\n` +
  `  modules covered: ${seenMods.size}/${mods.length}` +
  `   (skipped ${skipped} with no legal hull)\n` +
  `  hulls: ${hulls.length}   charges: ${withCharges ? 'enumerated' : 'off (--charges to enable)'}\n`
);
