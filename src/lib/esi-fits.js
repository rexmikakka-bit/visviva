// ESI saved-fitting <-> app fit model mapping (both directions).
//
// ESI's /characters/{id}/fittings/ items use the CLASSIC numeric "inventory flag" scheme (the
// same one the old XML API and the SDE's invFlags table used) — NOT the newer string-named flag
// enum (HiSlot0, MedSlot0, ...) used by the unrelated /characters/{id}/assets/ endpoint. Verified
// against pyfa's own service/port/esi.py (Pyfa-268/service/port/esi.py) — the same fitting-export
// code pyfa uses against the live ESI API — rather than trusting docs summaries, which conflated
// the two schemes. Ranges confirmed against this app's own dogma bundle (subSystemSlot attribute
// values land in the 125-128 range pyfa expects, e.g. Tengu Defensive subsystems = 126).
//
// Also confirmed there (and matches the well-known in-game limitation): a saved fitting does NOT
// record which module a charge was loaded into. pyfa's own export aggregates ALL loaded charges
// fleet-fit-wide into a flat cargo-hold quantity (flag=CARGO) rather than per-module, and its
// import just dumps everything with flag=CARGO into the fit's cargo hold, full stop — no attempt
// to guess which module a charge belongs to. We do the same, on both sides, to match pyfa/EVE's
// actual behavior rather than inventing a round-trip precision ESI itself doesn't support.

import { TYPES, tidByName } from '../calc.js';
import { lookupShip } from './core.js';
import dronesData from '../data/drones.json';

const FLAG_CARGO = 5;
const FLAG_DRONEBAY = 87;
const FLAG_FIGHTER = 158;
const FLAG_LOW = 11, FLAG_LOW_END = 18;
const FLAG_MED = 19, FLAG_MED_END = 26;
const FLAG_HIGH = 27, FLAG_HIGH_END = 34;
const FLAG_RIG = 92, FLAG_RIG_END = 94;

function slotForFlag(flag) {
  if (flag >= FLAG_LOW && flag <= FLAG_LOW_END) return 'low';
  if (flag >= FLAG_MED && flag <= FLAG_MED_END) return 'mid';
  if (flag >= FLAG_HIGH && flag <= FLAG_HIGH_END) return 'high';
  if (flag >= FLAG_RIG && flag <= FLAG_RIG_END) return 'rig';
  return null;
}

// ─── Import: ESI fitting -> the shape App.jsx's importFit(parsed) already accepts ─────────────
// Deliberately matches core.js's parseEFT() output shape exactly, so the exact same importFit()
// used for EFT paste also handles ESI import unchanged — no new state-building logic to get wrong.
export function esiFittingToImportShape(esiFitting) {
  const shipTid = esiFitting.ship_type_id;
  const shipTd = TYPES[shipTid];
  if (!shipTd?.n) throw new Error(`Unknown ship type_id ${shipTid} in ESI fitting`);
  const shipName = shipTd.n;
  const ship = lookupShip(shipName);

  const mods = [], drones = [], fighters = [], cargo = [], subsystems = [];
  for (const it of (esiFitting.items ?? [])) {
    const td = TYPES[it.type_id];
    if (!td?.n) continue; // unknown/unpublished type — skip rather than mis-place
    const name = td.n;
    const cat = td.c ?? td.category;

    if (it.flag === FLAG_DRONEBAY) {
      const dd = Object.values(dronesData).find(d => d.name === name);
      if (dd) drones.push({ name, qty: it.quantity, drone: dd });
      continue;
    }
    if (it.flag === FLAG_FIGHTER || cat === 87) {
      fighters.push({ name, qty: it.quantity, typeID: it.type_id });
      continue;
    }
    if (it.flag === FLAG_CARGO) {
      // Includes real cargo, loaded charges (aggregated, not per-module — see file header), and
      // any implants/boosters the exporting tool bundled in. All land in cargo on import, exactly
      // like pyfa's own importESI — there's no reliable signal to sort them apart.
      cargo.push({ name, qty: it.quantity, typeID: it.type_id });
      continue;
    }
    if (cat === 32) { // Subsystem
      subsystems.push({ typeID: it.type_id, name });
      continue;
    }
    const slot = slotForFlag(it.flag);
    if (!slot) continue; // unrecognized flag (e.g. a structure service slot) — skip, don't corrupt-place
    mods.push({ name, typeID: it.type_id, slot, charge: undefined, state: undefined });
  }

  return {
    shipName, fitName: esiFitting.name || 'Imported Fit', ship,
    mods, drones, fighters, cargo,
    implantNames: [], boosterNames: [],
    subsystems,
  };
}

