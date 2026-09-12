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
import { EFFECTS_DATA } from '../dogma-engine-init.js';
import { compareByMeta } from './meta.js';

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
  // Fitting cost is shown SEPARATELY and unconditionally, as the powergrid/CPU/calibration glyphs
  // above the attribute list — it is the constraint every swap has to clear, so it must not depend
  // on making the six-row cut. Ranking it here as well spent two of those six rows restating what
  // the glyph line already says: a Large Shield Extender family "differs" in exactly capacityBonus,
  // cpu and power, so two thirds of the comparison was fitting cost twice over.
  'cpu', 'power', 'upgradeCost',
  'requiredSkill1', 'requiredSkill2', 'requiredSkill3',
  'requiredSkill1Level', 'requiredSkill2Level', 'requiredSkill3Level',
  'skillPoints', 'skillTimeConstant',
  // Heat absorption rate only means anything while overheating, and it differs on nearly every
  // meta variant — so it reliably outranked the attributes the module is actually chosen for.
  'heatAbsorbtionRateModifier',   // CCP's spelling
  // CCP's own placeholder for the command-burst strength readout — the trailing FAKE is theirs.
  // Present on T2/faction bursts and absent on T1, which scored it a perfect 1.0 spread and put a
  // non-attribute at the top of every command-burst comparison.
  'commandBurstDbuffEffectStrengthFAKE',
]);

/**
 * Attributes whose VALUE is an ID reference, not a quantity.
 *
 * `canFitShipType2 = 89808` is a typeID in a fitting whitelist; subtracting one from another is
 * meaningless, and because the whitelists are numbered inconsistently across variants (a T1 burst
 * fills canFitShipType1 where its T2 fills canFitShipType2) they read as PRESENT-vs-ABSENT — the
 * maximum possible spread. That is how three rows of a six-row comparison went to fitting
 * bookkeeping and pushed a Shield Command Burst's actual range difference off the end of the list.
 */
const ID_VALUED_RE = /^(canFitShipType\d+|canFitShipGroup\d+|chargeGroup\d+|fitsToShipType)$/;

/**
 * Attributes that describe an NPC rather than the fit.
 *
 * `entityCapacitorLevelModifierSmall/Medium/Large` (1895–1897, alongside `entityCapacitorLevel`) is
 * the fraction of an NPC's capacitor left standing after a neutraliser hits it, bucketed by the
 * NPC's size class — a coarse hint for CCP's NPC AI. Provably inert here: NO effect in the bundle
 * references 1894–1897, and eos never reads them either (pyfa's only mention is a raw attribute
 * dump in service/port/efs.py), which is why the attribute cannot be found anywhere in pyfa's UI.
 *
 * It cost TWO of the six rows on an energy neutraliser, because the three siblings hold different
 * values so the numbered-sibling collapse cannot merge them — and their index is a word, not a
 * digit, so it would not have matched in the first place. Falloff, the stat that actually separates
 * the meta variants, was displaced to make room for it.
 */
const NPC_FACING_RE = /^entityCapacitorLevel/;

/**
 * SUBSYSTEMS are compared only on what they do to the fit's capacity.
 *
 * A T3 cruiser subsystem carries ~97 attributes, and the ones that actually vary between siblings
 * are mostly `subsystemBonusMinmatarCore2` and friends — prescale values for the hull's trait
 * bonuses, which mean nothing on their own and are already spelled out in the ship's trait panel.
 * What you are really choosing between when you swap a subsystem is the SLOT LAYOUT and the fitting
 * room, so that is all this shows: slots, hardpoints, CPU and powergrid.
 *
 * An allowlist rather than more exclusions, because the noise here is the overwhelming majority —
 * blocking it item by item would mean listing ~88 attributes and re-listing every one CCP adds.
 *
 * Deliberately NOT included: the `subsystem*FittingReduction` family (per-module-type cost cuts for
 * energy turrets, missiles, remote reps and so on). They do affect whether a fit fits, but they are
 * a discount on one module class rather than a change to the ship's available fitting, and there
 * are eight of them — enough to drown the four numbers that matter.
 */
