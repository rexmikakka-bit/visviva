// pyfa / EVE-client XML fitting import.
//
// Format (pyfa's service/port/xml.py exportXml, and what the in-game client writes):
//
//   <fittings count="N">
//     <fitting name="Jaguar fit">
//       <description value=""/>
//       <shipType value="Jaguar"/>
//       <hardware slot="hi slot 0" type="Light Missile Launcher II"/>
//       <hardware qty="2" slot="drone bay" type="Hobgoblin II"/>
//       <hardware qty="159" slot="cargo" type="Inferno Fury Light Missile"/>
//     </fitting>
//   </fittings>
//
// Everything is referenced by NAME — there is not a single typeID in the file. Three consequences
// that shape this module:
//
//  1. There are no folders and no implants or boosters. `exportXml` takes no options parameter at
//     all; it walks modules, drones, fighters and cargo and nothing else. An import screen must say
//     so, rather than telling the user to tick an export option that does not exist.
//
//  2. WHICH MODULE A CHARGE WAS LOADED INTO IS NOT RECORDED. exportXml sums every module's charge
//     into one fit-wide dict, then folds the actual cargo hold into the SAME dict, and emits the
//     totals as slot="cargo". Import therefore arrives with every gun empty and a pile of ammo in
//     the hold — on a real library that is ~93% of fits reading 0 DPS. `reloadCargoCharges` below
//     puts the ammo back; see its comment for why guessing is the right call here.
//
//  3. Abyssal modules DO survive, as base_type / mutaplasmid / mutated_attrs. `mutated_attrs` is
//     "cpu 22.9, power 1440" — byte-identical to the third line of an EFT mutation block, because
//     both come from renderMutantAttrs(). Same parse.
//
// Localized clients wrap every name as `<localized hint="Maelstrom">Maelstrom</localized>` inside
// the attribute value. pyfa detects this globally and prefers the hint; so do we, per attribute.

import { TYPES, tidByName } from "../calc.js";
import { lookupShip, moduleByName, guessSlotFromDogma, getCompatibleCharges, moduleTakesCharges } from "./core.js";
import { buildFitEntry } from "./fit-entry.js";
import dronesData from "../data/drones.json" with { type: "json" };
import mutaplasmidData from "../data/mutaplasmids.json" with { type: "json" };

const DRONE_BY_NAME = new Map();
for (const d of Object.values(dronesData ?? {})) if (d?.name && !DRONE_BY_NAME.has(d.name)) DRONE_BY_NAME.set(d.name, d);

const MUTA_BY_NAME = new Map();
for (const [mid, m] of Object.entries(mutaplasmidData ?? {})) if (m?.n) MUTA_BY_NAME.set(m.n.toLowerCase(), mid);

// pyfa writes FittingSlot(slot).name.lower(), with the one special case high -> "hi".
const SLOT_SECTION = { hi: "high", high: "high", med: "mid", low: "low", rig: "rig", service: "service", subsystem: "subsystem" };

// "hi slot 3" -> {kind:'slot', section:'high', index:3}; "drone bay" -> {kind:'drone'}; etc.
// Returns null for anything unrecognised, which is deliberately NOT the same as cargo — a slot name
// we don't know must not silently dump a module into the hold.
export function parseSlotAttr(slot) {
  const s = String(slot ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "cargo") return { kind: "cargo" };
  if (s === "drone bay") return { kind: "drone" };
  if (s === "fighter bay") return { kind: "fighter" };
  const m = s.match(/^([a-z]+)\s+slot\s+(\d+)$/);
  const section = m && SLOT_SECTION[m[1]];
  if (!section) return null;
  return section === "subsystem"
    ? { kind: "subsystem", index: Number(m[2]) }
    : { kind: "slot", section, index: Number(m[2]) };
}

