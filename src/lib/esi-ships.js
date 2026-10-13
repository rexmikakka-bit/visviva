// Import an assembled ship, as it really is, from a character's assets.
//
// A saved fitting cannot say which module a charge is loaded into, and it cannot carry an abyssal
// roll (see esi-fits.js). A fitted ship in the asset list can do both: every fitted module is an
// asset whose `location_id` is the ship's item_id and whose `location_flag` names its slot
// ("HiSlot0", "MedSlot3", "RigSlot0", "SubSystemSlot1" — the same strings as a saved fitting), and a
// loaded charge is a second asset under the SAME flag. Mutated modules and drones arrive as their
// dynamic type, so their base type, mutaplasmid and raw rolls are read from
// /dogma/dynamic/items/, exactly as My Abyssals does.
//
// The output is parseEFT's shape, so App.jsx's importFit builds the fit the same way it builds a
// pasted one. Schema: https://esi.evetech.net/meta/openapi.json (CharactersCharacterIdAssetsGet).
//
// React-free: the regression suite imports it.

import { TYPES, ATTR_ID_TO_NAME } from '../calc.js';
import { lookupShip } from './core.js';
import { parseFlag } from './esi-fits.js';
import { assetLocation, ASSET_SCOPE } from './abyssal-library.js';
import { fetchAllAssets, retryESI, publicJSON } from './abyssal-import.js';
import { getCharacterAssetNames, getCharacterShip, SHIP_SCOPE } from './esi.js';
import mutators from '../data/mutaplasmids.json' with { type: 'json' };
import dronesData from '../data/drones.json' with { type: 'json' };

const CAT_SHIP = 6, CAT_CHARGE = 8, CAT_FIGHTER = 87;
// Every mutaplasmid's result type: the "Abyssal Stasis Webifier" an asset holds instead of a base type.
const MUTATED_TYPES = new Set(Object.values(mutators).map(m => m.r));

export const isMutatedType = typeID => MUTATED_TYPES.has(typeID);

// Assembled hulls only. A packaged ship is not a singleton and has nothing fitted; a capsule has no
// slots worth importing.
export function assembledShips(assets) {
  return assets.filter(a => a.is_singleton && TYPES[a.type_id]?.c === CAT_SHIP && TYPES[a.type_id]?.gn !== 'Capsule');
}

// The ship's direct contents. Items inside a container in its cargo are one level further down and
// are deliberately not part of the fit.
export function shipContents(ship, assets) {
  return assets.filter(a => a.location_id === ship.item_id);
}

// /dogma/dynamic/items/ -> {typeID, name, mutaplasmid, mutations}, or null when this game data does
// not know the mutaplasmid (a newer one than the bundle). Modules and drones alike.
export function dynamicToMutated(asset, dynamic) {
  const base = TYPES[dynamic?.source_type_id], m = mutators[dynamic?.mutator_type_id];
  if (!base?.n || !m || m.r !== asset.type_id || !m.t.includes(dynamic.source_type_id)) return null;
  const raw = new Map((dynamic.dogma_attributes ?? []).map(a => [String(a.attribute_id), a.value]));
  const mutations = {};
  for (const id of Object.keys(m.a)) {
    const name = ATTR_ID_TO_NAME[id], value = raw.get(id);
    if (!name || typeof value !== 'number' || !Number.isFinite(value)) return null;
    mutations[name] = value;
  }
  return { typeID: dynamic.source_type_id, name: base.n, mutaplasmid: dynamic.mutator_type_id, mutations };
}