const SUBSYSTEM_CATEGORY = 32;
const SUBSYSTEM_FITTING_ATTRS = new Set([
  'hiSlotModifier', 'medSlotModifier', 'lowSlotModifier',
  'turretHardPointModifier', 'launcherHardPointModifier',
  'cpuOutput', 'cpuOutputBonus2', 'powerOutput', 'powerEngineeringOutputBonus',
]);
function isSubsystem(typeID) {
  const td = TYPES[typeID] ?? TYPES[String(typeID)];
  return td?.c === SUBSYSTEM_CATEGORY;
}

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
export function differingAttributes(typeIDs, { limit = 6, extraAttrs = null } = {}) {
  const ids = [...new Set(typeIDs.filter(Boolean))];
  if (ids.length < 2 && !extraAttrs) return [];
  // Subsystems get an ALLOWLIST rather than the usual exclusions — see SUBSYSTEM_FITTING_ATTRS. The
  // cap is lifted with it: the allowlist is nine attributes long, so there is nothing to crowd out,
  // and truncating at six could hide a slot change, which is the most important row here.
  const subsystemMode = ids.every(isSubsystem);
  const cap = subsystemMode ? Math.max(limit, SUBSYSTEM_FITTING_ATTRS.size) : limit;
  // `extraAttrs` is the MUTATED baseline (see compareRows). It scores as one more candidate so that
  // a rolled attribute still surfaces when every stock variant in the family agrees on it — which is
  // the common case for the attributes mutaplasmids touch, and would otherwise hide the roll itself.
  const maps = extraAttrs ? [...ids.map(attrsOf), ...(Array.isArray(extraAttrs)?extraAttrs:[extraAttrs])] : ids.map(attrsOf);
  const keys = new Set();
  for (const m of maps) for (const k of Object.keys(m)) {
    if (subsystemMode) { if (SUBSYSTEM_FITTING_ATTRS.has(k)) keys.add(k); continue; }
    if (IGNORED.has(k) || ID_VALUED_RE.test(k) || NPC_FACING_RE.test(k) || /^(meta|tech)Level/i.test(k)) continue;
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
  //
  // The index is not always a SUFFIX: a command burst's four buff slots are `warfareBuff1Value` …
  // `warfareBuff4Value`, all carrying the same number. Matching trailing digits only, this family
  // never collapsed and spent four of the six rows restating one value. The stem therefore keeps
  // whatever follows the digits (`warfareBuff#Value`), so siblings group but `emDamage` and
  // `kineticDamage` — different text after the digits — still cannot be confused for each other.
  const vecOf = k => maps.map(m => (typeof m[k] === 'number' ? m[k] : 0)).join(',');
  const keptStems = new Map();
  const out = [];
  for (const { key } of scored) {
    const m = /^(.*?)(\d+)(.*)$/.exec(key);
    if (m) {
      const stem = `${m[1]}#${m[3]}`, vec = vecOf(key);
      const prev = keptStems.get(stem);
      if (prev === vec) continue;            // same family, same numbers — already represented
      if (prev === undefined) keptStems.set(stem, vec);
    }
    out.push(key);
    if (out.length >= cap) break;
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
 * The same magnitude rule, inverted, covers the signed EWAR/assist BONUS family. On these, the SIGN
 * says which way the module pushes the attribute and the MAGNITUDE says how hard — so the sign is a
 * property of the module CLASS, not of whether one variant beats another. A Guidance Disruptor II
 * carries `aoeVelocityBonus = -12` against a Guidance Disruptor I's -10: more negative means it
 * cripples the target's missiles harder, i.e. it is the better disruptor. CCP flags every one of
 * them highIsGood=1, which reads -12 as the worse number and coloured the stronger module red.
 *
 * Each attribute here was checked to be sign-consistent within every fittable module group in the
 * bundle (a disruptor's whole variant set is negative, its guidance-computer counterpart's whole set
 * is positive), which is what makes comparing magnitudes safe — a comparison never mixes the two.
 * The only mixed-sign carriers are Effect Beacons, which are system effects and never comparable
 * module variants.
 */
// ── Derived direction: ask the module's OWN effects what the attribute does ────────────────────
//
// The hand-maintained lists below were losing a race. Every few weeks another attribute turned up
// coloured backwards (explosion velocity, stasis webs, cap need), each needing its own entry, and
// there was no way to know what the NEXT one would be. The reason is that CCP's highIsGood
// describes the ATTRIBUTE IN ISOLATION, while the question the compare view is asking is "does a
// bigger number here make this module better for me" — and that depends on two things highIsGood
// cannot see: what the attribute is applied TO, and WHO it is applied to.
//
// Both are in the dogma data. Each module carries its effect ids, and an effect's modifier says
// which attribute it reads (modifyingAttributeID), which it changes (modifiedAttributeID), how
// (operation), and on whom (domain). So:
//
//   larger modifier  --operation-->  larger or smaller target attribute
//   larger target attribute  --target's own highIsGood-->  better or worse
//   ...and if the domain is a hostile TARGET, invert: hurting them helps you.
//
// Worked through, that is `better = (increases === correctedHighIsGood) !== hostile`. It gets the
// reported case right (capNeedBonus lowers capacitorNeed, which is lower-is-better, so -20 beats
// -15) and — the reason a blanket "negative means magnitude" rule was rejected — it also gets the
// DRAWBACK case right: a Capacitor Power Relay's shieldBoostMultiplier is likewise negative, but it
// lowers shieldBonus, which is higher-is-better, so -5 genuinely beats -11.
//
// It resolves nothing for effects CCP ships EMPTY, which is most EWAR (webs, tracking and guidance
// disruptors, prop mods). Those keep the explicit list below as a fallback — see SIGNED_BONUS_RE.
//
// eos operation numbering: -1 PreAssign, 0 PreMul, 1 PreDiv, 2 ModAdd, 3 ModSub, 4 PostMul,
// 5 PostDiv, 6 PostPercent, 7 PostAssign. Divide and subtract invert the direction; an operation
// in neither set is left UNRESOLVED rather than guessed at.
const OP_INCREASES = new Set([-1, 0, 2, 4, 6, 7]);
const OP_DECREASES = new Set([1, 3, 5]);

/**
 * HOSTILE domains are deliberately NOT derived — the data cannot answer them.
 *
 * "Bad for the target is good for me" sounds like it should just be an inversion, and for a stasis
 * webifier it is: the target attribute is maxVelocity, the victim's own stat, and slowing them
 * helps. But a warp scrambler's target attribute is `warpScrambleStatus`, which is not the victim's
 * stat at all — it is the attacker's win condition, already written from our side, and inverting it
 * says a strength-1 scrambler beats a strength-2. Nothing in the data distinguishes the two, so
 * deriving a hostile modifier is a coin flip. These fall through to SIGNED_BONUS_RE, which already
 * covers the EWAR families correctly and is pinned by tests.
 */
const HOSTILE_DOMAINS = new Set(['targetID', 'target']);

/**
 * Attributes whose highIsGood CCP has simply got wrong.
 *
 * The derived rule is only ever as good as the flag on the attribute it lands on, and the industry
 * multipliers are a systematic error: `attributeAdvCompManufactureTimeMultiplier` and its ~50
 * siblings (manufacture/research/invention/reaction time, material and cost) are all flagged
 * highIsGood=1, when the whole point of the rig applying a -20% is to drive the multiplier DOWN.
 * `mass` is the same shape on a ship — flagged high-is-good, but an armor plate's added tonnage is
 * a cost, not a benefit.
 *
 * The fighter explosion radii are a third: CCP flags the missile's own `aoeCloudSize` 0, correctly,
 * and then flags `fighterAbilityMissilesExplosionRadius` and its Attack sibling 1. A smaller blast
 * radius applies better against a small target no matter who carries it, so an Omnidirectional
 * Tracking Link II's −8.25% beat a I's −5.5% while being painted as the worse module.
 *
 * Kept as patterns rather than a list of 50 names because the family is open-ended: CCP adds a new
 * manufacturing category and its multiplier arrives mis-flagged exactly like the others.
 *
 * This applies to an attribute read DIRECTLY as well as to one arrived at through an effect. It was
 * consulted only on the effect path at first, which split the file against itself: mass was declared
 * a cost here, and then the fallback at the bottom of directionOf asked CCP's raw flag and painted a
 * heavier hull green. The correction belongs to the attribute, not to the route taken to reach it.
 */
const LOWER_IS_BETTER_TARGET_RE = /((Time|Material|Mat|Cost)Multiplier|ExplosionRadius)$/;
// `upgradeCost` is calibration, and CCP flags it high-is-good — a rig that eats more of the 400 points
// is painted as the better rig. It stayed invisible while the only consumer was the attribute list,
// which drops it into the glyph line via IGNORED; the per-attribute locks read direction for every
// attribute the sort sheet offers, and a calibration lock would have kept exactly the wrong half.
const LOWER_IS_BETTER_TARGETS = new Set(['mass', 'strEngMatBonus', 'upgradeCost']);
function correctedHighIsGood(attrID) {
  const name = ATTR_ID_TO_NAME[attrID];
  if (name && (LOWER_IS_BETTER_TARGET_RE.test(name) || LOWER_IS_BETTER_TARGETS.has(name))) return false;
  return attrHighIsGood(attrID);
}

const _derivedCache = new Map();
/**
 * true = bigger is better, false = smaller is better, null = the data does not say.
 * Exported for the regression suite: "the rule declines to answer for hostile modifiers" is the
 * load-bearing half of this design, and the only fixture that would show it through compareRows
 * (warpScrambleStrength) is constant across the Warp Scrambler group and so never displayed.
 */
export function derivedDirection(typeID, key) {
  const ck = `${typeID}|${key}`;
  if (_derivedCache.has(ck)) return _derivedCache.get(ck);
  const td = TYPES[typeID] ?? TYPES[String(typeID)];
  const attrID = ATTR_NAME_TO_ID[key];
  let verdict = null;
  outer:
  for (const eid of (td?.e ?? [])) {
    for (const m of (EFFECTS_DATA?.[eid]?.m ?? [])) {
      if (m.modifyingAttributeID !== attrID) continue;
      if (HOSTILE_DOMAINS.has(m.domain)) { verdict = null; break outer; }   // see HOSTILE_DOMAINS
      const increases = OP_INCREASES.has(m.operation) ? true
                      : OP_DECREASES.has(m.operation) ? false : null;
      if (increases === null) { verdict = null; break outer; }   // unknown operation — say nothing
      const better = increases === correctedHighIsGood(m.modifiedAttributeID);
      // Two effects on the same module disagreeing about the same attribute means we cannot
      // honestly pick a direction — fall through to the rules below rather than take the first.
      if (verdict !== null && verdict !== better) { verdict = null; break outer; }
      verdict = better;
    }
  }
  _derivedCache.set(ck, verdict);
  return verdict;
}

// ── Derived values ──────────────────────────────────────────────────────────────────────────────
/**
 * The numbers a module is actually chosen by, which CCP does not store because each is a RATIO of
 * two attributes it does store.
 *
 * This is the question the attribute list cannot answer. A rolled shield booster that gained 8% shield
 * and lost 6% cycle time shows one green arrow and one red one, and nothing on the row says which
 * won — the comparison hands back the two halves of a division and leaves the user to do it on a
 * phone, across thirty contracts. Sorting by either half is worse than useless: sort by amount and
 * the longest cycles float to the top.
 *
 * Keyed under a `derived:` prefix that no dogma attribute can collide with, because these travel in
 * the same `values` bag as real attributes so that sorting, the per-attribute locks and the row
 * display all reach them through the paths they already use. The prefix is also what keeps them out
 * of a MutaMarket URL: `abyssalAttrSpan` matches against mutaplasmid attribute names, finds nothing,
 * and `attrFilterFor` returns no filter rather than a name the server would 400 on (mutamarket.js
 * trap 6).
 */
const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;
const ratio = (n, d) => (n != null && d != null && d > 0) ? n / d : null;
// Local reps, remote reps and hull reps each name their amount differently; a module carries exactly
// one of the three, so first-present is a selection and not a precedence.
function repairAmount(a) {
  const amount = num(a.shieldBonus) ?? num(a.armorDamageAmount) ?? num(a.structureDamageAmount);
  if (amount === null) return null;
  // An Ancillary Armor Repairer loaded with Nanite Repair Paste reps x3, and nobody runs one unpasted
  // — the module exists for the boosted cycle. It shares a variation family with the plain repairers
  // (`variantsOf` lists Large Ancillary Armor Repairer among Large Armor Repairer II's variants), so
  // leaving it out would file the strongest module in the list at a third of its output. Read from
  // the same attribute calc.js uses for its own AAR branch, so the two cannot drift apart.
  return amount * (num(a.chargedArmorDamageMultiplier) ?? 1);
}
const DERIVED = {
  'derived:repairPerSecond': a => ratio(repairAmount(a), num(a.duration) / 1000),
  // Sustain, as opposed to burst. Note an Ancillary Shield Booster reads pessimistically here: its
  // stored capacitorNeed is the UNLOADED cycle, and loaded with cap boosters it costs the ship
  // nothing until the clip runs dry. That is a floor on the real figure, not a wrong number, and it
  // is the same value the Activation Cost row beside it shows.
  'derived:repairPerCap':    a => ratio(repairAmount(a), num(a.capacitorNeed)),
  'derived:yieldPerSecond':  a => ratio(num(a.miningAmount), num(a.duration) / 1000),
  // A damage mod's whole trade. Turrets carry `damageMultiplier` and launchers
  // `missileDamageMultiplierBonus`, both against `speedMultiplier` — the multiplier the weapon's
  // cycle time is divided by, so dividing by it is what turns damage-per-shot into damage-per-time.
  // Both halves are required. A Drone Damage Amplifier carries neither — its damage lives on
  // `droneDamageBonus`, a flat percentage with no cycle to divide by — and rating a lone damage
  // multiplier against an implied 1.0 would just restate the attribute already on the row.
  'derived:damagePerTime':   a => {
    const dmg = num(a.damageMultiplier) ?? num(a.missileDamageMultiplierBonus);
    return ratio(dmg, num(a.speedMultiplier));
  },
};
export const DERIVED_KEYS = new Set(Object.keys(DERIVED));
/** Every derived value a set of attributes supports, as `{['derived:x']: number}`. */
export function derivedAttributes(attrs) {
  const out = {};
  for (const [key, fn] of Object.entries(DERIVED)) {
    const v = fn(attrs ?? {});
    if (v !== null && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

const PENALTY_RE = /Penalty$/;
const SIDE_EFFECT_CHANCE_RE = /^boosterEffectChance\d*$/;
// `speedFactor` is the clearest case in the family and the one most easily missed: a Stasis
// Webifier II carries −60 against a Stasis Webifier I's −50, and the −60 is the better web. The
// SAME attribute is +60…+520 on propulsion modules, where bigger is also better — which is exactly
// why magnitude, not sign, is the rule. It also covers Stasis Grapplers (−80…−88), Structure Stasis
// Webifiers and webifying drones, all of which had the identical reversed colouring.
const SIGNED_BONUS_RE = /^(aoeCloudSizeBonus|aoeVelocityBonus|missileVelocityBonus|explosionDelayBonus|trackingSpeedBonus|maxRangeBonus|falloffBonus|maxTargetRangeBonus|scanResolutionBonus|speedFactor)$/;
// `signatureRadiusBonus` means opposite things depending on who it lands on, and — unlike
// speedFactor above — the SIGN can't tell you which: both cases apply a POSITIVE value. An MWD/AB
// applies it to its OWN ship (bigger sig is bad); a Target Painter or Structure Disruption Battery
// applies the identical attribute to a locked TARGET (bigger is a bigger debuff on the enemy, and is
// the improvement). Neither is a real modifierInfo entry derivedDirection can read — both are
// hardcoded engine/calc passes (MWD's Effect6730, the EWAR modules' calc.js dispatch) that ship with
// empty modifierInfo — so this is keyed off the module's group name, mirroring calc.js's own
// group-name dispatch for the exact same attribute (see the 'Target Painter' branch there).
const TARGET_FACING_SIG_GROUPS = new Set(['Target Painter', 'Structure Disruption Battery']);
export function directionOf(k, v, b, typeID) {
  if (v == null || b == null) return null;
  // Every derived value is a rate — repaired HP per second, per GJ, damage per unit of cycle time —
  // and more of it is the reason anyone sorted by it. There is no dogma flag behind these keys, so
  // without this they would depend on `attrHighIsGood` happening to default an unknown attribute to
  // high-is-good, which is a coincidence rather than a decision — and a future derived key that is
  // lower-is-better (a cap DRAIN per second, say) has to be caught here rather than inherit this.
  if (DERIVED_KEYS.has(k))      return v > b;
  // The booster side-effect family first: CCP flags every one highIsGood=1 AND signs them
  // inconsistently, so neither the derived rule nor the raw flag can be trusted for them.
  if (PENALTY_RE.test(k))       return Math.abs(v) < Math.abs(b);   // weaker penalty wins
  if (SIDE_EFFECT_CHANCE_RE.test(k)) return v < b;                  // less chance of a side effect
  if (k === 'signatureRadiusBonus') {
    const gn = TYPES[typeID]?.gn ?? TYPES[String(typeID)]?.gn;
    if (TARGET_FACING_SIG_GROUPS.has(gn)) return v > b;             // bigger debuff on the target wins
  }
  // What the module's own effects say it does. Authoritative where it resolves.
  const derived = derivedDirection(typeID, k);
  if (derived !== null)         return derived ? v > b : v < b;
  if (SIGNED_BONUS_RE.test(k))  return Math.abs(v) > Math.abs(b);   // stronger bonus wins
  return correctedHighIsGood(ATTR_NAME_TO_ID[k]) ? v > b : v < b;
}

/**
 * Which sort direction puts the BEST value first, for a freshly picked attribute.
 *
 * There is no flag to read for this. `directionOf` is the only thing that knows which way is better,
 * and it answers about a PAIR — so ask it about the pair that spans the list: the largest and the
 * smallest value actually present. If the largest is the better one, the best-first order is 'desc'.
 *
 * It must be asked with REAL values, never a synthetic 1-vs-0 probe: half of `directionOf`'s rules
 * compare magnitudes, so a web's speedFactor of -60 beats -50 and a probe on the numbers 1 and 0
 * would answer backwards. The extremes are picked in DISPLAY space because that is the space the
 * sort itself runs in — a Rate of Fire shown as +11.7% is stored as a cycle-time divisor of 0.895,
 * and the two orderings are opposites.
 *
 * Fewer than two distinct values means there is nothing to learn, so 'asc' stands: that is what
 * keeps 'price' cheapest-first (rows carry no `values.price`) and leaves the by-name sorts alone.
 *
 * Rows MISSING the attribute are dropped before the extremes are picked, and screening the DISPLAY
 * value covers both halves at once — a null survives `toDisplay` as a null or an Infinity, never as
 * a finite number. A leaked one becomes an extreme, `directionOf` answers null for it, and the
 * result quietly degrades to 'asc', which is indistinguishable from having no opinion.
 */
export function bestFirstDirection(key, samples, toDisplay = (_k, v) => v) {
  const usable = (samples ?? []).map(s => ({ ...s, display: toDisplay(key, s?.value) }))
    .filter(s => typeof s.display === 'number' && Number.isFinite(s.display));
  if (usable.length < 2) return 'asc';
  const hi = usable.reduce((a, b) => b.display > a.display ? b : a);
  const lo = usable.reduce((a, b) => b.display < a.display ? b : a);
  if (hi.display === lo.display) return 'asc';
  return directionOf(key, hi.value, lo.value, hi.typeID) === true ? 'desc' : 'asc';
}

/**
 * One comparison row per candidate, each carrying its differing attributes as deltas against
 * `baselineTypeID` (the module currently fitted).
 *
 * `better` is null when the direction is meaningless — an unchanged value, or an attribute CCP has
 * no opinion about. The UI must not colour those; "no change" is not an improvement.
 *
 * `baselineMutations` is an abyssal module's roll, `{attrName: value}` exactly as the engine takes
 * it (a base-value override, see Fit.addModule). An abyssal module keeps its BASE typeID, so without
 * this the deltas are measured against the unrolled item — which is the one number the user already
 * knows is wrong. The rolled row is still `isBaseline`, and its own `stats` come out as zero deltas.
 *
 * When there IS a roll, the unrolled item is emitted a SECOND time as an `isStockBase` row. It shares
 * its typeID with the baseline but is a genuinely different module to fly — a bad roll is often worse
 * than the stock item it came from, and reverting to stock is then the swap you want. Leaving it out
 * made the one variant guaranteed to be relevant the only one the list could not offer. Callers must
 * therefore key rows on typeID PLUS this flag; typeID alone is no longer unique.
 */
export function compareRows(typeIDs, baselineTypeID, { limit = 6, baselineMutations = null } = {}) {
  const rolled = baselineMutations && Object.keys(baselineMutations).length
    ? { ...attrsOf(baselineTypeID), ...baselineMutations } : null;
  const keys = differingAttributes(typeIDs, { limit, extraAttrs: rolled });
  const base = rolled ?? attrsOf(baselineTypeID);
  const row = (typeID, a, flags) => ({ typeID, ...flags, stats: keys.map(k => {
    const v = typeof a[k] === 'number' ? a[k] : null;
    const b = typeof base[k] === 'number' ? base[k] : null;
    const delta = (v != null && b != null) ? v - b : null;
    // Percent is undefined against a zero baseline — an attribute the fitted module simply does
    // not have. The absolute delta still reads fine there, so leave pct null rather than Infinity.
    const pct = (delta != null && b) ? (delta / Math.abs(b)) * 100 : null;
    const better = (delta == null || delta === 0) ? null : directionOf(k, v, b, typeID);
    return { key: k, value: v, delta, pct, better };
  }) });
  const rows = [...new Set(typeIDs.filter(Boolean))].map(typeID => {
    const isBaseline = String(typeID) === String(baselineTypeID);
    // The baseline row must read back its OWN rolled values, or the fitted module appears to differ
    // from itself by exactly the roll.
    return row(typeID, (isBaseline && rolled) ? rolled : attrsOf(typeID), { isBaseline });
  });
  if (rolled) rows.push(row(baselineTypeID, attrsOf(baselineTypeID), { isBaseline: false, isStockBase: true }));
  return rows;
}

/**
 * Rows whose every LOCKED attribute is no worse than the fitted module's.
 *
 * Sorting answers "what is the best X" one attribute at a time, and the answer is usually a module
 * that wins on X by giving up something else. A lock is the other half of that question: hold this
 * one at the fitted value and sort by the next. That is the shape of an actual abyssal purchase —
 * "as much shield as I can get WITHOUT losing CPU" — and it is not expressible by sorting at all.
 *
 * "No worse" deliberately includes EQUAL. A lock is a floor, not a demand for an improvement, and
 * excluding ties would drop every variant that simply matches the module already fitted.
 *
 * Read from `values` rather than from `stats`, which is the whole reason this takes the row and not
 * the delta: `stats` omits cpu, power and upgradeCost — they are shown as the glyph line instead —
 * while the sort sheet offers all three. Judging on `stats` made a CPU lock a silent no-op, which
 * is the worst outcome available here, since a filter that does nothing still reads as one that did.
 *
 * Direction comes from `directionOf`, so a lock on a lower-is-better attribute (capacitorNeed) or a
 * magnitude one (a web's speedFactor) keeps the correct half with no list of special cases here.
 */
export function filterLockedRows(rows, locks) {
  if (!locks?.size) return rows;
  const base = rows.find(r => r.isBaseline)?.values;
  if (!base) return rows;
  return rows.filter(r => {
    // The fitted module is exempt — it is the value every lock is measured against, and a list that
    // dropped its own baseline would show deltas against something no longer on screen.
    if (r.isBaseline) return true;
    return [...locks].every(key => {
      const v = r.values?.[key], b = base[key];
      const has = x => typeof x === 'number' && Number.isFinite(x);
      // Nothing to clear: the fitted module has no value for this attribute at all.
      if (!has(b)) return true;
      // The variant is the one missing it, so it cannot be as good.
      if (!has(v)) return false;
      if (v === b) return true;
      // `null` is "the data does not say which way is better" — hostile modifiers, mostly. Keeping
      // the row is the only safe answer; hiding on a direction we could not resolve would drop
      // variants for no reason the user could see or undo.
      return directionOf(key, v, b, r.typeID) !== false;
    });
  });
}

/**
 * Sorts comparison rows for display. The fitted module is always pinned first — it is the thing
 * every other row is measured against, so burying it mid-list makes the deltas unreadable.
 *
 * `by`: 'price', 'meta', or a named attribute. Attribute ordering uses displayed values;
 * missing attributes and unknown prices remain last in either direction.
 */
export function sortCompareRows(rows, { by = 'price', dir = 'asc', prices, toDisplay=(_key,value)=>value } = {}) {
  const price = r => {
    // A rolled module has no market price, EXCEPT when the row is a contract listing — then the
    // asking price is the whole point of the row, and sorting it as unpriced would sink every
    // market result to the bottom of a price sort.
    const asking = r.record?.price;
    if(typeof asking === 'number' && asking > 0) return asking;
    if(r.mod?.mutations)return Infinity;
    const p = prices?.get?.(Number(r.typeID));
    return (typeof p === 'number' && p > 0) ? p : Infinity;   // unpriced sinks, never sorts as free
  };
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    // The fitted module stays pinned at the top in BOTH directions — it is the baseline every
    // delta is measured from, so flipping the sort must not bury it halfway down the list.
    if (a.isBaseline !== b.isBaseline) return a.isBaseline ? -1 : 1;
    if(by!=='price'&&by!=='meta'){
      const av=a.values?.[by],bv=b.values?.[by];
      const valid=v=>typeof v==='number'&&Number.isFinite(v);
      if(valid(av)!==valid(bv))return valid(av)?-1:1;
      return valid(av)?sign*(toDisplay(by,av)-toDisplay(by,bv)):0;
    }
    const cmp = by === 'meta' ? (compareByMeta(a, b) || (price(a) - price(b))) : (price(a) - price(b));
    // Unpriced rows sort as Infinity, which would float them to the TOP when reversed. Keep them
    // last either way: "we don't know" is not the most expensive thing on the list.
    if (by === 'price') {
      const ua = price(a) === Infinity, ub = price(b) === Infinity;
      if (ua !== ub) return ua ? 1 : -1;
    }
    return sign * cmp;
  });
}
