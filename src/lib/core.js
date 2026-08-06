// Shared constants, lookup tables, EFT parsing and the market/browser builders.
// Leaf module (imports only data + calc + theme). Layering: core <- ui <- tabs <- App.

import { useState, useEffect, useRef, useMemo } from "react";
import shipsData        from "../data/ships.json";
import modulesData      from "../data/modules.json";
import chargesData      from "../data/charges.json";
import dronesData       from "../data/drones.json";
import marketGroupsData from "../data/marketGroups.json";
import marketTreeData   from "../data/market-tree.json";
import mutaplasmidData  from "../data/mutaplasmids.json";
import TYPE_ICONS       from "../data/type-icons.json";
import { calcFitStats, computeCommandBursts, computeProjectedReps, calcRangeFactor, getModuleStats, layerEHP, peakRegen, calcAlignTime, calcLockTime, stackingPenalty, rangeFactor, calcTurretCTH, calcTurretMult, calcMissileFactor, SKILL_DEFAULTS, TYPES, tidByName, boosterSideEffectsFor, isT3Cruiser, subsystemsForHull, t3cSlotLayout, T3C_SUBSYSTEM_GROUPS, ATTR_ID_TO_NAME, simulateCapTrace } from "../calc.js";
import { DAMAGE_PROFILES } from "../data/damage-profiles.js";


const MUTA_BY_TYPE = {};   // baseTypeID -> [mutaTypeID]
const MUTA_BY_NAME = {};   // lowercased mutaplasmid name -> mutaTypeID
for (const [mid, m] of Object.entries(mutaplasmidData ?? {})) {
  if (m.n) MUTA_BY_NAME[m.n.toLowerCase()] = mid;
  for (const t of (m.t ?? [])) (MUTA_BY_TYPE[t] ??= []).push(mid);
}
// Resolve the affected attributes for a (mutaplasmid, baseTypeID) as [{attrID, name, base, min, max}].
function mutaAttrRanges(mutaID, baseTypeID) {
  const m = mutaplasmidData?.[mutaID]; if (!m) return [];
  const baseAttrs = TYPES[baseTypeID]?.attrs ?? TYPES[String(baseTypeID)]?.attrs ?? {};
  const out = [];
  for (const [aid, [lo, hi]] of Object.entries(m.a ?? {})) {
    const name = ATTR_ID_TO_NAME[aid];
    if (!name) continue;
    const base = baseAttrs[name];
    if (base == null) continue;
    out.push({ attrID: aid, name, base, min: base * lo, max: base * hi });
  }
  return out;
}

// ── Market tree indexes (pyfa market browser structure) ──────────────────────
// marketTreeData: { g: {gid:{n:name, p:parent, i:representative item tid}}, t: {tid:[mgid, name, volume]} }
const MT_CHILDREN = {}, MT_ITEMS = {};
for (const [gid, g] of Object.entries(marketTreeData.g)) {
  if (g.p != null) (MT_CHILDREN[g.p] ??= []).push(Number(gid));
}
for (const [tid, [mgid, name, vol]] of Object.entries(marketTreeData.t)) {
  (MT_ITEMS[mgid] ??= []).push({ typeID: Number(tid), name, vol });
}
for (const arr of Object.values(MT_CHILDREN)) arr.sort((a, b) => marketTreeData.g[a].n.localeCompare(marketTreeData.g[b].n));
for (const arr of Object.values(MT_ITEMS)) arr.sort((a, b) => a.name.localeCompare(b.name));
const MT_ROOTS = Object.keys(marketTreeData.g).filter(g => marketTreeData.g[g].p == null).map(Number)
  .sort((a, b) => marketTreeData.g[a].n.localeCompare(marketTreeData.g[b].n));
const MT_ALL_ITEMS = Object.entries(marketTreeData.t).map(([tid, [mgid, name, vol]]) => ({ typeID: Number(tid), name, vol, mgid }));
import { DRONE_TYPES } from "../dogma-engine-init.js";

