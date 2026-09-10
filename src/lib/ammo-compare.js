import { TYPES, calcFitStats } from "../calc.js";
import { getCompatibleCharges, groupChargesForBrowser, NAVY_AMMO_PREFIXES } from "./core.js";
import { metaOf } from "./meta.js";

const SLOT_KEYS = ["high", "mid", "low"];
const attrsOf = (typeID) => {
  const td = typeID != null ? (TYPES[typeID] ?? TYPES[String(typeID)]) : null;
  return td ? (td.attrs ?? td.a ?? {}) : {};
};
const damagePartsOf = (typeID) => {
  const a = attrsOf(typeID);
  return { em:  a["114"] ?? a.emDamage ?? 0,        th:  a["118"] ?? a.thermalDamage ?? 0,
           kin: a["117"] ?? a.kineticDamage ?? 0,   exp: a["116"] ?? a.explosiveDamage ?? 0 };
};
const damageOf = (typeID) => {
  const d = damagePartsOf(typeID);
  return d.em + d.th + d.kin + d.exp;
};
// The round's damage MIX, as fractions summing to 1. Taken off the charge's own attributes rather
// than the engine's output because this is the round's identity, not the fit's — a Scourge is
// kinetic on every hull, and the row's job is to say which round this is, not what the hull does
// with it. A missile comes out solid in one colour; a turret round shows its two.
const damageSplitOf = (typeID) => {
  const d = damagePartsOf(typeID);
  const total = d.em + d.th + d.kin + d.exp;
  if (!(total > 0)) return null;
  return { em: d.em / total, th: d.th / total, kin: d.kin / total, exp: d.exp / total };
};
// Which of the two T2 ammo lines a round belongs to, as "dmg" | "app" | null. The row colours the
// variant word with it — Fury and Rage in the T2 amber, Precision and Javelin in blue.
//
// Every T2 round is a trade against the T1 round of its own family, and the two lines trade in
// OPPOSITE directions. Fury and Rage buy raw damage (201 against 149 on a heavy missile, 155
// against 100 on a HAM) and pay for it in the hit: a 241m explosion radius where the T1 round runs
// 140m. Precision and Javelin pay in damage and buy the hit back — Precision as a smaller cloud
// (125m), Javelin as missile velocity (3375 m/s against 2250). So the SIGN of the damage difference
// is the line, on one attribute, with no name list to keep in step with CCP.
//
// Damage rather than explosion radius, though radius is the more descriptive quantity, because
// Javelin's explosion stats are identical to T1 to the metre — it is a reach round, not an
// application one — and measuring the cloud puts it on neither side. Damage is the axis both lines
// actually pay or are paid in.
//
// Gated to T2, because faction ammo also out-damages its T1 round and gives up nothing for it:
// Caldari Navy Scourge is 171 against 149 at no cost but ISK. That is an upgrade, not a trade, and
// colouring it as one would say there is a decision here that there isn't.
//
// Turret rounds fall out on their own. Their T2 members (Quake, Hail, Barrage, Void) are singleton
// families with no T1 sibling in the group, so there is no baseline and no line — no weapon-class
// test needed.
function lineOf(typeID, baseDamage) {
  if (!(baseDamage > 0) || metaOf(typeID, "T1") !== "T2") return null;
  return damageOf(typeID) > baseDamage ? "dmg" : "app";
}

