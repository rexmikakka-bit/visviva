/**
 * dogma-engine.js — EVE Online fitting calculator
 *
 * Driven directly by CCP's FSD dogma modifier data (dogma-types.json,
 * dogma-effects.json, dogma-attrs.json).  No transpiled Python effects.
 * No hand-written handlers except for ~10 effects that Pyfa implements
 * outside the dogma modifier system (Crystal implant set, boosterSideEffect, etc.).
 *
 * Architecture
 * ────────────
 *   AttrMap      – per-item attribute store; computes final value with stacking
 *   DogmaItem    – one fitted/implanted/skill item; owns an AttrMap + effect list
 *   Fit          – collection of items; runs calculate() to apply all modifiers
 *
 * Operation IDs (from EVE FSD dogmaeffects.modifierInfo.operation):
 *   -1  PreAssignment   → force base = value (before all else)
 *    0  PreMul          → base  *= value
 *    2  ModAdd          → base  += value
 *    3  ModSub          → base  -= value
 *    4  PostMul         → post  *= value          (stacking-penalised if attr.stackable=0)
 *    5  PostDiv         → post  *= 1/value
 *    6  PostPercent     → post  *= (1 + value/100)   (same stacking rule)
 *    7  PostAssignment  → post-force = value (last write wins)
 *    9  (SkillLevel)    → internal EVE use; ignored
 *
 * Func types  (modifier.func):
 *   ItemModifier                   – source item → target item (domain decides which)
 *   LocationModifier               – source on ship → all modules in domain
 *   LocationGroupModifier          – source on ship → modules with groupID filter
 *   LocationRequiredSkillModifier  – source on ship → modules requiring skillID
 *   OwnerRequiredSkillModifier     – source char (skill/implant) → modules req. skill
 *   EffectStopper                  – no-op for our purposes
 *
 * Domain (modifier.domain):
 *   shipID   – target is the ship item
 *   itemID   – target is the source item itself (self-buff)
 *   charID   – target is the character (skills → ship attrs via OwnerReqSkill)
 *   otherID  – launcher ↔ charge cross-link
 *   targetID / target – projected onto an external target; ignored for our own fit's stats
 *   structureID – the Structure-category equivalent of shipID (target is the structure), NOT a
 *                 projected domain — only looks that way if you've never fitted a structure.
 *                 Remapped to shipID in _applyEffect when the fit's own ship is a structure.
 */

// ─── Data is injected by initEngine() — works in both Vite and Node.js ───────────
let TYPES = {}, EFFECTS = {}, ATTRS = {};
let SYSTEM_EFFECTS = {};   // environment (Effect Beacon) ops, injected by initEngine
let AID = {}, TYPE_BY_NAME = {};

export function initEngine(types, effects, attrs, systemEffects) {
  TYPES = types; EFFECTS = effects; ATTRS = attrs;
  SYSTEM_EFFECTS = systemEffects ?? {};
  // Convert TYPES attrs from {attrID: value} → {attrName: value}
  const _AID_TO_NAME = {};
  for (const [id, meta] of Object.entries(ATTRS)) {
    if (meta.n) _AID_TO_NAME[id] = meta.n;
  }
  for (const t of Object.values(TYPES)) {
    if (!t.a) continue;
    const named = {};
    for (const [k, v] of Object.entries(t.a)) named[_AID_TO_NAME[k] ?? k] = v;
    t.a = named; t.attrs = named; Object.freeze(named);
  }
  // Build name→ID and name→typeID lookups
  for (const [id, meta] of Object.entries(ATTRS)) if (meta.n) AID[meta.n] = Number(id);
  for (const [tid, t] of Object.entries(TYPES)) if (t.n) TYPE_BY_NAME[t.n] = Number(tid);

  // Drop byte-identical duplicate modifiers within one effect. A single source applying the SAME
  // modifier twice is never correct dogma — eos hand-codes each effect and applies each bonus once —
  // but the modifier lists come from CCP's FSD dump and effect 7098
  // (structureConversionRigBasicBonuses, on all 104 Outpost Conversion Rigs) carries three entries
  // twice. The second application landed in the same stacking pool at the penalised rank, so a
  // 'Draccous' Fortizar with one Outpost rig read scanResolution 384 against pyfa's 130
  // (40 × 3.25 × (1 + 2.25·e^(-1/7.1289)) instead of 40 × 3.25). Cleaned once here rather than in
  // _applyEffect, which runs per module per recalculation. Found by the structure oracle sweep.
  let _dupDropped = 0;
  for (const eff of Object.values(EFFECTS)) {
    const mods = eff?.m;
    if (!Array.isArray(mods) || mods.length < 2) continue;
    const seen = new Set();
    const uniq = [];
    for (const m of mods) {
      const key = JSON.stringify(m);
      if (seen.has(key)) { _dupDropped++; continue; }
      seen.add(key);
      uniq.push(m);
    }
    if (uniq.length !== mods.length) eff.m = uniq;
  }
  initEngine.duplicateModifiersDropped = _dupDropped;
}

export const typeIDByName = (name) => TYPE_BY_NAME[name] ?? null;
export { TYPES, AID };

// ─── Attribute metadata helpers ─────────────────────────────────────────────────
const isStackable = (aid) => (ATTRS[aid]?.s ?? 1) !== 0;
const highIsGood  = (aid) => (ATTRS[aid]?.h ?? 1) !== 0;
const attrDefault = (aid) => ATTRS[aid]?.d ?? 0;
const attrName    = (aid) => ATTRS[aid]?.n ?? String(aid);

// ─── Stacking penalty formula ──────────────────────────────────────────────────
// EVE stacks modifiers sorted by absolute effect, largest first.
// Factor at rank i (0-based): exp(-(i²) / 7.1289)
function stackingFactor(rank) {
  return Math.exp(-(rank * rank) / 7.1289);
}

// Mode modules whose bonuses are ROLE bonuses, exempt from the stacking penalty.
const MODE_MODULE_GROUPS = new Set(['Siege Module', 'Triage Module', 'Bastion Module']);

// System security -> which of the rig's three security modifier attributes applies. CCP models this
// as the client writing the applicable value into `securityModifier`; see the note in calculate().
// wspace uses the nullsec value, matching eos's secMap.
const SEC_MODIFIER_ATTR = {
  hisec:  'hiSecModifier',
  lowsec: 'lowSecModifier',
  nullsec:'nullSecModifier',
  wspace: 'nullSecModifier',
};

// Pilot security-status hull bonuses (CONCORD ships + AT frigates). CCP models these with a chain of
// "intermediary" effects that scale a bonus attr by the pilot's (capped, inverted) sec status, then a
// final effect that applies it to modules. pyfa (eos/effects.py Effect6871/Effect12165) SKIPS the whole
// chain and hand-codes it, reading the *base* bonus attr and multiplying by the real pilot sec. We do
// the same: skip these effects in the generic dispatcher (they'd otherwise apply a bogus static bonus
// and flip the base attr's sign), then reproduce pyfa's logic in _runCustomHandlers (section 5g).
//   6869/6870 (Marshal chain), 6871 (concordSecStatusTankBonus applier),
//   12166/12167/12168 (Sidewinder chain), 12165 (ATFrigDmgBonus applier).
const PILOT_SEC_EFFECTS = new Set([6869, 6870, 6871, 12165, 12166, 12167, 12168]);

function applyStacking(base, mods, aid) {
  // mods: array of raw multipliers (already converted to factors, e.g. 1.05 for +5%)
  if (!mods.length) return base;
  if (isStackable(aid)) {
    // No stacking penalty – just multiply all in order
    let v = base;
    for (const m of mods) v *= m;
    return v;
  }
  // Sort: bonuses (>1) largest first; penalties (<1) most severe first
  const hi = highIsGood(aid);
  const bonuses  = mods.filter(m => hi ? m > 1 : m < 1).sort((a,b) => hi ? b-a : a-b);
  const penalties= mods.filter(m => hi ? m < 1 : m > 1).sort((a,b) => hi ? a-b : b-a);
  let v = base;
  for (let i = 0; i < bonuses.length;   i++) v *= 1 + (bonuses[i]  - 1) * stackingFactor(i);
  for (let i = 0; i < penalties.length; i++) v *= 1 + (penalties[i] - 1) * stackingFactor(i);
  return v;
}

// ─── AttrMap ──────────────────────────────────────────────────────────────────
class AttrMap {
  constructor(baseAttrs) {
    // baseAttrs may be { attrName: value } (from converted TYPES) or { attrID: value }
    // Normalize to { attrID: value } for internal use so applyMod(numericID) works.
    this._base  = {};
    for (const [k, v] of Object.entries(baseAttrs ?? {})) {
      const id = isNaN(k) ? (AID[k] ?? k) : Number(k);
      this._base[id] = v;
    }
    this._orig_named = baseAttrs; // (unused for values; never mutate — it aliases shared TYPES data)
    this._pre   = {};   // attrID → forced pre-value (PreAssignment)
    this._add   = {};   // attrID → accumulated flat add (ModAdd/ModSub)
    this._post0 = {};   // attrID → stacking pool for op=0 PreMul modules (DC II, Bastion resists)
    this._post4 = {};   // attrID → stacking pool for op=4 PostMul modules (Gyrostabs)
    this._post  = {};   // attrID → stacking pool for op=6 PostPercent modules (hardeners, TE/Bastion range/ROF)
    this._postPerc = {}; // attrID → SECONDARY penalised pool (eos penaltyGroup='postPerc'): mode-module
                         //   RoF + overload RoF penalise vs each other but NOT vs the main op4/op6 pool.
    this._mul   = {};   // attrID → direct multipliers (skills, hull bonuses, implants)
    this._force = {};   // attrID → forced post-value (PostAssignment)
  }

  // Override a base attribute value (used for abyssal/mutated modules). Modifiers still apply on top.
  setBase(attrNameOrId, value) {
    if (value == null || isNaN(value)) return;
    const id = isNaN(attrNameOrId) ? (AID[attrNameOrId] ?? attrNameOrId) : Number(attrNameOrId);
    this._base[id] = value;
    // NOTE: do NOT write to _orig_named here — it aliases the shared TYPES attrs object,
    // and mutating it would permanently corrupt the base type data. get()/getBase() use _base.
  }

  // Called by the engine to apply one modifier value
  // direct=true: bypass stacking penalty (skills, hull bonuses, implants, boosters)
  // direct=false: use stacking penalty pool (modules)
  applyMod(attrID, op, value, direct = false, penaltyGroup = null) {
    const aid = Number(attrID);
    if (value == null || isNaN(value)) return;
    // eos penaltyGroup='postPerc': a self-contained penalised group (mode-module RoF + overload RoF).
    // Its members penalise against EACH OTHER but not against the main op4/op6 pool. Convert the op to
    // a raw multiplier and stash it; get() stacks this pool separately.
    if (penaltyGroup === 'postPerc') {
      let mult = null;
      if (op === 6) mult = 1 + value / 100;
      else if (op === 4) mult = value;
      else if (op === 5 && value !== 0) mult = 1 / value;
      if (mult != null) { (this._postPerc[aid] ??= []).push(mult); return; }
    }
    switch (op) {
      case -1: // PreAssignment
        this._pre[aid] = value; break;
      case 0:  // PreMul
        // direct=true  → _base (skills, hull, implants — not stacking-penalised)
        // direct=false → _post0 (separate stacking pool for op=0 module effects)
        //   DC II + Bastion stack with each other (both op=0), but NOT with
        //   hardeners (op=6, which go to _post). EVE keeps these pools separate.
        if (direct) {
          this._base[aid] = (this._base[aid] ?? attrDefault(aid)) * value;
        } else {
          (this._post0[aid] ??= []).push(value);
        }
        break;
      case 2:  // ModAdd
        this._add[aid] = (this._add[aid] ?? 0) + value; break;
      case 3:  // ModSub
        this._add[aid] = (this._add[aid] ?? 0) - value; break;
      case 4:  // PostMul → separate _post4 pool from op=6 PostPercent
        if (direct) this._mul[aid] = (this._mul[aid] ?? 1) * value;
        else (this._post4[aid] ??= []).push(value); break;
      case 5:  // PostDiv
        if (value !== 0) {
          if (direct) this._mul[aid] = (this._mul[aid] ?? 1) / value;
          else (this._post[aid] ??= []).push(1 / value);
        } break;
      case 6:  // PostPercent (+value%)
        if (direct) {          this._mul[aid] = (this._mul[aid] ?? 1) * (1 + value / 100);
        } else {
          (this._post[aid] ??= []).push(1 + value / 100);
        }
        break;
      case 7:  // PostAssignment
        this._force[aid] = value; break;
      // op 9 = skill-level tracking, no-op
    }
  }

  get(attrIDorName, _capping = false) {
    return this._resolve(attrIDorName, null, _capping);
  }