// Supplemental data — loaded at runtime, no build-time dependency
// If data-bundle.js is missing the app still works; features using this data just show empty
let moduleVariations = {}, shipTraits = {}, implantData = {};
let shipsByClass = {}, slotIcons = {}, raceIcons = {}, navIcons = {};
let _bundleReady = false;
const _bundleListeners = [];
// NOTE: do NOT add /* @vite-ignore */ here. It used to be there, and it meant Vite left the path
// untouched in the production build — so the built app tried to fetch `dist/data-bundle.js`, which
// does not exist. The import failed silently and shipsByClass / moduleVariations / shipTraits /
// implantData / the icon maps were ALL empty in every production build (dev was fine, which is why
// nobody noticed). Letting Vite resolve it means the bundle is code-split into dist/assets/ and
// actually loads — and, as a bonus, its 5.6 MB leaves the main chunk.
// ship-traits.json is loaded ALONGSIDE the bundle (not after it) so `_bundleReady` only fires
// once traits are in — anything reading shipTraits on the ready signal would otherwise see the
// bundle's stale copy for a tick. Both are dynamic so they stay code-split out of the main chunk.
Promise.all([import('../data-bundle.js'), import('../data/ship-traits.json')]).then(([m, _traitsMod]) => {
  moduleVariations = m.moduleVariations ?? {};
  shipTraits       = m.shipTraits       ?? {};
  implantData      = m.implantData      ?? {};
  shipsByClass     = m.shipsByClass     ?? {};
  slotIcons        = m.slotIcons        ?? {};
  raceIcons        = m.raceIcons        ?? {};
  navIcons         = m.navIcons         ?? {};
  // The bundle's ship-browser list predates newer hulls (Lancer Dreadnoughts, etc.), so any ship it
  // doesn't know about was simply unselectable even though its stats were fully present in ships.json.
  // Backfill data-driven instead of maintaining a hardcoded list: every fittable hull in ships.json
  // that the bundle omits gets added under CCP's own group name from the type data (TYPES[].gn).
  // ships.json's own `hullClass` is NOT used as the class — it's wrong for 64 hulls (it files the Crow
  // under Tactical Destroyer, the Cenotaph under plain Battlecruiser); TYPES[].gn is authoritative.
  const _listedTypeIDs=new Set(Object.values(shipsByClass).flat().map(s=>s.typeID));
  for(const s of Object.values(shipsData)){
    if(!s?.typeID || !s?.name || _listedTypeIDs.has(s.typeID)) continue;
    const cls=TYPES[s.typeID]?.gn ?? s.hullClass;   // CCP group name; hullClass only as a last resort
    if(!cls) continue;
    if(!shipsByClass[cls]) shipsByClass[cls]=[];
    if(!shipsByClass[cls].some(x=>x.name===s.name||x.typeID===s.typeID)) shipsByClass[cls].push({name:s.name,typeID:s.typeID});
  }
  // Upwell structures aren't in ships.json at all (this app was ship-only until structure support
  // was added) — same backfill idea, but sourced straight from TYPES since there's no ships.json
  // entry to iterate. Filtered by group name, not a hardcoded typeID list, so a new structure hull
  // just works. Excludes non-fittable Upwell structures (Cyno Beacon/Jump Bridge/Jammer/Moon Drill —
  // no module slots at all) by only including the three groups that actually have hiSlots/medSlots/
  // lowSlots/rigSlots/serviceSlots. lookupShip()'s shipFromDogma() fallback already derives correct
  // stats+slot-counts for these from TYPES alone; this just makes them appear in the browse list.
  const STRUCTURE_HULL_GROUPS=new Set(["Citadel","Engineering Complex","Refinery"]);
  for(const[tid,t] of Object.entries(TYPES)){
    if((t.c??t.category)!==65 || !STRUCTURE_HULL_GROUPS.has(t.gn) || !t.n) continue;
    const ntid=Number(tid);
    if(_listedTypeIDs.has(ntid)) continue;
    if(!shipsByClass[t.gn]) shipsByClass[t.gn]=[];
    if(!shipsByClass[t.gn].some(x=>x.name===t.n||x.typeID===ntid)) shipsByClass[t.gn].push({name:t.n,typeID:ntid});
  }
  // Traits + descriptions for every hull, generated from eve.db by scripts/build-bundle.py.
  // These OVERRIDE the bundle's precomputed shipTraits rather than merely filling gaps. The
  // bundle's copy is doubly wrong: it has no entry at all for structures (blank Traits and
  // Description tabs on every Citadel/Engineering Complex/Refinery), and it is stale for ~114
  // hulls CCP has rebalanced since it was computed — the Helios, Claw and Revenant all still
  // list pre-rebalance bonuses there. The generated file reads the same invtraits/invtypes rows
  // pyfa itself reads, so it is current by construction.
  Object.assign(shipTraits, _traitsMod.default ?? _traitsMod ?? {});
  // Variations for module groups gaining newer faction/navy members (grouped by group+size,
  // since the precomputed bundle predates them). Override so existing members (e.g. T2 MGC) gain
  // the new siblings; each affected group's full variation list is rebuilt from current type data.
  const _NEW_VARIATIONS={"3606":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"3608":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"8635":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"8639":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"8641":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"93838":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"93839":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"444":[{"typeID":6571,"name":"Basic Mining Survey Chipset","meta":"Named"},{"typeID":6569,"name":"ML-3 Compact Mining Survey Chipset","meta":"Named"},{"typeID":444,"name":"Mining Survey Chipset I","meta":"T1"},{"typeID":2333,"name":"Mining Survey Chipset II","meta":"T2"},{"typeID":94065,"name":"Republic Fleet Mining Survey Chipset","meta":"Faction"}],"2333":[{"typeID":6571,"name":"Basic Mining Survey Chipset","meta":"Named"},{"typeID":6569,"name":"ML-3 Compact Mining Survey Chipset","meta":"Named"},{"typeID":444,"name":"Mining Survey Chipset I","meta":"T1"},{"typeID":2333,"name":"Mining Survey Chipset II","meta":"T2"},{"typeID":94065,"name":"Republic Fleet Mining Survey Chipset","meta":"Faction"}],"6569":[{"typeID":6571,"name":"Basic Mining Survey Chipset","meta":"Named"},{"typeID":6569,"name":"ML-3 Compact Mining Survey Chipset","meta":"Named"},{"typeID":444,"name":"Mining Survey Chipset I","meta":"T1"},{"typeID":2333,"name":"Mining Survey Chipset II","meta":"T2"},{"typeID":94065,"name":"Republic Fleet Mining Survey Chipset","meta":"Faction"}],"6571":[{"typeID":6571,"name":"Basic Mining Survey Chipset","meta":"Named"},{"typeID":6569,"name":"ML-3 Compact Mining Survey Chipset","meta":"Named"},{"typeID":444,"name":"Mining Survey Chipset I","meta":"T1"},{"typeID":2333,"name":"Mining Survey Chipset II","meta":"T2"},{"typeID":94065,"name":"Republic Fleet Mining Survey Chipset","meta":"Faction"}],"94065":[{"typeID":6571,"name":"Basic Mining Survey Chipset","meta":"Named"},{"typeID":6569,"name":"ML-3 Compact Mining Survey Chipset","meta":"Named"},{"typeID":444,"name":"Mining Survey Chipset I","meta":"T1"},{"typeID":2333,"name":"Mining Survey Chipset II","meta":"T2"},{"typeID":94065,"name":"Republic Fleet Mining Survey Chipset","meta":"Faction"}],"1893":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"2363":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"2364":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"5849":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"13941":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"13943":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14800":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14802":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14804":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14806":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14808":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14810":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14812":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14814":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"15808":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"15810":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"23902":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"44111":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"88265":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"94058":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"94060":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"1951":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"1998":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"1999":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"6325":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"14100":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"14640":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"14642":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"14644":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"14646":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"15965":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"93913":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"9944":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"10188":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"10190":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"11105":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"13945":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15144":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15146":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15148":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15150":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15416":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15895":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"22919":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"44113":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"44114":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"93998":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"94020":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"11359":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"16449":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"16451":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"16455":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"23416":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"26914":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"93840":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"93841":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"25561":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"25563":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"25565":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"85006":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"85007":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"94067":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"35770":[{"typeID":35770,"name":"Missile Guidance Enhancer I","meta":"T1"},{"typeID":35774,"name":"Pro-Nav Compact Missile Guidance Enhancer","meta":"Named"},{"typeID":35771,"name":"Missile Guidance Enhancer II","meta":"T2"},{"typeID":93908,"name":"Caldari Navy Missile Guidance Enhancer","meta":"Faction"},{"typeID":93909,"name":"Republic Fleet Missile Guidance Enhancer","meta":"Faction"}],"35771":[{"typeID":35770,"name":"Missile Guidance Enhancer I","meta":"T1"},{"typeID":35774,"name":"Pro-Nav Compact Missile Guidance Enhancer","meta":"Named"},{"typeID":35771,"name":"Missile Guidance Enhancer II","meta":"T2"},{"typeID":93908,"name":"Caldari Navy Missile Guidance Enhancer","meta":"Faction"},{"typeID":93909,"name":"Republic Fleet Missile Guidance Enhancer","meta":"Faction"}],"35774":[{"typeID":35770,"name":"Missile Guidance Enhancer I","meta":"T1"},{"typeID":35774,"name":"Pro-Nav Compact Missile Guidance Enhancer","meta":"Named"},{"typeID":35771,"name":"Missile Guidance Enhancer II","meta":"T2"},{"typeID":93908,"name":"Caldari Navy Missile Guidance Enhancer","meta":"Faction"},{"typeID":93909,"name":"Republic Fleet Missile Guidance Enhancer","meta":"Faction"}],"93908":[{"typeID":35770,"name":"Missile Guidance Enhancer I","meta":"T1"},{"typeID":35774,"name":"Pro-Nav Compact Missile Guidance Enhancer","meta":"Named"},{"typeID":35771,"name":"Missile Guidance Enhancer II","meta":"T2"},{"typeID":93908,"name":"Caldari Navy Missile Guidance Enhancer","meta":"Faction"},{"typeID":93909,"name":"Republic Fleet Missile Guidance Enhancer","meta":"Faction"}],"93909":[{"typeID":35770,"name":"Missile Guidance Enhancer I","meta":"T1"},{"typeID":35774,"name":"Pro-Nav Compact Missile Guidance Enhancer","meta":"Named"},{"typeID":35771,"name":"Missile Guidance Enhancer II","meta":"T2"},{"typeID":93908,"name":"Caldari Navy Missile Guidance Enhancer","meta":"Faction"},{"typeID":93909,"name":"Republic Fleet Missile Guidance Enhancer","meta":"Faction"}],"35788":[{"typeID":35789,"name":"Astro-Inertial Compact Missile Guidance Computer","meta":"Named"},{"typeID":35788,"name":"Missile Guidance Computer I","meta":"T1"},{"typeID":35790,"name":"Missile Guidance Computer II","meta":"T2"},{"typeID":94063,"name":"Caldari Navy Missile Guidance Computer","meta":"Faction"},{"typeID":94064,"name":"Republic Fleet Missile Guidance Computer","meta":"Faction"}],"35789":[{"typeID":35789,"name":"Astro-Inertial Compact Missile Guidance Computer","meta":"Named"},{"typeID":35788,"name":"Missile Guidance Computer I","meta":"T1"},{"typeID":35790,"name":"Missile Guidance Computer II","meta":"T2"},{"typeID":94063,"name":"Caldari Navy Missile Guidance Computer","meta":"Faction"},{"typeID":94064,"name":"Republic Fleet Missile Guidance Computer","meta":"Faction"}],"35790":[{"typeID":35789,"name":"Astro-Inertial Compact Missile Guidance Computer","meta":"Named"},{"typeID":35788,"name":"Missile Guidance Computer I","meta":"T1"},{"typeID":35790,"name":"Missile Guidance Computer II","meta":"T2"},{"typeID":94063,"name":"Caldari Navy Missile Guidance Computer","meta":"Faction"},{"typeID":94064,"name":"Republic Fleet Missile Guidance Computer","meta":"Faction"}],"94063":[{"typeID":35789,"name":"Astro-Inertial Compact Missile Guidance Computer","meta":"Named"},{"typeID":35788,"name":"Missile Guidance Computer I","meta":"T1"},{"typeID":35790,"name":"Missile Guidance Computer II","meta":"T2"},{"typeID":94063,"name":"Caldari Navy Missile Guidance Computer","meta":"Faction"},{"typeID":94064,"name":"Republic Fleet Missile Guidance Computer","meta":"Faction"}],"94064":[{"typeID":35789,"name":"Astro-Inertial Compact Missile Guidance Computer","meta":"Named"},{"typeID":35788,"name":"Missile Guidance Computer I","meta":"T1"},{"typeID":35790,"name":"Missile Guidance Computer II","meta":"T2"},{"typeID":94063,"name":"Caldari Navy Missile Guidance Computer","meta":"Faction"},{"typeID":94064,"name":"Republic Fleet Missile Guidance Computer","meta":"Faction"}]};
  for(const [tid,list] of Object.entries(_NEW_VARIATIONS)) moduleVariations[tid]=list;
  _bundleReady = true;
  _bundleListeners.forEach(fn => fn());
}).catch(() => { _bundleReady = true; _bundleListeners.forEach(fn => fn()); });

const GLOBAL_CSS=`
.hs{-ms-overflow-style:none;scrollbar-width:none}.hs::-webkit-scrollbar{display:none}
input{outline:none}select{outline:none}img.eve-icon{border-radius:4px;background:#1a1a1d;}

/* The app is exactly one viewport tall and never scrolls as a whole: each screen owns its own
   scroller. That is what keeps the header and the bottom nav pinned instead of scrolling away
   with the page. dvh first with a vh fallback — dvh needs iOS 15.4 and our floor is 15.0. */
.app-shell{height:100vh;height:100dvh;overflow:hidden}

/* Phones get the full screen width; the 430px column is a DESKTOP affordance, and capping there
   left a dead strip either side on any phone wider than 430pt (an iPhone Pro Max is 440). */
.app-col,.vv-sheet{width:100%;max-width:430px}
@media (max-width:640px){.app-col,.vv-sheet{max-width:none}}

/* Directional slide for sub-tab and drill-down changes. Applied by remounting with a key, which
   costs nothing extra here: switching tabs already unmounts one panel and mounts the other. */
@keyframes vv-from-right{from{transform:translateX(30%);opacity:.3}to{transform:none;opacity:1}}
@keyframes vv-from-left {from{transform:translateX(-30%);opacity:.3}to{transform:none;opacity:1}}
.vv-from-right{animation:vv-from-right .2s cubic-bezier(.22,.61,.36,1)}
.vv-from-left {animation:vv-from-left  .2s cubic-bezier(.22,.61,.36,1)}
@media (prefers-reduced-motion:reduce){.vv-from-right,.vv-from-left{animation:none}}
`;
import { C } from "../theme.js";
import { metaOf, META_COLORS, META_ORDER } from "./meta.js";
import { ATTRIBUTE_IMPLANTS, HARDWIRING_IMPLANTS, BOOSTER_DATA } from "../data/static-tables.js";
const DMG={
  em: {label:"EM",  color:"#60a5fa"},
  th: {label:"Th",  color:"#ef4444"},
  kin:{label:"Kin", color:"#cbd5e1"},
  exp:{label:"Exp", color:"#f97316"},
};
const STATE_COLORS={offline:C.offline,online:C.online,active:C.active,overheated:C.overheat};
const STATE_LABELS={offline:"Offline",online:"Online",active:"Active",overheated:"Overheat"};
const MODULE_STATES=["offline","online","active","overheated"];
const calcTransversal=(a,b)=>{const d=Math.abs(a-b)%360,n=d>180?360-d:d;return Math.min(n,180-n);};