// "Republic Fleet Fusion" -> "Fusion". The faction words are the round's GRADE, which the row shows
// as a badge, so repeating them in the name only pushes the part that differs off the end of a
// narrow column — a list reading "Republic Fleet Fusion / Republic Fleet Phased Plasma / Republic
// Fleet Depleted Uranium" is three rows of the same two words and one word that matters.
const stripNavy = (n) => {
  for (const p of NAVY_AMMO_PREFIXES) if (n.startsWith(p + " ")) return n.slice(p.length + 1);
  return n;
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

// Every charge a rack can take repeats the words naming the WEAPON — " L" on every artillery round,
// " Heavy Assault Missile" on every HAM round — and in a list where all rows share them they carry
// no information while eating the width that tells Rage from Javelin. Strip the longest run of
// trailing words that literally every charge in the rack ends with, leaving "EMP", "Republic Fleet
// EMP", "Quake", "Scourge Rage", "Caldari Navy Scourge".
//
// Trailing rather than shared-anywhere: a round's grade is a PREFIX ("Republic Fleet", "Caldari
// Navy") or an infix ("Rage", "Javelin"), so cutting from the end never removes the distinguishing
// word. The `min - 1` bound keeps at least one word of the shortest name, so a family whose members
// differ only by a leading word cannot be reduced to nothing.
const wordsOf = (n) => (n || "").split(/\s+/).filter(Boolean);
function labelerFor(charges) {
  const words = charges.map((c) => wordsOf(c.name)).filter((w) => w.length);
  if (!words.length) return (n) => n;
  const min = Math.min(...words.map((w) => w.length));
  let keep = 0;
  while (keep < min - 1) {
    const w = words[0][words[0].length - 1 - keep];
    if (!words.every((ws) => ws[ws.length - 1 - keep] === w)) break;
    keep++;
  }
  return (name) => {
    const ws = wordsOf(name);
    return ws.slice(0, Math.max(1, ws.length - keep)).join(" ") || name;
  };
}

// Which members of a family get a row of their own.
//
// A TURRET family is a GRADE ladder, not a choice: Republic Fleet EMP carries the same range
// multiplier as plain EMP and simply hits harder, so showing both spends a row on a decision nobody
// makes. One row per family, at the best grade the family has — navy if there is one, then
// storyline, then T1. The T2 rounds (Quake, Hail, Barrage, Void, Scorch…) are singleton families
// already, so they are untouched.
//
// A MISSILE family is the opposite. The family IS the damage type, and its members trade against
// each other along the axis that matters — Fury/Rage buy damage with application, Precision/Javelin
// buy reach with damage, Navy sits between — so collapsing it to one row hid the only comparison
// worth making. Every member above T1 gets a row.
//
// The two are told apart by weaponRangeMultiplier (attr 120), which turret charges carry and
// missiles do not. That is the same discriminator `groupChargesForBrowser` already sorts families
// on, so a weapon class CCP has not shipped yet lands on the right side with no list to maintain.
// Faction ammo that is not a NAVY line is dropped on both sides. Dread Guristas Scourge is Caldari
// Navy Scourge with a few percent more damage at many times the price, and there are two pirate
// lines per damage type — eight extra rows on a missile rack, every one of them repeating what the
// navy round above it already said. The Legion auto-targeting rounds land here too. metaGroupID
// cannot tell navy from pirate (both are metaGroup 4), so the name is the only discriminator, which
// is why core.js keeps the prefix list.
const isOffNavyFaction = (c) =>
  metaOf(c.typeID, "T1") === "Faction" && !NAVY_AMMO_PREFIXES.some((p) => c.name.startsWith(p));

const TURRET_GRADE = { Faction: 0, Storyline: 1, T1: 2 };
const AMMO_BRANDS = {
  'Republic Fleet':'R. F.', 'Imperial Navy':'I. N.', 'Caldari Navy':'C. N.', 'Federation Navy':'F. N.',
  'Arch Angel':'Arch A.', 'Domination':'Domi.', 'Guristas':'Guri.', 'Dread Guristas':'D. G.',
  'Shadow Serpentis':'S. S.', 'Serpentis':'Serp.', 'Dark Blood':'D. B.', 'Blood':'Blood',
  'True Sansha':'T. S.', 'Sanshas':'Sanshas',
};
const isNavy = c => NAVY_AMMO_PREFIXES.some(p=>c.name.startsWith(p+' '));

// Match an exact T1 name suffix, not just the damage word. Fury, Precision and auto-targeting
// missiles must never become grades of the ordinary missile, even though their browser group is shared.
export function ammoGrades(charge, charges) {
  const base=charges.find(c=>metaOf(c.typeID,'T1')==='T1' &&
    (charge.name===c.name || charge.name.endsWith(' '+c.name)));
  if(!base)return [charge];
  const family=charges.filter(c=>(c.name===base.name || c.name.endsWith(' '+base.name)) &&
    ['T1','Faction','Storyline'].includes(metaOf(c.typeID,'T1')));
  const order=c=>isNavy(c)?0:metaOf(c.typeID,'T1')==='T1'?2:1;
  return family.sort((a,b)=>order(a)-order(b)||damageOf(a.typeID)-damageOf(b.typeID)||a.name.localeCompare(b.name));
}

function gradeLabel(charge, grades) {
  const meta=metaOf(charge.typeID,'T1');
  if(isNavy(charge))return 'NAVY';
  if(meta!=='Faction')return meta;
  const strengths=[...new Set(grades.filter(c=>metaOf(c.typeID,'T1')==='Faction'&&!isNavy(c)).map(c=>damageOf(c.typeID)))].sort((a,b)=>a-b);
  return `PRT ${strengths.indexOf(damageOf(charge.typeID))+1}`;
}

function abbreviatedAmmo(name) {
  for(const [brand,short] of Object.entries(AMMO_BRANDS))if(name.startsWith(brand+' '))return short+name.slice(brand.length);
  return name;
}

function rowsOfFamily(group) {
  const items = group.items.filter((c) => !isOffNavyFaction(c));
  if (group.range == null) {
    // T1 comes out of a missile family for the same reason it comes out of a turret one: the navy
    // round is the same missile that hits harder, so the T1 row is not a choice. It takes the T1
    // auto-targeting rounds with it — they are named "<type> Auto-Targeting <size> Missile I" and
    // are strictly worse than the round they shadow, bought for a mechanic (firing without a lock)
    // that no fit being optimised on a DPS list is using.
    //
    // Guarded rather than unconditional: a launcher whose whole ammo line is T1 would otherwise
    // rank nothing at all.
    const graded = items.filter((c) => metaOf(c.typeID, "T1") !== "T1");
    return graded.length ? graded : items;
  }
  const gradeOf = (c) => TURRET_GRADE[metaOf(c.typeID, "T1")] ?? 3;
  // `items` is already sorted best-name-first, and Array.sort is stable, so the two identical navy
  // hybrid lines (Caldari Navy / Federation Navy Antimatter) resolve to one of them predictably.
  const best = [...items].sort((a, b) => gradeOf(a) - gradeOf(b))[0];
  return best ? [best] : [];
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
 * Ranked by DPS when a target profile is set, and by reach ascending when it is not — because without resists
 * to weight against, "best DPS" is Quake or Hail every time, which is the answer to a question the
 * game does not ask. Measured on a 7x 1400mm Maelstrom: Quake leads on raw damage at 412 and lands
 * 108 against an armour-tanked Amarr target, where Phased Plasma lands 213. Recommending the raw
 * winner would be recommending the worst real choice, near enough twice over.
 *
 * One calcFitStats per row — pure, and ~10-18 ms for a battleship rack, so a ten-row turret sweep is
 * ~150 ms and a sixteen-row missile one ~215 ms. Too slow for a render pass and fine for an idle
 * callback, which is how the Firepower card drives it.
 */
export function rankAmmo(ship, slots, drones, skills, opts, rack, cycleGrades = false) {
  if (!ship || !rack) return null;
  const targeted = Array.isArray(opts?.targetResists) && opts.targetResists.some((v) => v > 0);
  const dpsOf = (cs) => {
    const w = (targeted ? cs?.effective?.weaponDps : cs?.weaponDps) ?? {};
    return w.total ?? 0;
  };
  // Read off the same side of the fence as the DPS beside it. A row showing effective DPS next to a
  // raw volley would be two different questions answered in one line, and the gap between them would
  // look like a bug on any target with real resists.
  const volleyOf = (cs) => {
    const v = (targeted ? cs?.effective?.weaponVolley : cs?.weaponVolley) ?? {};
    return v.total ?? 0;
  };

  const picks = [];
  const seen = new Set();
  // The T2 trade is measured against the T1 round of the SAME family, so the baseline is taken here
  // — while the family is still whole — and kept by name. `rowsOfFamily` drops the T1 member from a
  // missile family, and the loaded-round fallback below reaches outside the picks entirely, so by
  // row-build time the round a Fury should be compared against is no longer in hand.
  //
  // The STRONGEST T1 member, not the first one found: a family can hold more than one metaGroup-1
  // round, and the auto-targeting round is one of them ("Scourge Auto-Targeting Heavy Missile I",
  // mg 1, 107 damage against the plain round's 149). Taking whichever came first made that the
  // baseline on the launchers that have one, which put Precision — dead level with the plain round
  // at 149 — above its own baseline and onto the damage line.
  const baseDamage = new Map();
  for (const group of groupChargesForBrowser(rack.charges)) {
    const base = group.items.reduce(
      (best, c) => (metaOf(c.typeID, "T1") === "T1" ? Math.max(best, damageOf(c.typeID)) : best), 0);
    for (const c of group.items) baseDamage.set(c.name, base);
    for (const c of rowsOfFamily(group)) {
      if (damageOf(c.typeID) <= 0 || seen.has(c.name)) continue;
      seen.add(c.name);
      picks.push({ family: group.family, charge: c });
    }
  }
  // The loaded round is the baseline every delta is measured from, so it has to appear even when the
  // grading above would not have picked it — a rack sitting on plain EMP still needs to read its own
  // 133 next to Republic Fleet's 152, or the "+19" has nothing visible to be relative to.
  if (rack.ammo && !seen.has(rack.ammo) && !(cycleGrades && picks.some(p=>ammoGrades(p.charge,rack.charges).some(c=>c.name===rack.ammo)))) {
    const c = rack.charges.find((x) => x.name === rack.ammo);
    if (c && damageOf(c.typeID) > 0) picks.push({ family: c.name, charge: c });
  }

  // Trimmed against what is SHOWN, not against every compatible charge. A rack's full charge list
  // carries names the list never renders — the auto-targeting rounds end "…Heavy Missile I" where
  // everything else ends "…Heavy Missile" — and one of those is enough to leave the whole column
  // untrimmed for rows that do in fact all share a suffix.
  const label = labelerFor(picks.map((p) => p.charge));

  const score = (family, charge) => {
    const { slots: trial, charges } = withAmmo(slots, rack, charge);
    const cs = calcFitStats(ship, trial, drones ?? [], skills, opts);
    if (!cs) return null;
    // Two names, because the two places this is read need different things. `label` keeps the grade
    // words and is what the collapsed one-line recommendation says, where there is no badge and
    // "Fusion would do 304 here" would not name a buyable round. `short` drops them for the list,
    // where the badge beside it already says NAVY.
    const label_ = label(charge.name);
    return {
      family, name: charge.name, label: label_, short: stripNavy(label_), typeID: charge.typeID,
      meta: metaOf(charge.typeID, "T1"), dps: dpsOf(cs), volley: volleyOf(cs), charges,
      dmg: damageSplitOf(charge.typeID), line: lineOf(charge.typeID, baseDamage.get(charge.name) ?? 0),
      ...rackRangeKm(cs, trial, rack),
      loaded: charge.name === rack.ammo,
    };
  };
  const rows = picks.map(({family,charge})=>{
    const row=score(family,charge);
    if(!row||!cycleGrades)return row;
    const grades=ammoGrades(charge,rack.charges);
    row.variants=grades.map(c=>{
      const v=c.name===charge.name?{...row}:score(family,c);
      return v&&{...v,short:abbreviatedAmmo(v.label),grade:gradeLabel(c,grades)};
    }).filter(Boolean);
    return row;
  }).filter(Boolean);
  if (!rows.length) return null;

  // The loaded round is the baseline every delta is measured from. It can be absent from the ranked
  // rows — an empty gun, or a tier the family swap did not pick — in which case the fit's own
  // current DPS stands in, so an unloaded rack still gets an honest "+412".
  const current = rows.flatMap(r=>r.variants??[r]).find((r) => r.loaded);
  const base = current ? current.dps : dpsOf(calcFitStats(ship, slots, drones ?? [], skills, opts));
  for (const r of rows) r.delta = r.dps - base;

  rows.sort(targeted
    ? (a, b) => b.dps - a.dps || b.optimal - a.optimal
    : (a, b) => (a.optimal + a.falloff) - (b.optimal + b.falloff) || b.dps - a.dps);
  // Only a target makes one round BEST; range alone does not. Ranked by reach with no profile set,
  // the head of the list is whatever reaches least far — Quake on a 1400mm rack — which is a true
  // range answer and a terrible recommendation, so nothing is starred and the list stays a picker.
  if (targeted && rows[0]) rows[0].best = true;
  return { rows, targeted, loadedName: rack.ammo ? label(rack.ammo) : null, base };
}