// "cpu 22.9, power 1440" -> {cpu:22.9, power:1440}. Attribute NAMES, matching what the abyssal
// editor and parseEFT both store on a slot.
export function parseMutatedAttrs(text) {
  const out = {};
  for (const pair of String(text ?? "").split(",")) {
    const m = pair.trim().match(/^([A-Za-z][A-Za-z0-9]*)\s+(-?[\d.]+)$/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

// A localized export escapes markup INTO the attribute, so by the time the value is decoded it reads
// `<localized hint="Maelstrom">Maelstrom*</localized>`. The hint is the official English name, which
// is the only thing our name lookups can resolve.
const LOCALIZED = /^<localized hint="([^"]+)">/;
export function officialName(value) {
  const v = String(value ?? "").trim();
  const m = v.match(LOCALIZED);
  return m ? m[1] : v;
}

// ── Cargo -> loaded charges ───────────────────────────────────────────────────────────────────
// pyfa's own importer leaves the guns empty, because the file genuinely does not say what was
// loaded. We put it back anyway: a fitting tool whose imported library reads 0 DPS is not much of a
// fitting tool, and the guess is a good one — a fit almost never carries ammo for a weapon it is not
// also loading. Each module takes ONE clip, so a full rack of eight launchers consumes exactly the
// eight clips the export summed, and anything genuinely spare stays in the hold.
//
// Ties (several compatible ammo types in the hold) go to the largest quantity: that is the one there
// is enough of to actually fill the rack, and the small stack is the situational reload.
export function reloadCargoCharges(mods, cargo) {
  const pool = cargo.map(c => ({ ...c }));
  let loaded = 0;
  for (const mod of mods) {
    if (mod.charge || !mod.typeID) continue;
    if (!moduleTakesCharges(mod.typeID, mod.name)) continue;
    const ok = new Set(getCompatibleCharges({ typeID: mod.typeID, name: mod.name }).map(c => c.name));
    if (!ok.size) continue;
    let best = null;
    for (const c of pool) if (c.qty > 0 && ok.has(c.name) && (!best || c.qty > best.qty)) best = c;
    if (!best) continue;
    // Clip size is not stored — it is floor(bay / (chargeVolume × chargeRate)). See calc.js's
    // clipSizeOf, which is the same formula; reading a `numShots` attribute returns 0.
    const a = TYPES[mod.typeID]?.a ?? TYPES[mod.typeID]?.attrs ?? {};
    const ctid = tidByName(best.name);
    const ca = ctid ? (TYPES[ctid]?.a ?? TYPES[ctid]?.attrs ?? {}) : {};
    const per = (ca.volume ?? 0) * (a.chargeRate ?? 1);
    const clip = a.capacity > 0 && per > 0 ? Math.max(1, Math.floor(a.capacity / per)) : best.qty;
    mod.charge = best.name;
    best.qty -= Math.min(best.qty, clip);
    loaded++;
  }
  return { mods, cargo: pool.filter(c => c.qty > 0), loaded };
}

// ── One <fitting> -> the shape importFit/buildFitEntry already accept ─────────────────────────
// Matches parseEFT's output exactly, so nothing downstream has to know an import came from XML.
// `raw` is {name, shipType, hardware:[{slot, type, qty, baseType, mutaplasmid, mutatedAttrs}]}.
export function xmlFittingToImportShape(raw) {
  const shipName = officialName(raw?.shipType);
  if (!shipName) return { error: "Fitting has no ship type" };
  const ship = lookupShip(shipName);
  if (!ship?.typeID) return { error: `Unknown ship: "${shipName}"`, shipName };

  const placed = [], drones = [], fighters = [], cargo = [], subsystems = [], unresolved = [];

  for (const hw of (raw.hardware ?? [])) {
    const where = parseSlotAttr(hw.slot);
    if (!where) continue;
    // pyfa resolves base_type in preference to type: on a mutated module `type` names the abyssal
    // result item, which is not what we store — we store the base module plus its mutations.
    const name = officialName(hw.baseType) || officialName(hw.type);
    if (!name) continue;
    const qty = Math.max(1, Number(hw.qty) || 1);

    if (where.kind === "drone") {
      const dd = DRONE_BY_NAME.get(name);
      if (dd) drones.push({ name, qty, drone: dd, ...mutationOf(hw) });
      else unresolved.push(name);
      continue;
    }
    if (where.kind === "fighter") {
      const tid = tidByName(name);
      if (tid) fighters.push({ name, qty, typeID: tid });
      else unresolved.push(name);
      continue;
    }
    if (where.kind === "cargo") {
      const tid = tidByName(name);
      if (!tid) { unresolved.push(name); continue; }
      cargo.push({ name, qty, typeID: tid, vol: TYPES[tid]?.a?.volume ?? TYPES[tid]?.attrs?.volume ?? 0 });
      continue;
    }
    if (where.kind === "subsystem") {
      const tid = tidByName(name);
      if (tid) subsystems.push({ typeID: tid, name, index: where.index });
      else unresolved.push(name);
      continue;
    }

    const info = moduleByName(name);
    const tid = info?.typeID ?? tidByName(name);
    if (!tid) { unresolved.push(name); continue; }
    placed.push({
      section: where.section, index: where.index,
      mod: { name, typeID: tid, slot: info?.slot ?? guessSlotFromDogma(tid), charge: undefined, state: undefined, ...mutationOf(hw) },
    });
  }

  // buildSlotsFromEFT fills each rack sequentially in array order, so sorting by the index the file
  // gave us is what puts a module back in the slot the pilot had it in.
  const mods = placed.sort((a, b) => a.index - b.index).map(p => p.mod);
  subsystems.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const reloaded = reloadCargoCharges(mods, cargo);

  return {
    shipName, fitName: raw.name || "Imported Fit", ship,
    mods: reloaded.mods, drones, fighters, cargo: reloaded.cargo,
    implantNames: [], boosterNames: [],       // never present in an XML export — see the file header
    subsystems,
    chargesReloaded: reloaded.loaded, unresolved,
  };
}

// One raw fitting -> one saved-fit record, ready to drop into fitsDB under `ship`. Kept per-fitting
// rather than whole-file so the caller can chunk a 1,700-fit library and keep the UI painting; ids
// are left undefined because mergeFitsDB reallocates them DB-wide at the point of the write.
export function convertFitting(raw) {
  const shape = xmlFittingToImportShape(raw);
  if (shape.error) return { error: shape.error, name: raw?.name ?? "" };
  return {
    ship: shape.shipName,
    entry: buildFitEntry(shape),
    chargesReloaded: shape.chargesReloaded,
    unresolved: shape.unresolved,
  };
}

function mutationOf(hw) {
  const mid = hw.mutaplasmid ? MUTA_BY_NAME.get(officialName(hw.mutaplasmid).toLowerCase()) : null;
  if (!mid) return {};
  const mutations = parseMutatedAttrs(hw.mutatedAttrs);
  return Object.keys(mutations).length ? { mutaplasmid: mid, mutations } : { mutaplasmid: mid };
}

// ── Document -> raw fittings ──────────────────────────────────────────────────────────────────
// DOMParser rather than a hand-rolled scan: the file carries XML entities and, on a localized
// client, escaped markup nested inside attribute values. Mis-parsing one of those silently drops
// modules, which is the one failure this importer must not have. Everything with actual logic in it
// lives above this line, in plain functions the regression suite can drive without a DOM.
export function parsePyfaXml(text) {
  if (typeof DOMParser === "undefined") return { error: "XML import needs a browser", fittings: [] };
  let doc;
  try { doc = new DOMParser().parseFromString(String(text ?? ""), "text/xml"); }
  catch (e) { return { error: `Couldn't read that file: ${e.message}`, fittings: [] }; }
  if (doc.getElementsByTagName("parsererror").length) return { error: "That isn't valid XML.", fittings: [] };

  const nodes = doc.getElementsByTagName("fitting");
  if (!nodes.length) return { error: "No fittings in that file — expected a pyfa 'Backup All Fittings' XML.", fittings: [] };

  const fittings = [];
  for (const f of nodes) {
    fittings.push({
      name: f.getAttribute("name") ?? "",
      shipType: f.getElementsByTagName("shipType")[0]?.getAttribute("value") ?? "",
      hardware: Array.from(f.getElementsByTagName("hardware"), h => ({
        slot: h.getAttribute("slot"),
        type: h.getAttribute("type"),
        qty: h.getAttribute("qty"),
        baseType: h.getAttribute("base_type"),
        mutaplasmid: h.getAttribute("mutaplasmid"),
        mutatedAttrs: h.getAttribute("mutated_attrs"),
      })),
    });
  }
  return { fittings };
}