// ── Ship lookup ────────────────────────────────────────────────────
// ── Ship lookup ─────────────────────────────────────────────────────
// Fallback: build a ships.json-shaped object from dogma TYPES data for ships
// that are missing from ships.json (e.g. Naga). Fixes blank stats/slots.
function shipFromDogma(name){
  const tid=tidByName(name);
  const td=tid?(TYPES[tid]??TYPES[String(tid)]):null;
  if(!td)return null;
  const a=td.attrs??td.a??{};
  const sensors=[["Radar",a.scanRadarStrength],["Ladar",a.scanLadarStrength],["Magnetometric",a.scanMagnetometricStrength],["Gravimetric",a.scanGravimetricStrength]]
    .filter(([,v])=>v>0).sort((x,y)=>(y[1]??0)-(x[1]??0));
  const rz=k=>Math.round((1-(a[k]??1))*1000)/10;
  let race=null;
  for(const races of Object.values(SHIPS_BY_CLASS)){for(const[r,ships] of Object.entries(races)){if(ships.includes(name)){race=r;break;}}if(race)break;}
  return{
    typeID:tid,name,hullClass:td.groupName??td.gn??"",race,
    cpu:a.cpuOutput??0,pg:a.powerOutput??0,calibration:a.upgradeCapacity??400,
    hiSlots:a.hiSlots??0,medSlots:a.medSlots??0,lowSlots:a.lowSlots??0,rigSlots:a.rigSlots??a.upgradeSlotsLeft??0,serviceSlots:a.serviceSlots??0,
    turrets:a.turretSlotsLeft??0,launchers:a.launcherSlotsLeft??0,
    maxVelocity:a.maxVelocity??0,agility:a.agility??0,
    warpSpeed:a.baseWarpSpeed??(a.warpSpeedMultiplier??3),baseWarpSpeed:a.baseWarpSpeed??1,
    mass:a.mass??0,volume:a.volume??0,
    shieldHP:a.shieldCapacity??0,armorHP:a.armorHP??0,hullHP:a.hp??0,
    shieldRechargeRate:a.shieldRechargeRate??0,
    capCapacity:a.capacitorCapacity??0,capRechargeRate:a.rechargeRate??0,
    targetRange:a.maxTargetRange??0,scanRes:a.scanResolution??0,maxTargets:a.maxLockedTargets??0,
    sigRadius:a.signatureRadius??0,droneBay:a.droneCapacity??0,droneBandwidth:a.droneBandwidth??0,
    warpCapNeed:a.warpCapacitorNeed??0,
    sensorStrength:sensors[0]?.[1]??0,sensorType:sensors[0]?.[0]??"",
    resists:{
      shield:{em:rz("shieldEmDamageResonance"),th:rz("shieldThermalDamageResonance"),kin:rz("shieldKineticDamageResonance"),exp:rz("shieldExplosiveDamageResonance")},
      armor:{em:rz("armorEmDamageResonance"),th:rz("armorThermalDamageResonance"),kin:rz("armorKineticDamageResonance"),exp:rz("armorExplosiveDamageResonance")},
      hull:{em:rz("emDamageResonance"),th:rz("thermalDamageResonance"),kin:rz("kineticDamageResonance"),exp:rz("explosiveDamageResonance")},
    },
  };
}
function lookupShip(name){
  const found=Object.values(shipsData).find(s=>s.name===name);
  const ship=found?{...found}:(shipFromDogma(name)??{name});
  // Override hullClass from authoritative SHIPS_BY_CLASS (fixes Malediction as Tactical Destroyer bug)
  for(const[cls,races] of Object.entries(SHIPS_BY_CLASS)){
    for(const ships of Object.values(races)){
      if(ships.includes(name)){ship.hullClass=cls;break;}
    }
  }
  return ship;
}
const fmtN=n=>{if(n==null)return"-";if(n>=1e6)return`${(n/1e6).toFixed(2)}M`;if(n>=100000)return`${Math.round(n/1000)}k`;if(n>=1000){const k=n/1000;return`${k%1===0?k.toFixed(0):k.toFixed(1)}k`;}return String(Math.round(n));};
const calcEHP=(hp,res)=>{const avg=((res?.em??0)+(res?.th??0)+(res?.kin??0)+(res?.exp??0))/4;return avg<100?hp/(1-avg/100):hp;};
const resMult=(em,th,kin,exp)=>(1/(1-(em+th+kin+exp)/400)).toFixed(2)+"x";

// Light haptic tick for touch feedback (no-op on devices/browsers without the Vibration API).
// Light haptic tick. Prefers the native Capacitor Haptics plugin (real Taptic Engine on iOS,
// where the web Vibration API is unavailable) via the runtime bridge, so there's no build-time
// dependency on the plugin; falls back to navigator.vibrate on the web.
const haptic=(ms=10)=>{try{
  const H=(typeof window!=="undefined")&&window.Capacitor?.Plugins?.Haptics;
  if(H){H.impact({style:"LIGHT"});return;}
  navigator.vibrate?.(ms);
}catch(e){}};

// ── Hull classes ───────────────────────────────────────────────────
const RACE_COLORS={Caldari:"#38bdf8",Gallente:"#4ade80",Amarr:"#f59e0b",Minmatar:"#f97316"};
const RACES=["Caldari","Gallente","Amarr","Minmatar"];
const HULL_CLASSES=[
  {key:"Frigate",icon:"🔸",color:C.rig},{key:"Assault Frigate",icon:"🔸",color:C.rig},
  {key:"Interceptor",icon:"🔸",color:C.rig},{key:"Covert Ops",icon:"🔸",color:C.rig},
  {key:"Electronic Attack Ship",icon:"🔸",color:C.rig},{key:"Stealth Bomber",icon:"🔸",color:C.rig},
  {key:"Logistics Frigate",icon:"🔸",color:C.rig},{key:"Destroyer",icon:"🔹",color:C.mid},
  {key:"Tactical Destroyer",icon:"🔹",color:C.mid},{key:"Interdictor",icon:"🔹",color:C.mid},
  {key:"Cruiser",icon:"🔷",color:C.accent},{key:"Heavy Assault Cruiser",icon:"🔷",color:C.accent},
  {key:"Recon Ship",icon:"🔷",color:C.accent},{key:"Heavy Interdictor",icon:"🔷",color:C.accent},
  {key:"Logistics",icon:"🔷",color:C.accent},{key:"Flag Cruiser",icon:"🔷",color:C.accent},
  {key:"Battlecruiser",icon:"🔶",color:C.warning},{key:"Command Ship",icon:"🔶",color:C.warning},
  {key:"Attack Battlecruiser",icon:"🔶",color:C.warning},
  {key:"Battleship",icon:"🔺",color:C.danger},{key:"Black Ops",icon:"🔺",color:C.danger},{key:"Marauder",icon:"🔺",color:C.danger},
];
const SHIPS_BY_CLASS={
  "Frigate":{Caldari:["Condor","Merlin","Kestrel","Heron","Bantam"],Gallente:["Incursus","Atron","Tristan","Imicus","Navitas"],Amarr:["Punisher","Executioner","Tormentor","Magnate","Inquisitor"],Minmatar:["Rifter","Slasher","Probe","Breacher","Burst"]},
  "Assault Frigate":{Caldari:["Harpy","Hawk"],Gallente:["Enyo","Ishkur"],Amarr:["Retribution","Vengeance"],Minmatar:["Jaguar","Wolf"]},
  "Interceptor":{Caldari:["Crow","Raptor"],Gallente:["Ares","Taranis"],Amarr:["Crusader","Malediction"],Minmatar:["Claw","Stiletto"]},
  "Covert Ops":{Caldari:["Buzzard"],Gallente:["Helios"],Amarr:["Anathema"],Minmatar:["Cheetah"]},
  "Electronic Attack Ship":{Caldari:["Kitsune"],Gallente:["Keres"],Amarr:["Sentinel"],Minmatar:["Hyena"]},
  "Stealth Bomber":{Caldari:["Manticore"],Gallente:["Nemesis"],Amarr:["Purifier"],Minmatar:["Hound"]},
  "Logistics Frigate":{Caldari:["Bantam"],Gallente:["Navitas"],Amarr:["Inquisitor"],Minmatar:["Burst"]},
  "Destroyer":{Caldari:["Cormorant","Corax"],Gallente:["Catalyst","Algos"],Amarr:["Coercer","Dragoon"],Minmatar:["Thrasher","Talwar"]},
  "Tactical Destroyer":{Caldari:["Jackdaw"],Gallente:["Hecate"],Amarr:["Confessor"],Minmatar:["Svipul"]},
  "Interdictor":{Caldari:["Flycatcher"],Gallente:["Eris"],Amarr:["Heretic"],Minmatar:["Sabre"]},
  "Cruiser":{Caldari:["Caracal","Moa","Osprey","Blackbird"],Gallente:["Thorax","Vexor","Celestis","Exequror"],Amarr:["Omen","Maller","Arbitrator","Augoror"],Minmatar:["Rupture","Stabber","Bellicose","Scythe"]},
  "Heavy Assault Cruiser":{Caldari:["Cerberus","Eagle"],Gallente:["Deimos","Ishtar"],Amarr:["Sacrilege","Zealot"],Minmatar:["Vagabond","Muninn"]},
  "Recon Ship":{Caldari:["Falcon","Rook"],Gallente:["Arazu","Lachesis"],Amarr:["Pilgrim","Curse"],Minmatar:["Huginn","Rapier"]},
  "Heavy Interdictor":{Caldari:["Onyx"],Gallente:["Phobos"],Amarr:["Devoter"],Minmatar:["Broadsword"]},
  "Logistics":{Caldari:["Basilisk"],Gallente:["Oneiros"],Amarr:["Guardian"],Minmatar:["Scimitar"]},
  "Flag Cruiser":{Caldari:["Stork"],Gallente:["Squall"],Amarr:["Sovereign"],Minmatar:["Bifrost"]},
  "Battlecruiser":{Caldari:["Drake","Ferox"],Gallente:["Brutix","Myrmidon"],Amarr:["Harbinger","Prophecy"],Minmatar:["Hurricane","Cyclone"]},
  "Command Ship":{Caldari:["Nighthawk","Vulture"],Gallente:["Astarte","Eos"],Amarr:["Damnation","Absolution"],Minmatar:["Claymore","Sleipnir"]},
  "Attack Battlecruiser":{Caldari:["Naga"],Gallente:["Talos"],Amarr:["Oracle"],Minmatar:["Tornado"]},
  "Battleship":{Caldari:["Raven","Scorpion","Rokh","Raven Navy Issue"],Gallente:["Hyperion","Dominix","Megathron","Vindicator"],Amarr:["Apocalypse","Abaddon","Armageddon","Nightmare"],Minmatar:["Tempest","Typhoon","Maelstrom","Bhaalgorn"]},
  "Black Ops":{Caldari:["Widow"],Gallente:["Sin"],Amarr:["Redeemer"],Minmatar:["Panther"]},
  "Marauder":{Caldari:["Golem"],Gallente:["Kronos"],Amarr:["Paladin"],Minmatar:["Vargur"]},
};
const SAVED_FITS_SEED={};
const CMD_SHIP_FITS={
  "Claymore":{bursts:["Interdiction Maneuvers: +12.5% Velocity","Evasive Maneuvers: +12.5% Agility","Rapid Deployment: -12.5% Align Time"]},
  "Sleipnir":{bursts:["Interdiction Maneuvers: +12.5% Velocity","Evasive Maneuvers: +12.5% Agility"]},
  "Eos":{bursts:["Armor Energizing: +12.5% Armor Resist","Rapid Repair: +12.5% Armor Rep Amt","Geometrical Precision: -12.5% Sig Radius"]},
  "Astarte":{bursts:["Armor Energizing: +12.5% Armor Resist","Rapid Repair: +12.5% Armor Rep Amt"]},
  "Vulture":{bursts:["Shield Harmonizing: +12.5% Shield Resist","Active Shielding: -12.5% Shield Boost Cap"]},
  "Nighthawk":{bursts:["Shield Harmonizing: +12.5% Shield Resist","Active Shielding: -12.5% Shield Boost Cap"]},
};