// ship: the hull's asset. assets: the full asset list. mutated: item_id -> dynamicToMutated() result.
// Returns parseEFT's shape plus `skipped`: items that could not be placed, for the UI to admit to.
export function shipAssetsToImportShape(ship, assets, { name, mutated = {} } = {}) {
  const shipTd = TYPES[ship.type_id];
  if (!shipTd?.n) throw new Error(`Unknown ship type_id ${ship.type_id}`);
  const placed = [], chargeBySlot = new Map(), subsystems = [], skipped = [];
  const drones = new Map(), fighters = new Map(), cargo = new Map(), rolledDrones = [];

  for (const it of shipContents(ship, assets)) {
    let td = TYPES[it.type_id], roll = null;
    if (MUTATED_TYPES.has(it.type_id)) {
      roll = mutated[it.item_id];
      if (!roll) { skipped.push(it); continue; }
      td = TYPES[roll.typeID];
    }
    const flag = String(it.location_flag ?? '');
    // The bundle only knows types with dogma, so a hold full of containers or fuel blocks is not a
    // loss worth reporting; an unknown module or drone is.
    if (!td?.n) { if (flag !== 'Cargo' && parseFlag(flag)?.kind !== undefined) skipped.push(it); continue; }
    const qty = Number(it.quantity) || 1;

    if (flag === 'DroneBay') {
      const dd = Object.values(dronesData).find(d => d.name === td.n);
      if (!dd) { skipped.push(it); continue; }
      if (roll) rolledDrones.push({ name: td.n, qty: 1, drone: dd, mutaplasmid: roll.mutaplasmid, mutations: roll.mutations });
      else drones.set(td.n, { name: td.n, qty: (drones.get(td.n)?.qty ?? 0) + qty, drone: dd });
      continue;
    }
    // A fighter loaded in a launch tube is still one of the ship's fighters.
    if (flag === 'FighterBay' || /^FighterTube\d$/.test(flag)) {
      if (td.c === CAT_FIGHTER) fighters.set(td.n, { name: td.n, qty: (fighters.get(td.n)?.qty ?? 0) + qty, typeID: roll?.typeID ?? it.type_id });
      else skipped.push(it);
      continue;
    }
    if (flag === 'Cargo') {
      // A mutated item in cargo is not fitted; keep the hold honest without a roll it cannot use.
      if (roll) { skipped.push(it); continue; }
      cargo.set(it.type_id, { name: td.n, qty: (cargo.get(it.type_id)?.qty ?? 0) + qty, typeID: it.type_id });
      continue;
    }
    const f = parseFlag(flag);
    // Specialised holds, ship and fleet hangars: not part of a fit.
    if (f?.kind !== 'slot') continue;
    if (td.c === CAT_CHARGE) { chargeBySlot.set(flag, td.n); continue; }
    if (f.section === 'subsystem') { subsystems.push({ typeID: it.type_id, name: td.n }); continue; }
    placed.push({ section: f.section, index: f.index, flag,
      mod: { name: td.n, typeID: roll?.typeID ?? it.type_id, slot: f.section, charge: undefined, state: undefined,
             mutaplasmid: roll?.mutaplasmid, mutations: roll?.mutations } });
  }

  // Charges are matched to their module by slot, which is the whole point of importing from assets.
  for (const p of placed) p.mod.charge = chargeBySlot.get(p.flag);
  // buildSlotsFromEFT fills each rack in array order, so this puts modules back in the pilot's order.
  // An empty slot between two modules closes up, the same as a saved-fitting import.
  const mods = placed.sort((a, b) => a.index - b.index).map(p => p.mod);

  return {
    shipName: shipTd.n, fitName: (name && name !== 'None' ? name : shipTd.n).slice(0, 100), ship: lookupShip(shipTd.n),
    mods, drones: [...drones.values(), ...rolledDrones], fighters: [...fighters.values()], cargo: [...cargo.values()],
    implantNames: [], boosterNames: [], subsystems, skipped,
  };
}

const defaultAPI = {
  names: getCharacterAssetNames,
  ship: getCharacterShip,
  dynamic: (a, signal) => publicJSON(`/dogma/dynamic/items/${a.type_id}/${a.item_id}/`, signal),
  station: (id, signal) => publicJSON(`/universe/stations/${id}/`, signal),
  system: (id, signal) => publicJSON(`/universe/systems/${id}/`, signal),
};

