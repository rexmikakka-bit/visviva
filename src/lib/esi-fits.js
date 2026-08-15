// ESI saved-fitting <-> app fit model mapping (both directions).
//
// ⚠️ `flag` on a fitting item is a STRING ENUM — "HiSlot0", "MedSlot3", "RigSlot0", "SubSystemSlot1",
// "ServiceSlot0", "Cargo", "DroneBay", "FighterBay", plus "Invalid" for entries ESI wants discarded.
// It is NOT the classic numeric inventory-flag scheme (LoSlot0=11, HiSlot0=27, ...) that the old XML
// API and the SDE's invFlags table used. Both directions of the live endpoint take the strings; the
// numbers are silently rejected, which is why every module of an imported fit vanished and left a
// bare hull.
//
// The authoritative source is CCP's own published schema, https://esi.evetech.net/meta/openapi.json
// (`CharactersCharacterIdFittingsGet` and the POST request body) — NOT pyfa. pyfa's
// service/port/esi.py still sends the old numeric INV_FLAGS, so reading it here (as this file
// originally did) reproduces a scheme the API has since moved off. Check the schema, not a port of
// it, whenever this endpoint misbehaves.
//
// Numeric flags are still ACCEPTED on import, because a fitting JSON saved by an older tool is a
// real thing a user will paste at us and the two schemes cannot be confused — one is a number.
//
// A saved fitting does NOT
// record which module a charge was loaded into. pyfa's own export aggregates ALL loaded charges
// fleet-fit-wide into a flat cargo-hold quantity (flag=CARGO) rather than per-module, and its
// import just dumps everything with flag=CARGO into the fit's cargo hold, full stop — no attempt
// to guess which module a charge belongs to. We do the same, on both sides, to match pyfa/EVE's
// actual behavior rather than inventing a round-trip precision ESI itself doesn't support.

import { TYPES, tidByName } from '../calc.js';
import { lookupShip } from './core.js';
import dronesData from '../data/drones.json' with { type: 'json' };

// name -> our section key. Order is the enum's, and the names are exact: "FighterBay", not "Fighter".
const SLOT_PREFIX = { HiSlot: 'high', MedSlot: 'mid', LoSlot: 'low', RigSlot: 'rig', ServiceSlot: 'service', SubSystemSlot: 'subsystem' };
const SECTION_PREFIX = { high: 'HiSlot', mid: 'MedSlot', low: 'LoSlot', rigs: 'RigSlot', services: 'ServiceSlot' };
const FLAG_CARGO = 'Cargo', FLAG_DRONEBAY = 'DroneBay', FLAG_FIGHTER = 'FighterBay';

// Legacy numeric ranges, import-only. Kept so a fitting file written by an older tool still loads.
const NUMERIC_RANGES = [
  [5, 5, 'Cargo'], [87, 87, 'DroneBay'], [158, 158, 'FighterBay'],
  [11, 18, 'low'], [19, 26, 'mid'], [27, 34, 'high'],
  [92, 99, 'rig'], [125, 132, 'subsystem'], [164, 171, 'service'],
];