// ── Module CPU/PG usage table (used until full calc engine) ────────
const MODULE_USAGE={
  "Neutron Blaster Cannon II":{cpu:34,pg:1440},
  "Caldari Navy X-Large Shield Booster":{cpu:72,pg:1},
  "Pith X-Type Thermal Dissipation Field":{cpu:30,pg:1},
  "Sensor Booster II":{cpu:27,pg:1},
  "Magnetic Field Stabilizer II":{cpu:30,pg:1},
  "Damage Control II":{cpu:30,pg:1},
  "Large Core Defense Field Purger I":{cpu:0,pg:0,cal:200},
  "Large Hybrid Collision Accelerator I":{cpu:0,pg:0,cal:200},
};

// ── Generate empty slots from ship data ────────────────────────────
// Pure display-row computation (shared by render and drag-reorder so they can't diverge).
// Only the high-slot section groups identical modules (same name + same ammo).
const _TURRET_GROUPS=new Set(['Projectile Weapon','Energy Weapon','Hybrid Weapon','Mining Laser','Frequency Mining Laser','Citizen Mining Laser','Precursor Weapon']);
function _isGroupable(m){
  if(m.type==="empty"||!m.typeID)return false;
  const gn=TYPES[String(m.typeID)]?.gn??'';
  return _TURRET_GROUPS.has(gn)||/^Missile Launcher/i.test(gn);
}
function computeDisplayRows(mods,secKey,grouped){
  if(!grouped||secKey!=="high")return mods.map(m=>({...m,count:1,groupIds:[m.id]}));
  const seen=new Map();
  mods.forEach(m=>{
    if(!_isGroupable(m)){seen.set(m.id,{...m,count:1,groupIds:[m.id]});return;}
    const key=m.mutaplasmid?`__abyssal_${m.id}`:(m.ammo?`${m.name}||${m.ammo}`:m.name);
    if(seen.has(key)){const e=seen.get(key);e.count++;e.groupIds.push(m.id);}
    else seen.set(key,{...m,count:1,groupIds:[m.id]});
  });
  return Array.from(seen.values());
}

function generateEmptySlots(ship,subsystems){
  const s=ship??{};
  const make=(prefix,label,count)=>Array.from({length:count??0},(_,i)=>({id:`${prefix}${i}`,name:`[Empty ${label} Slot]`,icon:null,type:"empty"}));
  const t3c=isT3Cruiser(s.name);
  if(t3c){
    // T3 cruisers: slot counts come from fitted subsystems. Subsystems live in their own 4-slot section.
    const subs=subsystems??[null,null,null,null];
    const layout=t3cSlotLayout(subs.filter(Boolean));
    return{
      subsystems:Array.from({length:4},(_,i)=>subs[i]??{id:`sub${i}`,name:`[Empty Subsystem Slot]`,icon:null,type:"empty"}),
      high:make("h","High",layout.hiSlots),
      mid: make("m","Mid", layout.medSlots),
      low: make("l","Low", layout.lowSlots),
      rigs:make("r","Rig", layout.rigSlots),
    };
  }
  return{
    high:make("h","High",s.hiSlots??0),
    mid: make("m","Mid", s.medSlots??0),
    low: make("l","Low", s.lowSlots??0),
    rigs:make("r","Rig", s.rigSlots??0),
    // Service Slots (structures only, e.g. Astrahus=3) — serviceSlots is 0/absent on every ship,
    // so this section is simply empty for ships, no isStructure() check needed.
    services:make("sv","Service",s.serviceSlots??0),
  };
}