// ─── Export: app slots -> ESI fitting POST body ────────────────────────────────────────────────
// opts: { description, includeCharges, includeImplants, includeBoosters, implants, boosters }
export function slotsToEsiFitting(shipTypeID, fitName, slots, drones, cargoItems, fighters, opts = {}) {
  const { description = '', includeCharges = true, includeImplants = false, includeBoosters = false, implants = [], boosters = [] } = opts;
  const items = [];
  const flagCursor = { high: FLAG_HIGH, mid: FLAG_MED, low: FLAG_LOW, rigs: FLAG_RIG };
  const chargeTotals = new Map(); // typeID -> total quantity across the whole fit

  for (const section of ['high', 'mid', 'low', 'rigs']) {
    for (const slot of (slots?.[section] ?? [])) {
      if (!slot?.typeID) continue;
      items.push({ flag: flagCursor[section]++, quantity: 1, type_id: slot.typeID });
      if (includeCharges && slot.ammo) {
        const chargeTid = tidByName((slot.ammo || '').replace(/\s*\(\d+\)$/, ''));
        if (chargeTid) {
          const qty = slot.charges ?? slot.maxCharges ?? 1;
          chargeTotals.set(chargeTid, (chargeTotals.get(chargeTid) ?? 0) + qty);
        }
      }
    }
  }
  for (const sub of (slots?.subsystems ?? [])) {
    if (!sub?.typeID) continue;
    const flag = TYPES[sub.typeID]?.attrs?.subSystemSlot ?? TYPES[sub.typeID]?.a?.subSystemSlot;
    if (flag != null) items.push({ flag: Math.round(flag), quantity: 1, type_id: sub.typeID });
  }
  for (const d of (drones ?? [])) {
    const tid = d.typeID ?? tidByName(d.name);
    if (tid) items.push({ flag: FLAG_DRONEBAY, quantity: d.qty ?? 1, type_id: tid });
  }
  for (const f of (fighters ?? [])) {
    const tid = f.typeID ?? tidByName(f.name);
    if (tid) items.push({ flag: FLAG_FIGHTER, quantity: f.qty ?? 1, type_id: tid });
  }
  for (const c of (cargoItems ?? [])) {
    const tid = c.typeID ?? tidByName(c.name);
    if (tid) items.push({ flag: FLAG_CARGO, quantity: c.qty ?? 1, type_id: tid });
  }
  for (const [tid, qty] of chargeTotals) items.push({ flag: FLAG_CARGO, quantity: qty, type_id: tid });
  if (includeImplants) {
    for (const i of implants) {
      if (!i?.name || i.name === '[Empty]') continue;
      const tid = tidByName(i.name);
      if (tid) items.push({ flag: FLAG_CARGO, quantity: 1, type_id: tid });
    }
  }
  if (includeBoosters) {
    for (const b of boosters) {
      const tid = tidByName(b?.name);
      if (tid) items.push({ flag: FLAG_CARGO, quantity: 1, type_id: tid });
    }
  }

  if (!items.length) throw new Error('Cannot export an empty fitting — add at least one module');

  return {
    name: (fitName || 'Unnamed').slice(0, 50),
    description: description.slice(0, 400),
    ship_type_id: shipTypeID,
    items,
  };
}

