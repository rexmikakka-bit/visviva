import { TYPES, calcFitStats } from "../calc.js";
import { getCompatibleCharges, groupChargesForBrowser } from "./core.js";
import { metaOf } from "./meta.js";

const SLOT_KEYS = ["high", "mid", "low"];
const attrsOf = (typeID) => {
  const td = typeID != null ? (TYPES[typeID] ?? TYPES[String(typeID)]) : null;
  return td ? (td.attrs ?? td.a ?? {}) : {};
};
const damageOf = (typeID) => {
  const a = attrsOf(typeID);
  return (a["114"] ?? a.emDamage ?? 0) + (a["118"] ?? a.thermalDamage ?? 0)
       + (a["117"] ?? a.kineticDamage ?? 0) + (a["116"] ?? a.explosiveDamage ?? 0);
};
// Strip the "(1200)" a quantity-tagged ammo name carries in a slot.
const bareName = (n) => (n || "").replace(/\s*\(\d+\)$/, "");

// A rack is every fitted copy of the SAME weapon, because that is the unit ammo is chosen for. A
// Maelstrom's seven 1400mm Howitzers are one decision, not seven — and a fit that carries two
// different weapons (a Loki with a launcher and a cargo scanner, a Praxis with turrets and drones)
// gets one rack per weapon rather than a single merged ranking that could not be loaded.
//
// "Takes charges" is not enough to be a weapon: a cap booster, an ancillary repairer and a probe
// launcher all do. What separates them is that a WEAPON's charges do damage, which is a fact in the
// charge's own attributes — so that is the test, rather than a list of group names that a new CCP
// weapon class would silently fall outside of (as the Vorton projector and the Breacher pod would
// have).
export function weaponRacks(slots) {
  if (!slots) return [];
  const byName = new Map();
  for (const key of SLOT_KEYS) {
    const arr = slots[key];
    if (!Array.isArray(arr)) continue;
    arr.forEach((mod, index) => {
      if (!mod || !mod.typeID || mod.name === "[Empty]") return;
      const charges = getCompatibleCharges(mod);
      if (!charges.length || !charges.some((c) => damageOf(c.typeID) > 0)) return;
      const existing = byName.get(mod.name);
      if (existing) { existing.mounts.push({ key, index }); return; }
      byName.set(mod.name, {
        name: mod.name, typeID: mod.typeID, mounts: [{ key, index }],
        ammo: bareName(mod.ammo), charges,
      });
    });
  }
  // Biggest rack first: on a fit with a main battery and one odd launcher, the battery is the
  // question being asked.
  return [...byName.values()].sort((a, b) => b.mounts.length - a.mounts.length);
}

// What is left of a charge's name once the words its whole family shares are taken out — "Rage" from
// "Scourge Rage Heavy Assault Missile", "Republic Fleet" from "Republic Fleet EMP L", "" from the
// plain T1 round.
//
// This is how a family gets compared against the loaded round on equal terms. Matching on meta group
// alone is not enough and gets it visibly wrong: Rage and Javelin are both T2 members of every
// missile family, so a rack loaded with Scourge Rage was answered with Inferno JAVELIN — a
// short-range round measured against a long-range one, every family losing DPS, and the loaded round
// itself missing from its own ranking. The signature separates the two because the words that
// survive are exactly the ones naming the round's ROLE; the damage type is what the family already
// is, so it always cancels.
const wordsOf = (n) => (n || "").split(/\s+/).filter(Boolean);
function signaturesIn(items) {
  let shared = null;
  for (const i of items) {
    const w = new Set(wordsOf(i.name));
    if (shared === null) shared = w;
    else for (const s of [...shared]) if (!w.has(s)) shared.delete(s);
  }
  return new Map(items.map((i) => [i.name, wordsOf(i.name).filter((w) => !shared.has(w)).sort().join(" ")]));
}

function withAmmo(slots, rack, charge) {
  const chargeVol = charge.volume ?? (attrsOf(charge.typeID)["161"] ?? attrsOf(charge.typeID).volume ?? 1);
  const modCap = attrsOf(rack.typeID)["38"] ?? attrsOf(rack.typeID).capacity ?? 0;
  const n = modCap > 0 && chargeVol > 0 ? Math.floor(modCap / chargeVol) : undefined;
  const next = { ...slots };
  for (const key of SLOT_KEYS) if (Array.isArray(slots[key])) next[key] = slots[key].slice();
  for (const { key, index } of rack.mounts) {
    next[key][index] = { ...next[key][index], ammo: charge.name, charges: n, maxCharges: n };
  }
  return { slots: next, charges: n };
}