function parseEFT(text){
  const rawLines=text.replace(/\r/g,"").split("\n").map(l=>l.trim());
  if(!rawLines.length)return{error:"Empty text"};
  const hm=rawLines[0].match(/^\[(.+?),\s*(.+)\]$/);
  if(!hm)return{error:"Invalid EFT header — expected [Ship Name, Fit Name]"};
  const shipName=hm[1].trim(),fitName=hm[2].trim();
  const ship=Object.values(shipsData).find(s=>s.name===shipName)??shipFromDogma(shipName);
  if(!ship)return{error:`Unknown ship: "${shipName}"`};

  const mods=[],drones=[],fighters=[],cargo=[],implantNames=[],boosterNames=[],subsystems=[];
  // ── Abyssal pre-pass: extract mutation blocks (appear at the bottom of pyfa exports) ──
  // Each block is 3 lines: "[N] BaseName" / "Mutaplasmid Name" / "attr value, attr value, ...".
  const abyssalByRef={}; const consumed=new Set();
  for(let i=1;i<rawLines.length;i++){
    const bh=rawLines[i].match(/^\[(\d+)\]\s+(.+)$/);
    if(!bh)continue;
    let j=i+1; while(j<rawLines.length&&!rawLines[j])j++;
    let k=j+1; while(k<rawLines.length&&!rawLines[k])k++;
    const mutaName=(rawLines[j]||"").trim(), attrLine=(rawLines[k]||"").trim();
    const mutaID=MUTA_BY_NAME[mutaName.toLowerCase()];
    if(mutaID&&/\s-?[\d.]/.test(attrLine)){
      const mutations={};
      for(const part of attrLine.split(",")){const mt=part.trim().match(/^([A-Za-z][A-Za-z0-9]*)\s+(-?[\d.]+)/);if(mt)mutations[mt[1]]=Number(mt[2]);}
      if(Object.keys(mutations).length){abyssalByRef[bh[1]]={mutaID,mutations};consumed.add(i);consumed.add(j);consumed.add(k);}
    }
  }
  for(let i=1;i<rawLines.length;i++){
    if(consumed.has(i))continue;
    let line=rawLines[i];
    if(!line)continue;
    if(/^\[.*slot\]$/i.test(line))continue;
    if(/^\[.*\]$/.test(line))continue;
    // Abyssal module reference marker, e.g. "Federation Navy 800mm Steel Plates [1]" or "...Paste [2]"
    let modRef=null;
    const refM=line.match(/^(.*\S)\s+\[(\d+)\]\s*$/);
    if(refM){line=refM[1].trim();modRef=refM[2];}
    // EFT state suffix: "ModuleName /OFFLINE" or "ModuleName, Ammo /OVERLOADED"
    let stateOverride=null;
    const stateMatch=line.match(/^(.+?)\s*\/(OFFLINE|ON|OVERLOADED|OVERHEATED)\s*$/i);
    if(stateMatch){
      line=stateMatch[1].trim();
      const tag=stateMatch[2].toUpperCase();
      if(tag==="OFFLINE")stateOverride="offline";
      else if(tag==="OVERLOADED"||tag==="OVERHEATED")stateOverride="overheated";
    }
    const qm=line.match(/^(.+)\s+x(\d+)$/i);
    if(qm){
      const itemName=qm[1].trim(),qty=parseInt(qm[2],10);
      const drone=Object.values(dronesData).find(d=>d.name===itemName);
      if(drone){drones.push({name:itemName,qty,drone});continue;}
      // Fighters (category 87): each EFT line is one squadron (the "xN" is the squadron size).
      // Aggregate repeated lines of the same fighter into a squadron count.
      const fTid=tidByName(itemName);
      if(fTid&&(TYPES[fTid]?.c??TYPES[fTid]?.category)===87){
        const ex=fighters.find(f=>f.name===itemName);
        if(ex)ex.qty+=1; else fighters.push({name:itemName,qty:1,typeID:fTid});
        continue;
      }
      // Resolve typeID + volume from TYPES (authoritative — charges.json lacks T2/faction ammo)
      const tid=tidByName(itemName);
      const vol=tid?(TYPES[tid]?.attrs?.volume??TYPES[tid]?.a?.['161']??0):0;
      cargo.push({name:itemName,qty,typeID:tid,vol});
      continue;
    }
    const comma=line.indexOf(",");
    const modName=comma>=0?line.slice(0,comma).trim():line.trim();
    const ammo=comma>=0?line.slice(comma+1).trim().replace(/\s*\(\d+\)$/,''):undefined;
    if(!modName)continue;
    // T3 cruiser subsystems (category 32): collect separately — they define the slot layout.
    const nameTid=tidByName(modName);
    if(nameTid&&(TYPES[nameTid]?.c??TYPES[nameTid]?.category)===32){
      subsystems.push({typeID:nameTid,name:modName});
      continue;
    }
    const _ab=modRef?abyssalByRef[modRef]:null;
    const modInfo=Object.values(modulesData).find(m=>m.name===modName);
    if(modInfo){mods.push({name:modName,typeID:modInfo.typeID,slot:modInfo.slot,charge:ammo||undefined,state:stateOverride,mutaplasmid:_ab?.mutaID,mutations:_ab?.mutations});continue;}
    // Fallback: module not in modulesData but exists in TYPES (e.g. probe launcher) — slot by group
    if(!modInfo&&nameTid){
      const td=TYPES[nameTid];
      if([7,66].includes(td?.c??td?.category)){ // Module category (66 = Structure Module — weapons/rigs/service modules)
        mods.push({name:modName,typeID:nameTid,slot:guessSlotFromDogma(nameTid),charge:ammo||undefined,state:stateOverride,mutaplasmid:_ab?.mutaID,mutations:_ab?.mutations});
        continue;
      }
    }
    if(isBoosterName(modName)){boosterNames.push(modName);continue;}
    const implantSlot=IMPLANT_NAME_TO_SLOT.get(modName);
    if(implantSlot)implantNames.push({slot:implantSlot,name:modName});
  }
  return{shipName,fitName,ship,mods,drones,fighters,cargo,implantNames,boosterNames,subsystems};
}

// Determine a module's slot (high/med/low/rig/service) from its dogma effects when it's not in
// modulesData. EVE encodes slot via effects: 12=hiPower, 13=medPower, 11=loPower, 2663=rigSlot,
// 6306=serviceSlot (structures only) — verified against pyfa's Module.calculateSlot, which reads
// these same effect names from its own gamedata db (ours has no effect-name field, only IDs).
function guessSlotFromDogma(typeID){
  const e=TYPES[typeID]?.e??TYPES[typeID]?.effectIDs??[];
  if(e.includes(2663))return "rig";
  if(e.includes(6306))return "service";
  if(e.includes(12))return "high";
  if(e.includes(13))return "mid";
  if(e.includes(11))return "low";
  return "high"; // sensible default for launchers/turrets
}

function buildSlotsFromEFT(ship,parsedMods,subsystems){
  const slots=generateEmptySlots(ship,subsystems);
  const counters={high:0,mid:0,low:0,rigs:0,services:0};
  const slotKeyMap={high:"high",mid:"mid",low:"low",rig:"rigs",rigs:"rigs",service:"services",services:"services"};
  for(const mod of parsedMods){
    const secKey=slotKeyMap[mod.slot];
    if(!secKey)continue;
    const idx=counters[secKey];
    if(idx>=slots[secKey].length)continue;
    const modInfo=Object.values(modulesData).find(m=>m.name===mod.name);
    const takesCharges=moduleTakesCharges(mod.typeID,mod.name);
    const hasIntrinsicDmg=!!(modInfo?.emDmg||modInfo?.thDmg||modInfo?.kinDmg||modInfo?.expDmg);
    // Weapon = does damage (turrets/launchers). MGC/probe launchers take charges but aren't weapons.
    const isWeaponMod=(modInfo?.dmgMult!=null&&modInfo?.rof!=null)||hasIntrinsicDmg||
      (takesCharges&&/Launcher|Turret|Weapon/i.test(TYPES[mod.typeID]?.gn??TYPES[mod.typeID]?.groupName??''));
    const hasCharges=takesCharges||!!(modInfo?.chargeGroups?.length);
    const isCapBooster=modInfo?.groupName==="Capacitor Booster";
    const isRigMod=secKey==="rigs";
    const modType=isCapBooster?"capbooster":isWeaponMod?"weapon":isRigMod?"rig":"passive";
    const hasCycle=!!(modInfo?.duration&&modInfo.duration>0)||(modInfo?.capUse!=null&&modInfo.capUse>0)||!!(mod.typeID&&TYPES[mod.typeID]?.attrs?.duration>0);
    // Micro Jump Drives / Field Generators cycle but shouldn't count as "active" for stats — default online.
    const _gName=TYPES[mod.typeID]?.gn??TYPES[mod.typeID]?.groupName??'';
    const isMJD=/Micro Jump Drive|Micro Jump Field Generator/i.test(_gName);
    const defaultState=isRigMod?"online":isMJD?"online":(isWeaponMod||isCapBooster||hasCycle)?"active":"online";
    const state=mod.state??defaultState;
    // Compute maxCharges from module capacity and charge volume:
    let maxChargesVal = undefined;
    if(mod.charge && mod.typeID){
      const modTd = TYPES[mod.typeID]??TYPES[String(mod.typeID)];
      const modCapacity = modTd?.attrs?.capacity ?? modTd?.a?.['38'] ?? 0;
      const chargeTid = tidByName(mod.charge.replace(/\s*\(\d+\)$/, ''));
      const chargeVol = chargeTid ? (TYPES[chargeTid]?.attrs?.volume ?? TYPES[chargeTid]?.a?.['161'] ?? 1) : 1;
      maxChargesVal = modCapacity > 0 && chargeVol > 0 ? Math.floor(modCapacity / chargeVol) : undefined;
    }
    slots[secKey][idx]={...slots[secKey][idx],name:mod.name,typeID:mod.typeID,icon:null,type:modType,state,ammo:mod.charge,charges:maxChargesVal,maxCharges:maxChargesVal,optimal:modInfo?.optimal??undefined,falloff:modInfo?.falloff??undefined,tracking:modInfo?.tracking??undefined,mutaplasmid:mod.mutaplasmid??undefined,mutations:mod.mutations??undefined};
    counters[secKey]++;
  }
  return slots;
}

// ── Ammo/charges ───────────────────────────────────────────────────
const MODULE_VARS={
  "Neutron Blaster Cannon II":[{name:"Neutron Blaster Cannon I",meta:"T1"},{name:"Neutron Blaster Cannon II",meta:"T2"},{name:"'Arbalest' Neutron Blaster I",meta:"Named"},{name:"Dread Guristas Neutron Blaster",meta:"Faction"}],
  "Caldari Navy X-Large Shield Booster":[{name:"X-Large Shield Booster I",meta:"T1"},{name:"X-Large Shield Booster II",meta:"T2"},{name:"Caldari Navy X-Large Shield Booster",meta:"Faction"},{name:"Pith A-Type X-Large Shield Booster",meta:"Officer"}],
  "Magnetic Field Stabilizer II":[{name:"Magnetic Field Stabilizer I",meta:"T1"},{name:"Magnetic Field Stabilizer II",meta:"T2"},{name:"Federation Navy Magnetic Field Stabilizer",meta:"Faction"}],
};
const DMG_COLOR={EM:DMG.em.color,Thermal:DMG.th.color,Kinetic:DMG.kin.color,Explosive:DMG.exp.color};

