// EFT text generation — the inverse of core.js's parseEFT().
//
// Kept as a leaf module (calc.js + one JSON, no React) so it can be exercised from Node by the
// regression suite as well as from the export sheet. pyfa's service/port/eft.py is the reference:
// this reproduces its section structure, ordering and number formatting so that the same fit
// exported from both apps diffs line for line. That diffability is the only practical way
// divergences here get caught — an export that silently drops a rack, the drone bay or an abyssal
// roll still looks like a perfectly valid fit.

import mutaplasmidData from "../data/mutaplasmids.json" with { type: "json" };
import { TYPES, tidByName } from "../calc.js";

// Racks in pyfa's order (eft.py SLOT_ORDER), with the label it uses in its "[Empty <label> slot]"
// placeholder — `FittingSlot.MED.name.capitalize()`, hence "Med" rather than our "mid".
const EFT_RACKS = [
  ["low", "Low"], ["mid", "Med"], ["high", "High"],
  ["rigs", "Rig"], ["subsystems", "Subsystem"], ["services", "Service"],
];

// pyfa runs every mutated attribute value through eos's floatUnerr() — round to ~7 significant
// digits, killing float-representation dust — and Python then renders a whole float with a trailing
// ".0". Match both, or every abyssal line reads as a diff against pyfa's own output.
export function mutaNum(v) {
  if (!Number.isFinite(v)) return String(v);
  const r = v === 0 ? 0 : Number(v.toPrecision(7));
  return Number.isInteger(r) ? r.toFixed(1) : String(r);
}

export function mutaplasmidName(mutaID) {
  return mutaplasmidData?.[mutaID]?.n ?? mutaplasmidData?.[String(mutaID)]?.n ?? null;
}

// An abyssal module keeps its BASE name, so nothing in a list row would otherwise reveal that its
// numbers came from a roll. The mutaplasmid's leading word is its grade — except for the Glorified
// tier, whose names read "Glorified <grade> …", so both words matter and only the second is short
// enough to sit in a badge.
export function abyssalGrade(mutaID) {
  if (!mutaID) return null;
  const w = (mutaplasmidName(mutaID) ?? "").split(" ");
  if (w[0] === "Glorified") return w[1] ? `G. ${w[1]}` : "G. Abyssal";
  return w[0] || "Abyssal";
}

// EFT is a sequence of SECTIONS separated by two blank lines, each of which may hold sub-sections
// separated by one: modules (one sub-section per rack), drones + fighters, implants + boosters,
// cargo, and last the mutated-module details.
export function fitToEFT(fit, opts = {}) {
  const { charges = true, implants: wantImplants = true, boosters: wantBoosters = true,
          cargo: wantCargo = true, mutations = true } = opts;
  const { ship = "Unknown", name = "Unnamed", slots, implants, boosters, drones, fighters, cargo } = fit ?? {};
  const sections = [];
  // An abyssal module exports under its BASE item name plus a "[n]" marker, with the roll itself in
  // the trailing block. Markers are numbered in the order the modules are emitted.
  const mutants = [];

  const rackSections = [];
  for (const [sec, label] of EFT_RACKS) {
    const rack = slots?.[sec] ?? [];
    if (!rack.length) continue;
    rackSections.push(rack.map((slot) => {
      if (!slot?.typeID) return `[Empty ${label} slot]`;
      const charge = charges && slot.ammo ? `, ${slot.ammo}` : "";
      const offline = slot.state === "offline" ? " /offline" : "";
      let marker = "";
      if (mutations && slot.mutaplasmid && slot.mutations && Object.keys(slot.mutations).length) {
        mutants.push({ base: slot.name, mutaID: slot.mutaplasmid, mutations: slot.mutations });
        marker = ` [${mutants.length}]`;
      }
      return `${slot.name}${charge}${offline}${marker}`;
    }).join("\n"));
  }
  if (rackSections.length) sections.push(rackSections.join("\n\n"));

  const droneLines = [];
  for (const d of (drones ?? [])) if (d?.name && d.qty > 0) droneLines.push(`${d.name} x${d.qty}`);
  // One line per SQUADRON, with xN the squadron SIZE — that is what "x5" means for fighters in EFT,
  // unlike drones where it is the count. parseEFT reads them back on the same convention.
  const fighterLines = [];
  for (const f of (fighters ?? [])) {
    if (!f?.name) continue;
    const tid = tidByName(f.name);
    const size = (tid != null ? TYPES[tid]?.attrs?.fighterSquadronMaxSize : 0) || 1;
    for (let i = 0; i < (f.qty ?? 1); i++) fighterLines.push(`${f.name} x${size}`);
  }
  const bay = [droneLines, fighterLines].filter((a) => a.length).map((a) => a.join("\n"));
  if (bay.length) sections.push(bay.join("\n\n"));

  const charSection = [];
  const filledImplants = (implants ?? []).filter((i) => i?.name && i.name !== "[Empty]");
  if (wantImplants && filledImplants.length) charSection.push(filledImplants.map((i) => i.name).join("\n"));
  if (wantBoosters && boosters?.length) charSection.push(boosters.map((b) => b?.name ?? "").join("\n"));
  if (charSection.length) sections.push(charSection.join("\n\n"));

  if (wantCargo && cargo?.length) sections.push(cargo.map((c) => `${c.name} x${c.qty ?? 1}`).join("\n"));

  // "[n] BaseItem" / two-space-indented mutaplasmid / two-space-indented "attr value, ..." with the
  // attributes sorted by name — exactly what pyfa's renderMutant() writes.
  if (mutants.length) sections.push(mutants.map((m, i) => {
    const attrs = Object.keys(m.mutations).sort()
      .map((a) => `${a} ${mutaNum(m.mutations[a])}`).join(", ");
    return `[${i + 1}] ${m.base}\n  ${mutaplasmidName(m.mutaID) ?? ""}\n  ${attrs}`;
  }).join("\n"));

  return `[${ship}, ${name}]\n\n${sections.join("\n\n\n")}`;
}