  /**
   * What get() WOULD return with one extra PostPercent modifier in the penalised pool.
   *
   * Not a convenience — it is the only correct way to PREVIEW a modifier that is not applied yet,
   * because adding one to a penalised attribute does not simply scale the current value: it takes
   * a stacking slot, and demotes everything weaker than it by one rank.
   *
   * The case that forced it: a module row shows "OH: n km" for a web while it is still cold. That
   * preview used to be `current * (1 + overloadRangeBonus/100)`, which is only right when nothing
   * else is boosting the range. Under an Interdiction Maneuvers link a Loki's Domination web reads
   * 45.1 km cold and the naive preview promised 65.5 km — but actually overheating it gives 63.3,
   * because the 45% overload bonus outranks the 33.75% burst and pushes the burst into slot two
   * (x0.8691). The preview was writing a cheque the engine would not cash.
   *
   * Shares _resolve with get(), so the preview and the real value cannot disagree about stacking.
   */
  getWithExtraPercent(attrIDorName, pct) {
    return this._resolve(attrIDorName, pct ? 1 + pct / 100 : null, false);
  }

  _resolve(attrIDorName, extraPenalised, _capping = false) {
    // A numeric string is an attribute ID, NOT a name. Three garbage attrs (1847/1848 named "902",
    // 2018 named "2015") carry purely-numeric names that poison the AID name→id map, so an
    // AID-first lookup of e.g. "2015" resolves to attr 2018 (value 0) instead of attr 2015. Reading
    // an effect's numeric modifyingAttributeID via get(String(id)) then silently returned 0 — which
    // dropped the Caldari Tactical Destroyer rate-of-fire bonus (attr 2015) off every Jackdaw fit.
    const aid = typeof attrIDorName === 'number'
      ? attrIDorName
      : (/^\d+$/.test(attrIDorName) ? Number(attrIDorName)
         : (AID[attrIDorName] != null ? AID[attrIDorName] : Number(attrIDorName)));
    // maxAttributeID cap (upper bound), matching pyfa's min(val, cappingValue). The cap is another
    // attribute's MODIFIED value on this item (its default if unset). This is what floors resists at
    // 0% for Polarized weapons: their forced resonance (>>1) is clamped to the *MaxDamageResonance
    // cap of 1.0 instead of running away to -9900%. _capping guards against cap-attr recursion.
    const capAid = _capping ? 0 : ATTRS[aid]?.x;
    const clamp = (v) => {
      if (!capAid) return v;
      const c = this.get(capAid, true);
      return (c == null || isNaN(c)) ? v : Math.min(v, c);
    };
    if (aid in this._force) return clamp(this._force[aid]);
    const pre  = aid in this._pre ? this._pre[aid] : null;
    const base = pre ?? ((this._base[aid] ?? attrDefault(aid)) + (this._add[aid] ?? 0));
    // Stacking groups. EVE penalises PostMul (op4) and PostPercent (op6) TOGETHER — they compete for
    // the same slots on an attribute. We used to penalise each pool separately, so each pool's
    // strongest modifier got factor 1.0 and nothing was ever penalised against a modifier of a
    // different operation. That understated the penalty: a Salvation with an active Integrated Sensor
    // Array (op4 x12 on maxTargetRange) plus an Information Command Burst (op6 +42%) gave the burst
    // full strength -> 6718 km, where pyfa says 6457 km because the burst sits in the SECOND slot
    // (x0.8691).
    //
    // PreMul (op0) keeps its OWN group: folding it in as well regresses the Astarte's armor resists,
    // the Bane's lance DPS and the Minokawa's EHP, so those modifiers do not compete in this group.
    const stacked0 = applyStacking(base, this._post0[aid] ?? [], aid);
    const penalised = [...(this._post4[aid] ?? []), ...(this._post[aid] ?? [])];
    // A hypothetical modifier joins the pool BEFORE stacking is applied — that is the whole point:
    // it has to compete for a slot like any real one.
    if (extraPenalised != null) penalised.push(extraPenalised);
    const stacked = applyStacking(stacked0, penalised, aid);
    // The 'postPerc' pool stacks within itself (base 1) and multiplies in on top — separate from the
    // main penalised pool, so e.g. a Bastion RoF bonus and an overload RoF bonus penalise each other
    // (Bastion slot 1 full, overload slot 2 ×0.8691) without touching the Ballistic Control Systems.
    const postPercMult = applyStacking(1, this._postPerc[aid] ?? [], aid);
    return clamp(stacked * (this._mul[aid] ?? 1) * postPercMult);
  }

  getBase(attrIDorName) {
    const aid = typeof attrIDorName === 'number'
      ? attrIDorName
      : (/^\d+$/.test(attrIDorName) ? Number(attrIDorName)
         : (AID[attrIDorName] != null ? AID[attrIDorName] : Number(attrIDorName)));
    return this._base[aid] ?? attrDefault(aid);
  }
}

// ─── DogmaItem ────────────────────────────────────────────────────────────────
export class DogmaItem {
  constructor(typeID) {
    const tid = Number(typeID);
    const td  = TYPES[tid];
    if (!td) throw new Error(`Unknown typeID: ${tid}`);
    this.typeID       = tid;
    this._td          = td;
    this.attrs        = new AttrMap(td.a ?? {});
    this.state        = 'active';   // 'offline' | 'online' | 'active' | 'overheated'
    this._level       = 0;          // skill level (set by Fit for skills)
    this._charge      = null;       // DogmaItem for loaded charge


  }

  get(attrName)   { return this.attrs.get(attrName); }
  // Preview an unapplied PostPercent modifier with correct stacking — see AttrMap.
  getWithExtraPercent(attrName, pct) { return this.attrs.getWithExtraPercent(attrName, pct); }
  getA(attrID)    { return this.attrs.get(attrID); }
  getBase(n)      { return this.attrs.getBase(n); }

  get name()       { return this._td.n; }
  get groupName()  { return this._td.gn; }
  get groupID()    { return this._td.g; }
  get categoryID() { return this._td.c; }
  get level()      { return this._level; }
  set level(v)     { this._level = v; }

  // A mutated drone's SDE identity is swapped to a size-specific placeholder type (pyfa:
  // getItemWithBaseItemAttribute) — "Medium Mutated Drone" etc — whose OWN requiredSkillN list adds
  // "Mutated Drone Specialization" on top of the base item's requirements (Drones, Medium Drone
  // Operation, ...). We mutate the base item's attributes in place rather than swapping typeID, so
  // that extra requirement has to be added by hand here, or every bonus gated on it (Effect1730's
  // damage bonus, the mining-amount equivalent) silently reads as "doesn't apply" on every abyssal
  // drone roll.
  requiresSkill(skillName) {
    if ((this._td.rs ?? []).includes(skillName)) return true;
    if (skillName === 'Mutated Drone Specialization' && this._mutations && this.categoryID === 18) return true;
    return false;
  }

  // Effect IDs from type data
  get effectIDs() { return this._td.e ?? []; }
}

// Effects that fire while a module is merely FITTED — including at state 'offline'. eos marks these
// with `type = 'offline'` on the effect class (eos/effects.py); there is no equivalent flag in
// eve.db, whose dgmeffects table has only published/isAssistance/isOffensive/resistanceID, and whose
// effectCategory for 854 is 0 (passive). So this list is transcribed from eos and is the COMPLETE
// set it defines (854, 3046, 6737, 11714).
//
//   854  cloakingScanResolutionMultiplier — a fitted cloak halves scanResolution even offline. This
//        is a pyfa modelling convention (in game the penalty applies while cloaked), and pyfa is the
//        reference: a Stork with an OFFLINE Prototype Cloaking Device read 594 scan res against
//        eos's 296.875 — exactly 2x — until this was honoured.
//   3046 modifyMaxVelocityOfShipPassive — Expanded Cargoholds slow the ship whenever fitted.
//
// 6737 (command burst charge multipliers) and 11714 (Disruptive Lance blocks cloaking) are eos's
// other two, deliberately NOT here: 6737 is charge-side and calc.js already reads warfare buffs off
// the charge directly, and 11714 only sets activationBlocked, which we do not model.
const OFFLINE_STATE_EFFECTS = new Set([854, 3046]);

// ─── Effect category → active state mapping ───────────────────────────────────
// effectCategory: 0=passive, 1=activation(always?), 2=target, 4=online, 5=active, 6=overheat
function effectActiveForState(effectCat, itemState) {
  if (effectCat === 0) return itemState !== 'offline';          // passive: online+
  if (effectCat === 4) return itemState !== 'offline';          // online: online+
  if (effectCat === 1) return itemState !== 'offline';          // always
  if (effectCat === 5) return itemState === 'active' || itemState === 'overheated';
  if (effectCat === 6) return itemState === 'overheated';
  return false;
}

// A skill's PRESCALE effect multiplies one of the skill's own bonus attributes by attr 280
// (skillLevel), turning a per-level figure into the trained one. Anything reading that attribute
// has to run after it. Detected by shape rather than by an ID list so a new skill is covered on the
// next bundle regeneration; the arrays are per-type and immutable, so the order is cached on them.
const _skillOrder = new WeakMap();
const _isPrescale = eid => {
  const m = EFFECTS[eid]?.m;
  return !!m?.length && m.every(x => x.func === 'ItemModifier' && x.domain === 'itemID' && x.modifyingAttributeID === 280);
};
function skillPassOrder(effectIDs) {
  let ordered = _skillOrder.get(effectIDs);
  if (ordered) return ordered;
  const pre = effectIDs.filter(_isPrescale);
  ordered = (pre.length && pre.length < effectIDs.length)
    ? [...pre, ...effectIDs.filter(e => !_isPrescale(e))]
    : effectIDs;
  _skillOrder.set(effectIDs, ordered);
  return ordered;
}

// ─── Fit ──────────────────────────────────────────────────────────────────────
export class Fit {
  // Booster side-effect penalty effects — skipped by default (matches Pyfa default behaviour)
  static BOOSTER_PENALTY_EFFECTS = new Set([2735, 2736, 2737, 2739, 2741, 2745, 2746, 2747, 2748, 2749, 2791, 4970]);
  // A Crystal-set shield-boost implant (Alpha–Epsilon of ANY grade: standard/mid/high) carries BOTH
  // shieldBoostMultiplier (its per-slot bonus) and implantSetGuristas (the set multiplier). Omega has
  // only implantSetGuristas. We skip Effect1395 for these members because the custom set handler
  // re-applies the FULL set-boosted value in one step (avoiding a double count). Detect by attribute
  // presence, NOT hardcoded typeIDs — the old mid-grade-only list (22107–22111) let the high-grade set
  // (20121/20157–20160) fall through, double-applying its base +1..+5% (Whiptail shield tank +15.9%).
  static isCrystalSetMember(item) {
    const a = item._td?.a ?? {};
    return ('shieldBoostMultiplier' in a) && ('implantSetGuristas' in a);
  }