// ── Implant data ───────────────────────────────────────────────────
const BOOSTER_DRUGS=[
  {name:"Blue Pill",effect:"Shield Boost Amount",icon:"💙",color:C.mid,variants:[{grade:"Synth",boost:"+10%",sideEffects:false},{grade:"Standard",boost:"+15%",sideEffects:true},{grade:"Improved",boost:"+20%",sideEffects:true},{grade:"Strong",boost:"+25%",sideEffects:true}]},
  {name:"Crash",effect:"Armor Repair Amount",icon:"🟠",color:C.warning,variants:[{grade:"Synth",boost:"+10%",sideEffects:false},{grade:"Standard",boost:"+15%",sideEffects:true},{grade:"Improved",boost:"+20%",sideEffects:true},{grade:"Strong",boost:"+25%",sideEffects:true}]},
  {name:"Drop",effect:"Armor HP",icon:"🟤",color:"#b45309",variants:[{grade:"Synth",boost:"+3%",sideEffects:false},{grade:"Standard",boost:"+4%",sideEffects:true},{grade:"Improved",boost:"+6%",sideEffects:true},{grade:"Strong",boost:"+8%",sideEffects:true}]},
  {name:"Exile",effect:"Armor Rep (Self-Only)",icon:"💚",color:C.rig,variants:[{grade:"Synth",boost:"+10%",sideEffects:false},{grade:"Standard",boost:"+15%",sideEffects:true},{grade:"Improved",boost:"+20%",sideEffects:true},{grade:"Strong",boost:"+25%",sideEffects:true}]},
  {name:"Mindflood",effect:"Capacitor Capacity",icon:"GJ",color:C.warning,variants:[{grade:"Synth",boost:"+5%",sideEffects:false},{grade:"Standard",boost:"+8%",sideEffects:true},{grade:"Improved",boost:"+12%",sideEffects:true},{grade:"Strong",boost:"+16%",sideEffects:true}]},
  {name:"Sooth Sayer",effect:"Shield HP",icon:"🔷",color:C.mid,variants:[{grade:"Synth",boost:"+3%",sideEffects:false},{grade:"Standard",boost:"+4%",sideEffects:true},{grade:"Improved",boost:"+6%",sideEffects:true},{grade:"Strong",boost:"+8%",sideEffects:true}]},
  {name:"X-Instinct",effect:"Signature Radius",icon:"🟢",color:C.rig,variants:[{grade:"Synth",boost:"-1.5%",sideEffects:false},{grade:"Standard",boost:"-2%",sideEffects:true},{grade:"Improved",boost:"-3%",sideEffects:true},{grade:"Strong",boost:"-4%",sideEffects:true}]},
  {name:"Frentix",effect:"Turret Optimal and Falloff",icon:"🔴",color:C.danger,variants:[{grade:"Synth",boost:"+5%",sideEffects:false},{grade:"Standard",boost:"+8%",sideEffects:true},{grade:"Improved",boost:"+12%",sideEffects:true},{grade:"Strong",boost:"+16%",sideEffects:true}]},
  {name:"Pyrolancea",effect:"Damage (All Types)",icon:"🔥",color:C.danger,variants:[{grade:"Synth",boost:"+3%",sideEffects:false},{grade:"Standard",boost:"+5%",sideEffects:true},{grade:"Improved",boost:"+7%",sideEffects:true},{grade:"Strong",boost:"+9%",sideEffects:true}]},
];

// ── EFT-import lookup helpers ──────────────────────────────────────
const BOOSTER_NAME_SET=new Set(Object.values(BOOSTER_DATA).flatMap(s=>Object.values(s).flat()));
// Agency 'X' YYn boosters (Overclocker SB7, Hardshell TB5, Pyrolancea DB3, etc.) aren't enumerated.
const AGENCY_BOOSTER_RE=/^Agency '/;
// Data-driven fallback: anything in the "Booster" group (303) is a booster, regardless of name.
// Catches seasonal/faction drugs (Republic Mobility, Federation Hardpoint, …) the name list omits.
// Implants share category 20 but sit in other groups, so group 303 cleanly excludes them.
const BOOSTER_GROUP_ID=303;
const isBoosterName=n=>{
  if(BOOSTER_NAME_SET.has(n)||AGENCY_BOOSTER_RE.test(n))return true;
  const t=tidByName(n);
  const g=t?(TYPES[t]?.g??TYPES[t]?.group??TYPES[t]?.groupID):null;
  return g===BOOSTER_GROUP_ID;
};
const IMPLANT_NAME_TO_SLOT=(()=>{const m=new Map();
  for(const dict of[ATTRIBUTE_IMPLANTS,HARDWIRING_IMPLANTS]){
    for(const[slotStr,sets]of Object.entries(dict)){
      const slot=parseInt(slotStr,10);
      for(const names of Object.values(sets))for(const n of names)m.set(n,slot);
    }
  }
  return m;})();

// ── Drone / cargo browser data ─────────────────────────────────────
const FIGHTER_CATALOG={"Light":{"Amarr":[{"name":"Equite I","tier":"T1","typeID":40358},{"name":"Templar I","tier":"T1","typeID":23055},{"name":"Equite II","tier":"T2","typeID":40552},{"name":"Templar II","tier":"T2","typeID":40556},{"name":"Imperial Navy Equite","tier":"Navy","typeID":83585},{"name":"Imperial Navy Templar","tier":"Navy","typeID":83579}],"Caldari":[{"name":"Dragonfly I","tier":"T1","typeID":23057},{"name":"Locust I","tier":"T1","typeID":40359},{"name":"Dragonfly II","tier":"T2","typeID":40557},{"name":"Locust II","tier":"T2","typeID":40554},{"name":"Caldari Navy Dragonfly","tier":"Navy","typeID":83582},{"name":"Caldari Navy Locust","tier":"Navy","typeID":83586}],"Gallente":[{"name":"Firbolg I","tier":"T1","typeID":23059},{"name":"Satyr I","tier":"T1","typeID":40360},{"name":"Firbolg II","tier":"T2","typeID":40558},{"name":"Satyr II","tier":"T2","typeID":40555},{"name":"Federation Navy Firbolg","tier":"Navy","typeID":83583},{"name":"Federation Navy Satyr","tier":"Navy","typeID":83587}],"Minmatar":[{"name":"Einherji I","tier":"T1","typeID":23061},{"name":"Gram I","tier":"T1","typeID":40361},{"name":"Einherji II","tier":"T2","typeID":40559},{"name":"Gram II","tier":"T2","typeID":40553},{"name":"Republic Fleet Einherji","tier":"Navy","typeID":83584},{"name":"Republic Fleet Gram","tier":"Navy","typeID":83589}]},"Heavy":{"Faction":[{"name":"Shadow","tier":"Navy","typeID":2948}],"Gallente":[{"name":"Antaeus I","tier":"T1","typeID":40364},{"name":"Cyclops I","tier":"T1","typeID":32325},{"name":"Antaeus II","tier":"T2","typeID":40562},{"name":"Cyclops II","tier":"T2","typeID":40563}],"Amarr":[{"name":"Ametat I","tier":"T1","typeID":40362},{"name":"Malleus I","tier":"T1","typeID":32340},{"name":"Ametat II","tier":"T2","typeID":40560},{"name":"Malleus II","tier":"T2","typeID":40561}],"Minmatar":[{"name":"Gungnir I","tier":"T1","typeID":40365},{"name":"Tyrfing I","tier":"T1","typeID":32342},{"name":"Gungnir II","tier":"T2","typeID":40564},{"name":"Tyrfing II","tier":"T2","typeID":40565}],"Caldari":[{"name":"Mantis I","tier":"T1","typeID":32344},{"name":"Termite I","tier":"T1","typeID":40363},{"name":"Mantis II","tier":"T2","typeID":40567},{"name":"Termite II","tier":"T2","typeID":40566}]},"Support":{"Amarr":[{"name":"Cenobite I","tier":"T1","typeID":37599},{"name":"Cenobite II","tier":"T2","typeID":40568},{"name":"Imperial Navy Cenobite","tier":"Navy","typeID":83591}],"Caldari":[{"name":"Scarab I","tier":"T1","typeID":40345},{"name":"Scarab II","tier":"T2","typeID":40569},{"name":"Caldari Navy Scarab","tier":"Navy","typeID":83592}],"Gallente":[{"name":"Siren I","tier":"T1","typeID":40346},{"name":"Siren II","tier":"T2","typeID":40570},{"name":"Federation Navy Siren","tier":"Navy","typeID":83593}],"Minmatar":[{"name":"Dromi I","tier":"T1","typeID":40347},{"name":"Dromi II","tier":"T2","typeID":40571},{"name":"Republic Fleet Dromi","tier":"Navy","typeID":83594}]}};
const CARGO_BROWSER={
  "Ammunition and Charges":[{name:"Antimatter Charge L",vol:0.025,priceM:0.0012,icon:"💊"},{name:"Void L",vol:0.025,priceM:0.0028,icon:"💊"},{name:"Null L",vol:0.025,priceM:0.0024,icon:"💊"},{name:"Cap Booster 400",vol:3.0,priceM:0.8,icon:"GJ"},{name:"Cap Booster 800",vol:6.0,priceM:1.6,icon:"GJ"},{name:"Navy Cap Booster 800",vol:6.0,priceM:4.2,icon:"GJ"}],
  "Consumables":[{name:"Nanite Repair Paste",vol:0.1,priceM:0.55,icon:"🔬"},{name:"Agency 'Overclocker' SB5",vol:0.1,priceM:0.20,icon:"🧪"},{name:"Synth Mindflood Booster",vol:0.1,priceM:0.50,icon:"💊"}],
  "Salvage":[{name:"Armor Plates",vol:0.5,priceM:0.015,icon:"🔩"},{name:"Burned Logic Circuit",vol:0.1,priceM:0.008,icon:"🔩"},{name:"Contaminated Nanite Compound",vol:0.1,priceM:0.025,icon:"🔩"}],
  "Minerals":[{name:"Tritanium",vol:0.01,priceM:0.000005,icon:"📦"},{name:"Mexallon",vol:0.01,priceM:0.00006,icon:"📦"},{name:"Zydrine",vol:0.01,priceM:0.0004,icon:"📦"},{name:"Megacyte",vol:0.01,priceM:0.006,icon:"📦"}],
  "Mobile Structures":[{name:"Mobile Depot",vol:50,priceM:1.2,icon:"🏗"},{name:"Mobile Tractor Unit",vol:100,priceM:6,icon:"🏗"}],
};

// ── Target profile stats for graph ────────────────────────────────
// Display units for warfare buff types (buffID → unit suffix). Most are percentages.
const WARFARE_BUFF_UNIT={3:" GJ/s",17:" m/s"};

