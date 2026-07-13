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
 *   structureID / targetID / target – projected / ignored
 */

// ─── Data is injected by initEngine() — works in both Vite and Node.js ───────────
let TYPES = {}, EFFECTS = {}, ATTRS = {};
let AID = {}, TYPE_BY_NAME = {};

export function initEngine(types, effects, attrs) {
  TYPES = types; EFFECTS = effects; ATTRS = attrs;
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
  applyMod(attrID, op, value, direct = false) {
    const aid = Number(attrID);
    if (value == null || isNaN(value)) return;
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

  get(attrIDorName) {
    const aid = typeof attrIDorName === 'number'
      ? attrIDorName
      : (AID[attrIDorName] != null ? AID[attrIDorName] : Number(attrIDorName));
    if (aid in this._force) return this._force[aid];
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
    const stacked = applyStacking(stacked0, penalised, aid);
    return stacked * (this._mul[aid] ?? 1);
  }

  getBase(attrIDorName) {
    const aid = typeof attrIDorName === 'number'
      ? attrIDorName
      : (AID[attrIDorName] != null ? AID[attrIDorName] : Number(attrIDorName));
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
  getA(attrID)    { return this.attrs.get(attrID); }
  getBase(n)      { return this.attrs.getBase(n); }

  get name()       { return this._td.n; }
  get groupName()  { return this._td.gn; }
  get groupID()    { return this._td.g; }
  get categoryID() { return this._td.c; }
  get level()      { return this._level; }
  set level(v)     { this._level = v; }

  requiresSkill(skillName) {
    return (this._td.rs ?? []).includes(skillName);
  }

  // Effect IDs from type data
  get effectIDs() { return this._td.e ?? []; }
}

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

// ─── Fit ──────────────────────────────────────────────────────────────────────
export class Fit {
  // Booster side-effect penalty effects — skipped by default (matches Pyfa default behaviour)
  static BOOSTER_PENALTY_EFFECTS = new Set([2735, 2736, 2737, 2739, 2741, 2745, 2746, 2747, 2748, 2749, 2791, 4970]);
  static CRYSTAL_SET_TIDS = new Set([22107, 22108, 22109, 22110, 22111]); // Crystal Alpha-Epsilon

  constructor(shipTypeID) {
    const tid = Number(shipTypeID);
    if (!TYPES[tid]) throw new Error(`Unknown ship typeID: ${tid}`);
    this.ship      = new DogmaItem(tid);
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
  // T3 cruiser subsystems (Core/Defensive/Offensive/Propulsion). Each is a real dogma type
  // whose effects apply hull/slot bonuses. Processed like the ship mode: direct, non-penalized,
  // before modules so their attribute changes (CPU/PG reductions, etc.) are visible to modules.
  setSubsystems(typeIDs) {
    this._subsystems = (typeIDs || []).filter(Boolean).map(tid => new DogmaItem(tid));
    return this._subsystems;
  }
  addDrone(typeID) {
    const item = new DogmaItem(typeID);
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
    this._skillItems = {};

    // 2. Skill pass (runs FIRST — skills modify module attrs before modules read them) (runs once, after item effects but BEFORE ship hull effects)
    //    Skills scale ship bonus attributes (e.g. Effect605: skillLevel→shipBonusMB2)
    //    which must be ready before ship hull effects read them (Effect8106 reads shipBonusMB2).
    for (const [skillName, level] of Object.entries(this._skills)) {
      if (level <= 0) continue;
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
      for (const eid of skillItem.effectIDs) {
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

    // 3. Run effects for all non-ship items (modules read skill-modified attrs) (implants, boosters, modules, drones)
    //    The ship runs AFTER skills so skill-scaled ship attrs are ready.
    const nonShipGroups = [
      ...(this._shipMode ? [{ item: this._shipMode, isModule: false, isBooster: false }] : []),
      ...this._subsystems.map(s => ({ item: s, isModule: false, isBooster: false })),
      ...this._implants.map(i => ({ item: i, isModule: false, isBooster: false })),
      ...this._boosters.map(i => ({ item: i, isModule: false, isBooster: true })),
      ...this._modules.filter(m => m.state !== 'offline').map(i => ({ item: i, isModule: true, isBooster: false })),
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
        const mm = name.match(/^(.+Bonus)Bonus$/);
        if (!mm) continue;
        const targetAid = AID[mm[1]];
        if (targetAid != null) m.attrs.applyMod(targetAid, 6, val, true);
      }
    }

    for (const { item, isModule, isBooster } of nonShipGroups) {
      const direct = !isModule;
      for (const eid of item.effectIDs) {
        if (isBooster && Fit.BOOSTER_PENALTY_EFFECTS.has(eid)) continue;
        // Skip Effect1395 for Crystal Alpha-Epsilon — custom handler applies full set-boosted value
        if (eid === 1395 && Fit.CRYSTAL_SET_TIDS.has(item.typeID)) continue;
        // Skip Effect2716 (drawback → signatureRadius) — handled post-skill-pass in custom handlers
        // so that Shield Rigging V's drawback reduction (via LocationGroupModifier) is applied first.
        if (eid === 2716) continue;
        // Gate by effectCategory vs module state:
        //   cat=1 (active) → only fire when active/overheated
        //   cat=5 (overload) → only fire when overheated
        //   cat=0/4 (passive/online) → fire for all non-offline states
        const eCat = EFFECTS[eid]?.c;
        if (eCat === 1 && item.state !== 'active' && item.state !== 'overheated') continue;
        if (eCat === 5 && item.state !== 'overheated') continue;
        this._applyEffect(eid, item, null, direct);
      }
    }

    // 4. Ship hull effects (run AFTER skill pass so skill-scaled ship attrs are ready)
    //    e.g. Effect8106 reads shipBonusMB2 which is scaled by MB skill in step 3.
    //    Hull bonuses are NOT stacking-penalized (direct=true).
    for (const eid of this.ship.effectIDs) {
      if (eid === 6614 || eid === 6641) continue; // plate/extender role bonus — applied pre-module above
      this._applyEffect(eid, this.ship, null, true);
    }

    // 5. Custom handlers (implant sets, booster side-effects, etc.)
    this._runCustomHandlers();
  }

  // ── Internal: apply one effect from a source item ───────────────────────────
  _applyEffect(eid, src, skillLevel = null, direct = false) {
    const edata = EFFECTS[eid];
    if (!edata) return;

    // Check if effect is active for this item's state
    if (!effectActiveForState(edata.c, src.state)) return;

    const level = skillLevel ?? src.level ?? 0;

    for (const mod of (edata.m ?? [])) {
      const { func, domain, operation: op,
              modifiedAttributeID: dstAttr,
              modifyingAttributeID: srcAttr,
              groupID, skillID: _skillID, skillTypeID, typeID: filterTypeID } = mod;
      // CCP uses 'skillTypeID' for the required skill filter (not 'skillID')
      const skillID = skillTypeID ?? _skillID;

      if (!func || func === 'EffectStopper') continue;
      if (domain === 'targetID' || domain === 'target' || domain === 'structureID') continue;

      // Get the raw value from the source item
      // Use src.get() so that prior skill/module reductions to the source attr are applied.
      // e.g. Shield Rigging V reduces drawback via _mul before Effect2716 reads it.
      let rawVal = src.get ? src.get(String(srcAttr)) : src.attrs.getBase(srcAttr);
      if ((rawVal === 0 || rawVal == null) && !(srcAttr in (src._td?.a ?? {}))) {
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
      if (!effectiveDirect && MODE_MODULE_GROUPS.has(src.groupName)) effectiveDirect = true;

      // Booster (drug) bonuses are their OWN stacking group in EVE — they are not penalised against
      // modules. We already knew this for passive resists; it applies to every booster bonus. It
      // matters now that op4 and op6 share a pool: a State Hardpoint Booster's -12% rate-of-fire (op6)
      // was being penalised against the Ballistic Control Systems' speedMultiplier (op4), costing a
      // Praxis ~5% missile DPS (87.6 vs pyfa's 92.5).
      if (!effectiveDirect && this._boosterSet && this._boosterSet.has(src)) effectiveDirect = true;

      // Apply to the correct target(s)
      if (func === 'ItemModifier') {
        // domain=shipID → target is ship; domain=itemID → target is src itself
        if (domain === 'shipID') {
          this.ship.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
        } else if (domain === 'itemID') {
          src.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
        } else if (domain === 'charID') {
          // skill → char attr; not used for fitting stats
        } else if (domain === 'otherID') {
          // Launcher ↔ charge link; custom handler covers this
        }

      } else if (func === 'LocationModifier') {
        // Applies to all modules (+ subsystems/ship-mode, which are location items too)
        if (domain === 'shipID') {
          for (const m of this._modules) m.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
          for (const s of this._subsystems) s.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
          if (this._shipMode) this._shipMode.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
        }

      } else if (func === 'LocationGroupModifier') {
        if (domain === 'shipID') {
          for (const m of this._modules) {
            if (Number(m.groupID) === Number(groupID)) m.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
          }
          // Loaded charges are location items too, and some hull bonuses target the CHARGE's group
          // rather than the module's — e.g. the Minokawa's Force Auxiliary C5 bonus (Effect12835)
          // filters on group 87 "Capacitor Booster Charge" and modifies capacitorBonus, an attribute
          // that only exists on the charge (the Capacitor Booster module is group 76). Without this
          // the bonus silently no-ops and cap-booster injection is understated.
          for (const m of this._modules) {
            if (m._charge && Number(m._charge.groupID) === Number(groupID)) {
              m._charge.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
            }
          }
          // Subsystems are group-filtered location items too: a subsystem skill scales the
          // subsystem's own bonus attrs (e.g. Minmatar Offensive Systems → group 956 bonus2).
          for (const s of this._subsystems) {
            if (Number(s.groupID) === Number(groupID)) s.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
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
            if (m.requiresSkill(skill)) m.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
          }
          // Loaded charges (missile ammo) require missile skills; ship/subsystem damage bonuses
          // (e.g. Legion Offensive → emDamage on Light Missiles) filter on those skills and must
          // reach the charge's damage attributes.
          for (const m of this._modules) {
            if (m._charge && m._charge.requiresSkill(skill)) m._charge.attrs.applyMod(dstAttr, op, rawVal, effectiveDirect);
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
    for (const m of mods) {
      if (!m._charge) continue;
      const ch = m._charge;
      const rng = ch.getBase('weaponRangeMultiplier');
      const fal = ch.getBase('fallofMultiplier');
      const trk = ch.getBase('trackingSpeedMultiplier');
      if (rng && rng !== 1) m.attrs.applyMod(AID.maxRange, 4, rng);
      if (fal && fal !== 1) m.attrs.applyMod(AID.falloff, 4, fal);
      if (trk && trk !== 1) m.attrs.applyMod(AID.trackingSpeed, 4, trk);
    }
    // ── 5a. Cloak velocity Black-Ops ordering correction ────────────────────────
    // The cloak's maxVelocity penalty (Effect607) is applied during the module pass using the
    // UN-bonused maxVelocityModifier (e.g. 0.1). Black Ops' shipBonusRole1 boost to that modifier
    // (Effect8151, ×shipBonusRole1) runs later in the ship pass, so the penalty misses it. Multiply
    // ship maxVelocity by shipBonusRole1 to reflect the bonused modifier (Panther ×0.1 → ×0.75).
    if ((this.ship._td?.gn ?? this.ship.groupName) === 'Black Ops') {
      const rb = this.ship.get('shipBonusRole1');
      if (rb && rb !== 1) {
        for (const m of mods) {
          if (m.state !== 'active' && m.state !== 'overheated') continue;
          if ((m._td?.gn ?? m.groupName) !== 'Cloaking Device') continue;
          if ((m.get('maxVelocityModifier') ?? 1) >= 1) continue;  // covert cloak: no penalty
          this.ship.attrs.applyMod(AID.maxVelocity, 4, rb, true);  // direct _mul correction
        }
      }
    }
    // ── 5b. Implant set bonuses (generic) ──────────────────────────────────────
    // Many implant sets (Snake/Serpentis, Genolution/Christmas, Thukker, Halo, etc.) carry an
    // `implantSet*` multiplier attr. Each set member's individual bonus attrs are amplified by the
    // PRODUCT of all equipped members' multipliers (self-inclusive). Those bonus attrs then feed
    // ship attrs via op=6 effects the engine already runs at the BASE value, so here we apply only
    // the EXTRA (amplified − base) as an additional op=6 mod. The set effects are domain=charID
    // LocationGroupModifiers which the generic dispatcher skips, so they're handled here for all sets.
    {
      // setAttr → list of {bonus attr, ship target attr}. Op is PostPercent (op6) for all of these.
      const SET_BONUS_MAP = {
        implantSetSerpentis:  [['velocityBonus','maxVelocity']],
        implantSetThukker:    [['agilityBonus','agility']],
        implantSetBloodraider:[['durationBonus','duration']],
        implantSetORE:        [['maxRangeBonus','maxRange']],
        implantSetMordus:     [['rangeSkillBonus','maxRange']],
        implantSetWarpSpeed:  [['WarpSBonus','warpSpeedMultiplier']],
        implantSetChristmas:  [
          ['capacitorCapacityBonus','capacitorCapacity'],
          ['capRechargeBonus','rechargeRate'],
          ['agilityBonus','agility'],
          ['implantBonusVelocity','maxVelocity'],
          ['shieldCapacityBonus','shieldCapacity'],
          ['armorHpBonus2','armorHP'],
          ['powerEngineeringOutputBonus','powerOutput'],
          ['cpuOutputBonus2','cpuOutput'],
        ],
      };
      for (const [setAttr, bonusList] of Object.entries(SET_BONUS_MAP)) {
        // A true set member carries the set multiplier attr in its OWN type data. getBase()
        // returns the attribute default (1 for multiplier attrs) for items that lack it, so
        // filtering on getBase would wrongly include non-members (e.g. NN-605, which has no
        // implantSetChristmas) and amplify their bonus attrs. Check raw type data presence.
        const hasSetAttr = (i) => {
          const a = i._td?.a ?? {};
          return setAttr in a;
        };
        const members = imp.filter(hasSetAttr);
        if (members.length < 2) continue; // set bonus needs ≥2 members
        const setProduct = members.reduce((p, i) => p * (i.getBase(setAttr) ?? 1), 1);
        if (setProduct === 1) continue;
        for (const [bonusAttr, shipAttr] of bonusList) {
          for (const mi of members) {
            // Only count the bonus attr if the member explicitly carries it (same default caveat).
            if (!(bonusAttr in (mi._td?.a ?? {}))) continue;
            const rawBonus = mi.getBase(bonusAttr) ?? 0;
            if (rawBonus === 0) continue;
            // Engine already applied rawBonus via the bonus attr's op6 effect. Apply the extra.
            const extra = rawBonus * setProduct - rawBonus;
            if (extra !== 0) ship.attrs.applyMod(AID[shipAttr] ?? shipAttr, 6, extra, true);
          }
        }
      }
    }


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
        // The set product amplifying the LOCAL armor-rep bonus is the product of implantSetSerpentis2
        // over the rep-bonus-carrying members (Alpha–Epsilon, ×1.1 each → 1.1^5 ≈ 1.6105 for a full
        // set). The Omega completion implant (armorRepairBonus = 0, implantSetSerpentis2 = 1.25) does
        // NOT amplify the local armor-repair amount in pyfa (verified vs v2.67.0), so it's excluded by
        // filtering on a nonzero armorRepairBonus.
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
    // Unlike Asklepian, the FULL set product INCLUDING Omega applies here (1.1^5 x 1.25 = 2.0131,
    // verified against pyfa v2.67.0: a Minokawa lands on 3.26M EHP with it, 3.11M without). The
    // relevant difference is the target attribute: Nirvana feeds shieldCapacity (stackable), while
    // Asklepian feeds armorDamageAmount (stacking-penalised) — see the note in 5d.
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
      // Effect6730: MWD/AB sig bloom (hardcoded, only when active)
      if ((m.state === 'active' || m.state === 'overheated') && m.groupName === 'Propulsion Module') {
        const AID_SIGBONUS = AID.signatureRadiusBonus ?? 554;
        const hasSig = AID_SIGBONUS in (m._td?.a ?? {}) ||
                       String(AID_SIGBONUS) in (m._td?.a ?? {}) ||
                       'signatureRadiusBonus' in (m._td?.a ?? {});
        if (hasSig) {
          const sigBonus = m.get('signatureRadiusBonus');
          if (sigBonus) this.ship.attrs.applyMod(AID.signatureRadius, 6, sigBonus, false);
        }
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
export const EFFECTS_DATA = EFFECTS;
export const ATTR_META    = ATTRS;