// Range for the rack under one ammo. Read back out of the engine's per-slot stats rather than off
// the charge, because a charge carries a MULTIPLIER — the metres depend on the gun, the hull bonus
// and the pilot. Missiles land here too: calc.js files their expected flight distance under the
// same `optimal`, with falloff 0.
function rackRangeKm(cs, slots, rack) {
  const { key, index } = rack.mounts[0];
  const st = cs?.slotEngineStats?.get(slots[key]?.[index]);
  return st ? { optimal: st.optimal ?? 0, falloff: st.falloff ?? 0 } : { optimal: 0, falloff: 0 };
}

/**
 * Every ammo the rack can take, scored by what it would actually do to the selected target.
 *
 * Ranked by DPS when a target profile is set and by range when it is not — because without resists
 * to weight against, "best DPS" is Quake or Hail every time, which is the answer to a question the
 * game does not ask. Measured on a 7x 1400mm Maelstrom: Quake leads on raw damage at 412 and lands
 * 108 against an armour-tanked Amarr target, where Phased Plasma lands 213. Recommending the raw
 * winner would be recommending the worst real choice, near enough twice over.
 *
 * One calcFitStats per family — pure, and ~10-18 ms for a battleship rack, so a full ten-family
 * sweep is ~150 ms. That is too slow for a render pass and fine for an idle callback, which is how
 * the Firepower card drives it.
 */
export function rankAmmo(ship, slots, drones, skills, opts, rack) {
  if (!ship || !rack) return null;
  const targeted = Array.isArray(opts?.targetResists) && opts.targetResists.some((v) => v > 0);
  const dpsOf = (cs) => {
    const w = (targeted ? cs?.effective?.weaponDps : cs?.weaponDps) ?? {};
    return w.total ?? 0;
  };

  const groups = groupChargesForBrowser(rack.charges).map((g) => ({ ...g, sigs: signaturesIn(g.items) }));
  // The role the rack is currently loaded with, which every family is then asked for its version of.
  // An empty gun has none, and each family falls back to items[0] — already sorted best-first.
  const wantSig = rack.ammo ? groups.find((g) => g.sigs.has(rack.ammo))?.sigs.get(rack.ammo) : null;

  const rows = [];
  for (const group of groups) {
    const pick = (wantSig != null && group.items.find((i) => group.sigs.get(i.name) === wantSig)) || group.items[0];
    if (!pick || damageOf(pick.typeID) <= 0) continue;
    const { slots: trial, charges } = withAmmo(slots, rack, pick);
    const cs = calcFitStats(ship, trial, drones ?? [], skills, opts);
    if (!cs) continue;
    rows.push({
      family: group.family, name: pick.name, typeID: pick.typeID,
      meta: metaOf(pick.typeID, "T1"), dps: dpsOf(cs), charges,
      ...rackRangeKm(cs, trial, rack),
      loaded: pick.name === rack.ammo,
      variants: group.items.length,
    });
  }
  if (!rows.length) return null;

  // The loaded round is the baseline every delta is measured from. It can be absent from the ranked
  // rows — an empty gun, or a tier the family swap did not pick — in which case the fit's own
  // current DPS stands in, so an unloaded rack still gets an honest "+412".
  const current = rows.find((r) => r.loaded);
  const base = current ? current.dps : dpsOf(calcFitStats(ship, slots, drones ?? [], skills, opts));
  for (const r of rows) r.delta = r.dps - base;

  rows.sort(targeted
    ? (a, b) => b.dps - a.dps || b.optimal - a.optimal
    : (a, b) => (b.optimal + b.falloff) - (a.optimal + a.falloff) || b.dps - a.dps);
  // Only a target makes one round BEST; range alone does not. Ranked by reach with no profile set,
  // the head of the list is Tremor at a third of the rack's damage — true as a range answer and a
  // terrible thing to recommend, so nothing is starred and the list is a picker rather than advice.
  if (targeted && rows[0]) rows[0].best = true;
  return { rows, targeted, loadedName: rack.ammo || null, base };
}