  constructor(shipTypeID) {
    const tid = Number(shipTypeID);
    if (!TYPES[tid]) throw new Error(`Unknown ship typeID: ${tid}`);
    this.ship      = new DogmaItem(tid);
    // Where the structure is anchored. Only affects structure rigs (see calculate() step 1b).
    // Defaults to nullsec because eos does, and pyfa is the reference implementation.
    this.systemSecurity = 'nullsec';
    this._modules  = [];   // DogmaItem[]
    this._implants = [];
    this._boosters = [];
    this._shipMode = null;  // T3 destroyer tactical mode item
    this._subsystems = [];  // T3 cruiser subsystem items
    this._drones   = [];
    this._skills   = {};   // skillName → level (integer)
    this._skillItems = {}; // skillName → DogmaItem (cached)
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  addModule(typeID, state = 'active', mutations = null) {
    const item = new DogmaItem(typeID);
    item.state = state;
    item._mutations = mutations || null;
    if (mutations) for (const [k, v] of Object.entries(mutations)) item.attrs.setBase(k, v);
    this._modules.push(item);
    return item;
  }
  addImplant(typeID) {
    const item = new DogmaItem(typeID);
    this._implants.push(item);
    return item;
  }
  addBooster(typeID) {
    const item = new DogmaItem(typeID);
    this._boosters.push(item);
    return item;
  }
  // T3 destroyer tactical mode (e.g. "Jackdaw Defense Mode") — a real dogma type whose
  // cat-0 effects apply PostDiv hull bonuses. Processed like an implant (direct=true,
  // no stacking penalties), matching EVE/pyfa semantics for mode bonuses.
  setShipMode(typeID) {
    this._shipMode = typeID ? new DogmaItem(typeID) : null;
    return this._shipMode;
  }
  // ENVIRONMENT — the system the fit is sitting in: a wormhole class effect, a metaliminal storm,
  // an event beacon ("Effect Beacon", group 920). Not something you fit; it is the dogma carrier
  // for the system's modifiers, projected onto everything in it. CCP ships no modifierInfo for
  // these, so they arrive inert and are driven from src/data/system-effects.json — see
  // _applyEnvironment() and scripts/build-system-effects.py.
  setEnvironment(typeID) {
    this._environment = typeID ? new DogmaItem(typeID) : null;
    return this._environment;
  }
  // T3 cruiser subsystems (Core/Defensive/Offensive/Propulsion). Each is a real dogma type
  // whose effects apply hull/slot bonuses. Processed like the ship mode: direct, non-penalized,
  // before modules so their attribute changes (CPU/PG reductions, etc.) are visible to modules.
  setSubsystems(typeIDs) {
    this._subsystems = (typeIDs || []).filter(Boolean).map(tid => new DogmaItem(tid));
    return this._subsystems;
  }
  addDrone(typeID, mutations = null) {
    const item = new DogmaItem(typeID);
    item._mutations = mutations || null;
    if (mutations) for (const [k, v] of Object.entries(mutations)) item.attrs.setBase(k, v);
    this._drones.push(item);
    return item;
  }
  setSkill(name, level) { this._skills[name] = Number(level) || 0; }
  getSkillLevel(name)   { return this._skills[name] ?? 0; }

  // ── calculate() ─────────────────────────────────────────────────────────────
  // Reset all items to base, then apply every active modifier.
  calculate() {
    this._boosterSet = new Set(this._boosters);
    // 1. Reset all attrs to base values
    const reset = (item) => { item.attrs = new AttrMap(item._td.a ?? {}); if (item._mutations) for (const [k, v] of Object.entries(item._mutations)) item.attrs.setBase(k, v); };
    reset(this.ship);
    for (const m of this._modules)  reset(m);
    for (const i of this._implants) reset(i);
    for (const b of this._boosters) reset(b);
    if (this._shipMode) reset(this._shipMode);
    for (const s of this._subsystems) reset(s);
    for (const d of this._drones)   reset(d);
    for (const m of this._modules)  if (m._charge) reset(m._charge);

    // 1b. System security → `securityModifier`. Structure rig bonuses scale with where the
    // structure is anchored: CCP ships hiSecModifier/lowSecModifier/nullSecModifier on the rig and
    // has the CLIENT write the applicable one into `securityModifier`, which Effect6672 then
    // PostMuls into every bonus attribute (scan res, lock range, PD range, missile velocity, ...).
    // Our bundle carries `securityModifier` frozen at its hisec value of 1, so every structure
    // combat rig was 20% weak in low/null. Setting the attribute here — before any effect runs — is
    // enough; effect 6672 is present with real modifiers and does the rest through normal dogma.
    // Defaults to NULLSEC because that is what eos defaults to (Fit.getSystemSecurity), and pyfa is
    // the reference. 167 structure modules carry these attributes.
    {
      const key = SEC_MODIFIER_ATTR[this.systemSecurity] ?? SEC_MODIFIER_ATTR.nullsec;
      for (const m of this._modules) {
        const sec = m._td?.a?.[key];
        if (sec != null) m.attrs.setBase('securityModifier', sec);
      }
    }
    this._skillItems = {};

    // 2. Skill pass (runs FIRST — skills modify module attrs before modules read them) (runs once, after item effects but BEFORE ship hull effects)
    //    Skills scale ship bonus attributes (e.g. Effect605: skillLevel→shipBonusMB2)
    //    which must be ready before ship hull effects read them (Effect8106 reads shipBonusMB2).
    // NOTE: structures still run the skill pass (unlike an earlier version of this fix) — a
    // character's skills DO enhance modules/charges fitted to a structure (e.g. "Structure Missile
    // Systems" boosts structure missile charge damage exactly like Warhead Upgrades does for a
    // ship). What must NOT happen is a skill writing directly to the STRUCTURE's own hull
    // attributes (shieldCapacity/armorHP/hp) the way Hull Upgrades/Shield Management/Mechanics do
    // for a ship — a structure isn't personally piloted, so that specific case (ItemModifier,
    // domain=shipID, source=a skill) is blocked in _applyEffect below, not here.
    // An UNTRAINED skill still has to run. Its prescale effect is what turns a hull's raw per-level
    // bonus attribute into the trained value (Effect520: shipBonusCC ×= skillLevel), so skipping the
    // skill leaves the attribute at its raw per-level figure and the hull effect then applies it as
    // though the skill were at I. A Caracal with Caldari Cruiser untrained read an 11.4 s launcher
    // cycle against eos's 12.0 s — a phantom 5% rate-of-fire bonus. Level 0 zeroes every bonus
    // attribute instead, which is what eos does (it carries a Skill object at every level).
    for (const [skillName, level] of Object.entries(this._skills)) {
      let skillItem = this._skillItems[skillName];
      if (!skillItem) {
        const tid = TYPE_BY_NAME[skillName];
        if (!tid || !TYPES[tid]) continue;
        skillItem = new DogmaItem(tid);
        this._skillItems[skillName] = skillItem;
      }
      skillItem.attrs = new AttrMap(skillItem._td.a ?? {});
      skillItem.level = level;
      // Inject attrID 280 (skillLevel) = actual level.
      // CCP's dogma effects use skillLevel as a multiplicative source:
      // e.g. Effect280: cpuOutputBonus2 = cpuOutputBonus2_base × skillLevel
      // Without this, all skill scaling effects produce zero.
      skillItem.attrs._base[280] = level;
      // A skill's own bonus attributes are scaled by level by a PRESCALE effect on the skill itself
      // (bombLauncherReactivationDelayBonus ×= skillLevel). CCP's list order does not guarantee it
      // comes before the effect that reads the scaled value, and for 35 modifiers across ~24 skills
      // it does not: Bomb Deployment lists its consumer (3036) at index 1 and its prescale (8469) at
      // index 2, so the -10% per level arrived as a flat -10%. Run prescales first, stable within
      // each group, so a skill is fully scaled before anything reads it.
      for (const eid of skillPassOrder(skillItem.effectIDs)) {
        this._applyEffect(eid, skillItem, level, true);  // skills are non-penalized
      }
    }

    // 2b. Pre-module hull role bonus for armor plates / shield extenders. Supercarriers use effect 6614
    //     ("400% bonus to Armor Plates and Shield Extenders", shipBonusRole2=400) and titans use effect
    //     6641 (same bonus, shipBonusRole2=500 → ×6). Boosts the plate's armorHPBonusAdd and the
    //     extender's capacityBonus, and MUST run before the module pass — the plate/extender effects then
    //     propagate those (boosted) attrs into ship armorHP/shieldCapacity.
    if (this.ship.effectIDs.includes(6614) || this.ship.effectIDs.includes(6641)) {
      const roleBonus = this.ship.get('shipBonusRole2');
      if (roleBonus) {
        for (const m of this._modules) {
          if (m.state === 'offline') continue;
          const ta = m._td?.a ?? {};
          if (ta.armorHPBonusAdd != null) m.attrs.applyMod(AID.armorHPBonusAdd, 6, roleBonus, true);
          if (ta.capacityBonus   != null) m.attrs.applyMod(AID.capacityBonus,   6, roleBonus, true);
        }
      }
    }

    // 2c. Pre-module hull location modifiers. Hull effects that target MODULE attributes
    //     (LocationGroupModifier, LocationModifier, LocationRequiredSkillModifier with domain=shipID)
    //     must run BEFORE the module pass. A module may read its own hull-modified attr and use that
    //     value when contributing to a ship attr (e.g. Effect1959 reads massAddition to add ship mass).
    //     If the hull effect ran after (step 4), the module would have already written the wrong value.
    //     Example: Cybele effect 11992 reduces armor-plate massAddition by 100% (role bonus: plates are
    //     effectively massless). Plates then read massAddition in effect 1959 and add it to ship mass.
    //     Running 11992 after step 3 lets plates add 2.5M kg that should have been zeroed — the ship
    //     ends up 2.5M kg heavier than pyfa, giving 4305 m/s MWD speed instead of the correct 4689.
    //
    //     Safety: hull effects always read HULL attrs (shipBonusXYZ etc.) as their source, which are
    //     set at base time or skill-scaled in step 2. Modules do not write to hull bonus attrs, so
    //     pre-applying is always equivalent to applying post-step-3 for these effects.
    const _preHullLocFuncs = new Set(['LocationModifier','LocationGroupModifier','LocationRequiredSkillModifier']);
    const _preAppliedHullEIDs = new Set();
    for (const eid of this.ship.effectIDs) {
      if (eid === 6614 || eid === 6641) continue;
      if (PILOT_SEC_EFFECTS.has(eid)) continue;  // hand-coded in _runCustomHandlers (section 5g)
      const edata = EFFECTS[eid];
      if (!edata || !edata.m?.length) continue;
      if (edata.m.some(mod => _preHullLocFuncs.has(mod.func) && mod.domain === 'shipID')) {
        this._applyEffect(eid, this.ship, null, true);
        _preAppliedHullEIDs.add(eid);
      }
    }

    // 2d. ENVIRONMENT (wormhole class effect / metaliminal storm / event beacon). pyfa marks every
    //     one of these `runTime = 'early'`, and that is load-bearing rather than cosmetic: the
    //     overload effects boost attributes like overloadHardeningBonus which a module's OWN
    //     overload effect then reads in step 3. Applied after that pass instead, the module has
    //     already consumed the un-boosted value — a Lachesis in a C6 Red Giant read 84.2% armor
    //     explosive resist against eos's 92.3.
    this._applyEnvironment();

    // 2e. IMPLANT SET amplification. Also `runTime = 'early'` in pyfa, and for the same structural
    //     reason as the environment above: the set effect multiplies each member's own BONUS
    //     attribute, and it is the member's ordinary effect (in step 3) that carries that bonus to
    //     the ship. Run it afterwards instead and the ship has already taken the un-amplified value,
    //     leaving only the option of applying the difference as a SECOND modifier — which compounds
    //     rather than combines. See _amplifyImplantSets.
    this._amplifyImplantSets();

    // 3. Run effects for all non-ship items (modules read skill-modified attrs) (implants, boosters, modules, drones)
    //    The ship runs AFTER skills so skill-scaled ship attrs are ready.
    const nonShipGroups = [
      ...(this._shipMode ? [{ item: this._shipMode, isModule: false, isBooster: false }] : []),
      ...this._subsystems.map(s => ({ item: s, isModule: false, isBooster: false })),
      ...this._implants.map(i => ({ item: i, isModule: false, isBooster: false })),
      ...this._boosters.map(i => ({ item: i, isModule: false, isBooster: true })),
      // OFFLINE modules are included, but only OFFLINE_STATE_EFFECTS fire for them (gated below).
      ...this._modules.map(i => ({ item: i, isModule: true, isBooster: false })),
      ...this._drones.map(i => ({ item: i, isModule: false, isBooster: false })),
    ];

    // Script-charge bonus forwarding: a script's "<X>BonusBonus" attr modifies the host module's
    // "<X>Bonus" attr (op=6 PostPercent). e.g. Optimal Range Script: maxRangeBonusBonus +100 doubles
    // the module's maxRange/falloff bonus, trackingSpeedBonusBonus -100 zeroes its tracking bonus.
    // MUST run before the module's effect propagates the (scripted) bonus to turrets/targets.
    // Exception: sensorStrengthBonusBonus targets the four racial scan*StrengthPercent attrs (not a
    // literal "sensorStrengthBonus"), so a Scan Resolution / Targeting Range script zeroes the sensor
    // booster's sensor-strength bonus rather than its (nonexistent) generic bonus.
    const SENSOR_STRENGTH_TARGETS = ['scanRadarStrengthPercent','scanMagnetometricStrengthPercent','scanLadarStrengthPercent','scanGravimetricStrengthPercent'];
    for (const m of this._modules) {
      if (m.state === 'offline' || !m._charge) continue;
      const ca = m._charge._td?.a ?? {};
      for (const [name, val] of Object.entries(ca)) {
        if (val == null || isNaN(val)) continue;
        if (name === 'sensorStrengthBonusBonus') {
          for (const t of SENSOR_STRENGTH_TARGETS) { const aid = AID[t]; if (aid != null) m.attrs.applyMod(aid, 6, val, true); }
          continue;
        }
        // Crystals/ammo modify their PARENT MODULE via effects with domain "otherID" (charge -> module).
        // The engine never iterates charges as effect sources, so those effects are dead — including
        // Effect804 (capNeedBonus -> capacitorNeed). Conflagration XL costs +25% cap: without this a
        // Revelation Navy Issue drained 165.9 GJ/s instead of pyfa's 178.
        if (name === 'capNeedBonus') {
          const aid = AID['capacitorNeed'];
          if (aid != null) m.attrs.applyMod(aid, 6, val, true);
          continue;
        }
        // Mining crystals are the same shape (Effect1200, all three modifiers domain otherID): the
        // crystal multiplies its strip miner's yield and shifts the module's waste figures. A
        // Modulated Strip Miner II is 120 m3/cycle bare and 216 with a T2 crystal, so the crystal is
        // roughly half of an exhumer's yield — dropping it does not look like a bug, just a low
        // number. pyfa's multiplyItemAttr/increaseItemAttr pass no stacking flag → unpenalised.
        if (name === 'specializationAsteroidYieldMultiplier') {
          const aid = AID['miningAmount'];
          if (aid != null) m.attrs.applyMod(aid, 4, val, true);
          continue;
        }
        if (name === 'specializationCrystalMiningWastedVolumeMultiplierBonus') {
          const aid = AID['miningWastedVolumeMultiplier'];
          if (aid != null) m.attrs.applyMod(aid, 2, val, true);
          continue;
        }
        if (name === 'specializationCrystalMiningWasteProbabilityBonus') {
          const aid = AID['miningWasteProbability'];
          if (aid != null) m.attrs.applyMod(aid, 2, val, true);
          continue;
        }
        const mm = name.match(/^(.+Bonus)Bonus$/);
        if (!mm) continue;
        const targetAid = AID[mm[1]];
        if (targetAid != null) m.attrs.applyMod(targetAid, 6, val, true);
      }
    }

    for (const { item, isModule, isBooster } of nonShipGroups) {
      const direct = !isModule;
      // Order a module's SELF-modifying effects (all modifiers domain=itemID) before its
      // PROPAGATING effects (any modifier domain=shipID/etc.). eos resolves an attribute lazily —
      // all modifiers accumulate before any read — so effect order never matters there. Our engine
      // is imperative and single-pass, so if a propagating effect reads a module attr BEFORE a
      // self-effect boosts it, the boost is lost. The worked example: an overheated Sensor Booster
      // carries Effect2670 (propagates maxTargetRangeBonus → ship maxTargetRange) at effectID index
      // 2 and the overload Effect5757 (+15% to that same maxTargetRangeBonus) at index 3, so the
      // ship captured the un-boosted 30 and lock range came out ~5.6% low. Self-first fixes it.
      const orderedEffectIDs = [...item.effectIDs].sort((a, b) => {
        const selfA = (EFFECTS[a]?.m ?? []).every(mod => mod.domain === 'itemID' || mod.domain === 'self' || mod.domain == null);
        const selfB = (EFFECTS[b]?.m ?? []).every(mod => mod.domain === 'itemID' || mod.domain === 'self' || mod.domain == null);
        return (selfA === selfB) ? 0 : (selfA ? -1 : 1);
      });
      for (const eid of orderedEffectIDs) {
        if (isBooster && Fit.BOOSTER_PENALTY_EFFECTS.has(eid)) continue;
        // Skip Effect1395 for Crystal Alpha-Epsilon (any grade) — custom handler applies full set-boosted value
        if (eid === 1395 && Fit.isCrystalSetMember(item)) continue;
        // Skip Effect2716 (drawback → signatureRadius) — handled post-skill-pass in custom handlers
        // so that Shield Rigging V's drawback reduction (via LocationGroupModifier) is applied first.
        if (eid === 2716) continue;
        // Gate by effectCategory vs module state:
        //   cat=1 (active) → only fire when active/overheated
        //   cat=5 (overload) → only fire when overheated
        //   cat=0/4 (passive/online) → fire for all non-offline states
        const eCat = EFFECTS[eid]?.c;
        // An OFFLINE module is inert except for the handful of effects eos classifies as
        // type='offline' — they apply while the module is merely FITTED. There is no data flag for
        // this (CCP's effectCategory says 0/passive for effect 854, and eve.db's dgmeffects has no
        // isOffline column); it lives only in eos's hand-written effect classes, so the set is
        // transcribed from them. See OFFLINE_STATE_EFFECTS.
        if (item.state === 'offline' && !OFFLINE_STATE_EFFECTS.has(eid)) continue;
        if (eCat === 1 && item.state !== 'active' && item.state !== 'overheated') continue;
        if (eCat === 5 && item.state !== 'overheated') continue;
        this._applyEffect(eid, item, null, direct);
      }
    }

    // 4. Ship hull effects — ItemModifier hull effects (domain=shipID/itemID) that write directly to
    //    ship attrs. Location modifiers were pre-applied in step 2c; skip them here to avoid doubling.
    //    Hull bonuses are NOT stacking-penalized (direct=true).
    for (const eid of this.ship.effectIDs) {
      if (eid === 6614 || eid === 6641) continue; // plate/extender role bonus — applied pre-module above
      if (PILOT_SEC_EFFECTS.has(eid)) continue;    // hand-coded in _runCustomHandlers (section 5g)
      if (_preAppliedHullEIDs.has(eid)) continue;  // location modifiers — applied pre-module in step 2c
      this._applyEffect(eid, this.ship, null, true);
    }

    // 5. Custom handlers (implant sets, booster side-effects, etc.)
    this._runCustomHandlers();

  }

  // Environment effects are data-driven from SYSTEM_EFFECTS (generated from pyfa's hand-written
  // handlers — see scripts/build-system-effects.py). Each op reads one attribute off the beacon and
  // applies it to the ship, or to modules/charges/drones filtered by required skill, group, or
  // simply carrying a given attribute (which is how the overload effects select overloadable
  // modules).
  // Implant sets (Snake, Genolution, Thukker, Blood Raider, ORE, Mordu's, warp-speed) each carry an
  // `implantSet*` multiplier attribute. pyfa's set effects are `filteredItemMultiply` over the other
  // implants' BONUS attributes — `cpuOutputBonus2 *= implantSetChristmas` — and never touch the ship.
  // The member's own effect (Effect485/490/...) then propagates the already-amplified bonus.
  //
  // Getting the ORDER right is the whole point. A Genolution CA-2 is +1.5% CPU with a set product of
  // 3.276, so pyfa gives one +4.914% bonus; applying +1.5% and then +3.414% separately instead yields
  // 1.015 x 1.03414, and a Curse read 498.58 tf of CPU output against pyfa's 498.34.
  _amplifyImplantSets() {
    if (this._implants.length < 2) return;
    // setAttr -> the bonus attributes that set amplifies. Effects route them to the ship; we don't.
    const SET_BONUS_ATTRS = {
      implantSetSerpentis:  ['velocityBonus'],
      implantSetThukker:    ['agilityBonus'],
      implantSetBloodraider:['durationBonus'],
      implantSetORE:        ['maxRangeBonus'],
      implantSetMordus:     ['rangeSkillBonus'],
      implantSetWarpSpeed:  ['WarpSBonus'],
      implantSetChristmas:  ['capacitorCapacityBonus', 'capRechargeBonus', 'agilityBonus',
                             'implantBonusVelocity', 'shieldCapacityBonus', 'armorHpBonus2',
                             'powerEngineeringOutputBonus', 'cpuOutputBonus2'],
    };
    for (const [setAttr, bonusAttrs] of Object.entries(SET_BONUS_ATTRS)) {
      // Membership is attribute PRESENCE in the raw type data: getBase() returns the attribute's
      // default (1 for a multiplier), so a non-member would read back as a member with no effect on
      // the product but every effect on the amplified list.
      const members = this._implants.filter(i => setAttr in (i._td?.a ?? {}));
      if (members.length < 2) continue;
      const setProduct = members.reduce((p, i) => p * (i.getBase(setAttr) ?? 1), 1);
      if (setProduct === 1) continue;
      for (const mi of members) {
        for (const bonusAttr of bonusAttrs) {
          if (!(bonusAttr in (mi._td?.a ?? {}))) continue;
          const aid = AID[bonusAttr];
          if (aid != null) mi.attrs.applyMod(aid, 4, setProduct, true);
        }
      }
    }
  }

  _applyEnvironment() {
    const env = this._environment;
    if (!env) return;
    const OP = { mul: 4, boost: 6, inc: 2 };   // PostMul / PostPercent / ModAdd
    for (const eid of (env.effectIDs ?? [])) {
      for (const op of (SYSTEM_EFFECTS[eid] ?? SYSTEM_EFFECTS[String(eid)] ?? [])) {
        // Warfare-buff beacons (Pochven, insurgency) hand buffs to the fit like a command burst.
        // calc.js owns that machinery, so record them and let it read them back out.
        if (op.t === 'buff') {
          for (let i = 1; i <= (op.n ?? 4); i++) {
            const id = env.get(`warfareBuff${i}ID`), val = env.get(`warfareBuff${i}Value`);
            if (id && val) (this._envBuffs ??= []).push({ buffID: Math.round(id), value: val });
          }
          continue;
        }
        const val = env.get(op.s);
        if (val == null || !Number.isFinite(val)) continue;
        // A multiplier of exactly 1 or a bonus of 0 is a no-op; skip so it cannot occupy a
        // stacking slot that a real modifier should have had.
        if ((op.op === 'mul' && val === 1) || (op.op !== 'mul' && val === 0)) continue;
        const aid = AID[op.a];
        if (aid == null) continue;
        const direct = !op.p;                  // p = stacking-penalised
        const match = (item) => {
          const f = op.f;
          if (!f) return true;
          if (f.skill) return f.skill.some(sk => item.requiresSkill(sk));
          if (f.group) return f.group.includes(item.groupName);
          if (f.hasAttr) return f.hasAttr in (item._td?.a ?? {});
          return false;
        };
        if (op.t === 'ship') { this.ship.attrs.applyMod(aid, OP[op.op], val, direct); continue; }
        const coll = op.t === 'drones' ? this._drones : this._modules;
        for (const it of coll) {
          if (op.t === 'charges') {
            // filtered on the CHARGE, applied to the CHARGE
            if (it._charge && match(it._charge)) it._charge.attrs.applyMod(aid, OP[op.op], val, direct);
          } else if (match(it)) {
            it.attrs.applyMod(aid, OP[op.op], val, direct);
          }
        }
        // 'fighters' ops are dropped here on purpose: the engine has no fighter collection —
        // calc.js computes fighters from raw type data — so there is nothing to modify.
      }
    }
  }

  // ── Internal: apply one effect from a source item ───────────────────────────
  _applyEffect(eid, src, skillLevel = null, direct = false) {
    const edata = EFFECTS[eid];
    if (!edata) return;

    // Check if effect is active for this item's state. OFFLINE_STATE_EFFECTS are exempt: eos runs
    // them whenever the module is FITTED, at any state (see the set's definition).
    if (!OFFLINE_STATE_EFFECTS.has(eid) && !effectActiveForState(edata.c, src.state)) return;

    const level = skillLevel ?? src.level ?? 0;
    // domain='structureID' is the Structure-category equivalent of domain='shipID' — CCP's dogma
    // locations are category-typed, so a structure's own hull effects (and structure-module
    // effects that target the structure they're fitted to, e.g. Effect7009's full-power-state
    // assignment) use 'structureID' where the ship equivalent would use 'shipID'. It is NOT a
    // "projected onto an external target" domain the way targetID/target are — that was an
    // incorrect assumption from before this app fit structures at all (no structure effect had
    // ever been exercised to notice). Confirmed against eos: Effect7008/7009 (both domain=
    // structureID) are what apply the Full/Low Power State HP multiplier, and skipping them here
    // silently left every structure permanently in "low power" (25% low on shield/armor/hull HP
    // relative to eos even for a bare hull — Astrahus 11.25M EHP vs eos's 9.0M). Only remap when
    // OUR fit's ship is itself a structure; a ship fit could theoretically carry a genuine
    // remote/projected structureID reference (targeting an allied structure), which must stay
    // ignored exactly like targetID/target.
    const _isStructureFit = (this.ship._td.c ?? this.ship._td.category) === 65;

    for (const mod of (edata.m ?? [])) {
      const { func, domain: _rawDomain, operation: op,
              modifiedAttributeID: dstAttr,
              modifyingAttributeID: srcAttr,
              groupID, skillID: _skillID, skillTypeID, typeID: filterTypeID } = mod;
      const domain = (_rawDomain === 'structureID' && _isStructureFit) ? 'shipID' : _rawDomain;
      // CCP uses 'skillTypeID' for the required skill filter (not 'skillID')
      const skillID = skillTypeID ?? _skillID;

      if (!func || func === 'EffectStopper') continue;
      if (domain === 'targetID' || domain === 'target' || domain === 'structureID') continue;

      // Get the raw value from the source item
      // Use src.get() so that prior skill/module reductions to the source attr are applied.
      // e.g. Shield Rigging V reduces drawback via _mul before Effect2716 reads it.
      let rawVal = src.get ? src.get(String(srcAttr)) : src.attrs.getBase(srcAttr);
      // An attribute the source doesn't carry reads as the attribute's DEFAULT, not 0 — but the
      // presence test has to be by NAME, because `_td.a` is name-keyed and a numeric ID is never
      // `in` it. Testing by ID made the branch fire for every source attribute that legitimately
      // computed to zero, substituting the default: an untrained Caldari Cruiser zeroes the
      // Caracal's shipBonusCC, whose default is +5, and the launcher gained a 5% rate-of-fire
      // PENALTY. Invisible at all skills V, where a bonus attribute is never exactly zero.
      if ((rawVal === 0 || rawVal == null) && !(attrName(srcAttr) in (src._td?.a ?? {}))) {
        rawVal = attrDefault(srcAttr);
      }
      // For skill effects: multiply rawVal by skill level when the attr hasn't been
      // pre-scaled by a self-effect. Detection: if the skill item's current computed
      // get() value matches its stored base value, no sub-effect has scaled it,
      // so we multiply by level (the "per level" convention).
      // This correctly handles AWU (attr323=-2 → -10 at L5) without double-scaling
      // AC (attr318=5 → already 25 after effect 228 scales it by level).
      if (skillLevel != null && skillLevel > 0 && srcAttr !== 280) {
        const baseVal = src._td?.a?.[String(srcAttr)] ?? src._td?.a?.[srcAttr];
        if (baseVal !== 0 && baseVal != null && Math.abs(rawVal - baseVal) < 1e-9) {
          // attr hasn't been modified from base → it's a "per level" attr, scale by level
          rawVal = rawVal * skillLevel;
        }
      }

      // Gate: overheat-source attrs (overloadDamageModifier etc.) only fire when overheated.
      // CCP uses effectCategory=5 for these but they should only apply at state=overheated.
      const OVERHEAT_SRC = new Set([1206, 1208, 1209, 1210, 1211, 1212, 1231]);
      if (OVERHEAT_SRC.has(srcAttr) && src.state !== 'overheated') continue;

      // For op=0 (PreMul) from modules: whether it goes to _post0 (stacking) or _base (direct)
      // depends on the SOURCE attribute's stackable flag.
      // stackable=0 source (e.g. armorEmDamageResonance): stacking-penalised → _post0
      // stackable=1 source (e.g. hullEmDamageResonance):  non-penalised    → _base
      // This matches Pyfa: armor/shield resists stack, hull resists don't.
      let effectiveDirect = (op === 0 && !direct && isStackable(srcAttr)) ? true : direct;

      // Mode modules (Siege / Triage / Bastion) apply ROLE bonuses: EVE does not stacking-penalise them
      // against ordinary modules. This matters now that op4 and op6 share one stacking group — without
      // the exemption a Bane's Siege rate-of-fire bonus gets penalised against its Ballistic Control
      // Systems and DPS drops from 13301 to 12695 (pyfa says 13301).
      // The Capital Sensor Array is deliberately NOT exempt: its x12 lock-range multiplier IS penalised
      // (first slot, command burst second) — which is exactly what produces pyfa's 6457 km Salvation.
      //
      // Exception: Industrial Core / Siege / Triage / Bastion modules are in the MODE_MODULE_GROUPS but
      // their LOCAL LOGISTICS AMOUNT bonus (attr 2607 for IC2, 2347 for Siege/Triage, 548/895 for
      // Bastion's shield/armor boost) competes with Shield/Armor Boost Amplifiers in the stacking group
      // — pyfa applies both with stackingPenalties=True (eos Effect6658 line 30017/30014, Effect1720).
      // Without this carve-out the bonuses go direct (_mul), bypassing the stacking penalty and
      // over-stating EHP/s (IC2 Rorqual: 18324 vs pyfa's 17582; Bastion Golem: shieldRepEhpS 12572 vs
      // eos 12077 — the amplifier ends up alone in its pool at full strength, over-repping by ~4.1%).
      //
      // Bastion Module I's armor/shield resonance bonus (attrs 267-274, self-referencing PreMul,
      // same pattern as Damage Control II) is likewise stacking-penalised by pyfa against DC2 — it
      // is a passive resist bonus, not a role bonus, despite the module being in MODE_MODULE_GROUPS.
      // Without this carve-out Bastion's -30% resonance applies unpenalised on top of DC2's own
      // (also unpenalised, now alone in its pool) -15%/-12.5%, overstating a Vargur's shield/armor
      // resists in every damage type (pyfa: 82.0/83.2/85.8/88.0 shield, 81.7/65.4/54.3/45.2 armor).
      const IC_STACKED_SRC = new Set([
        2607, 2347, // industrialCoreLocalLogisticsAmountBonus, siegeLocalLogisticsAmountBonus
        548, 895,   // shieldBoostMultiplier, armorDamageAmountBonus (Bastion's local-rep boost)
        267, 268, 269, 270, // armor em/explosive/kinetic/thermal DamageResonance
        271, 272, 273, 274, // shield em/explosive/kinetic/thermal DamageResonance
      ]);
      // Members of eos's 'postPerc' penalty group route here instead of going fully direct.
      let postPercGroup = false;
      if (!effectiveDirect && MODE_MODULE_GROUPS.has(src.groupName) && !IC_STACKED_SRC.has(srcAttr)) {
        // Only BASTION's RoF bonus shares eos's 'postPerc' group with overload RoF. This used to be a
        // blanket rule for every mode module's `speed` bonus, which is wrong for SIEGE: eos passes no
        // stackingPenalties flag on the siege RoF boost at all (it defaults False → unpenalised),
        // while Effect6658's two Bastion RoF boosts explicitly pass penaltyGroup='postPerc'. Those
        // three lines are the ONLY uses of 'postPerc' in eos.
        //
        // The difference is invisible until a weapon is BOTH sieged and overheated, because with one
        // member the group applies at full strength either way. Overheated + sieged, the two
        // penalised each other and the overload's -15% RoF arrived as -13.04% (= -15% x
        // exp(-1/7.1289)): a sieged Phoenix Navy Issue with overheated Rapid Torpedo Launchers
        // cycled 2336 ms against eos's 2283, i.e. 2.2% low on DPS with volley matching exactly.
        if (Number(dstAttr) === AID.speed && eid === 6658) postPercGroup = true;
        else effectiveDirect = true;
      }

      // Booster (drug) bonuses are their OWN stacking group in EVE — they are not penalised against
      // modules. We already knew this for passive resists; it applies to every booster bonus. It
      // matters now that op4 and op6 share a pool: a State Hardpoint Booster's -12% rate-of-fire (op6)
      // was being penalised against the Ballistic Control Systems' speedMultiplier (op4), costing a
      // Praxis ~5% missile DPS (87.6 vs pyfa's 92.5).
      if (!effectiveDirect && this._boosterSet && this._boosterSet.has(src)) effectiveDirect = true;

      // Effect 854 (cloakingScanResolutionMultiplier): pyfa hand-codes this with its OWN penalty group
      // ('cloakingScanResolutionMultiplier'), separate from the default scanResolution PostMul group that
      // Warp Core Stabilizers / Interdiction Nullifiers (effect 2645) share. With a single cloak fitted its
      // group has one member, so it applies at FULL strength, unpenalised against the WCS group. (Occator
      // with 3 WCS + cloak: pyfa scanRes 30.3 = 250 × 0.2021 [WCS penalised] × 0.6 [cloak alone]; lumping
      // all four multipliers into one pool under-penalised us to 44.8.) Multiple cloaks are not a fittable
      // active configuration, so unpenalised (→ _mul) is exact for every real fit.
      if (eid === 854) effectiveDirect = true;

      // Effect 3001 (overloadRofBonus): pyfa hand-codes overheat RoF with its OWN penalty group
      // ('postPerc'), separate from the 'default' PostMul group that damage-mod modules share on
      // `speed` (gyrostabs, BCS, Vorton Tuning Systems — filteredItemMultiply, no penaltyGroup). Our
      // engine otherwise merges op4 and op6 into one penalised pool (stacking rule 1), which would
      // wrongly penalise a module's overload RoF against its own damage mods. A module carries at most
      // one overload effect, so its 'postPerc' group always has a single member → full strength.
      // (Overheated Vorton Stormbringer: eos 259.7 DPS; lumped-in pool under-applied us to 247.3.)
      //
      // Effect 3025 (overloadSelfDamageBonus, energy/hybrid/projectile/precursor turrets) is the same
      // story: pyfa's boostItemAttr('damageMultiplier', overloadDamageModifier) passes NO
      // stackingPenalties flag → defaults False → un-penalised. Our op6 pool otherwise penalises the
      // +15% overheat damage against the module's Heat Sinks / Magnetic Field Stabs / Gyrostabs (op4
      // damageMultiplier), crushing it to ~+5%. A module carries one overload, so full strength is
      // exact. (Overheated Abaddon w/ Conflagration: eos 1677.7 DPS, penalised pool gave us 1533.3.)
      if (eid === 3001) postPercGroup = true;         // overload RoF: eos 'postPerc', penalises vs mode-module RoF only
      else if (eid === 3025) effectiveDirect = true;  // overload self-damage: no stackingPenalties flag → unpenalised

      // eos 'postPerc' members route to the secondary penalised pool (penalise each other, not the
      // main op4/op6 pool); everything else uses the ordinary direct/penalised routing.
      const pg = postPercGroup ? 'postPerc' : null;

      // Apply to the correct target(s)
      if (func === 'ItemModifier') {
        // domain=shipID → target is ship; domain=itemID → target is src itself
        // A SKILL (skillLevel != null) writing directly to the SHIP's own attributes via
        // ItemModifier is exactly the "Hull Upgrades/Shield Management/Mechanics give +25% hull
        // HP" pattern — correct for a ship (the trained character is flying it), wrong for a
        // structure (corp asset, nobody's personal skills touch its own hull stats). This does
        // NOT affect LocationModifier/LocationGroupModifier/LocationRequiredSkillModifier skill
        // effects (a few lines down) — those target FITTED MODULES/CHARGES, not the hull itself,
        // and DO apply to structures (e.g. "Structure Missile Systems" boosting a structure
        // missile launcher's charge damage, same mechanism as Warhead Upgrades for a ship).
        if (domain === 'shipID' && skillLevel != null && _isStructureFit) {
          // skip: skill → structure's own hull attribute
        } else if (domain === 'shipID') {
          this.ship.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect, pg);
        } else if (domain === 'itemID') {
          src.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect, pg);
        } else if (domain === 'charID') {
          // skill → char attr; not used for fitting stats
        } else if (domain === 'otherID') {
          // Launcher ↔ charge link; custom handler covers this
        }

      } else if (func === 'LocationModifier') {
        // Applies to all modules (+ subsystems/ship-mode, which are location items too)
        if (domain === 'shipID') {
          for (const m of this._modules) m.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect, pg);
          for (const s of this._subsystems) s.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect, pg);
          if (this._shipMode) this._shipMode.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect, pg);
        }

      } else if (func === 'LocationGroupModifier') {
        if (domain === 'shipID') {
          for (const m of this._modules) {
            if (Number(m.groupID) === Number(groupID)) m.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect, pg);
          }
          // Loaded charges are location items too, and some hull bonuses target the CHARGE's group
          // rather than the module's — e.g. the Minokawa's Force Auxiliary C5 bonus (Effect12835)
          // filters on group 87 "Capacitor Booster Charge" and modifies capacitorBonus, an attribute
          // that only exists on the charge (the Capacitor Booster module is group 76). Without this
          // the bonus silently no-ops and cap-booster injection is understated.
          for (const m of this._modules) {
            if (m._charge && Number(m._charge.groupID) === Number(groupID)) {
              m._charge.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect, pg);
            }
          }
          // Subsystems are group-filtered location items too: a subsystem skill scales the
          // subsystem's own bonus attrs (e.g. Minmatar Offensive Systems → group 956 bonus2).
          for (const s of this._subsystems) {
            if (Number(s.groupID) === Number(groupID)) s.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect, pg);
          }
        }

      } else if (func === 'LocationRequiredSkillModifier') {
        // direct=true when source is skill/hull/implant/booster (no stacking penalty in EVE).
        // direct=false (stacking-penalized) when source is a MODULE (e.g. Tracking Enhancer,
        // Bastion — shown as "(penalized)" in Pyfa's "Affected by" panel).
        //
        // NOTE: ship hull "per level" bonuses (e.g. shipBonusGBC1=7.5, eliteBonusCS2=10)
        // are pre-scaled by the character's skill BEFORE the hull effect reads them.
        // e.g. Gallente Battlecruiser 5 → Effect5288 sets ship.shipBonusGBC1 = 7.5×5 = 37.5
        //      Command Ships 5 → Effect2451 sets ship.eliteBonusCommandShips1 = -7.5×5 = -37.5
        // The skillTypeID here is purely a module filter, NOT a level multiplier.
        // Role bonuses (e.g. roleBonusCommandBurstAoERange=50) have no such scaling skill.
        if (domain === 'shipID') {
          const skill = skillID != null ? (TYPES[skillID]?.n ?? '') : '';
          for (const m of this._modules) {
            if (m.requiresSkill(skill)) m.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect, pg);
          }
          // Loaded charges (missile ammo) require missile skills; ship/subsystem damage bonuses
          // (e.g. Legion Offensive → emDamage on Light Missiles) filter on those skills and must
          // reach the charge's damage attributes.
          for (const m of this._modules) {
            if (m._charge && m._charge.requiresSkill(skill)) m._charge.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect, pg);
          }
        }
      } else if (func === 'OwnerRequiredSkillModifier') {
        // Skill/implant/booster → owned items (modules AND drones/fighters) requiring a skill.
        // The target filter is the modifier's skillTypeID (e.g. Drone Interfacing scales
        // damageMultiplierBonus and applies it to anything requiring the Drones skill 3436).
        // When skillTypeID is absent (some implant effects), fall back to the source's own type.
        const skillName = (skillID != null && TYPES[skillID]?.n) ? TYPES[skillID].n
                         : (domain === 'charID' ? src.name : null);
        if (skillName != null) {
          for (const m of this._modules) {
            if (m.requiresSkill(skillName)) m.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
          }
          for (const d of this._drones) {
            if (d.requiresSkill(skillName)) d.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
          }
        }
      }
    }
  }

  // ── Custom handlers for effects outside the dogma modifier system ────────────
  _runCustomHandlers() {
    // Custom handlers for effects not in CCP's dogma modifier data.
    // These are effects that EVE applies via C++ game code, handled in Pyfa via Python.

    const ship = this.ship;
    const mods = this._modules;
    const imp  = this._implants;
    const bst  = this._boosters;

    // ── Booster bonuses (comprehensive) ──────────────────────────────────────────
    // Combat boosters carry standard <X>Bonus attrs, but their dogma effects ship with EMPTY
    // modifiers, so nothing applies them. Apply them here (PostPercent), matching pyfa. Runs BEFORE
    // the RAH so the RAH adapts to buffed armor resonance. Resonance/ewar-resist bonuses are stacking-
    // penalised (direct=false, shared group with modules); the rest are direct (unpenalised).
    // Weapon/drone damage-RoF-range bonuses are NOT applied here — calc.js handles those on the
    // weapon/drone side (so they aren't double-counted).
    {
      const B_PCT = [ // [attr, [shipTargets], direct]
        // NOTE: velocityBonus, WarpSBonus, capNeedBonus, trackingSpeedBonus, armorDamageAmountBonus,
        // damageMultiplierBonus/durationBonus and friends are intentionally NOT listed here — their
        // booster dogma effects are NON-empty, so the effect pass in step 3 (line ~391) already applies
        // them (verified vs pyfa: velocity eff394 265->278.3 = +5%, warp eff856 4.0->4.36 = +9%). Listing
        // any of those below would DOUBLE-apply. Only the bonuses whose effects ship EMPTY belong here.
        ['agilityBonus',             ['agility'],             true],
        ['scanResolutionBonus',      ['scanResolution'],      true],
        ['maxTargetRangeBonus',      ['maxTargetRange'],      true],
        ['capacitorCapacityBonus',   ['capacitorCapacity'],   true],
        ['capRechargeBonus',         ['rechargeRate'],        true],
        ['signatureRadiusBonus',     ['signatureRadius'],     true],
        ['shieldCapacityBonus',      ['shieldCapacity'],      true],
        ['hullHpBonus',              ['hp'],                  true],
        ['armorHpBonus',             ['armorHP'],             true],
        ['armorHpBonus2',            ['armorHP'],             true],
        ['energyWarfareResistanceBonus',   ['energyWarfareResistance'],   false],
        // passive damage-resistance bonuses → shield+armor+hull resonance. Booster (drug) bonuses are
        // a separate stacking group and are NOT penalised against modules/rigs/bursts (verified vs pyfa
        // v2.67.0: Astarte armor EM 78.84→79.45 and Th 81.42→81.58 with direct=true, matching pyfa's
        // 79.5/81.6 exactly; Kin/Exp unaffected as they carry no booster resist here).
        ['passiveEmDamageResistanceBonus',        ['shieldEmDamageResonance','armorEmDamageResonance','emDamageResonance'], true],
        ['passiveThermicDamageResistanceBonus',   ['shieldThermalDamageResonance','armorThermalDamageResonance','thermalDamageResonance'], true],
        ['passiveKineticDamageResistanceBonus',   ['shieldKineticDamageResonance','armorKineticDamageResonance','kineticDamageResonance'], true],
        ['passiveExplosiveDamageResistanceBonus', ['shieldExplosiveDamageResonance','armorExplosiveDamageResonance','explosiveDamageResonance'], true],
      ];
      // Skip any bonus the booster's OWN effect already applies — otherwise it lands twice. Which
      // bonuses ship with an empty effect varies per booster (10 of 13 boosters with a passive resist
      // bonus apply it by effect; 3 don't), so decide per booster from the data rather than keeping a
      // hardcoded list. The old list was calibrated against PHANTOM booster entries whose effects were
      // empty; with clean data every non-resist entry double-applied — that is what pushed the
      // Astarte's scan resolution from 306 to 312.
      const appliedByOwnEffect = (item, attrName) => {
        const aid = AID[attrName];
        if (aid == null) return false;
        for (const eid of (item._td?.e ?? [])) {
          for (const m of (EFFECTS[eid]?.m ?? [])) {
            if (Number(m.modifyingAttributeID) === Number(aid)) return true;
          }
        }
        return false;
      };
      for (const b of bst) {
        const ba = b._td?.a ?? {};
        for (const [attr, targets, direct] of B_PCT) {
          const v = ba[attr];
          if (!v) continue;
          if (appliedByOwnEffect(b, attr)) continue;   // the effect pass already handled it
          for (const t of targets) ship.attrs.applyMod(AID[t] ?? t, 6, v, direct);
        }
      }
    }

    // ── Reactive Armor Hardener (Effect4928 'adaptiveArmorHardener') ──────────────────────────
    // CCP applies this in game code; Pyfa replicates it in Python (eos Effect4928). Each RAH
    // carries four armor*DamageResonance attrs (≈0.85 = 15% base) plus resistanceShiftAmount
    // (6%). The module continuously shifts its resonance budget away from the two damage types
    // taking the LEAST damage and toward the two taking the MOST, where "damage taken" is the
    // incoming damage pattern weighted by the ship's CURRENT armor resonances (so even a uniform
    // pattern adapts toward the ship's natural resist holes). We simulate up to 50 cycles, detect
    // the steady-state loop, average it, then multiply the ship's armor resonances by that average
    // (op0 PreMul, stacking-penalised — pyfa penaltyGroup='preMul'). Runs in _runCustomHandlers,
    // i.e. AFTER regular armor hardeners, so ship.attrs.get(resonance) is the post-hardener value.
    //
    // Per-RAH setting m._rahPattern:  'disable' (do-not-adapt) | {p:[em,th,kin,exp]} (specific
    // ammo/NPC override) | anything else / undefined → "fit pattern" (this.fit._damageProfile,
    // defaulting to uniform). this._damageProfile is set by calc.js from the Resistances-tab profile.
    const RAH_RES = ['armorEmDamageResonance','armorThermalDamageResonance',
                     'armorKineticDamageResonance','armorExplosiveDamageResonance'];
    const fitProfile = Array.isArray(this._damageProfile) ? this._damageProfile : null;
    // Command bursts are applied by calc.js AFTER the engine runs, so by default the RAH would adapt
    // to PRE-burst resonances. To match pyfa (which adapts to the post-burst profile), calc.js runs a
    // second calculate() pass with this._rahArmorBurstEff set to the armor-resonance warfare-buff value
    // (buff 13, already the strongest of own+projected). We apply it here — stacking-penalised with the
    // hardeners/rigs, exactly as calc.js would — so ship.attrs.get(resonance) below is the post-burst
    // value the RAH truly sees. calc.js then skips its own buff-13 application to avoid double-counting.
    if (this._rahArmorBurstEff) {
      for (const a of RAH_RES) ship.attrs.applyMod(AID[a] ?? a, 6, this._rahArmorBurstEff, false);
    }
    for (const m of mods) {
      // RAH only adapts/contributes while ACTIVE (running) — an online-but-inactive RAH does nothing.
      if (m.state !== 'active' && m.state !== 'overheated') continue;
      if (!(m.effectIDs ?? []).includes(4928)) continue;

      const modRes = RAH_RES.map(a => { const v = m.get(a); return (v == null || isNaN(v)) ? 0.85 : v; });
      const setting = m._rahPattern;

      // "Do not adapt": apply the module's own (even-spread) resonances, no simulation.
      if (setting === 'disable') {
        for (let i = 0; i < 4; i++) ship.attrs.applyMod(AID[RAH_RES[i]] ?? RAH_RES[i], 0, modRes[i], false);
        m._rahAdapted = modRes.slice();
        continue;
      }

      // Resolve the damage pattern: explicit override → fit profile → uniform.
      const pat = (setting && Array.isArray(setting.p)) ? setting.p
                : (fitProfile ?? [0.25, 0.25, 0.25, 0.25]);
      // resistanceShiftAmount (the per-cycle 6%) was trimmed from the data bundle for RAH types,
      // so get() returns the default 0; every RAH variant uses 6, so fall back to it when missing.
      const rawShift = m.get('resistanceShiftAmount');
      const shiftAmount = ((rawShift && rawShift > 0) ? rawShift : 6) / 100;

      // baseDamageTaken[i] = pattern[i] × ship's current armor resonance[i]
      const baseDamageTaken = [0, 1, 2, 3].map(i => (pat[i] ?? 0) * ship.attrs.get(RAH_RES[i]));

      const RAHResistance = modRes.slice();
      const cycleList = [];
      let loopStart = -20;
      for (let num = 0; num < 50; num++) {
        // Order 0,3,2,1 emulates the in-game tiebreak when types take equal damage.
        const tuples = [
          [0, baseDamageTaken[0] * RAHResistance[0], RAHResistance[0]],
          [3, baseDamageTaken[3] * RAHResistance[3], RAHResistance[3]],
          [2, baseDamageTaken[2] * RAHResistance[2], RAHResistance[2]],
          [1, baseDamageTaken[1] * RAHResistance[1], RAHResistance[1]],
        ];
        tuples.sort((a, b) => a[1] - b[1]);  // ascending by damage taken
        let c0, c1, c2, c3;
        if (tuples[2][1] === 0) {            // one damage type
          c0 = 1 - tuples[0][2]; c1 = 1 - tuples[1][2]; c2 = 1 - tuples[2][2]; c3 = -(c0 + c1 + c2);
        } else if (tuples[1][1] === 0) {     // two damage types
          c0 = 1 - tuples[0][2]; c1 = 1 - tuples[1][2]; c2 = -(c0 + c1) / 2; c3 = -(c0 + c1) / 2;
        } else {                             // three or four damage types
          c0 = Math.min(shiftAmount, 1 - tuples[0][2]);
          c1 = Math.min(shiftAmount, 1 - tuples[1][2]);
          c2 = -(c0 + c1) / 2; c3 = -(c0 + c1) / 2;
        }
        RAHResistance[tuples[0][0]] = tuples[0][2] + c0;
        RAHResistance[tuples[1][0]] = tuples[1][2] + c1;
        RAHResistance[tuples[2][0]] = tuples[2][2] + c2;
        RAHResistance[tuples[3][0]] = tuples[3][2] + c3;
        // Detect a repeated profile (steady-state loop).
        for (let i = 0; i < cycleList.length; i++) {
          const v = cycleList[i];
          if (Math.abs(RAHResistance[0] - v[0]) <= 1e-6 && Math.abs(RAHResistance[1] - v[1]) <= 1e-6 &&
              Math.abs(RAHResistance[2] - v[2]) <= 1e-6 && Math.abs(RAHResistance[3] - v[3]) <= 1e-6) {
            loopStart = i; break;
          }
        }
        if (loopStart >= 0) break;
        cycleList.push(RAHResistance.slice());
      }
      // Average the loop (or the last 20 cycles if no loop found), round to 3 decimals.
      const loopCycles = cycleList.slice(loopStart);
      const n = loopCycles.length || 1;
      const average = [0, 0, 0, 0];
      for (const cyc of loopCycles) for (let i = 0; i < 4; i++) average[i] += cyc[i];
      for (let i = 0; i < 4; i++) average[i] = Math.round((average[i] / n) * 1000) / 1000;

      // Apply averaged resonances to the ship (op0 PreMul, stacking-penalised → pyfa preMul group).
      for (let i = 0; i < 4; i++) ship.attrs.applyMod(AID[RAH_RES[i]] ?? RAH_RES[i], 0, average[i], false);
      m._rahAdapted = average.slice();
    }

    // Drone Operation / Specialization skills set damageMultiplierBonus via Effect146 but their
    // application effect (1730) ships with empty modifierInfo (CCP applies it in game code, Pyfa
    // in Python). Apply each such skill's damageMultiplierBonus (op6 PostPercent) to every drone
    // requiring that skill. Drone Interfacing is NOT here — it uses Effect6663 (data-driven) above.
    if (this._drones.length > 0) {
      for (const [skillName, level] of Object.entries(this._skills)) {
        if (level <= 0) continue;
        const skillItem = this._skillItems[skillName];
        if (!skillItem || !(skillItem.effectIDs ?? []).includes(1730)) continue;
        const bonus = skillItem.get('damageMultiplierBonus');
        if (!bonus) continue;
        for (const d of this._drones) {
          if (d.requiresSkill(skillName)) d.attrs.applyMod(AID.damageMultiplier ?? 64, 6, bonus, true);
        }
      }
    }

    // ── Helper: PostMul a ship attribute by a factor (stacking-penalised) ──────
    // Custom handler helpers: all use direct=true (no stacking penalty)
    // Implants, boosters, and hull-level bonuses don't stack-penalize in EVE.
    const shipMul = (attr, factor) => ship.attrs.applyMod(AID[attr] ?? attr, 4, factor, true);
    const shipPct = (attr, pct)    => ship.attrs.applyMod(AID[attr] ?? attr, 6, pct, true);
    const modPct  = (filter, attr, pct) => {
      for (const m of mods) if (filter(m)) m.attrs.applyMod(AID[attr] ?? attr, 6, pct, true);
    };
    const modMul  = (filter, attr, factor) => {
      for (const m of mods) if (filter(m)) m.attrs.applyMod(AID[attr] ?? attr, 4, factor, true);
    };

    // ── 1. Damage Control — handled by dogma modifiers (Effect2302 has modifierInfo)

    // ── 2. Bastion Module — handled by dogma modifiers (Effect6658 has full modifierInfo)

    // ── 3. Implant set bonuses (Crystal, etc.) ──────────────────────────────────
    // Each Crystal implant (Alpha-Epsilon) has:
    //   - Effect1395: shieldBoostMultiplier → shieldBonus (LRSM, skillTypeID=3416) — runs in item pass
    //   - Effect1397: implantSetGuristas → shieldBoostMultiplier (LocationGroupModifier, domain=charID) — NOT handled by engine
    //
    // domain=charID means Effect1397 applies to ALL Crystal implants including the source itself.
    // So Crystal Alpha (implantSetGuristas=1.10) boosts Alpha, Beta, Gamma, Delta, Epsilon, Omega by ×1.10.
    // Each Crystal Alpha-Epsilon gives ×1.10, and Omega gives ×1.25 (implantSetGuristas values).
    //
    // Final shieldBoostMultiplier for each:
    //   Alpha: 1.0 × 1.10^5 × 1.25 ≈ 2.013  → +2.013% via Effect1395
    //   Epsilon: 5.0 × 1.10^5 × 1.25 ≈ 10.07 → +10.07% via Effect1395
    //
    // Effect1395 already applied the BASE values (+1%, +2%, +3%, +4%, +5%) in the item pass.
    // We apply only the EXTRA: base × (full_set_product - 1) for each Crystal implant.
    {
      // Compute the full Crystal set multiplier product (all implants' implantSetGuristas, including self)
      // fullSetProduct = product of all implantSetGuristas (self-inclusive per domain=charID)
      let fullSetProduct = 1.0;
      for (const i of imp) {
        const sg = i.getBase('implantSetGuristas');
        if (sg && sg > 1) fullSetProduct *= sg;
      }
      if (fullSetProduct > 1) {
        for (const implant of imp) {
          if (implant.groupName !== 'Cyberimplant') continue;
          const bm = implant._td.a?.[AID.shieldBoostMultiplier] ?? implant._td.a?.shieldBoostMultiplier;
          if (!bm) continue;
          // Apply FULL boosted value in one step (Effect1395 is skipped for Crystal implants)
          // Avoids compound rounding error from two-step application
          // Effect1395 is keyed to Shield Operation (skill 3416) only; capital shield boosters
          // require Capital Shield Operation and are NOT affected by the Crystal set (matches Pyfa).
          modPct(m => m.requiresSkill('Shield Operation'),
                 'shieldBonus', bm * fullSetProduct);
        }
      }
    }

    // ── 4. Booster side-effects — skipped (handled by BOOSTER_PENALTY_EFFECTS filter)

    // ── 5. Charge attribute forwarding ──────────────────────────────────────────
    // Turret ammo charge modifiers apply to the parent turret item.
    // Operations match the FSD (dogma-effects.json) and are applied direct=true (unpenalized)
    // because each turret can only hold one ammo type — there is nothing to stack against.
    //   weaponRangeMultiplier → maxRange  FSD op=0 PreMul  → direct multiplies _base
    //   fallofMultiplier      → falloff   FSD op=4 PostMul → direct multiplies _mul (post stacking)
    //   trackingSpeedMultiplier → trackingSpeed FSD op=4 PostMul → same
    // Using op=4 not-direct was wrong: it put the multiplier into _post4 where it competed in
    // the stacking pool with TC bonuses, understating both optimal range and falloff.
    for (const m of mods) {
      if (!m._charge) continue;
      const ch = m._charge;
      const rng = ch.getBase('weaponRangeMultiplier');
      const fal = ch.getBase('fallofMultiplier');
      const trk = ch.getBase('trackingSpeedMultiplier');
      if (rng && rng !== 1) m.attrs.applyMod(AID.maxRange,       0, rng, true);
      if (fal && fal !== 1) m.attrs.applyMod(AID.falloff,        4, fal, true);
      if (trk && trk !== 1) m.attrs.applyMod(AID.trackingSpeed,  4, trk, true);
    }
    // ── 5a. (removed) Cloak velocity Black-Ops ordering correction ──────────────
    // This used to re-multiply ship maxVelocity by shipBonusRole1 (Effect8151) here, on the theory
    // that the cloak's own Effect607 (module pass, step 3) ran before the ship's role bonus could
    // reach it. That theory stopped being true when step 2c ("pre-module hull location modifiers")
    // was added: Effect8151 is a LocationRequiredSkillModifier with domain=shipID, so it now runs
    // BEFORE the module pass, bumping the cloak's OWN maxVelocityModifier attribute (Panther: 0.1 ->
    // 0.75) in time for Effect607 to read the corrected value on its first and only application, and
    // step 4 explicitly skips re-applying it (`_preAppliedHullEIDs`). This block ran afterward anyway
    // and reapplied ×shipBonusRole1 a second time — a Panther + Syndicate Cloaking Device (high slot)
    // read 5.6x its bare speed while cloaked (should be 0.75x, a 25% penalty): 228 -> 1280 m/s instead
    // of 171. See regression suite 'blackops' section for the pinned value.
    // ── 5b. Generic implant set bonuses — moved EARLY, see _amplifyImplantSets ─

    // ── 5c. Hydra implant set ────────────────────────────────────────────────────
    // Unlike the ship-attr sets above, Hydra's per-member bonuses target the loaded MISSILE
    // CHARGES (explosionDelay=flight time/range, aoeVelocity=application) via Missile Launcher
    // Operation, and DRONES (trackingSpeed, maxRange) via Drones. The engine already applied each
    // member's BASE bonus (effects 8025/8026/8023/8024 at op6). Here we amplify by the set-
    // completion product of implantSetHydra (self-inclusive), matching pyfa: each member's effective
    // bonus is raw*setProduct. Since op6-direct stacks multiplicatively, we apply the exact ratio
    // factor (1+raw*prod/100)/(1+raw/100) so the base+extra reconstructs (1+raw*prod/100).
    {
      const members = imp.filter(i => 'implantSetHydra' in (i._td?.a ?? {}));
      if (members.length >= 2) {
        const setProduct = members.reduce((p, i) => p * (i.getBase('implantSetHydra') ?? 1), 1);
        if (setProduct > 1) {
          const MISSILE = [['hydraMissileFlightTimeBonus', 'explosionDelay'],
                           ['hydraMissileExplosionVelocityBonus', 'aoeVelocity']];
          const DRONE   = [['hydraDroneTrackingBonus', 'trackingSpeed'],
                           ['hydraDroneRangeBonus', 'maxRange']];
          const extraPct = (raw) => ((1 + raw * setProduct / 100) / (1 + raw / 100) - 1) * 100;
          for (const mi of members) {
            for (const [bAttr, tAttr] of MISSILE) {
              if (!(bAttr in (mi._td?.a ?? {}))) continue;
              const raw = mi.getBase(bAttr) ?? 0; if (!raw) continue;
              const ex = extraPct(raw); if (!ex) continue;
              for (const m of mods) {
                if (m._charge && m._charge.requiresSkill('Missile Launcher Operation'))
                  m._charge.attrs.applyMod(AID[tAttr] ?? tAttr, 6, ex, true);
              }
            }
            for (const [bAttr, tAttr] of DRONE) {
              if (!(bAttr in (mi._td?.a ?? {}))) continue;
              const raw = mi.getBase(bAttr) ?? 0; if (!raw) continue;
              const ex = extraPct(raw); if (!ex) continue;
              for (const d of this._drones) {
                if (d.requiresSkill('Drones')) d.attrs.applyMod(AID[tAttr] ?? tAttr, 6, ex, true);
              }
            }
          }
        }
      }
    }
    // ── 5d. Asklepian implant set (implantSetSerpentis2) ─────────────────────────
    // Each Asklepian member carries armorRepairBonus (attr2457: Alpha..Epsilon = 1..5, Omega = 0),
    // applied to armor-repairer armorDamageAmount via Effect6708 (LocationRequiredSkillModifier,
    // skill=Repair Systems) — the engine already ran that at BASE value. The set multiplier
    // (Effect6706, implantSetSerpentis2 PreMul, domain=charID) is dispatcher-skipped, so amplify
    // here: each member's effective bonus is raw*setProduct (full-set product ≈ 1.1^5·1.25 = 2.013).
    // op6-direct stacks multiplicatively, so apply the ratio factor (1+raw*prod/100)/(1+raw/100)-1
    // per member, reconstructing base+extra = (1+raw*prod/100). Targets local repairers (Repair
    // Systems), matching Effect6708. Omega contributes to setProduct but has raw=0 → no extra.
    {
      const members = imp.filter(i => 'implantSetSerpentis2' in (i._td?.a ?? {}));
      if (members.length >= 2) {
        // setProduct spans ALL members, Omega included (×1.1 each plus Omega's ×1.25 → 2.0131 for a
        // full set), same as every other set. `repMembers` is NOT an exclusion rule — it picks whose
        // bonus gets scaled, and Omega carries armorRepairBonus = 0 so it has nothing to contribute
        // either way. This file's history has an "Asklepian excludes Omega" story attached to these
        // two lines; it was compensating for a phantom type and is dead. See CLAUDE.md.
        const repMembers = members.filter(i => (i.getBase('armorRepairBonus') ?? 0) > 0);
        const setProduct = members.reduce((p, i) => p * (i.getBase('implantSetSerpentis2') ?? 1), 1);
        if (setProduct > 1) {
          const extraPct = (raw) => ((1 + raw * setProduct / 100) / (1 + raw / 100) - 1) * 100;
          for (const mi of repMembers) {
            const raw = mi.getBase('armorRepairBonus') ?? 0; if (!raw) continue;
            const ex = extraPct(raw); if (!ex) continue;
            for (const m of mods) {
              if (m.requiresSkill('Repair Systems'))
                m.attrs.applyMod(AID.armorDamageAmount ?? 'armorDamageAmount', 6, ex, true);
            }
          }
        }
      }
    }
    // ── 5e. Nirvana implant set (ImplantSetNirvana) ──────────────────────────────
    // Each Nirvana member carries shieldHpBonus (attr3015: Alpha..Epsilon = 1..5, Omega = none),
    // applied to the ship's shieldCapacity via Effect8011 (ItemModifier) — which the engine already
    // ran at BASE value. The set multiplier (Effect8013, ImplantSetNirvana PreMul on attr3015,
    // domain=charID) is dispatcher-skipped, so amplify here, exactly as for the other sets.
    //
    // The FULL set product INCLUDING Omega applies (1.1^5 x 1.25 = 2.0131, verified against pyfa: a
    // Minokawa lands on 3.26M EHP with it, 3.11M without) — as it does for every set, 5d included.
    {
      const members = imp.filter(i => 'ImplantSetNirvana' in (i._td?.a ?? {}));
      if (members.length >= 2) {
        const setProduct = members.reduce((p, i) => p * (i.getBase('ImplantSetNirvana') ?? 1), 1);
        if (setProduct > 1) {
          // op6-direct stacks multiplicatively, so add the exact ratio on top of the base bonus.
          const extraPct = (raw) => ((1 + raw * setProduct / 100) / (1 + raw / 100) - 1) * 100;
          // Only members that actually CARRY shieldHpBonus get amplified. Testing the value alone is
          // not enough: attr3015 has a default of 1, so getBase() on the Omega (which doesn't have the
          // attribute at all) returns 1 rather than 0 and would add a phantom +1%.
          const hpMembers = members.filter(i => 'shieldHpBonus' in (i._td?.a ?? {}) && (i.getBase('shieldHpBonus') ?? 0) > 0);
          for (const mi of hpMembers) {
            const raw = mi.getBase('shieldHpBonus') ?? 0; if (!raw) continue;
            const ex = extraPct(raw); if (!ex) continue;
            ship.attrs.applyMod(AID.shieldCapacity ?? 'shieldCapacity', 6, ex, true);
          }
        }
      }
    }
    // ── 5f. Amulet implant set (implantSetAmulet) ────────────────────────────────
    // Identical shape to Nirvana. Each member carries armorHpBonus (Alpha..Epsilon = 1..5, Omega has
    // none) which Effect271 applies to armorHP at BASE value. The set multiplier (Effect1579
    // "setBonusSansha", implantSetAmulet PreMul on armorHpBonus, domain=charID) is dispatcher-skipped,
    // so without this the whole set bonus was missing: a Revelation Navy Issue came out at 4.49M EHP
    // instead of pyfa's 5.07M.
    //
    // pyfa (eos/effects.py Effect1579) multiplies EVERY Cybernetics implant's armorHpBonus by the set
    // attribute, so the FULL product including Omega applies (1.1^5 x 1.25 = 2.0131) — same as Nirvana.
    {
      const members = imp.filter(i => 'implantSetAmulet' in (i._td?.a ?? {}));
      if (members.length >= 2) {
        const setProduct = members.reduce((p, i) => p * (i.getBase('implantSetAmulet') ?? 1), 1);
        if (setProduct > 1) {
          const extraPct = (raw) => ((1 + raw * setProduct / 100) / (1 + raw / 100) - 1) * 100;
          // Only members that actually CARRY armorHpBonus — testing the value alone is not enough if
          // the attribute has a non-zero default (the trap that produced a phantom +1% for Nirvana).
          const hpMembers = members.filter(i => 'armorHpBonus' in (i._td?.a ?? {}) && (i.getBase('armorHpBonus') ?? 0) > 0);
          for (const mi of hpMembers) {
            const raw = mi.getBase('armorHpBonus') ?? 0; if (!raw) continue;
            const ex = extraPct(raw); if (!ex) continue;
            ship.attrs.applyMod(AID.armorHP ?? 'armorHP', 6, ex, true);
          }
        }
      }
    }
    // ── 5f2. Mimesis implant set (setBonusMimesis) — the FOURTH set ──────────────
    // Same shape as Asklepian/Nirvana/Amulet, but it boosts a WEAPON attribute rather than a ship
    // one: each member carries damageMultiplierBonusMaxModifier (Mid-grade Alpha..Epsilon =
    // 1.25/1.75/2.25/2.75/3.25) and damageMultiplierBonusPerCycleModifier (-0.33 on every member),
    // which effects 7232/7233 apply to Precursor Weapons (group 1986) — i.e. entropic
    // disintegrators' SPOOL: how far it ramps, and how fast.
    //
    // Those two effects DO carry modifiers, so the un-amplified bonus was already applying. What was
    // missing is the set multiplier, Effect7234 (domain=charID) — dispatcher-skipped like the other
    // three sets. Without it a Draugur's full-spool DPS came out 388.8 against eos's 490.6: the
    // spool max read 2.125 x 1.53 short, because each member's modifier was applied at 1x instead of
    // x(1.2^5 x 1.6) = x3.981312.
    //
    // FULL product including Omega, matching pyfa (Effect7234 multiplies every Cyberimplant's two
    // modifier attrs by setBonusMimesis) and the convention of the other three sets. Unpenalised —
    // eos records these with penaltyGroup None.
    {
      const members = imp.filter(i => 'setBonusMimesis' in (i._td?.a ?? {}));
      if (members.length >= 2) {
        const setProduct = members.reduce((p, i) => p * (i.getBase('setBonusMimesis') ?? 1), 1);
        if (setProduct > 1) {
          // The dispatcher already applied (1 + raw/100); top it up to (1 + raw*setProduct/100).
          const extraPct = (raw) => ((1 + raw * setProduct / 100) / (1 + raw / 100) - 1) * 100;
          const PRECURSOR_WEAPON_GROUP = 1986;
          const targets = mods.filter(m => Number(m.groupID) === PRECURSOR_WEAPON_GROUP);
          if (targets.length) {
            for (const [modAttr, dstAttr] of [
              ['damageMultiplierBonusMaxModifier', 'damageMultiplierBonusMax'],
              ['damageMultiplierBonusPerCycleModifier', 'damageMultiplierBonusPerCycle'],
            ]) {
              // Attribute PRESENCE, not truthiness — Omega carries neither modifier, and these have
              // defaults that would otherwise inject a phantom bonus (the Nirvana trap).
              for (const mi of members.filter(i => modAttr in (i._td?.a ?? {}))) {
                const raw = mi.getBase(modAttr) ?? 0; if (!raw) continue;
                const ex = extraPct(raw); if (!ex) continue;
                for (const m of targets) m.attrs.applyMod(AID[dstAttr] ?? dstAttr, 6, ex, true);
              }
            }
          }
        }
      }
    }
    // ── 5f3. Savior implant set (implantSetSavior) — the FIFTH set ───────────────
    // Like Mimesis, this one targets MODULES rather than the hull, and for the same reason the
    // un-amplified bonus was already applying: effect 8018 carries real modifiers (duration and
    // capacitorNeed of anything requiring Remote Armor Repair Systems or Shield Emission Systems),
    // while the set multiplier Effect8017 is domain=charID and dispatcher-skipped.
    //
    // Members carry remoteRepDurationCapBonus (Mid-grade Alpha..Epsilon = -1/-1.5/-2/-2.5/-3), so
    // the set makes remote reps CYCLE FASTER. Missing the multiplier left a projected Nestor's Large
    // Remote Armor Repairer II at 141.62 HP/s against eos's 157.28 (cycle 5422 ms vs 4882.86).
    //
    // FULL product including Omega, as with every other set: Mid-grade = 1.1^5 x 1.25 = 2.0131375.
    {
      const members = imp.filter(i => 'implantSetSavior' in (i._td?.a ?? {}));
      if (members.length >= 2) {
        const setProduct = members.reduce((p, i) => p * (i.getBase('implantSetSavior') ?? 1), 1);
        if (setProduct > 1) {
          // Top the already-applied (1 + raw/100) up to (1 + raw*setProduct/100). raw is NEGATIVE
          // here (shorter cycle), which the same expression handles.
          const extraPct = (raw) => ((1 + raw * setProduct / 100) / (1 + raw / 100) - 1) * 100;
          const REMOTE_REP_SKILLS = ['Remote Armor Repair Systems', 'Shield Emission Systems'];
          const targets = mods.filter(m => REMOTE_REP_SKILLS.some(s => m.requiresSkill(s)));
          if (targets.length) {
            // Attribute PRESENCE, not truthiness — the Omega carries only implantSetSavior.
            for (const mi of members.filter(i => 'remoteRepDurationCapBonus' in (i._td?.a ?? {}))) {
              const raw = mi.getBase('remoteRepDurationCapBonus') ?? 0; if (!raw) continue;
              const ex = extraPct(raw); if (!ex) continue;
              for (const m of targets) {
                m.attrs.applyMod(AID.duration ?? 'duration', 6, ex, true);
                m.attrs.applyMod(AID.capacitorNeed ?? 'capacitorNeed', 6, ex, true);
              }
            }
          }
        }
      }
    }
    // ── 5g. Pilot security-status hull bonuses (CONCORD + AT frigates) ──────────
    // A handful of hulls scale a bonus by the *pilot's* security status. The magnitude is set
    // externally on the fit as `_pilotSec` (default 0) and wired through by calc.js.
    //
    //   Effect6871 (concordSecStatusTankBonus) — Enforcer / Marshal / Pacifier:
    //     sec clamped to [0,5]; bonus = sec×10 (percent). Boosts local armor-repair amount (Repair
    //     Systems modules) and shield-booster amount (Shield Operation modules). pyfa Effect6871.
    //   Effect12165 (ATFrigDmgBonus) — Sidewinder and kin:
    //     sec clamped to [-10,0]; bonus = ship ATFrigDmgBonus × sec (a negative × negative → positive).
    //     Boosts small turret damageMultiplier here; the rocket/light-missile CHARGE damage half is
    //     applied in calc.js (the engine can't reach charges). pyfa Effect12165.
    {
      const sec = this._pilotSec ?? 0;
      if (ship.effectIDs.includes(6871)) {
        const bonus = Math.max(0, Math.min(5, sec)) * 10;
        if (bonus) {
          modPct(m => m.requiresSkill('Repair Systems'), 'armorDamageAmount', bonus);
          modPct(m => m.requiresSkill('Shield Operation'), 'shieldBonus', bonus);
        }
      }
      if (ship.effectIDs.includes(12165)) {
        const negSec = Math.max(-10, Math.min(0, sec));
        const bonus = (ship.get('ATFrigDmgBonus') ?? 0) * negSec;
        if (bonus) {
          modPct(m => m.requiresSkill('Small Energy Turret') || m.requiresSkill('Small Hybrid Turret')
                   || m.requiresSkill('Small Projectile Turret'), 'damageMultiplier', bonus);
        }
      }
    }
    // ── 6. Sig radius effects that depend on post-skill attr values ────────────
    // Effect2716 (drawback → signatureRadius) is skipped in item pass so Shield Rigging V
    // drawback reduction (from LocationGroupModifier in skill pass) is applied first.
    // Effect6730 MWD/AB sig bloom is hardcoded (empty modifierInfo) — also applied here.
    for (const m of this._modules) {
      // Effect2716: drawback → signatureRadius. ONLY for rigs that actually carry Effect 2716
      // (e.g. Polycarbon Engine Housing). Rigs like Hydraulic Bay Thrusters / Rocket Fuel Cache
      // route their drawback to CPU via Effect 2714 instead and must NOT bloat signature.
      const effList = m._td?.e ?? m._td?.effectIDs ?? [];
      if (effList.includes(2716)) {
        const drawback = m.get('drawback');  // fully resolved: includes Shield/relevant Rigging reduction
        if (drawback) this.ship.attrs.applyMod(AID.signatureRadius, 6, drawback, false);
      }
      // Effect6730: MWD/AB sig bloom + mass addition (hardcoded, only when active). Detect an active
      // prop by speedBoostFactor presence rather than group name (MWD/AB group names vary).
      if ((m.state === 'active' || m.state === 'overheated') && ('speedBoostFactor' in (m._td?.a ?? {}))) {
        const AID_SIGBONUS = AID.signatureRadiusBonus ?? 554;
        const hasSig = AID_SIGBONUS in (m._td?.a ?? {}) ||
                       String(AID_SIGBONUS) in (m._td?.a ?? {}) ||
                       'signatureRadiusBonus' in (m._td?.a ?? {});
        if (hasSig) {
          const sigBonus = m.get('signatureRadiusBonus');
          if (sigBonus) this.ship.attrs.applyMod(AID.signatureRadius, 6, sigBonus, false);
        }
        // massAddition as a modAdd (op 2) so hull mass multipliers (Higgs Anchor massBonusPercentage,
        // a postPercent) apply to the combined base+prop mass — matching eos operator ordering. calc.js
        // therefore reads the prop-inclusive mass straight from s.get('mass').
        const massAdd = m.get('massAddition');
        if (massAdd) this.ship.attrs.applyMod(AID.mass ?? 4, 2, massAdd, false);
      }
    }

    // ── Drone control range: droneRangeBonus → droneControlDistance ──────────────────
    // Drone Avionics (+5 km/lvl) and Advanced Drone Avionics (+3 km/lvl) carry droneRangeBonus
    // per level; Drone Link Augmentor modules carry a flat droneRangeBonus. CCP applies these in
    // game code (empty modifierInfo), so the base 20 km never changes in the data-driven pass.
    {
      let droneRangeAdd = 0;
      for (const [skillName, level] of Object.entries(this._skills)) {
        if (level <= 0) continue;
        const si = this._skillItems[skillName];
        const drb = si?.get?.('droneRangeBonus') ?? 0;  // already level-scaled by the skill pass
        if (drb) droneRangeAdd += drb;
      }
      for (const m of mods) {
        if (m.state === 'offline') continue;
        const drb = m.get('droneRangeBonus');
        if (drb) droneRangeAdd += drb;
      }
      if (droneRangeAdd) ship.attrs.applyMod(AID.droneControlDistance ?? 458, 2, droneRangeAdd, true);
    }

    // ── Warp Disruption Field Generator scripts (HIC) ───────────────────────────────
    // A loaded Focused Warp Disruption/Scrambling Script reshapes the bubble into a point:
    //   duration ×=(1+durationBonus/100)        [Effect3602]  (−80% → 6 s cycle)
    //   capacitorNeed ×=(1+capNeedBonus/100)     [Effect804]   (−60% → 60 GJ)
    //   warpScrambleRange ×=(1+warpScrambleRangeBonus/100) [Effect3648] (+50% → 24 km point)
    // None are data-driven, so without this the module keeps its un-scripted cap/s and range.
    for (const m of mods) {
      if (m.state === 'offline') continue;
      if ((m._td?.gn ?? m.groupName) !== 'Warp Disrupt Field Generator') continue;
      const ch = m._charge;
      if (!ch) continue;
      const durB = ch.get('durationBonus');
      const capB = ch.get('capNeedBonus');
      const rngB = ch.get('warpScrambleRangeBonus');
      if (durB) m.attrs.applyMod(AID.duration ?? 73, 6, durB, true);
      if (capB) m.attrs.applyMod(AID.capacitorNeed ?? 6, 6, capB, true);
      if (rngB) m.attrs.applyMod(AID.warpScrambleRange ?? 103, 6, rngB, true);
    }

  }

  // ── Helpers for calc.js compatibility ─────────────────────────────────────
  /** Load a charge into a module (for range/damage calculations) */
  setCharge(moduleItem, chargeTypeID) {
    if (!chargeTypeID || !TYPES[chargeTypeID]) return;
    moduleItem._charge = new DogmaItem(chargeTypeID);
  }
}

// ─── Convenience re-exports for calc.js ───────────────────────────────────────
// Export the LIVE `let` bindings (not a snapshot). initEngine() reassigns EFFECTS/ATTRS
// after module eval, so `export const X = EFFECTS` would freeze the initial empty {}.
export { EFFECTS as EFFECTS_DATA, ATTRS as ATTR_META };
