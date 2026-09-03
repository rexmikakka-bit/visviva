// Shared constants, lookup tables, EFT parsing and the market/browser builders.
// Leaf module (imports only data + calc + theme). Layering: core <- ui <- tabs <- App.

// NOTE: no React import here, and there must not be one. The hooks were imported and never used,
// which cost nothing until the regression suite started importing this file for the charge-browser
// checks — the CI `test` job runs `node src/regression.test.mjs` with NO npm install (it needs only
// Node built-ins and the committed data bundles), so a bare `react` specifier fails to resolve and
// the whole suite dies before its first check. Same constraint as compare.js: React-free on purpose.
import shipsData        from "../data/ships.json" with { type: "json" };
import modulesData      from "../data/modules.json" with { type: "json" };
import chargesData      from "../data/charges.json" with { type: "json" };
import dronesData       from "../data/drones.json" with { type: "json" };
import marketGroupsData from "../data/marketGroups.json" with { type: "json" };
import marketTreeData   from "../data/market-tree.json" with { type: "json" };
import mutaplasmidData  from "../data/mutaplasmids.json" with { type: "json" };
import TYPE_ICONS       from "../data/type-icons.json" with { type: "json" };
import { calcFitStats, computeCommandBursts, computeProjectedReps, calcRangeFactor, getModuleStats, layerEHP, peakRegen, calcAlignTime, calcLockTime, stackingPenalty, rangeFactor, calcTurretCTH, calcTurretMult, calcMissileFactor, SKILL_DEFAULTS, TYPES, tidByName, boosterSideEffectsFor, isT3Cruiser, subsystemsForHull, t3cSlotLayout, T3C_SUBSYSTEM_GROUPS, ATTR_ID_TO_NAME, simulateCapTrace, fitCostClassOf } from "../calc.js";
import { DAMAGE_PROFILES } from "../data/damage-profiles.js";
import { classifyHull } from "./ship-taxonomy.js";


