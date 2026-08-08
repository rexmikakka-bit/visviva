// Module comparison — the data behind the Variations tab's compare view.
//
// pyfa answers "which of these should I fit" with a wide grid: one row per module, one column per
// attribute. That is a desktop answer to a desktop constraint. On a phone you cannot show ten
// columns legibly, and you certainly cannot see two rows at once to subtract them by eye — which is
// the operation the grid is really asking you to perform.
//
// So this module computes the SUBTRACTION instead of presenting a table. Two ideas do the work:
//
//   1. Only attributes that actually DIFFER across the candidate set are interesting. Every module
//      carries ~40 attributes and a Large Shield Extender II differs from a Compact one in about
//      four of them. Dropping the agreeing ones is what makes the result fit on a phone.
//   2. Every difference is expressed as a DELTA against the module currently fitted, with a
//      direction — so "+12% shield, -9 CPU, +40M ISK" reads as a decision rather than a data dump.
//
// Direction comes from CCP's own `highIsGood` flag via attrHighIsGood (dgmattribs -> `h`), not from
// a hand-kept list of which attributes count as improvements. 19 of the attributes a module can
// carry are lower-is-better, and the non-obvious ones are exactly where a hand list goes wrong.
//
// React-free on purpose: `regression.test.mjs` runs under Node and cannot import .jsx.
import { TYPES, ATTR_ID_TO_NAME, attrHighIsGood } from '../calc.js';
import { metaOf, META_ORDER } from './meta.js';

// name -> attributeID, so a runtime attrs map keyed by NAME can still reach CCP's highIsGood flag.
const ATTR_NAME_TO_ID = {};
for (const [id, name] of Object.entries(ATTR_ID_TO_NAME)) ATTR_NAME_TO_ID[name] = Number(id);

/**
 * Attributes that say nothing about whether one variant is better than another.
 *
 * `metaLevel`/`techLevel` are already shown as the meta badge, and including them would guarantee
 * a "difference" on every single comparison — drowning the real ones. The radius/mass/volume group
 * is inventory bookkeeping. Everything else is left in: it is far better to show one odd attribute
 * than to silently hide the one that mattered for some module class nobody thought about.
 */
const IGNORED = new Set([
  'metaLevel', 'metaLevelOld', 'techLevel', 'metaGroupID', 'typeColorScheme',
  'radius', 'volume', 'mass', 'capacity',
  'requiredSkill1', 'requiredSkill2', 'requiredSkill3',
  'requiredSkill1Level', 'requiredSkill2Level', 'requiredSkill3Level',
  'skillPoints', 'skillTimeConstant',
]);

/** The runtime attribute map for a type, keyed by attribute NAME. */
function attrsOf(typeID) {
  const td = TYPES[typeID] ?? TYPES[String(typeID)];
  return td?.attrs ?? td?.a ?? {};
}

/**
 * Which attributes differ across `typeIDs`, most-variable first.
 *
 * "Most variable" is the RELATIVE spread (max-min)/|max|, not the absolute one — otherwise a
 * capacitorNeed measured in hundreds always outranks a damageMultiplier measured in tenths, purely
 * because of its units, and the list fills with whichever attribute happens to use the biggest
 * numbers rather than whichever actually changes the module's behaviour.
 */