// One asset scan -> every assembled ship with its name and location, the one being flown first.
// `flying` is null when the character has not granted SHIP_SCOPE; a failed lookup only costs the
// marker, never the list.
export async function scanShips(character, { signal, onProgress = () => {}, api = defaultAPI, assetAPI } = {}) {
  if (!character?.scopes?.includes(ASSET_SCOPE)) throw new Error('Asset access is required. Connect this character again.');
  const assets = await fetchAllAssets(character, { signal, onProgress, ...(assetAPI ? { api: assetAPI } : {}) });
  const ships = assembledShips(assets), byId = new Map(assets.map(a => [a.item_id, a])), warnings = [];
  let flying = null;
  if (character.scopes.includes(SHIP_SCOPE)) {
    try { flying = await retryESI(s => api.ship(character.characterId, s), signal); }
    catch (e) { if (e.name === 'AbortError') throw e; }
  }
  // Ships are named; so are the containers and carriers a ship may sit inside.
  const ids = new Set(ships.map(s => s.item_id)), stations = new Set(), systems = new Set();
  for (const s of ships) {
    let node = s; const seen = new Set();
    while (!seen.has(node.location_id)) {
      seen.add(node.location_id);
      const parent = byId.get(node.location_id);
      if (!parent) {
        if (node.location_type === 'station') stations.add(node.location_id);
        else if (node.location_type === 'solar_system') systems.add(node.location_id);
        break;
      }
      ids.add(parent.item_id); node = parent;
    }
  }
  const names = {}, list = [...ids];
  for (let i = 0; i < list.length; i += 1000) {
    try {
      for (const row of await retryESI(s => api.names(character.characterId, list.slice(i, i + 1000), s), signal))
        if (row.name && row.name !== 'None') names[row.item_id] = row.name;
    } catch (e) { if (e.name === 'AbortError') throw e; warnings.push(e.message); break; }
  }
  const places = {};
  for (const [set, get] of [[stations, api.station], [systems, api.system]]) {
    for (const id of set) {
      try { places[id] = (await retryESI(s => get(id, s), signal)).name; }
      catch (e) { if (e.name === 'AbortError') throw e; warnings.push(e.message); break; }
    }
  }
  const rows = ships.map(s => ({
    asset: s, name: names[s.item_id] ?? null, location: assetLocation(s, byId, { ...places, ...names }),
    flying: flying?.ship_item_id === s.item_id, modules: shipContents(s, assets).filter(a => parseFlag(a.location_flag)?.kind === 'slot' && TYPES[a.type_id]?.c !== CAT_CHARGE).length,
  }));
  // Sorted by what the row shows: its own name, or the hull for an unnamed ship.
  const shown = r => r.name ?? TYPES[r.asset.type_id]?.n ?? '';
  rows.sort((a, b) => (b.flying - a.flying) || a.location.localeCompare(b.location) || shown(a).localeCompare(shown(b)));
  // ESI caches assets for up to an hour, so the ship being flown can be missing from them.
  const flyingMissing = flying && !rows.some(r => r.flying) ? flying : null;
  return { character, assets, rows, flyingMissing, warnings };
}

// Resolves the ship's rolls, then builds the import. A roll that cannot be read is skipped and
// reported rather than imported as its unrolled base, which would show numbers the pilot doesn't have.
export async function importShip(scan, row, { signal, api = defaultAPI } = {}) {
  const mutated = {};
  for (const it of shipContents(row.asset, scan.assets).filter(a => MUTATED_TYPES.has(a.type_id))) {
    try { const r = dynamicToMutated(it, await retryESI(s => api.dynamic(it, s), signal)); if (r) mutated[it.item_id] = r; }
    catch (e) { if (e.name === 'AbortError') throw e; }
  }
  return shipAssetsToImportShape(row.asset, scan.assets, { name: row.name, mutated });
}