// -> { kind: 'cargo'|'drone'|'fighter'|'slot', section?, index? }, or null for "Invalid"/unknown.
// The index matters: ESI lists items in no particular order, so without it a fit's modules land in
// whatever order they happened to arrive rather than in the slots the pilot put them in.
function parseFlag(flag) {
  if (typeof flag === 'number' || /^\d+$/.test(String(flag))) {
    const n = Number(flag);
    const hit = NUMERIC_RANGES.find(([lo, hi]) => n >= lo && n <= hi);
    if (!hit) return null;
    const [lo, , kind] = hit;
    return kind === 'Cargo' ? { kind: 'cargo' } : kind === 'DroneBay' ? { kind: 'drone' }
      : kind === 'FighterBay' ? { kind: 'fighter' } : { kind: 'slot', section: kind, index: n - lo };
  }
  const s = String(flag ?? '');
  if (s === FLAG_CARGO) return { kind: 'cargo' };
  if (s === FLAG_DRONEBAY) return { kind: 'drone' };
  if (s === FLAG_FIGHTER) return { kind: 'fighter' };
  const m = s.match(/^([A-Za-z]+?)(\d+)$/);
  const section = m && SLOT_PREFIX[m[1]];
  return section ? { kind: 'slot', section, index: Number(m[2]) } : null;
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

  const placed = [], drones = [], fighters = [], cargo = [], subsystems = [];
  for (const it of (esiFitting.items ?? [])) {
    const td = TYPES[it.type_id];
    if (!td?.n) continue; // unknown/unpublished type — skip rather than mis-place
    const name = td.n;
    const cat = td.c ?? td.category;
    const f = parseFlag(it.flag);
    if (!f) continue; // "Invalid", or a flag CCP added after this was written — never guess a slot

    if (f.kind === 'drone') {
      const dd = Object.values(dronesData).find(d => d.name === name);
      if (dd) drones.push({ name, qty: it.quantity, drone: dd });
      continue;
    }
    if (f.kind === 'fighter' || cat === 87) {
      fighters.push({ name, qty: it.quantity, typeID: it.type_id });
      continue;
    }
    if (f.kind === 'cargo') {
      // Includes real cargo, loaded charges (aggregated, not per-module — see file header), and
      // any implants/boosters the exporting tool bundled in. All land in cargo on import, exactly
      // like pyfa's own importESI — there's no reliable signal to sort them apart.
      cargo.push({ name, qty: it.quantity, typeID: it.type_id });
      continue;
    }
    if (cat === 32 || f.section === 'subsystem') { // Subsystem — placed by group, not by slot index
      subsystems.push({ typeID: it.type_id, name });
      continue;
    }
    // A slot flag names ONE slot, so quantity is normally 1. An older tool that aggregated a rack
    // into a single entry would otherwise lose every copy but the first; buildSlotsFromEFT drops
    // anything that overflows the rack, so expanding here cannot overfill it.
    const qty = Math.max(1, Math.min(Number(it.quantity) || 1, 8));
    for (let i = 0; i < qty; i++) {
      placed.push({ section: f.section, index: f.index + i,
                    mod: { name, typeID: it.type_id, slot: f.section, charge: undefined, state: undefined } });
    }
  }
  // buildSlotsFromEFT fills each rack sequentially in array order, so sorting by the slot index ESI
  // gave us is what actually puts a module back where the pilot had it.
  const mods = placed.sort((a, b) => a.index - b.index).map(p => p.mod);

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
  const flagCursor = { high: 0, mid: 0, low: 0, rigs: 0, services: 0 };
  const chargeTotals = new Map(); // typeID -> total quantity across the whole fit

  for (const section of ['high', 'mid', 'low', 'rigs', 'services']) {
    for (const slot of (slots?.[section] ?? [])) {
      if (!slot?.typeID) continue;
      items.push({ flag: `${SECTION_PREFIX[section]}${flagCursor[section]++}`, quantity: 1, type_id: slot.typeID });
      if (includeCharges && slot.ammo) {
        const chargeTid = tidByName((slot.ammo || '').replace(/\s*\(\d+\)$/, ''));
        if (chargeTid) {
          const qty = slot.charges ?? slot.maxCharges ?? 1;
          chargeTotals.set(chargeTid, (chargeTotals.get(chargeTid) ?? 0) + qty);
        }
      }
    }
  }
  // The subSystemSlot attribute is still the classic 125-128 numbering (that is how CCP ships it on
  // the type), so it names the slot INDEX — 125 is SubSystemSlot0.
  for (const sub of (slots?.subsystems ?? [])) {
    if (!sub?.typeID) continue;
    const raw = TYPES[sub.typeID]?.attrs?.subSystemSlot ?? TYPES[sub.typeID]?.a?.subSystemSlot;
    if (raw != null) items.push({ flag: `SubSystemSlot${Math.round(raw) - 125}`, quantity: 1, type_id: sub.typeID });
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