// Name -> module record. Every caller used to write `Object.values(modulesData).find(m=>m.name===n)`,
// which allocates a fresh 3,837-element array and scans it: ~0.9 ms per lookup, roughly 16 lookups per
// fit parsed. That is 14.5 of the 16.4 ms it costs to import one fit, so a 1,700-fit pyfa backup spent
// 25 of its 28 seconds here. It is also on the path of every EFT paste and every ESI import today.
// First-wins on a duplicate name, matching the `.find` it replaces.
const MODULE_BY_NAME = new Map();
for (const m of Object.values(modulesData ?? {})) if (m?.name && !MODULE_BY_NAME.has(m.name)) MODULE_BY_NAME.set(m.name, m);
function moduleByName(name) { return MODULE_BY_NAME.get(name); }

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
    // `lo`/`hi` are multipliers, so they only order the RESULT while the base is positive. A stasis
    // webifier's speedFactor is -60 and a cap battery's energyWarfareResistanceBonus is -20, which
    // flips them (min -54, max -66); CCP also ships six Siege mutaplasmids with lo > hi outright.
    // An <input type=range> whose max is below its min is clamped by the spec to a single point, so
    // the slider went dead while the typed box still worked — 234 of ~25.5k attribute slots.
    const a = base * lo, b = base * hi;
    out.push({ attrID: aid, name, base, min: Math.min(a, b), max: Math.max(a, b) });
  }
  return out;
}
// Detent at the unrolled base: a slider value within 2% of the range snaps onto `base` exactly.
// Undoing ONE attribute back to base is otherwise unreachable from the slider — the step is 1/400th
// of the range, so landing on the base by dragging is luck, and Revert is all-or-nothing.
// Works in RAW space, so the caller must un-mirror an inverted (rate-of-fire) slider first;
// snapping the mirrored value would put the detent at (min+max-base), which is not the base.
// The typed input is the escape hatch for a value genuinely inside the dead zone.
const DETENT_FRAC = 0.02;
function snapToBase(v, base, min, max) {
  const span = max - min;
  return span > 0 && Math.abs(v - base) <= span * DETENT_FRAC ? base : v;
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

/**
 * Sibling items for the Variations tab.
 *
 * `moduleVariations` (from data-bundle.js) is MODULE-only: all 311 boosters have an empty entry, so
 * a booster's Variations tab was permanently "No variation data available" — which is what made the
 * Exile and Overclocker boosters look broken. CCP has no `variationParentTypeID` on any booster
 * either, so there is nothing to key off in the dogma data.
 *
 * The MARKET tree does group them, correctly and by CCP's own hand: the four Exile grades all sit in
 * market group 2492 ("Exile"), the Agency Overclocker doses in 2504 ("Overclocker"). So fall back to
 * market-group siblings whenever the module map has nothing. This also gives drones, implants and
 * subsystems a sensible family list for free.
 *
 * Items CCP does not sell (AIR/Serenity event boosters) are absent from the market tree and honestly
 * report no siblings, rather than being lumped in with a family they are not part of.
 */
// Implants and hardwirings carry NO moduleVariations data, so they fall through to the market-group
// fallback below — which for a slot-1 implant is every slot-1 implant in the game. That is not a
// variation list, it is a catalogue, and it buries the three entries you actually wanted.
//
// Their real "variations" are encoded in the NAME, in two shapes:
//   grade sets   "Mid-Grade Asklepian Alpha"  -> siblings are the other GRADES of Asklepian Alpha
//   hardwirings  "... Surgical Strike SS-905" -> siblings are the other CODES of Surgical Strike
// Stripping whichever marker applies leaves a family key the siblings share.
const IMPLANT_GRADE_RE = /^(?:Low|Mid|High)-Grade\s+/i;
const HARDWIRING_CODE_RE = /\s+[A-Z]{1,3}-\d{3,4}$/;
// Boosters are graded either by a leading word ("Standard/Improved/Strong Exile Booster") or by a
// trailing tier numeral ("Federation Hardpoint Booster I/II"). Both are the same idea as an implant
// grade: the same item at a different strength.
const BOOSTER_GRADE_RE = /^(?:Standard|Improved|Strong)\s+/i;
const BOOSTER_TIER_RE = /\s+(?:I{1,3}|IV|V|VI{0,3})$/;
function implantFamilyKey(name) {
  return String(name ?? '')
    .replace(IMPLANT_GRADE_RE, '')
    .replace(BOOSTER_GRADE_RE, '')
    .replace(HARDWIRING_CODE_RE, '')
    .replace(BOOSTER_TIER_RE, '')
    .trim().toLowerCase();
}
/** Category 20 is Implant — which covers hardwirings and boosters too. */
function isImplantLike(typeID) {
  const t = TYPES[typeID] ?? TYPES[String(typeID)];
  return (t?.c ?? t?.category) === 20;
}
// Family -> members, built once over every category-20 type.
//
// Deliberately NOT scoped to the market group. CCP files these by SLOT ("Booster Slot 17"), which
// is the wrong axis twice over: it lumps Federation Hardpoint in with every unrelated slot-17
// booster, and it strands Republic Defense II in a group of one so the tab showed nothing at all.
// The family lives in the name, so that is what we index.
let _implantFamilies = null;
function implantFamilyIndex() {
  if (_implantFamilies) return _implantFamilies;
  _implantFamilies = new Map();
  for (const [tid, t] of Object.entries(TYPES)) {
    if ((t?.c ?? t?.category) !== 20 || !t?.n) continue;
    const k = implantFamilyKey(t.n);
    if (!k) continue;
    if (!_implantFamilies.has(k)) _implantFamilies.set(k, []);
    _implantFamilies.get(k).push({ typeID: Number(tid), name: t.n });
  }
  return _implantFamilies;
}

function variantsOf(typeID) {
  const direct = (moduleVariations ?? {})[String(typeID)] ?? [];
  if (direct.length) return direct;
  if (isImplantLike(typeID)) {
    const self = TYPES[typeID] ?? TYPES[String(typeID)];
    const kin = implantFamilyIndex().get(implantFamilyKey(self?.n)) ?? [];
    // Only narrow when the key found relatives; a name matching none of the shapes keeps whatever
    // the market-group fallback gives it rather than collapsing to a single entry.
    if (kin.length > 1) return kin.map(k => ({ ...k }));
  }
  const row = marketTreeData.t[String(typeID)];
  if (!row) return [];

  // meta is left undefined on purpose — the Variations tab resolves it from CCP's metaGroupID,
  // which is more reliable than anything stored alongside the name.
  return (MT_ITEMS[row[0]] ?? []).map(s => ({ typeID: s.typeID, name: s.name }));
}
import { DRONE_TYPES } from "../dogma-engine-init.js";

// Supplemental data — loaded at runtime, no build-time dependency
// If data-bundle.js is missing the app still works; features using this data just show empty
let moduleVariations = {}, shipTraits = {}, implantData = {};
let shipsByClass = {}, slotIcons = {}, raceIcons = {}, navIcons = {};
// pyfa imgs/gui/slot_subsystem_small.png — the pentagon of five bent strokes EVE uses for a
// subsystem slot. Inlined because the other four slot icons are inline data URIs too.
const SUBSYSTEM_SLOT_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAA8UlEQVR42q3BA0xwYRiA0ee99/ttM0tz0pQ0JY159vKsptyUpdmIs9WalG3btnkOz+ideEsAJijxkADsEC6QD5mzO0s7H8txbVxY2imbwps3nPMhvTey51WdpOOtR78rW9h5VY81Z8Q0c+hFIZ68RgGfHFvf1uCOcErnKzZ84sQr/vOZU2++FEggijPvP+VoEbzgmNPs9utqfnDmfWKvfTsmHBG/tZ3vDXzjhIhj8ZRfB7Yce/0uu2tDT0QHQHgd2RbdJ9G85pQSd/6pBC0K43cZmIodlmhcov7Ujm5VzNXPSwg3eKOSzBpwQeNGguJh9gA8dDZR6aX2XQAAAABJRU5ErkJggg==';
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
  // data-bundle.js ships only high/mid/low/rig, so a T3 cruiser's Subsystems header rendered an
  // empty box. Sourced from pyfa's imgs/gui/slot_subsystem_small.png, the same file the other
  // four came from — verified byte-identical for all four before adding this one, so the set
  // stays visually consistent. Merged HERE rather than into the bundle, which is generated.
  slotIcons        = { ...(m.slotIcons ?? {}), subsystem: SUBSYSTEM_SLOT_ICON };
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

// Function, not a module-level const: the template interpolates C.border/C.text, which must be
// read at CALL time (App.jsx calls this every render) so a live theme switch is picked up, rather
// than frozen at whatever the palette was when this module first loaded.
function getGlobalCss(){ return `
/* WKWebView defaults to text-size-adjust:auto, which inflates text in blocks much wider than the
   viewport — and it does so per cluster, so a layout laid out at a fixed width on a phone gets
   different sizes in different racks. The snapshot card (1140px inside a ~390px viewport) showed it
   as a visibly smaller High rack. Every size in this app is declared; none of them want adjusting. */
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
.hs{-ms-overflow-style:none;scrollbar-width:none}.hs::-webkit-scrollbar{display:none}

/* Unselectable. React emits plain "user-select" for the style prop, which WebKit ignores — iOS
   needs -webkit-user-select, and -webkit-touch-callout to stop the long-press magnifier/callout.
   Applied to things you DRAG, where a text selection is never what you meant. */
.no-select{-webkit-user-select:none;-ms-user-select:none;user-select:none;-webkit-touch-callout:none}
input{outline:none}select{outline:none}img.eve-icon{border-radius:4px;background:#1a1a1d;}

/* The app is exactly one viewport tall and never scrolls as a whole: each screen owns its own
   scroller. That is what keeps the header and the bottom nav pinned instead of scrolling away
   with the page.
   Sized from the parent, NOT in dvh. dvh is the *dynamic* viewport, so it re-resolves every time
   iOS shows or hides its toolbar — including mid-gesture, while you are dragging something. The
   height chain is now html -> body -> #root -> here, all 100%, resolving once against the initial
   containing block and never moving. index.css owns the top of that chain. */
.app-shell{height:100%;overflow:hidden}

/* Scroll anchoring OFF everywhere. Each screen already tracks and restores its own scroll
   position by hand (use-scroll-memory.js) and drives header-collapse / tab-strip-close off the
   scroll position it sees (App.jsx's window-capture scroll listener) — so a browser-initiated
   scrollTop correction is not a convenience here, it is a second, uncoordinated writer.
   Concretely: expanding the fit-tabs strip (FitTabs.jsx) grows a sibling ABOVE a screen's
   flex:1 scroller, which shrinks that scroller's own box. With the user scrolled to the exact
   bottom, Chromium's default scroll anchoring "corrects" scrollTop to keep the bottom content
   flush — which fires a real scroll event, which App.jsx reads as the user scrolling down, which
   immediately re-closes the strip it was told to open. Confirmed Android + dev server (Chromium
   scroll-anchoring default ON) only, never iOS (Safari's anchoring doesn't fire the same way). */
.app-shell,.app-shell *{overflow-anchor:none}

/* Phones get the full screen width; the 430px column is a DESKTOP affordance, and capping there
   left a dead strip either side on any phone wider than 430pt (an iPhone Pro Max is 440). */
.app-col,.vv-sheet{width:100%;max-width:430px}
@media (max-width:640px){.app-col,.vv-sheet{max-width:none}}

/* Directional slide for sub-tab and drill-down changes. Applied by remounting with a key, which
   costs nothing extra here: switching tabs already unmounts one panel and mounts the other. */
@keyframes vv-from-right{from{transform:translateX(30%);opacity:.3}to{transform:none;opacity:1}}
@keyframes vv-from-left {from{transform:translateX(-30%);opacity:.3}to{transform:none;opacity:1}}
/* Pressable feedback. A tap that visibly reacts feels immediate even when the work behind it is
   not; without it, buttons on a phone read as dead until the screen repaints. */
.press{transition:transform .11s ease, background-color .15s ease, border-color .15s ease, opacity .15s ease}
.press:active{transform:scale(.965)}
/* Rows and sheets entering. Short enough not to be in the way, long enough to read as motion. */
@keyframes vv-fade-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.vv-in{animation:vv-fade-up .18s cubic-bezier(.22,.61,.36,1)}
/* The sheet travels its full height rather than nudging 14px — a bottom sheet that appears with a
   small hop reads as a cut, not a movement. The ENTRY animation is a separate class from .vv-sheet
   because .vv-sheet also carries the 430px max-width above: dropping the class to run an exit
   would snap the sheet to full width mid-slide. Exit is an inline transform in BottomSheet, which
   also owns the drag-to-dismiss offset. */
@keyframes vv-sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}
.vv-sheet-in{animation:vv-sheet-up .22s cubic-bezier(.22,.61,.36,1)}
/* The nav drawer, same two-part shape as the sheet: a keyframe for entry (nothing to hang a
   transition off at mount time) and an inline transform for exit, which is the half that has to be
   driven by state so the drawer can finish leaving before it unmounts. These classes carry ONLY the
   animation, so dropping one to run the exit takes no layout with it. */
@keyframes vv-drawer-in{from{transform:translateX(-100%)}to{transform:translateX(0)}}
@keyframes vv-scrim-in{from{opacity:0}to{opacity:1}}
.vv-drawer-in{animation:vv-drawer-in .22s cubic-bezier(.22,.61,.36,1)}
.vv-scrim-in{animation:vv-scrim-in .22s ease}
@media (prefers-reduced-motion:reduce){
  .press:active{transform:none}
  .vv-in,.vv-sheet-in,.vv-drawer-in,.vv-scrim-in{animation:none}
}
.vv-from-right{animation:vv-from-right .2s cubic-bezier(.22,.61,.36,1)}
.vv-from-left {animation:vv-from-left  .2s cubic-bezier(.22,.61,.36,1)}
@media (prefers-reduced-motion:reduce){.vv-from-right,.vv-from-left{animation:none}}

/* Loading spinner (FitPickerSheet's deferred filterFn pass). Reduced-motion users still get the
   static ring — it reads as "not ready yet" even without the spin. */
@keyframes vv-spin{to{transform:rotate(360deg)}}
.vv-spin{animation:vv-spin .7s linear infinite}
@media (prefers-reduced-motion:reduce){.vv-spin{animation:none}}

/* Mutaplasmid sliders. The bar runs from the BASE value to the current one and is coloured by
   whether the roll is an improvement, so its length reads as the size of the roll and its colour as
   the sign — which a left-anchored accent fill cannot say at all. That needs the native track
   replaced: accent-color only ever fills left-to-thumb. MutaplasmidEditor supplies --a/--b (the two
   stop positions, already ordered) and --c (the colour); the px term in those positions corrects for
   the thumb's own width, since its centre travels between half a thumb from each end.
   Both track rules are duplicated rather than grouped because a selector list is dropped whole by
   any engine that does not recognise one member, and no engine knows both prefixes. */
.vv-muta{-webkit-appearance:none;appearance:none;width:100%;height:16px;background:transparent}
.vv-muta::-webkit-slider-runnable-track{height:4px;border-radius:2px;
  background:linear-gradient(to right,${C.border} var(--a),var(--c) var(--a),var(--c) var(--b),${C.border} var(--b))}
.vv-muta::-moz-range-track{height:4px;border-radius:2px;
  background:linear-gradient(to right,${C.border} var(--a),var(--c) var(--a),var(--c) var(--b),${C.border} var(--b))}
.vv-muta::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;
  margin-top:-5px;border-radius:50%;border:none;background:${C.text}}
.vv-muta::-moz-range-thumb{width:14px;height:14px;border-radius:50%;border:none;background:${C.text}}
`; }
import { C, getTheme } from "../theme.js";
import { metaOf, META_COLORS, META_ORDER, browserMetaRank } from "./meta.js";
import { nameMatchesQuery, searchScore } from "./jargon.js";
import { ATTRIBUTE_IMPLANTS, HARDWIRING_IMPLANTS, BOOSTER_DATA } from "../data/static-tables.js";
// #cbd5e1 (kin) and #60a5fa (em) read fine glowing on near-black but drop to ~1.5:1 and ~2.5:1
// against white — the light-mode "Kin" column and its percentages were barely visible. Colors
// are getters (not a plain object) so a theme switch is picked up live, same reasoning as
// STATE_COLORS above.
const DMG_COLORS={
  dark: {em:"#60a5fa",th:"#ef4444",kin:"#cbd5e1",exp:"#f97316"},
  light:{em:"#2f6fe0",th:"#dc2626",kin:"#475569",exp:"#c2410c"},
  // Kinetic goes warm grey rather than the dark theme's cool #cbd5e1, which looks blue-tinted next
  // to brown and competed with EM. Explosive is pulled toward red for the same reason the palette's
  // `warning` is: against a gold accent an orange this close to amber reads as a highlight.
  amarr:{em:"#6aa8f0",th:"#ec5a52",kin:"#d6cbb4",exp:"#f4602a"},
  // Only kinetic differs from dark: its grey is warmed to sit on a red-tinted background, where the
  // dark theme's cool #cbd5e1 reads as a blue cast. The other three are the dark palette's — thermal
  // in particular stays at pure #ef4444, which is the same reason `danger` does (see theme.js).
  sansha:{em:"#60a5fa",th:"#ef4444",kin:"#d0c8c6",exp:"#f97316"},
};
// Falls back to dark rather than indexing straight in: this is read on every damage-profile render,
// and a theme whose author forgot this table would otherwise take the whole app down instead of
// showing four slightly-off colours.
const dmgColor=k=>(DMG_COLORS[getTheme()]??DMG_COLORS.dark)[k];
const DMG={
  em: {label:"EM",  get color(){ return dmgColor("em"); }},
  th: {label:"Th",  get color(){ return dmgColor("th"); }},
  kin:{label:"Kin", get color(){ return dmgColor("kin"); }},
  exp:{label:"Exp", get color(){ return dmgColor("exp"); }},
};
// Proxy, not a plain object: values must be read live off C (itself a live Proxy) so a theme
// switch is picked up instead of freezing at whatever C.offline/etc. resolved to on first import.
const STATE_COLORS=new Proxy({},{ get(_,s){ return {offline:C.offline,online:C.online,active:C.active,overheated:C.overheat}[s]; } });
// The state dot has to answer "is this module RUNNING?" from a 6px circle, in a list of eight rows,
// without being read. Hue alone could not: active green and online grey sat at almost the same
// brightness, so they blurred together at a glance (and to a red/green-colourblind eye they are the
// same colour). A glow radius (px, 0 = none) separates the running states from the idle ones on
// something other than colour, without changing the dot's footprint.
const STATE_GLOW={offline:0,online:0,active:7,overheated:9};
const STATE_LABELS={offline:"Offline",online:"Online",active:"Active",overheated:"Overheat"};
const MODULE_STATES=["offline","online","active","overheated"];
// Which states this module can legally hold, low to high. Lives here rather than in the state picker
// because the dot in the fit row and the picker in the module menu both have to answer it, and two
// copies of "can this overheat?" would eventually disagree — the dot would then offer a state the
// picker doesn't and the engine ignores.
function validStatesFor(mod){
  if(!mod||mod.type==="empty")return [];
  // A rig cannot be offlined in game — you either fit it or you destroy it taking it out. pyfa allows
  // it anyway because it is the only way to ask "what does this rig actually buy me?" without
  // rebuilding the fit, and that is what the state is for here too. Offline frees its calibration,
  // matching pyfa (eos sums upgradeCost over ONLINE modules only).
  if(mod.type==="rig")return ["offline","online"];
  const td=TYPES[mod.typeID]??TYPES[String(mod.typeID)];
  const a=td?.attrs??td?.a??{};
  // A cloak has neither a duration nor a cap cost, so it fails the generic test and has to be named.
  const canActivate=((td?.gn??td?.groupName)==="Cloaking Device")
    ||!!(Number(a.duration||a['73']||0)||Number(a.speed||a['51']||0)||Number(a.capacitorNeed||a['6']||0));
  if(!canActivate)return ["offline","online"];
  return Number(a.heatDamage??a['1211']??0)>0?MODULE_STATES:["offline","online","active"];
}
// Where a gesture on the state dot should take a module, or null if that gesture means nothing here.
//
// Each gesture RESOLVES TO A TOGGLE rather than a one-way set, because the dot is the only control
// on the row — a gesture that can only go one way strands you in a state you need the module menu to
// leave. Hold offlines; holding again brings it back.
//
// What a gesture means depends on what the module can legally do, so the mapping is computed from
// `states` rather than hardcoded. A gesture a module cannot honour returns null — the caller reports
// that rather than silently doing nothing.
function gestureTarget(states,cur,gesture){
  const has=(s)=>states.includes(s);
  if(gesture==="hold")   return has("offline")?(cur==="offline"?"online":"offline"):null;
  if(gesture==="double") return has("overheated")?(cur==="overheated"?"active":"overheated"):null;
  // Tap: run/stop, and it NEVER offlines — hold is the only way off, so a brushed finger cannot
  // silently unfit a module's stats. That constraint is only visible on a passive module, whose
  // "stop" would have to be offline: tap brings it online and then refuses. Overheated steps down
  // one notch to active rather than stopping outright, since tapping a hot module means "cool it".
  if(!has("online"))return null;
  if(cur==="offline")    return has("active")?"active":"online";
  if(cur==="overheated") return "active";
  if(cur==="active")     return "online";
  return has("active")?"active":null;
}
// 300ms is Android's own DOUBLE_TAP_TIMEOUT, so the window matches what a thumb is already trained on
// elsewhere on the phone. Erring long is the safer direction: a missed double-tap reads as a broken
// control, while a pair of deliberate taps landing inside the window does something visible that one
// more gesture undoes. Shared by the module state dot and the abyssal sliders so the same gesture does
// not need different timing in different parts of the app.
//
// ⚠️ Measure it with the EVENT's `timeStamp`, never `Date.now()` inside the handler. The browser
// stamps an input event when it RECEIVES it, so the stamp survives the queue; the clock read inside
// the handler measures when React got round to you. That distinction is not academic in either place
// this is used — the first tap commits a change that recalculates the whole fit and blocks the main
// thread for ~500ms, so a genuine 140ms double-tap reads as 650ms and silently degrades into two
// single taps.
export const DOUBLE_TAP_MS=300;
const calcTransversal=(a,b)=>{const d=Math.abs(a-b)%360,n=d>180?360-d:d;return Math.min(n,180-n);};

// ── Ship lookup ────────────────────────────────────────────────────
// ── Ship lookup ─────────────────────────────────────────────────────
// What class of hull is this, and who built it? Both are derived from the type data, never read off
// the ships.json row: that row's `hullClass` is wrong for 64 hulls and its `race` for 116. The Draugur
// — a Triglavian Command Destroyer — is filed there as an "Unknown Attack Battlecruiser", and the
// Bifrost and Stork as "Flag Cruisers". TYPES[].gn is CCP's own group name and `classifyHull` reads
// the hull's factionID, which is exactly what the ship browser already routes on; sharing that here is
// what stops the header subtitle and the browser from disagreeing about the same ship.
function hullIdentity(typeID){
  const td=typeID?(TYPES[typeID]??TYPES[String(typeID)]):null;
  if(!td) return null;
  return {hullClass:td.groupName??td.gn??"", race:classifyHull(td,typeID).race};
}
// A hull's sensor is whichever of CCP's four strength attributes it actually carries, strongest
// first. Shared with lookupShip rather than inlined twice: ships.json's own sensorType calls 62
// Minmatar hulls "Laser", which is not a sensor type EVE has — the Minmatar sensor is LADAR.
const strongestSensor=a=>[["Radar",a.scanRadarStrength],["Ladar",a.scanLadarStrength],
  ["Magnetometric",a.scanMagnetometricStrength],["Gravimetric",a.scanGravimetricStrength]]
  .filter(([,v])=>v>0).sort((x,y)=>(y[1]??0)-(x[1]??0));
// Fallback: build a ships.json-shaped object from dogma TYPES data for ships
// that are missing from ships.json (e.g. Naga). Fixes blank stats/slots.
function shipFromDogma(name){
  const tid=tidByName(name);
  const td=tid?(TYPES[tid]??TYPES[String(tid)]):null;
  if(!td)return null;
  const a=td.attrs??td.a??{};
  const sensors=strongestSensor(a);
  const rz=k=>Math.round((1-(a[k]??1))*1000)/10;
  const{hullClass,race}=hullIdentity(tid)??{hullClass:"",race:null};
  return{
    typeID:tid,name,hullClass,race,
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
  const id=hullIdentity(ship.typeID);
  if(id){ship.hullClass=id.hullClass;ship.race=id.race;}
  // ships.json is a legacy precomputed bundle and hullClass/race above are not the only fields it
  // gets wrong — it is just where we noticed first. The dogma bundle is regenerated from pyfa's
  // eve.db and is the authoritative side of every disagreement, so take these from it too:
  //
  //   mass / volume  — 0 on 317 of 423 entries, the Vargur among them. Read as "0.00M kg" on the
  //                    hull's attributes sheet, and GraphTab's align-time fallback would have
  //                    divided by it. 0 is not a mass any ship has, so a falsy test is safe.
  //   sensorType     — 62 Minmatar hulls say "Laser", which EVE has no such thing as. Overridden
  //                    rather than backfilled: it is present and WRONG, not missing, and the Stats
  //                    tab prints it verbatim ("20 Laser" on a Vargur).
  //   sensorStrength — two hulls are stale (Cenotaph 25→15, Tholos 16→8), so it comes across with
  //                    the type it belongs to rather than being left to disagree with it.
  const _a=ship.typeID?((TYPES[ship.typeID]??TYPES[String(ship.typeID)])?.attrs??(TYPES[ship.typeID]??TYPES[String(ship.typeID)])?.a):null;
  if(_a){
    if(!ship.mass)ship.mass=_a.mass??0;
    if(!ship.volume)ship.volume=_a.volume??0;
    const sen=strongestSensor(_a)[0];
    if(sen){ship.sensorType=sen[0];ship.sensorStrength=sen[1];}
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
// Haptics. `kind` picks the weight of the tap so feedback carries meaning rather than being one
// undifferentiated buzz: 'light' for routine selection, 'medium' for committing something, 'heavy'
// for destructive, and the notification styles for outcomes.
//
// The web fallback matters less than it looks: navigator.vibrate does not exist on iOS at all, so
// on an iPhone this is entirely the Capacitor plugin's job. @capacitor/haptics must be installed
// for ANY of it to fire natively — the bridge silently no-ops otherwise.
const HAPTIC_MS={light:8,medium:14,heavy:22,success:[8,40,8],warning:[14,60,14],error:[22,60,22]};
const haptic=(kind="light")=>{try{
  // Back-compat: haptic(10) used to mean "buzz for 10ms".
  if(typeof kind==="number"){navigator.vibrate?.(kind);
    const H0=(typeof window!=="undefined")&&window.Capacitor?.Plugins?.Haptics;
    H0?.impact?.({style:"LIGHT"});return;}
  const H=(typeof window!=="undefined")&&window.Capacitor?.Plugins?.Haptics;
  if(H){
    if(kind==="success"||kind==="warning"||kind==="error"){
      H.notification?.({type:kind.toUpperCase()});
    } else if(kind==="selection"){
      H.selectionChanged?.();
    } else {
      H.impact?.({style:kind.toUpperCase()});
    }
    return;
  }
  navigator.vibrate?.(HAPTIC_MS[kind]??8);
}catch(e){}};

// ── Hull classes ───────────────────────────────────────────────────
const RACE_COLORS={Caldari:"#38bdf8",Gallente:"#4ade80",Amarr:"#f59e0b",Minmatar:"#f97316"};
const RACES=["Caldari","Gallente","Amarr","Minmatar"];
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
function isGroupableModule(m){
  if(m.type==="empty"||!m.typeID)return false;
  const gn=TYPES[String(m.typeID)]?.gn??'';
  return _TURRET_GROUPS.has(gn)||/^Missile Launcher/i.test(gn);
}
function computeDisplayRows(mods,secKey,grouped){
  if(!grouped||secKey!=="high")return mods.map(m=>({...m,count:1,groupIds:[m.id]}));
  const seen=new Map();
  mods.forEach(m=>{
    if(!isGroupableModule(m)){seen.set(m.id,{...m,count:1,groupIds:[m.id]});return;}
    // `orphan` is part of the key: a module stranded by a subsystem swap must never merge into
    // a group with a live one of the same name, or the red 'no longer have this slot' marking
    // would apply to both — or to neither, depending which landed first.
    //
    // `state` is part of the key too: state carries the DPS-affecting difference between
    // "active" and "overheated" (and the row's dot/heat display comes from one representative
    // member), so grouping across states used to let 2 overheated launchers merge into a 5x row
    // with 3 merely-active ones and show whichever state the first-seen module happened to be in
    // for all five — the DMG figure was real for some of the row and wrong for the rest of it.
    const key=m.mutaplasmid?`__abyssal_${m.id}`:`${m.orphan?'__orphan_':''}${m.state}||${m.ammo?`${m.name}||${m.ammo}`:m.name}`;
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
      // Every other rack identifies its slots by id, and so must this one. A subsystem list coming
      // straight from parseEFT carries only a name and typeID — importFit stamps the ids by group
      // order, but a direct caller doesn't, and four slots sharing the id `undefined` collapse onto
      // one another anywhere they are keyed. Spread last so an id that IS already there wins.
      // Slot index maps to subsystem category in T3C_SUBSYSTEM_GROUPS' declared order
      // (Core/Defensive/Offensive/Propulsion) — same order t3cSlotLayout and every T3C fit uses.
      subsystems:Array.from({length:4},(_,i)=>subs[i]
        ?{id:`sub${i}`,type:"subsystem",...subs[i]}
        :{id:`sub${i}`,name:`[Empty ${Object.keys(T3C_SUBSYSTEM_GROUPS)[i]} Subsystem Slot]`,icon:null,type:"empty"}),
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

// Reads the fit a user has copied — native (Capacitor's Clipboard plugin, the only thing that can
// reach the OS clipboard from inside the WebView) and web (navigator.clipboard) alike. Shared by the
// "From EFT" chooser button, which imports straight off a successful read with no sheet in between,
// and ImportFitSheet's manual "Read from Clipboard" button, its fallback when that direct read fails
// — so the native/web branching, and the empty-string-is-not-null footgun it exists to avoid, only
// live in one place. Returns text:null (never "") on any failure, with why carrying the real cause.
async function readClipboardText(){
  const Cap=(typeof window!=="undefined")&&window.Capacitor;
  const native=!!Cap?.isNativePlatform?.();
  let text=null,why=null;
  if(native){
    try{
      const {Clipboard}=await import('@capacitor/clipboard');
      text=(await Clipboard.read())?.value ?? null;
    }catch(e){ why=e?.message||String(e); }
  }else{
    try{ text=await navigator.clipboard.readText(); }catch(e){ why=e?.message||String(e); }
  }
  return{text,why};
}

function parseEFT(text){
  // Fits pasted from Discord are almost always wrapped in a ``` code fence, because that is how you
  // make one render as a block there. Strip it — leading and trailing fences, with an optional
  // language tag — so the fit imports as pasted instead of failing on "```" as a ship name. The
  // third replace catches a lone fence on its own line, which is what a clipped selection leaves.
  //
  // Line endings are normalized FIRST (a native clipboard can hand back CRLF or bare CR), and the
  // fences are then removed by FILTERING WHOLE LINES rather than by anchoring to the start and end
  // of the string. The anchored version only stripped a fence that began the text or ended it, so
  // any leading blank line, trailing newline, surrounding prose or stray carriage return left the
  // fence in place and "```" got parsed as the ship name. Matching "a line that is nothing but
  // backticks, optionally with a language tag" is both simpler and position-independent.
  //   is in the class because a mobile copy can carry non-breaking spaces.
  const norm = String(text ?? "").replace(/\r\n?/g, "\n");
  const fenced = norm.split("\n")
    .filter(l => !/^[\s ]*`{3,}[\s ]*\w*[\s ]*$/.test(l))
    .join("\n");
  const _srcLines=fenced.split("\n").map(l=>l.replace(/ /g," ").trim());
  // Filtering whole fence LINES is still not enough for a paste off a phone. Three shapes kept
  // arriving with the fence attached: a fence sharing its line with the header ("```[Legion, Foo]"),
  // a single-backtick inline wrap, and a fence followed by a blank line — that last one survived
  // because the header was read from index 0 specifically, so one empty line failed the whole
  // import. So strip backticks off both ends of every line too, then SEARCH for the header instead
  // of demanding it come first. Searching also means surrounding chat prose no longer has to be
  // deleted by hand. No EFT line legitimately begins or ends with a backtick.
  const allLines=_srcLines.map(l=>l.replace(/^`+|`+$/g,"").trim());
  if(!allLines.some(l=>l))return{error:"Empty text"};
  const HEADER=/^\[(.+?),\s*(.+)\]$/;
  const hdrAt=allLines.findIndex(l=>HEADER.test(l));
  if(hdrAt<0)return{error:"Invalid EFT header — expected [Ship Name, Fit Name]"};
  const rawLines=allLines.slice(hdrAt);
  const hm=rawLines[0].match(HEADER);
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
      if(drone){
        const _ab=modRef?abyssalByRef[modRef]:null;
        drones.push({name:itemName,qty,drone,mutaplasmid:_ab?.mutaID,mutations:_ab?.mutations});
        continue;
      }
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
    const modInfo=moduleByName(modName);
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
    const modInfo=moduleByName(mod.name);
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
    const defaultState=isRigMod?"online":(isMicroJumpDrive(mod.typeID)||isAssaultDamageControl(mod.typeID))?"online":(isWeaponMod||isCapBooster||hasCycle)?"active":"online";
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
  // Only ONE propulsion module may run at a time, so an imported fit carrying an MWD *and* an
  // afterburner cannot have both active — every prop mod cycles, so the defaultState above would
  // otherwise light up all of them. First one listed wins; the rest come in merely online, which is
  // the legal state and the one the user can flip from.
  let propSeen=false;
  for(const k of ["high","mid","low"]){
    slots[k]=(slots[k]??[]).map(m=>{
      if(TYPES[m?.typeID]?.gn!=="Propulsion Module"||m.state!=="active")return m;
      if(propSeen)return{...m,state:"online"};
      propSeen=true;return m;
    });
  }
  return slots;
}

// ── Ammo/charges ───────────────────────────────────────────────────
const MODULE_VARS={
  "Neutron Blaster Cannon II":[{name:"Neutron Blaster Cannon I",meta:"T1"},{name:"Neutron Blaster Cannon II",meta:"T2"},{name:"'Arbalest' Neutron Blaster I",meta:"Named"},{name:"Dread Guristas Neutron Blaster",meta:"Faction"}],
  "Caldari Navy X-Large Shield Booster":[{name:"X-Large Shield Booster I",meta:"T1"},{name:"X-Large Shield Booster II",meta:"T2"},{name:"Caldari Navy X-Large Shield Booster",meta:"Faction"},{name:"Pith A-Type X-Large Shield Booster",meta:"Officer"}],
  "Magnetic Field Stabilizer II":[{name:"Magnetic Field Stabilizer I",meta:"T1"},{name:"Magnetic Field Stabilizer II",meta:"T2"},{name:"Federation Navy Magnetic Field Stabilizer",meta:"Faction"}],
};
// Proxy, not a plain object, for the same reason as STATE_COLORS above — DMG.*.color is itself
// live, but a plain object here would still snapshot it once at import time.
const DMG_COLOR=new Proxy({},{ get(_,k){ return {EM:DMG.em.color,Thermal:DMG.th.color,Kinetic:DMG.kin.color,Explosive:DMG.exp.color}[k]; } });

// ── Implant data ───────────────────────────────────────────────────

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
// CCP nominates Bomb Launcher I for "Turrets & Launchers" (10), and at 28px that art is close enough
// to a Core Probe Launcher to be read as one — which sends people to the wrong branch, since probe
// launchers live under Scanning, not here. A 1400mm Howitzer is unmistakably a gun and is the widest
// thing the group covers. market-tree.json is generated, so the override belongs here, not there.
MT_GROUP_ICON['10']=2961;
// Same problem one branch over: CCP nominates Data Analyzer I for "Scanning Equipment" (1708), whose
// art says "hacking", not "scanning" — and hacking modules are one small child of this group
// (Analyzers), not what it is for. A Scan Acquisition Array is the readable stand-in. Note this is
// the SAME art its own child "Scanning Upgrades" (1709) carries; the two are never on screen at once
// and matching art down the branch reads as confirmation rather than confusion.
MT_GROUP_ICON['1708']=33176;
// CCP nominates Clone Vat Bay I for "Fleet Assistance Modules" (779), the narrowest of its five
// children — capital-only, two items, and art that says "medical bay" rather than anything fleet.
// A Cynosural Field Generator is the one thing under here everyone recognises on sight.
MT_GROUP_ICON['779']=21096;

function buildModuleBrowser(slotType){
  const mods=Object.values(modulesData).filter(m=>m.slot===slotType);
  const metaOrder={T1:0,T2:1,Storyline:2,Faction:3,Deadspace:4,Officer:5,Abyssal:6};
  const byMG={};
  for(const m of mods){
    if(!byMG[m.marketGroupID])byMG[m.marketGroupID]=[];
    byMG[m.marketGroupID].push(m);
  }
  // Ancillary repairers/boosters lead their category. They are a different thing from the plain
  // module next to them — charge-fed, burst tank — and are usually what someone opening "Shield
  // Boosters" is actually after, but sort into the middle of the alphabet.
  const isAncillary=m=>/^Ancillary /.test(TYPES[m.typeID]?.gn??TYPES[m.typeID]?.groupName??"");
  for(const k of Object.keys(byMG)){
    byMG[k].sort((a,b)=>
      (isAncillary(b)?1:0)-(isAncillary(a)?1:0)
      ||browserMetaRank(a.typeID,a.meta)-browserMetaRank(b.typeID,b.meta)
      ||a.name.localeCompare(b.name));
  }
  function buildNode(mgId){
    if(MG_HIDDEN.has(mgId))return null;
    const children=(MG_CHILDREN[String(mgId)]??[]).sort((a,b)=>a.name.localeCompare(b.name)).map(c=>buildNode(c.id)).filter(Boolean);
    const mods=byMG[mgId]??[];
    if(children.length===0&&mods.length===0)return null;
    // `calib` is the rig calibration cost (upgradeCost, attr 1153) — read from TYPES because
    // modules.json has no such field and reports rigs as cpu 0 / pg 0. Rigs carry no CPU or
    // powergrid at all, so the browser shows calibration in their place.
    //
    // These are BASE attributes, matching the item's own "show info" in game. Character skills
    // reduce what a fit is actually charged (up to -25%, and which of CPU/PG moves varies by module
    // type), so the resource strip on a fitted module can read lower than the figure here.
    const outMods=mods.map(m=>{
      const a=TYPES[m.typeID]?.attrs??TYPES[m.typeID]?.a??{};
      return {name:m.name,meta:m.meta,cpu:m.cpu,pg:m.pg,typeID:m.typeID,
              calib:a.upgradeCost??a['1153']??null};
    });
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
  // A charge that does not physically FIT in the module's hold cannot be loaded. This is not a
  // nicety — it is the only thing in CCP's data that stops a Core Probe Launcher taking combat
  // probes. Core and Expanded launchers are indistinguishable by chargeGroup (both 479), effects,
  // or anything else; what separates them is capacity 0.8 vs 8 against a Core Scanner Probe's
  // volume of 0.1 and a Combat Scanner Probe's volume of 1. floor(0.8 / 1) = 0 combat probes.
  // Same capacity-vs-volume mechanism as clipSizeOf() in calc.js.
  //
  // NOTE: pyfa does NOT model this — eos's getValidCharges() filters on chargeGroup alone, so it
  // will happily load combat probes into a core launcher. This is one of the rare places we are
  // deliberately stricter than the reference, because the game itself is.
  const capacity=a['38']??a.capacity??null;
  // CIVILIAN ammo is filed under the wrong group by CCP. All four turret variants — Civilian Pulse
  // Crystal, Civilian Autocannon Ammo, Civilian Railgun Charge, Civilian Blaster Charge — sit in
  // group 86 "Frequency Crystal" at chargeSize 1, whatever weapon they actually belong to. So every
  // small energy turret in the game offered autocannon, blaster and railgun ammo as loadable
  // charges. (Civilian Scourge Light Missile does the same to light missile launchers.)
  //
  // Nothing in the data separates them, and the group is not fixable from our side, so they are
  // matched by name — CCP has never shipped a civilian charge not named "Civilian ...". They stay
  // available to the civilian WEAPONS, which are named the same way, since those are the only
  // modules the ammo is for.
  const isCivilian=n=>/^civilian\b/i.test(String(n??''));
  const modIsCivilian=isCivilian(td.n??td.name??mod.name);
  const out=[];
  for(const gid of chargeGroups){
    for(const c of (CHARGES_BY_GROUP.get(gid)??[])){
      // chargeSize filter, exactly as eos's Module.isValidCharge does it: if the MODULE names a size,
      // the charge must carry that same size — and a charge with NO size fails that, it is not exempt.
      //
      // The old rule ("skip only if both sides specify a size and they differ") let the two sizeless
      // charges in the game, Cap Booster 25 and Navy Cap Booster 25, into every ancillary shield
      // booster. That is not a harmless extra option: they are the smallest by volume, so an X-Large
      // ASB offered a 149-charge clip it cannot load in game (400s are its smallest), and the clip
      // EHP that clip implies is nonsense. Capacitor Boosters proper carry no chargeSize at all, so
      // they are untouched and still take a 25 — which is correct, they do.
      //
      // A module size of 0 (the Small ASB) means "no size restriction" here, not "size zero"; eos
      // gates on `> 0` for the same reason.
      if(chargeSize>0 && c.chargeSize!==chargeSize)continue;
      if(capacity>0 && c.volume>0 && c.volume>capacity)continue;
      if(!modIsCivilian && isCivilian(c.name))continue;
      out.push(c);
    }
  }
  // dedupe by typeID, sort by name
  const seen=new Set();
  return out.filter(c=>seen.has(c.typeID)?false:(seen.add(c.typeID),true))
            .sort((x,y)=>x.name.localeCompare(y.name));
}

// Ancillary modules are useless empty — an Ancillary Shield Booster with no cap booster loaded is
// just a worse shield booster, and an Ancillary Armor Repairer with no paste reps at a third rate.
// A plain Capacitor Booster is the same story: no charge, no GJ. Fitting one and forgetting the
// charge is a silent, easy mistake, so all three arrive loaded.
//
// Returns {name, qty} or null.
//
// ASB/AAR: smallest volume wins among the compatible charges — which is also what picks Navy over
// the plain variant, as navy charges are physically smaller for the same capacitor. Every ASB size
// lands on 9 charges, which is the number the module is known for.
//
// This used to need a size rule of its own, preferring an exact chargeSize match and falling back to
// sizeless charges, because `getCompatibleCharges` let the sizeless Cap Booster 25s into every list
// and "smallest volume" would otherwise have loaded 149 of them into an X-Large. That filter now
// enforces the size itself, so a sized module never sees them and the fallback has nothing to catch.
function defaultChargeFor(typeID){
  const td=typeID!=null?(TYPES[typeID]??TYPES[String(typeID)]):null;
  if(!td)return null;
  const gn=td.gn??td.groupName??"";
  const isASB=gn==="Ancillary Shield Booster"||gn==="Ancillary Remote Shield Booster";
  const isAAR=gn==="Ancillary Armor Repairer"||gn==="Ancillary Remote Armor Repairer";
  const isCapBooster=gn==="Capacitor Booster";
  if(!isASB&&!isAAR&&!isCapBooster)return null;
  const a=td.attrs??td.a??{};
  const capacity=a["38"]??a.capacity??0;
  if(!(capacity>0))return null;

  if(isAAR){
    // An ancillary armor repairer takes nothing but Nanite Repair Paste.
    const tid=tidByName("Nanite Repair Paste");
    const vol=tid?((TYPES[tid]?.attrs??TYPES[tid]?.a??{})["161"]??(TYPES[tid]?.attrs?.volume)):null;
    if(!tid||!(vol>0))return null;
    return {name:"Nanite Repair Paste",qty:Math.floor(capacity/vol)};
  }

  const compatible=getCompatibleCharges({typeID,name:td.n??td.name});
  if(!compatible.length)return null;

  if(isCapBooster){
    // Unlike an ASB/AAR (more clips of a small charge beats fewer of a big one), a plain Capacitor
    // Booster wants the LARGEST charge that fits — one big GJ hit per cycle beats reloading sooner.
    // Preferring the Navy line specifically (over the plain charge of the same nominal size) matches
    // what a pilot would actually load: identical capacitorBonus, smaller volume, and cheap enough
    // that there's essentially no reason to fly the plain version once Navy is available.
    const navy=compatible.filter(c=>c.name.startsWith("Navy "));
    const pool=(navy.length?navy:compatible)
      .map(c=>({...c,vol:c.volume??((TYPES[c.typeID]?.attrs??TYPES[c.typeID]?.a??{})["161"])}))
      .filter(c=>c.vol>0)
      .sort((x,y)=>(y.capBonus??0)-(x.capBonus??0)||x.name.localeCompare(y.name));
    const best=pool[0];
    if(!best)return null;
    return {name:best.name,qty:Math.floor(capacity/best.vol)};
  }

  const pool=compatible
    .map(c=>({...c,vol:c.volume??((TYPES[c.typeID]?.attrs??TYPES[c.typeID]?.a??{})["161"])}))
    .filter(c=>c.vol>0)
    .sort((x,y)=>x.vol-y.vol||x.name.localeCompare(y.name));
  const best=pool[0];
  if(!best)return null;
  return {name:best.name,qty:Math.floor(capacity/best.vol)};
}

// Implant SETS are named "<Grade>-grade <Set> <Greek>" — High-grade Snake Alpha ... Omega. Fitting
// one a slot at a time means six trips through the picker for a thing that is only ever wanted as a
// set, so given any member this returns every sibling with the slot it belongs in.
//
// Slots come from IMPLANT_NAME_TO_SLOT rather than from the Greek letter's position: the letters
// happen to run Alpha..Omega = 1..6 today, but the map is built from the actual implant data and
// cannot drift from it.
const IMPLANT_SET_RE=/^((?:High|Mid|Low)-grade\s+.+?)\s+(Alpha|Beta|Gamma|Delta|Epsilon|Omega)$/i;
function implantSetMembers(name){
  const m=IMPLANT_SET_RE.exec(String(name??""));
  if(!m)return null;
  const prefix=m[1];
  const out=[];
  for(const [n,slot] of IMPLANT_NAME_TO_SLOT){
    const mm=IMPLANT_SET_RE.exec(n);
    if(mm&&mm[1].toLowerCase()===prefix.toLowerCase())out.push({name:n,slot});
  }
  out.sort((a,b)=>a.slot-b.slot);
  return out.length>1?{setName:prefix,members:out}:null;
}

// Drop every member of a set into its own slot, returning a new implant list. Pure, and here rather
// than inline in the screen because the screen's copy of it was written as `set=>fitSet(set)` — a
// const arrow calling itself — and shipped that way: both "+ Set" buttons blew the stack instead of
// fitting anything. Nothing could catch that while the only copy lived inside a component.
//
// Matched INTO the existing rows by slot, so a set with a grade missing leaves that slot as it was
// rather than blanking it, and `bonus` is cleared exactly as fitting one implant by hand does.
function applyImplantSet(implants,set){
  const bySlot=new Map((set?.members??[]).map(m=>[m.slot,m]));
  return implants.map(i=>{const m=bySlot.get(i.slot);return m?{...i,name:m.name,bonus:null}:i;});
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

// MISSILES do not sort on range the way turret ammo does — you pick a missile by DAMAGE TYPE,
// because the launcher's range is the launcher's, not the charge's. Every missile is named for its
// type, and the T2 variants keep that word ("Scourge Fury Heavy Missile", "Scourge Precision..."),
// so the word itself is the category. Listed in CCP's usual EM/Th/Kin/Exp order rather than
// alphabetically, which is the order every resist readout in the app already uses.
const MISSILE_DMG_ORDER=["Mjolnir","Inferno","Scourge","Nova"];
const MISSILE_DMG_LABEL={Mjolnir:"Mjolnir (EM)",Inferno:"Inferno (Thermal)",
                         Scourge:"Scourge (Kinetic)",Nova:"Nova (Explosive)"};
function missileDamageWord(name){
  for(const w of MISSILE_DMG_ORDER)if(name===w||name.startsWith(w+" ")||name.includes(" "+w+" "))return w;
  return null;
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
  const order=new Map();     // family -> explicit sort index, for damage-type groups
  for(const c of charges){
    const dmg=missileDamageWord(c.name);
    // Cap booster charges never merge with a sibling of a different brand: unlike turret/missile
    // ammo, plain and Navy of the same size have no reason to sit behind a second tap to choose
    // between — Navy is a strict upgrade (identical capacitorBonus, smaller volume) — so each stays
    // its own single-item family and equips straight from the top-level list.
    const key=dmg?(MISSILE_DMG_LABEL[dmg]??dmg):(c.groupID===87?c.name:chargeFamilyOf(c.name,names));
    if(dmg)order.set(key,MISSILE_DMG_ORDER.indexOf(dmg));
    if(!fam.has(key))fam.set(key,[]);
    fam.get(key).push(c);
  }
  // Capacitor booster charges are graded by SIZE, not by tech tier — a Cap Booster 3200 and a Cap
  // Booster 25 are different magnitudes of the same thing, and which ones even fit is decided by
  // the module's capacity (handled by getCompatibleCharges). Falling through to localeCompare
  // sorted them as STRINGS, so the list read 100, 150, 200, 3200, 25, 400, 50, 75, 800. Largest
  // first, because the biggest charge that fits is almost always the one you want.
  const capBonusOf=c=>{const a=TYPES[c.typeID]?.a??TYPES[String(c.typeID)]?.a??{};return Number(a['67']??a.capacitorBonus??0);};
  const groups=[...fam.entries()].map(([family,items])=>{
    items.sort((a,b)=>{
      const ca=capBonusOf(a),cb=capBonusOf(b);
      if(ca>0&&cb>0&&ca!==cb)return cb-ca;
      return chargeTierRank(a)-chargeTierRank(b)||a.name.localeCompare(b.name);
    });
    const ranges=items.map(chargeRangeMult).filter(v=>v!=null);
    // The size sort above only ever ordered charges WITHIN a family, and cap booster sizes are now
    // one family per BRAND ("Cap Booster 400", "Navy Cap Booster 400" — see the ungrouping above),
    // so the families themselves still fell through to localeCompare and the picker read 100, 150,
    // 200, 3200, 25, 400, 50, 75, 800, each doubled by brand. Carried up to the group so the sizes
    // line up numerically.
    const caps=items.map(capBonusOf).filter(v=>v>0);
    // T2 turret ammo leads its list. Two per weapon family (Hail/Barrage, Void/Null,
    // Conflagration/Scorch), and they are the two you are actually choosing between most of the
    // time, but being one short-range and one long-range they sat at opposite ENDS of a
    // range-ordered list. Gated on `range` so this only touches turret ammo: missiles carry no
    // weaponRangeMultiplier and are ordered by damage type instead, which is left alone.
    const t2Turret=ranges.length>0&&items.every(i=>metaOf(i.typeID,null)==="T2");
    return{family,items,range:ranges.length?Math.min(...ranges):null,order:order.get(family),
           capSize:caps.length?Math.max(...caps):null,t2Turret};
  });
  groups.sort((a,b)=>{
    // Damage-type groups (missiles) carry an explicit index and always lead, in EM/Th/Kin/Exp order.
    // Checked FIRST, so nothing below can reorder a missile list.
    if(a.order!=null||b.order!=null){
      if(a.order==null)return 1;
      if(b.order==null)return -1;
      return a.order-b.order;
    }
    // T2 turret ammo first; the pair then orders by range between themselves, as everything does.
    if(a.t2Turret!==b.t2Turret)return a.t2Turret?-1:1;
    // Cap boosters: biggest first, matching the within-family rule — the largest charge that fits
    // is almost always the one you want, and what fits is already decided by getCompatibleCharges.
    if(a.capSize!=null&&b.capSize!=null&&a.capSize!==b.capSize)return b.capSize-a.capSize;
    // Same size, different brand (plain vs Navy, now separate one-item families) — Navy leads, for
    // the same reason defaultChargeFor prefers it: identical capacitorBonus, smaller volume.
    if(a.capSize!=null&&b.capSize!=null&&a.capSize===b.capSize){
      const an=a.family.startsWith("Navy "),bn=b.family.startsWith("Navy ");
      if(an!==bn)return an?-1:1;
    }
    if(a.range==null&&b.range==null)return a.family.localeCompare(b.family);
    if(a.range==null)return 1;
    if(b.range==null)return -1;
    return a.range-b.range||a.family.localeCompare(b.family);
  });
  return groups;
}

// Micro Jump Drives and Field Generators cycle, so the "anything that cycles starts active" default
// would light them up — but an MJD is a one-shot escape, not something you sit there running, and
// leaving it on charges the fit for cap it will never actually spend. Both places that fit a module
// (the browser, and an imported EFT) have to agree on this, so the rule lives here rather than being
// restated in each.
// The group name alone is not enough: the capital pair is filed under "Capital Mobility Modules",
// so the name is tested too, anchored at the end to keep out the "Micro Jump Drive Operation" skill
// and the "Mobile Micro Jump Unit" deployable, neither of which is ever fitted to a slot.
export function isMicroJumpDrive(typeID){
  const t=TYPES[typeID]??TYPES[String(typeID)];
  if(!t)return false;
  return /Micro Jump (Drive|Field Generator)/i.test(t.gn??t.groupName??'')
      || /Micro Jump (Drive|Field Generator)$/i.test(t.n??t.name??'');
}

// Same reasoning as the MJD above, for the same "anything that cycles starts active" default:
// an Assault Damage Control shares its GROUP with the plain passive Damage Control (which has no
// duration and can never be toggled at all), but is itself activated — burning cap and its cooldown
// every cycle the instant it's added, before the pilot has chosen when to trigger the emergency
// resist spike it exists for. Detected structurally (group + a duration attribute actually present)
// rather than by name, so a faction/deadspace variant like Breach Control or a future abyssal roll
// is covered without a name list to maintain — the passive Damage Control in the same group has no
// `duration` attribute at all and so never matches.
export function isAssaultDamageControl(typeID){
  const t=TYPES[typeID]??TYPES[String(typeID)];
  if(!t)return false;
  if((t.gn??t.groupName)!=='Damage Control')return false;
  return ((t.attrs??t.a)?.duration??0)>0;
}

// ── Fitting go/no-go ─────────────────────────────────────────────────────────
// The cost printed against a module in the browser and the Variations tab is deliberately its BASE
// attribute — that is what show-info says, and what a player expects to read off an item. The fit's
// used/total are engine-computed, with skills, hull bonuses and engineering rigs already applied.
// Comparing one against the other is what used to make the mark lie: on a Scimitar, which halves
// remote shield booster CPU, a 61 tf variant measured against a backed-out base of 78 read as
// fitting when the real question was 30.5 against 39.
//
// So the base cost is scaled by its class's multiplier before the comparison. calc.js's
// computeFitCostRatios hands the multipliers out keyed by GROUP + REQUIRED SKILLS; these two
// functions are the only place either the lookup or the arithmetic happens, so the browser and the
// Variations tab cannot drift apart on the answer.
//
// The key itself (fitCostClassOf) lives in calc.js next to the probe pass that builds the table, so
// the two sides cannot drift apart on what a class is.
export function fitCostRatioOf(headroom,typeID){
  const cls=fitCostClassOf(TYPES[typeID]??TYPES[String(typeID)]);
  return (cls?headroom?.ratios?.get(cls):null)??null;
}

// `base` is the cost being displaced: the fitted module's base cost for a swap, 0 when filling an
// empty slot. Both it and `val` are base attributes, so BOTH get scaled — the module coming out was
// only ever charged its effective cost, and backing out the base frees room that never existed.
// `m` null falls back to 1 — raw base cost, which errs toward flagging early since these modifiers
// only ever reduce a cost. The probe table covers every fittable type, so this is now only the window
// before it has been computed, not the ordinary case it used to be.
// Null when there is no headroom to test against, meaning "no opinion" rather than "won't fit".
export function fitCostFits(hr,val,base=0,m=1){
  if(!hr)return null;
  const k=m??1;
  return val*k<=(hr.total??0)-(hr.used??0)+base*k+1e-6;
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

// How many of a drone to drop in when one is tapped in the browser, and whether it starts flying.
//
// Five was hardcoded, which is right for a Vexor and flatly wrong for a Vigil: 5 Mbit/s of bandwidth
// flies exactly one light drone, so the screen opened with the bandwidth bar already red. Bay volume
// caps it too, and INDEPENDENTLY — bandwidth limits what can be in space, the bay limits what is
// carried, so a hull can legitimately hold more than it can launch. Five stays the ceiling: it is
// the game's own max drones in space for a fully skilled pilot, and this app assumes skills at V.
//
// Never returns 0. A drone that fits neither budget is still worth carrying as a spare or as the
// thing you swap the current flight for — it just goes in unactivated.
export function droneAddQty({bandwidth,volume,bwFree,bayFree,max=5}){
  const byBw =bandwidth>0?Math.floor(bwFree /bandwidth):max;
  const byBay=volume   >0?Math.floor(bayFree/volume   ):max;
  const qty=Math.max(1,Math.min(max,byBw,byBay));
  return {qty,active:byBw>=qty};
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
// Every implant, flattened out of the per-slot tree and carrying the slot it came from.
//
// The picker is opened FROM a slot, so its search could only ever answer "which Amulet goes here" —
// but the question a player actually has is the other way round ("I want an Ascendancy, where does
// it go?"), and answering it meant opening slots one at a time until one of them had the thing.
// Computed on call rather than cached: implantData arrives via the lazy data-bundle import, so a
// module-load snapshot would be permanently empty.
export function allImplants(){
  const out=[];
  for(const[slot,sd]of Object.entries(implantData??{}))
    for(const items of Object.values(sd?.groups??{}))
      for(const it of items) out.push({...it,slot:Number(slot)});
  return out;
}

// High before Mid before Low, matching the best-first order the module browser uses for meta. It has
// to come off the NAME: every grade of a set implant carries the same metaGroupID 4 / metaLevel 9, so
// browserMetaRank cannot tell them apart. Hardwirings (no prefix) sort last within a tie, which only
// arises when a query hits both a set and a hardwiring.
const IMPLANT_GRADE_RANK=n=>/^High-grade/.test(n)?0:/^Mid-grade/.test(n)?1:/^Low-grade/.test(n)?2:3;

// Matching implants across every slot, most relevant first, or null for a query too short to be worth
// filtering on.
//
// Sorted on SLOT before name, unlike the module browser's group-then-meta blocking: for a set query
// every member ties at the same word-start score, and slot order then lays the set out Alpha..Omega —
// which is both the natural reading order and, for someone who searched because they did not know the
// slot, the answer itself.
export function searchImplants(query,list){
  const q=String(query??"").trim();
  if(q.length<2) return null;
  const src=list??allImplants();
  return src
    .filter(i=>nameMatchesQuery(i.name,q))
    .map((i,idx)=>({i,idx,s:searchScore(i.name,q)}))
    .sort((a,b)=>b.s-a.s||a.i.slot-b.i.slot
                ||IMPLANT_GRADE_RANK(a.i.name)-IMPLANT_GRADE_RANK(b.i.name)
                ||a.i.name.localeCompare(b.i.name)||a.idx-b.idx)
    .map(r=>r.i);
}

const REAL_CHARGE_BROWSER=buildChargeBrowser();
const REAL_DRONE_BROWSER=buildDroneBrowser();
const REAL_MODULE_BROWSER={high:buildModuleBrowser("high"),mid:buildModuleBrowser("mid"),low:buildModuleBrowser("low"),rigs:buildModuleBrowser("rigs")};

// Fittable modules the browser tree cannot show. The tree is CCP's MARKET tree, so a module CCP does
// not sell has no node to live under and simply isn't in it — correct for browsing, but it also left
// them unsearchable, i.e. unreachable: every "Civilian" rookie-ship item bar the four that are on the
// market, the four navy Bastion modules, the officer "…'s Modified" drops, the Integrated Sensor
// Array, the Mining Foreman Links. parseEFT already accepts all of them (guessSlotFromDogma), so a
// pasted fit could hold a module the app gave you no way to add yourself.
//
// The test is membership of the built TREE, not of modulesData. Those are not the same set and the
// difference is not empty: the Festival and Display Launchers ARE in modulesData, but their market
// group hangs outside the Ship Equipment root the browser walks from, so they never reach a node.
//
// Abyssal base types are deliberately excluded, and they are the bulk of what's left out (81 of 141):
// a mutated module is reached by rolling a mutaplasmid onto its SOURCE module, and the bare base type
// carries no rolled attributes — offering it would add a statless item to the list.
//
// The slot must come from a real slot effect. guessSlotFromDogma defaults to "high" for anything with
// none, which is the right call for a named module off an EFT paste but wrong for a sweep over every
// type in the category: it would rake unfittable junk into the high-slot list.
const SLOT_EFFECT_IDS=[2663,6306,12,13,11];
const IN_MODULE_TREE=(()=>{
  const seen=new Set();
  const walk=ns=>{for(const n of ns){for(const m of (n.mods??[]))seen.add(m.typeID);walk(n.children??[]);}};
  for(const t of Object.values(REAL_MODULE_BROWSER))walk(t);
  return seen;
})();
function buildOffMarketModules(slotType){
  const out=[];
  for(const[tid,t]of Object.entries(TYPES)){
    const id=Number(tid);
    if((t.c??t.category)!==7||!t.n||IN_MODULE_TREE.has(id))continue;
    const e=t.e??t.effectIDs??[];
    if(!SLOT_EFFECT_IDS.some(x=>e.includes(x)))continue;
    if(guessSlotFromDogma(id)!==slotType)continue;
    const meta=metaOf(id,null);
    if(meta==='Abyssal')continue;
    const a=t.attrs??t.a??{};
    out.push({name:t.n,typeID:id,meta,cpu:a.cpu??a['50']??0,pg:a.power??a['30']??0,
              calib:a.upgradeCost??a['1153']??null});
  }
  return out.sort((a,b)=>browserMetaRank(a.typeID,a.meta)-browserMetaRank(b.typeID,b.meta)||a.name.localeCompare(b.name));
}
const OFF_MARKET_MODULES={high:buildOffMarketModules("high"),mid:buildOffMarketModules("mid"),
                          low:buildOffMarketModules("low"),rigs:buildOffMarketModules("rig")};

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
    // Same fitting-cost subtext as the ship module browser. These rows are built straight from
    // TYPES (structures are not in modules.json at all), so the attributes are read here.
    const a=t.attrs??t.a??{};
    (byGroup[t.gn]??=[]).push({name:t.n,typeID:Number(tid),meta:metaOf(Number(tid)),
      cpu:a.cpu??a['50']??0, pg:a.power??a['30']??0, calib:a.upgradeCost??a['1153']??null});
  }
  return Object.entries(byGroup).sort(([a],[b])=>a.localeCompare(b)).map(([gn,mods])=>({
    id:gn,name:gn,children:[],
    mods:mods.sort((a,b)=>browserMetaRank(a.typeID,a.meta)-browserMetaRank(b.typeID,b.meta)||a.name.localeCompare(b.name)),
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

export { AGENCY_BOOSTER_RE, BOOSTER_GROUP_ID, BOOSTER_NAME_SET, CHARGES_BY_GROUP, CMD_SHIP_FITS, DMG, DMG_COLOR, FIGHTER_CATALOG, getGlobalCss, IMPLANT_NAME_TO_SLOT, MG_CHILDREN, MG_HIDDEN, MODULE_STATES, MODULE_USAGE, MODULE_VARS, MT_ALL_ITEMS, MT_CHILDREN, MT_ITEMS, MT_ROOTS, MUTA_BY_NAME, MUTA_BY_TYPE, OFF_MARKET_MODULES, RACES, RACE_COLORS, REAL_CHARGE_BROWSER, REAL_DRONE_BROWSER, REAL_MODULE_BROWSER, REAL_STRUCTURE_MODULE_BROWSER, SAVED_FITS_SEED, SLOT_ROOT, STATE_COLORS, STATE_GLOW, STATE_LABELS, TOP_DRONE_ORDER, WARFARE_BUFF_UNIT, _bundleListeners, _bundleReady, buildChargeBrowser, buildDroneBrowser, buildMGChildren, buildModuleBrowser, buildSlotsFromEFT, calcEHP, moduleByName, calcTransversal, cheaperEquivalent, computeDisplayRows, defaultChargeFor, fmtN, generateEmptySlots, getCompatibleCharges, getMGPath, groupChargesForBrowser, guessSlotFromDogma, haptic, implantData, implantSetMembers, applyImplantSet,isBoosterName, isGroupableModule, lookupShip, moduleTakesCharges, moduleVariations, variantsOf, mutaAttrRanges, snapToBase, navIcons, optimizeSlotPrice, parseEFT, readClipboardText, raceIcons, resMult, shipFromDogma, shipTraits, shipsByClass, slotIcons, gestureTarget, validStatesFor };