// ═══ SDE DATA BUILDERS ═══════════════════════════════════════════
function buildMGChildren(){
  const map={};
  for(const[idStr,mg]of Object.entries(marketGroupsData)){
    const pk=String(mg.parent??"__root__");
    if(!map[pk])map[pk]=[];
    map[pk].push({id:Number(idStr),name:mg.name});
  }
  return map;
}
const MG_CHILDREN=buildMGChildren();
const MG_HIDDEN=new Set([685,681,1639]);
const SLOT_ROOT={high:9,mid:9,low:9,rigs:1111};

// A representative item typeID per market group, for category icons — pyfa shows an actual item's
// icon beside a category ("Energy Turrets" gets a beam laser), which reads far faster than a wall
// of text. CCP nominates one in the market tree, but only for ~half the groups the module browser
// walks, so buildNode falls back to the first item it can find beneath the node.
const MT_GROUP_ICON={};
for(const [gid,g] of Object.entries(marketTreeData.g)) if(g.i!=null) MT_GROUP_ICON[gid]=g.i;

function buildModuleBrowser(slotType){
  const mods=Object.values(modulesData).filter(m=>m.slot===slotType);
  const metaOrder={T1:0,T2:1,Storyline:2,Faction:3,Deadspace:4,Officer:5,Abyssal:6};
  const byMG={};
  for(const m of mods){
    if(!byMG[m.marketGroupID])byMG[m.marketGroupID]=[];
    byMG[m.marketGroupID].push(m);
  }
  for(const k of Object.keys(byMG)){
    // sort by the authoritative meta group (bundle's own meta string is unreliable)
    byMG[k].sort((a,b)=>(META_ORDER[metaOf(a.typeID,a.meta)]??99)-(META_ORDER[metaOf(b.typeID,b.meta)]??99)||a.name.localeCompare(b.name));
  }
  function buildNode(mgId){
    if(MG_HIDDEN.has(mgId))return null;
    const children=(MG_CHILDREN[String(mgId)]??[]).sort((a,b)=>a.name.localeCompare(b.name)).map(c=>buildNode(c.id)).filter(Boolean);
    const mods=byMG[mgId]??[];
    if(children.length===0&&mods.length===0)return null;
    const outMods=mods.map(m=>({name:m.name,meta:m.meta,cpu:m.cpu,pg:m.pg,typeID:m.typeID}));
    // CCP's nominated item first; otherwise the first real item anywhere beneath this node, which
    // is what makes the icon meaningful for leaf groups the market tree does not nominate one for.
    const iconTid=MT_GROUP_ICON[String(mgId)]
      ?? outMods.find(m=>m.typeID)?.typeID
      ?? children.map(c=>c.iconTid).find(Boolean)
      ?? null;
    return{id:mgId,name:marketGroupsData[String(mgId)]?.name??"",children,mods:outMods,iconTid};
  }
  const rootId=SLOT_ROOT[slotType]??9;
  return(MG_CHILDREN[String(rootId)]??[]).sort((a,b)=>a.name.localeCompare(b.name)).map(c=>buildNode(c.id)).filter(Boolean);
}

function buildChargeBrowser(){
  const byCategory={};
  for(const c of Object.values(chargesData)){
    if(!byCategory[c.category])byCategory[c.category]=[];
    byCategory[c.category].push(c);
  }
  return Object.fromEntries(Object.entries(byCategory).sort(([a],[b])=>a.localeCompare(b)).map(([cat,items])=>[cat,items.sort((a,b)=>a.name.localeCompare(b.name))]));
}

// Complete charge index built from TYPES (category 8 = Charge). charges.json is missing many
// T2/faction/script charges, so we index the authoritative dogma data instead: groupID → [charges].
const CHARGES_BY_GROUP=(()=>{
  const m=new Map();
  for(const[tid,t]of Object.entries(TYPES)){
    if((t.c??t.category)!==8)continue; // Charge category
    const gid=t.g??t.groupID;
    if(gid==null)continue;
    const a=t.attrs??t.a??{};
    const entry={typeID:Number(tid),name:t.n??t.name,groupID:gid,
      chargeSize:(a.chargeSize??a['128']??null),
      volume:(a.volume??a['161']??null),
      meta:(a.metaLevel??a['633']??0),
      // display fields for the ammo browser:
      em:(a.emDamage??a['114']??0),th:(a.thermalDamage??a['118']??0),
      kin:(a.kineticDamage??a['117']??0),exp:(a.explosiveDamage??a['116']??0),
      capBonus:(a.capacitorBonus??a['67']??null)};
    if(!m.has(gid))m.set(gid,[]);
    m.get(gid).push(entry);
  }
  for(const arr of m.values())arr.sort((a,b)=>a.name.localeCompare(b.name));
  return m;
})();

function getCompatibleCharges(mod){
  // Read charge groups from authoritative TYPES dogma data (chargeGroup1-6, attrs 604-606/609/610/1389).
  const td=mod.typeID?(TYPES[mod.typeID]??TYPES[String(mod.typeID)]):
    Object.entries(TYPES).find(([,t])=>(t.n??t.name)===mod.name)?.[1];
  if(!td)return [];
  const a=td.attrs??td.a??{};
  const CG_KEYS=[['604','chargeGroup1'],['605','chargeGroup2'],['606','chargeGroup3'],
                 ['609','chargeGroup4'],['610','chargeGroup5'],['1389','chargeGroup6']];
  const chargeGroups=CG_KEYS.map(([id,nm])=>a[id]??a[nm]).filter(v=>v&&v>0).map(Number);
  if(chargeGroups.length===0)return [];
  const chargeSize=a['128']??a.chargeSize??null;
  const out=[];
  for(const gid of chargeGroups){
    for(const c of (CHARGES_BY_GROUP.get(gid)??[])){
      // chargeSize filter: skip only if both sides specify a size and they differ
      if(chargeSize!=null && c.chargeSize!=null && c.chargeSize!==chargeSize)continue;
      out.push(c);
    }
  }
  // dedupe by typeID, sort by name
  const seen=new Set();
  return out.filter(c=>seen.has(c.typeID)?false:(seen.add(c.typeID),true))
            .sort((x,y)=>x.name.localeCompare(y.name));
}

// ── Ammo grouping for the charge browser ─────────────────────────────────────
// A flat alphabetical list is close to useless for picking ammo: "Imperial Navy Multifrequency S"
// sorts under I, nowhere near the "Multifrequency S" it is a variant of, and nothing tells you
// which end of the range/damage trade-off you are looking at. This groups charges into their ammo
// FAMILY and orders the families shortest-range first, which is the axis you actually choose on.

// Faction ammo is named "<Faction> <BaseName>". Rather than hardcoding a faction-prefix list (CCP
// keeps adding to it), a charge joins the family of the shortest OTHER charge in the same list
// whose name it ends with on a word boundary. Entirely data-driven: a new faction line groups
// itself, and a charge with no plainer sibling is its own family.
function chargeFamilyOf(name, allNames){
  let best=null;
  for(const other of allNames){
    if(other===name)continue;
    if(name.endsWith(" "+other)&&(!best||other.length<best.length))best=other;
  }
  return best??name;
}

// Ordering WITHIN a family. metaGroupID cannot tell a navy faction charge from a pirate one — both
// are metaGroup 4 — so the navy lines are matched by name, which is the only thing that separates
// them in the data.
const NAVY_AMMO_PREFIXES=["Imperial Navy","Republic Fleet","Caldari Navy","Federation Navy"];
function chargeTierRank(c){
  const meta=metaOf(c.typeID,null);
  if(meta==="T1")return 0;
  if(meta==="T2")return 1;
  if(meta==="Storyline")return 2;
  if(meta==="Faction")return NAVY_AMMO_PREFIXES.some(p=>c.name.startsWith(p))?3:4;
  return 5+(META_ORDER[meta]??0);
}

// weaponRangeMultiplier (attr 120): 0.5 on Multifrequency/Antimatter (short range, high damage),
// 1.2 on Infrared, and so on. Missiles and scripts have no such attribute — those families fall
// back to alphabetical, after everything that can be ordered by range.
function chargeRangeMult(c){
  const t=c.typeID!=null?TYPES[c.typeID]:null;
  const a=t?.a??t?.attrs??{};
  const v=a["120"]??a.weaponRangeMultiplier;
  return typeof v==="number"?v:null;
}

function groupChargesForBrowser(charges){
  const names=charges.map(c=>c.name);
  const fam=new Map();
  for(const c of charges){
    const key=chargeFamilyOf(c.name,names);
    if(!fam.has(key))fam.set(key,[]);
    fam.get(key).push(c);
  }
  const groups=[...fam.entries()].map(([family,items])=>{
    items.sort((a,b)=>chargeTierRank(a)-chargeTierRank(b)||a.name.localeCompare(b.name));
    const ranges=items.map(chargeRangeMult).filter(v=>v!=null);
    return{family,items,range:ranges.length?Math.min(...ranges):null};
  });
  groups.sort((a,b)=>{
    if(a.range==null&&b.range==null)return a.family.localeCompare(b.family);
    if(a.range==null)return 1;
    if(b.range==null)return -1;
    return a.range-b.range||a.family.localeCompare(b.family);
  });
  return groups;
}

// True if a module accepts charges (reads chargeGroup1-6 from authoritative TYPES data).
// Used for module classification and charge-tab gating so any chargeable module works going forward.
function moduleTakesCharges(typeID,name){
  const td=typeID?(TYPES[typeID]??TYPES[String(typeID)]):
    Object.entries(TYPES).find(([,t])=>(t.n??t.name)===name)?.[1];
  if(!td)return false;
  const a=td.attrs??td.a??{};
  return [['604','chargeGroup1'],['605','chargeGroup2'],['606','chargeGroup3'],
          ['609','chargeGroup4'],['610','chargeGroup5'],['1389','chargeGroup6']]
    .some(([id,nm])=>(a[id]??a[nm])>0);
}

