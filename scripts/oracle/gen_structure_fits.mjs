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