// 6, not 5: most boosters carry four side effects plus a bonus and a chance, and at 5 one of
// them fell off the end exactly when you were comparing grades of the same drug.
export function differingAttributes(typeIDs, { limit = 6 } = {}) {
  const ids = [...new Set(typeIDs.filter(Boolean))];
  if (ids.length < 2) return [];
  const maps = ids.map(attrsOf);
  const keys = new Set();
  for (const m of maps) for (const k of Object.keys(m)) {
    if (IGNORED.has(k) || /^(meta|tech)Level/i.test(k)) continue;
    if (typeof m[k] === 'number' && Number.isFinite(m[k])) keys.add(k);
  }
  const scored = [];
  for (const k of keys) {
    // An attribute PRESENT on some variants and absent on others is itself a difference, so a
    // missing value counts as 0 rather than excluding the attribute.
    const vals = maps.map(m => (typeof m[k] === 'number' && Number.isFinite(m[k])) ? m[k] : 0);
    const min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) continue;                       // every candidate agrees — not interesting
    const scale = Math.max(Math.abs(max), Math.abs(min)) || 1;
    scored.push({ key: k, spread: (max - min) / scale });
  }
  scored.sort((a, b) => b.spread - a.spread || a.key.localeCompare(b.key));

  // Collapse NUMBERED SIBLINGS that carry identical values. A booster ships five separate
  // `boosterEffectChance1..5` attributes and every one of them holds the same number, so listing
  // all five spends the whole row on one fact. Keeping the first is enough — the others say nothing
  // it does not. Only collapsed when the value vectors match exactly; genuinely differing numbered
  // attributes (missile damage per type, say) stay separate.
  const vecOf = k => maps.map(m => (typeof m[k] === 'number' ? m[k] : 0)).join(',');
  const keptStems = new Map();
  const out = [];
  for (const { key } of scored) {
    const m = /^(.*?)(\d+)$/.exec(key);
    if (m) {
      const stem = m[1], vec = vecOf(key);
      const prev = keptStems.get(stem);
      if (prev === vec) continue;            // same family, same numbers — already represented
      if (prev === undefined) keptStems.set(stem, vec);
    }
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Is `v` better than `b` for attribute `k`?
 *
 * CCP's highIsGood carries this for ordinary attributes, but it is WRONG for the booster
 * side-effect family — every `booster*Penalty` is flagged highIsGood=1 even though a bigger penalty
 * is plainly worse. Worse still, they are not signed consistently: `boosterArmorHPPenalty` is −20
 * while `boosterMissileAOECloudPenalty` is +20, both meaning "20% worse". So sign is useless there
 * and MAGNITUDE is the real signal — a stronger penalty is a worse one, whichever way it points.
 *
 * The same magnitude rule, inverted, covers signed BONUSES like `aoeCloudSizeBonus`, which is
 * negative when it helps (a smaller explosion radius applies better) — a bigger magnitude is a
 * stronger bonus, so better.
 */
const PENALTY_RE = /Penalty$/;
const SIDE_EFFECT_CHANCE_RE = /^boosterEffectChance\d*$/;
const SIGNED_BONUS_RE = /^aoeCloudSizeBonus$/;
function directionOf(k, v, b) {
  if (v == null || b == null) return null;
  if (PENALTY_RE.test(k))       return Math.abs(v) < Math.abs(b);   // weaker penalty wins
  if (SIGNED_BONUS_RE.test(k))  return Math.abs(v) > Math.abs(b);   // stronger bonus wins
  if (SIDE_EFFECT_CHANCE_RE.test(k)) return v < b;                  // less chance of a side effect
  return attrHighIsGood(ATTR_NAME_TO_ID[k]) ? v > b : v < b;
}

/**
 * One comparison row per candidate, each carrying its differing attributes as deltas against
 * `baselineTypeID` (the module currently fitted).
 *
 * `better` is null when the direction is meaningless — an unchanged value, or an attribute CCP has
 * no opinion about. The UI must not colour those; "no change" is not an improvement.
 */
export function compareRows(typeIDs, baselineTypeID, { limit = 6 } = {}) {
  const keys = differingAttributes(typeIDs, { limit });
  const base = attrsOf(baselineTypeID);
  return [...new Set(typeIDs.filter(Boolean))].map(typeID => {
    const a = attrsOf(typeID);
    const stats = keys.map(k => {
      const v = typeof a[k] === 'number' ? a[k] : null;
      const b = typeof base[k] === 'number' ? base[k] : null;
      const delta = (v != null && b != null) ? v - b : null;
      // Percent is undefined against a zero baseline — an attribute the fitted module simply does
      // not have. The absolute delta still reads fine there, so leave pct null rather than Infinity.
      const pct = (delta != null && b) ? (delta / Math.abs(b)) * 100 : null;
      const better = (delta == null || delta === 0) ? null : directionOf(k, v, b);
      return { key: k, value: v, delta, pct, better };
    });
    return { typeID, isBaseline: String(typeID) === String(baselineTypeID), stats };
  });
}

/**
 * Sorts comparison rows for display. The fitted module is always pinned first — it is the thing
 * every other row is measured against, so burying it mid-list makes the deltas unreadable.
 *
 * `by`: 'price' (cheapest first, unpriced last) or 'meta' (T1 -> T2 -> Faction -> ... ).
 *
 * There is deliberately NO "best stat" sort: with several differing attributes on screen, a control
 * labelled that way cannot say WHICH stat it ranked by, so the ordering looks arbitrary. Meta level
 * is the ordering EVE players already carry in their heads, and it correlates with the thing being
 * traded off anyway.
 */
export function sortCompareRows(rows, { by = 'price', dir = 'asc', prices } = {}) {
  const price = r => {
    const p = prices?.get?.(Number(r.typeID));
    return (typeof p === 'number' && p > 0) ? p : Infinity;   // unpriced sinks, never sorts as free
  };
  // Unknown meta sorts last rather than first, so an unclassified item never leads the list.
  const meta = r => META_ORDER[metaOf(Number(r.typeID), null)] ?? 99;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    // The fitted module stays pinned at the top in BOTH directions — it is the baseline every
    // delta is measured from, so flipping the sort must not bury it halfway down the list.
    if (a.isBaseline !== b.isBaseline) return a.isBaseline ? -1 : 1;
    const cmp = by === 'meta' ? ((meta(a) - meta(b)) || (price(a) - price(b))) : (price(a) - price(b));
    // Unpriced rows sort as Infinity, which would float them to the TOP when reversed. Keep them
    // last either way: "we don't know" is not the most expensive thing on the list.
    if (by === 'price') {
      const ua = price(a) === Infinity, ub = price(b) === Infinity;
      if (ua !== ub) return ua ? 1 : -1;
    }
    return sign * cmp;
  });
}