const TOP_DRONE_ORDER=["Combat Drones","Combat Utility Drones","Electronic Warfare Drones","Logistics Drones","Mining Drones","Salvage Drones"];
function getMGPath(mgID){
  const chain=[];let cur=Number(mgID);const visited=new Set();
  while(cur&&marketGroupsData[cur]&&!visited.has(cur)){visited.add(cur);chain.unshift(marketGroupsData[cur].name);cur=marketGroupsData[cur].parent;}
  return chain;
}
function buildDroneBrowser(){
  const metaOrder={T1:0,T2:1,Storyline:2,Faction:3,Deadspace:4,Officer:5,Abyssal:6};
  const sortFn=arr=>[...arr].sort((a,b)=>(META_ORDER[metaOf(a.typeID,a.meta)]??99)-(META_ORDER[metaOf(b.typeID,b.meta)]??99)||a.name.localeCompare(b.name));
  const tree={};
  for(const d of Object.values(dronesData)){
    const path=getMGPath(d.marketGroupID);
    const top=path.length>=2?path[1]:path[0]??"Other";
    const sub=path.length>=3?path[2]:null;
    if(!tree[top])tree[top]={};
    const key=sub??"__flat__";
    if(!tree[top][key])tree[top][key]=[];
    tree[top][key].push(d);
  }
  const result=[];const seen=new Set();
  for(const topGroup of TOP_DRONE_ORDER){
    if(!tree[topGroup])continue;seen.add(topGroup);
    const subMap=tree[topGroup];
    const subKeys=Object.keys(subMap).filter(k=>k!=="__flat__").sort((a,b)=>a.localeCompare(b));
    if(subKeys.length>0){
      const subGroups=subKeys.map(name=>({name,drones:sortFn(subMap[name])}));
      if(subMap["__flat__"]?.length)subGroups.push({name:"Other",drones:sortFn(subMap["__flat__"])});
      result.push({topGroup,subGroups});
    }else{
      result.push({topGroup,drones:sortFn(Object.values(subMap).flat())});
    }
  }
  for(const[topGroup,subMap]of Object.entries(tree)){
    if(seen.has(topGroup))continue;
    result.push({topGroup,drones:sortFn(Object.values(subMap).flat())});
  }
  return result;
}
const REAL_CHARGE_BROWSER=buildChargeBrowser();
const REAL_DRONE_BROWSER=buildDroneBrowser();
const REAL_MODULE_BROWSER={high:buildModuleBrowser("high"),mid:buildModuleBrowser("mid"),low:buildModuleBrowser("low"),rigs:buildModuleBrowser("rigs")};

// Structure (citadel/engineering complex/refinery) modules aren't in modulesData at all — this app
// was ship-only until structure support was added, and there's no equivalent precomputed cache for
// them. Built straight from TYPES instead: category 66 = "Structure Module" (the structure
// equivalent of category 7), grouped by dogma group name rather than marketGroupID — CCP's
// marketGroupID data on many structure modules is unreliable (e.g. Standup Guided Bomb Launcher I
// carries marketGroupID 54 = "Standard Ores", clearly wrong), so market-tree placement can't be
// trusted the way it can for ship modules. Group name has no such problem and reads clearly
// ("Structure Warp Scrambler", "Structure Energy Neutralizer", ...). Slot comes from the same
// effect-based detection (guessSlotFromDogma) used for any module not in modulesData.
function buildStructureModuleBrowser(slotType){
  const byGroup={};
  for(const[tid,t] of Object.entries(TYPES)){
    if((t.c??t.category)!==66 || !t.n || !t.gn) continue;
    if(guessSlotFromDogma(Number(tid))!==slotType) continue;
    (byGroup[t.gn]??=[]).push({name:t.n,typeID:Number(tid),meta:metaOf(Number(tid))});
  }
  return Object.entries(byGroup).sort(([a],[b])=>a.localeCompare(b)).map(([gn,mods])=>({
    id:gn,name:gn,children:[],
    mods:mods.sort((a,b)=>(META_ORDER[a.meta]??99)-(META_ORDER[b.meta]??99)||a.name.localeCompare(b.name)),
  }));
}
const REAL_STRUCTURE_MODULE_BROWSER={high:buildStructureModuleBrowser("high"),mid:buildStructureModuleBrowser("mid"),low:buildStructureModuleBrowser("low"),rigs:buildStructureModuleBrowser("rig"),services:buildStructureModuleBrowser("service")};

// ═══ PRICE-EQUIVALENT MODULE SWAPS (Optimize Fit Price) ════════════════════════════
// Byte-identical dogma stats check — a pure cosmetic/faction reskin (e.g. Caldari Navy Warp
// Disruptor and Dread Guristas Warp Disruptor share literally every attribute, effect and skill
// requirement) vs. a real variant (e.g. Federation Navy Warp Disruptor, which trades CPU for
// range — same meta level, genuinely different stats). Meta level/group membership alone is NOT
// a safe signal for "identical" — verified against the live bundle that same-meta-tier faction
// modules frequently differ in real attributes. Only exact attribute+effect+skill equality qualifies.
function _sameModuleStats(tidA, tidB) {
  if (tidA === tidB) return false;
  const a = TYPES[tidA], b = TYPES[tidB];
  if (!a || !b || a.g !== b.g) return false;
  const aa = a.attrs ?? a.a ?? {}, ba = b.attrs ?? b.a ?? {};
  const keys = new Set([...Object.keys(aa), ...Object.keys(ba)]);
  for (const k of keys) {
    const av = Number(aa[k] ?? 0), bv = Number(ba[k] ?? 0);
    if (Math.abs(av - bv) > Math.max(1e-6, Math.abs(bv) * 1e-6)) return false;
  }
  if ((a.e ?? []).join(',') !== (b.e ?? []).join(',')) return false;
  const ar = (a.rs ?? []).slice().sort().join(','), br = (b.rs ?? []).slice().sort().join(',');
  return ar === br;
}
// Cheapest stat-identical variant of `typeID` that's actually cheaper than it, given a
// Map<typeID, iskPrice> (from prices.js's fetchPrices — which already drops zero/missing-price
// entries, so anything absent from the map is treated as unavailable and never recommended).
function cheaperEquivalent(typeID, priceMap) {
  if (!typeID || !priceMap) return null;
  const family = moduleVariations?.[String(typeID)] ?? moduleVariations?.[typeID] ?? [];
  const curPrice = priceMap.get(typeID);
  let best = null, bestPrice = curPrice ?? Infinity;
  for (const v of family) {
    if (!v?.typeID || !_sameModuleStats(typeID, v.typeID)) continue;
    const p = priceMap.get(v.typeID);
    if (p != null && p > 0 && p < bestPrice) { best = v; bestPrice = p; }
  }
  return best; // {typeID, name, meta} or null
}

// Optimize Fit Price, for ONE slot. Returns a replacement slot, or the same object unchanged when
// there is nothing to do (callers count swaps by identity).
//
// An ABYSSAL is never swapped. Its rolled attributes belong to the base type it was rolled on, so
// changing typeID/name would leave those mutations describing a module that was never rolled — a
// fit that cannot exist. There is also nothing to compare it against: an abyssal is a unique item
// with no per-type market price. Kept here rather than inline in the caller so the rule is
// exercisable on its own.
function optimizeSlotPrice(slot, priceMap) {
  if (!slot?.typeID || slot.mutaplasmid) return slot;
  const better = cheaperEquivalent(slot.typeID, priceMap);
  return better ? { ...slot, typeID: better.typeID, name: better.name } : slot;
}

// ═══ BOTTOM SHEET ════════════════════════════════════════════════

export { AGENCY_BOOSTER_RE, BOOSTER_DRUGS, BOOSTER_GROUP_ID, BOOSTER_NAME_SET, CARGO_BROWSER, CHARGES_BY_GROUP, CMD_SHIP_FITS, DMG, DMG_COLOR, FIGHTER_CATALOG, GLOBAL_CSS, HULL_CLASSES, IMPLANT_NAME_TO_SLOT, MG_CHILDREN, MG_HIDDEN, MODULE_STATES, MODULE_USAGE, MODULE_VARS, MT_ALL_ITEMS, MT_CHILDREN, MT_ITEMS, MT_ROOTS, MUTA_BY_NAME, MUTA_BY_TYPE, RACES, RACE_COLORS, REAL_CHARGE_BROWSER, REAL_DRONE_BROWSER, REAL_MODULE_BROWSER, REAL_STRUCTURE_MODULE_BROWSER, SAVED_FITS_SEED, SHIPS_BY_CLASS, SLOT_ROOT, STATE_COLORS, STATE_LABELS, TOP_DRONE_ORDER, WARFARE_BUFF_UNIT, _bundleListeners, _bundleReady, buildChargeBrowser, buildDroneBrowser, buildMGChildren, buildModuleBrowser, buildSlotsFromEFT, calcEHP, calcTransversal, cheaperEquivalent, computeDisplayRows, fmtN, generateEmptySlots, getCompatibleCharges, getMGPath, groupChargesForBrowser, guessSlotFromDogma, haptic, implantData, isBoosterName, lookupShip, moduleTakesCharges, moduleVariations, mutaAttrRanges, navIcons, optimizeSlotPrice, parseEFT, raceIcons, resMult, shipFromDogma, shipTraits, shipsByClass, slotIcons };
