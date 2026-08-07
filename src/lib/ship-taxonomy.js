// Ship-browser taxonomy: turns the flat "48 CCP group names" list into the nested menu players
// actually think in (Battleships > Faction Battleships > Pirate Faction, Capital Ships > Carriers >
// Standard Carriers > Gallente, ...).
//
// Built from `dogma-types.json` (via calc.js's TYPES), NOT from data-bundle.js's `shipsByClass`.
// That legacy list is stale — it has ZERO entries for Command Carriers and Lancer Dreadnoughts even
// though CCP ships four hulls in each — and CLAUDE.md already flags its `hullClass` as wrong for 64
// hulls. TYPES[].gn is CCP's own group name and is authoritative.
//
// RACE comes from the hull's REQUIRED SKILL, not from data-bundle's `raceID`. Same reason: the
// bundle simply has no row for the hulls it's missing, whereas every hull in the game carries its
// racial skill ("Gallente Battleship", "Amarr Carrier", "Precursor Frigate"). `t.rs` holds skill
// NAMES, not IDs.
//
// Leaf module: imports only calc.js. Pure — `buildShipTaxonomy()` takes no globals, so the
// regression suite can assert that all 423 hulls land somewhere.

import { TYPES } from "../calc.js";
// `with { type: 'json' }` so this module loads under plain Node (the regression suite) as well as
// Vite — same convention as dogma-engine-init.js.
import SHIP_FACTIONS from "../data/ship-factions.json" with { type: "json" };

// Keys into data-bundle.js's `raceIcons`. These are NOT the SDE raceIDs they look like: the bundle
// ships eight icons keyed 1/2/4/8/16/32/135/512, and **135 is ORE's gold hexagon while 512 is the
// Triglavian red glyph** — verified by decoding the actual PNGs, not by trusting the key. Reading
// them as SDE raceIDs (ORE=128, Triglavian=135) put the ORE logo on every Triglavian category and
// left ORE with no icon at all. There is no icon for CONCORD, EDENCOM, Upwell or Pirate Faction;
// those fall back to the generic ship glyph in the UI.
export const RACE_ICON_ID = { Amarr: 4, Caldari: 1, Gallente: 8, Minmatar: 2, ORE: 135, Triglavian: 512 };
const RACE_ORDER = ["Amarr", "Caldari", "Gallente", "Minmatar", "ORE", "Triglavian", "EDENCOM",
                    "CONCORD", "Upwell", "Pirate Faction", "Other"];
const RACES = new Set(["Amarr", "Caldari", "Gallente", "Minmatar"]);

// invtypes.factionID → the racial bucket a hull belongs in. This OVERRIDES the skill-derived race,
// because the required skill describes what you must train, not who built the hull: the Vendetta
// needs "Gallente Carrier" but is Serpentis, the Python and the Marshal require no racial skill at
// all, and nothing in the Outrider's skill list says ORE. Generated into ship-factions.json by
// build-bundle.py so it refreshes on an eve.db upgrade.
//
// Deliberately partial: Jove (500005), Sisters of EVE (500016) and SoCT (500017) are left out so
// they fall through to the skill-derived race. Every hull they cover already routes somewhere else
// (Astero/Stratios/Nestor are faction cruisers; Gnosis/Praxis/Sunesis are Special Edition), so
// giving them buckets would only create one-ship categories that nothing ever lands in.
const FACTION_BUCKET = {
  500001: "Caldari", 500002: "Minmatar", 500003: "Amarr", 500004: "Gallente",
  500006: "CONCORD",      // Pacifier, Enforcer, Marshal, Monitor
  500014: "ORE",          // Outrider, Rorqual, Orca, Venture, the barges
  500026: "Triglavian",
  500027: "EDENCOM",
  // Every pirate/outlaw faction shares ONE bucket — a Guristas Python and a Sansha Revenant are
  // both "the pirate one" in a list that is otherwise four empires deep.
  500009: "Pirate Faction", 500010: "Pirate Faction", 500011: "Pirate Faction",
  500012: "Pirate Faction", 500018: "Pirate Faction", 500019: "Pirate Faction",
  500020: "Pirate Faction", 500024: "Pirate Faction", 500029: "Pirate Faction",
};

// Structures with no module slots at all (Cyno Beacon / Jump Bridge / Cyno Jammer / Moon Drill) are
// not fittable and are excluded, matching the backfill in core.js.
const STRUCTURE_HULL_GROUPS = new Set(["Citadel", "Engineering Complex", "Refinery"]);

export const TOP_ORDER = [
  "Shuttles", "Frigates", "Cruisers", "Destroyers", "Battlecruisers", "Battleships",
  "Capital Ships", "Haulers and Industrial Ships", "Mining Barges", "Special Edition Ships",
  "Corvettes", "Structures",
];

// Groups that carry the T1 hulls of a size class, and so split by TIER first (standard / faction /
// precursor) and only then by race. `[top-level node, the word used in the child labels]`.
const BASE_GROUPS = {
  "Frigate":              ["Frigates", "Frigates"],
  "Destroyer":            ["Destroyers", "Destroyers"],
  "Cruiser":              ["Cruisers", "Cruisers"],
  "Combat Battlecruiser": ["Battlecruisers", "Battlecruisers"],
  "Battleship":           ["Battleships", "Battleships"],
  "Hauler":               ["Haulers and Industrial Ships", "Haulers"],
};

// Everything else routes to a fixed path. `r:true` adds a final race level.
const GROUP_ROUTES = {
  "Assault Frigate":            { p: ["Frigates", "Advanced Frigates", "Assault Frigates"], r: true },
  "Covert Ops":                 { p: ["Frigates", "Advanced Frigates", "Covert Ops"], r: true },
  "Interceptor":                { p: ["Frigates", "Advanced Frigates", "Interceptors"], r: true },
  "Electronic Attack Ship":     { p: ["Frigates", "Advanced Frigates", "Electronic Attack Ships"], r: true },
  "Stealth Bomber":             { p: ["Frigates", "Advanced Frigates", "Stealth Bombers"], r: true },
  "Logistics Frigate":          { p: ["Frigates", "Advanced Frigates", "Logistics Frigates"], r: true },
  "Expedition Frigate":         { p: ["Frigates", "Advanced Frigates", "Expedition Frigates"], r: false },

  "Interdictor":                { p: ["Destroyers", "Advanced Destroyers", "Interdictors"], r: true },
  "Command Destroyer":          { p: ["Destroyers", "Advanced Destroyers", "Command Destroyers"], r: true },
  "Tactical Destroyer":         { p: ["Destroyers", "Advanced Destroyers", "Tactical Destroyers"], r: true },

  "Heavy Assault Cruiser":      { p: ["Cruisers", "Advanced Cruisers", "Heavy Assault Cruisers"], r: true },
  "Heavy Interdiction Cruiser": { p: ["Cruisers", "Advanced Cruisers", "Heavy Interdiction Cruisers"], r: true },
  "Logistics":                  { p: ["Cruisers", "Advanced Cruisers", "Logistics Cruisers"], r: true },
  "Force Recon Ship":           { p: ["Cruisers", "Advanced Cruisers", "Force Recon Ships"], r: true },
  "Combat Recon Ship":          { p: ["Cruisers", "Advanced Cruisers", "Combat Recon Ships"], r: true },
  "Strategic Cruiser":          { p: ["Cruisers", "Advanced Cruisers", "Strategic Cruisers"], r: true },

  "Attack Battlecruiser":       { p: ["Battlecruisers", "Attack Battlecruisers"], r: true },
  "Command Ship":               { p: ["Battlecruisers", "Advanced Battlecruisers", "Command Ships"], r: true },

  "Black Ops":                  { p: ["Battleships", "Advanced Battleships", "Black Ops"], r: true },
  "Marauder":                   { p: ["Battleships", "Advanced Battleships", "Marauders"], r: true },

  // Supercarriers deliberately share the "Standard Carriers" node with carriers — they are not an
  // advanced tier of carrier, so the Nyx and the Thanatos both live under Gallente.
  "Carrier":                    { p: ["Capital Ships", "Carriers", "Standard Carriers"], r: true },
  "Supercarrier":               { p: ["Capital Ships", "Carriers", "Standard Carriers"], r: true },
  "Command Carrier":            { p: ["Capital Ships", "Carriers", "Command Carriers"], r: true },
  "Dreadnought":                { p: ["Capital Ships", "Dreadnoughts", "Standard Dreadnoughts"], r: true },
  "Lancer Dreadnought":         { p: ["Capital Ships", "Dreadnoughts", "Lancer Dreadnoughts"], r: true },
  "Force Auxiliary":            { p: ["Capital Ships", "Force Auxiliaries"], r: true },
  "Titan":                      { p: ["Capital Ships", "Titans"], r: true },
  "Freighter":                  { p: ["Capital Ships", "Freighters", "Standard Freighters"], r: true },
  "Jump Freighter":             { p: ["Capital Ships", "Freighters", "Jump Freighters"], r: true },
  "Capital Industrial Ship":    { p: ["Capital Ships", "Capital Industrial Ships"], r: false },

  "Blockade Runner":            { p: ["Haulers and Industrial Ships", "Advanced Haulers", "Blockade Runners"], r: true },
  "Deep Space Transport":       { p: ["Haulers and Industrial Ships", "Advanced Haulers", "Deep Space Transports"], r: true },
  "Industrial Command Ship":    { p: ["Haulers and Industrial Ships", "Industrial Command Ships"], r: false },
  "Expedition Command Ship":    { p: ["Haulers and Industrial Ships", "Industrial Command Ships"], r: false },

  "Mining Barge":               { p: ["Mining Barges", "Mining Barges"], r: false },
  "Exhumer":                    { p: ["Mining Barges", "Exhumers"], r: false },

  "Shuttle":                    { p: ["Shuttles"], r: false },
  "Corvette":                   { p: ["Corvettes"], r: false },

  "Special Edition Yachts":     { p: ["Special Edition Ships", "Yachts"], r: false },
  "Prototype Exploration Ship": { p: ["Special Edition Ships", "Frigates"], r: false },
  "Flag Cruiser":               { p: ["Special Edition Ships", "Cruisers"], r: false },
};

// Not fittable — the pod has no slots and only clutters the Shuttles list.
const EXCLUDED_GROUPS = new Set(["Capsule"]);

// Which "Special Edition Ships" sub-node a hull lands in, keyed by its CCP group. Only groups where
// a special hull has NO natural home are listed — deliberately no advanced/T2 groups.
//
// The `s` flag (CCP's own `Ships / Special Edition Ships` market group) also covers the Alliance
// Tournament hulls: the Utu, Chremoas, Adrestia, Skua and ~30 others. Those stay in their functional
// class, because an AT Assault Frigate is still an Assault Frigate and you fit it as one — the class
// list is about what a hull IS, and pulling them out would leave e.g. Tactical Destroyers missing a
// member that behaves exactly like the other four. Special Edition is for hulls that would otherwise
// be mis-filed as a standard/navy/pirate ship of their size: the Echelon is not a CONCORD navy
// frigate, the Guardian-Vexor is not a Serpentis cruiser you can field.
const SPECIAL_EDITION_CLASS = {
  "Shuttle": "Shuttles",
  "Corvette": "Corvettes",
  "Frigate": "Frigates",
  "Prototype Exploration Ship": "Frigates",   // Zephyr — CCP files it under Special Edition Frigates
  "Destroyer": "Destroyers",
  "Cruiser": "Cruisers",
  "Flag Cruiser": "Cruisers",                 // Monitor
  "Special Edition Yachts": "Yachts",
  "Combat Battlecruiser": "Battlecruisers",
  "Battleship": "Battleships",
  "Hauler": "Haulers",
};
// Hull classes ordered by size wherever they are used as sibling labels; alphabetical would put
// Battleships before Corvettes.
const SIZE_ORDER = ["Shuttles", "Corvettes", "Frigates", "Destroyers", "Cruisers",
                    "Battlecruisers", "Battleships", "Haulers", "Yachts"];

// Mining hulls sit in the Frigate/Destroyer groups but belong with the barges, not with combat T1.
const MINING_NODE = { "Frigate": "Mining Frigates", "Destroyer": "Mining Destroyers" };

/**
 * Read race + tier off a hull. Tier comes from the required skills + metaGroupID; race prefers the
 * hull's faction and falls back to the skills. Exported for the regression suite.
 */
export function classifyHull(t, typeID) {
  const skills = t.rs ?? [];
  const races = [];
  let precursor = false, edencom = false, mining = false, ore = false, upwell = false;
  for (const s of skills) {
    const head = String(s).split(" ")[0];
    if (RACES.has(head)) { if (!races.includes(head)) races.push(head); }
    else if (head === "Precursor") precursor = true;
    else if (head === "EDENCOM") edencom = true;
    else if (head === "Mining") mining = true;
    else if (head === "ORE") ore = true;
    else if (head === "Upwell") upwell = true;
  }
  const skillRace = races[0]
    ?? (precursor ? "Triglavian" : edencom ? "EDENCOM" : ore ? "ORE" : upwell ? "Upwell" : null);
  const rec = SHIP_FACTIONS[String(typeID)];
  const factionBucket = FACTION_BUCKET[rec?.f] ?? null;
  // A NON-EMPIRE racial skill beats the faction, because those skills are themselves the
  // "who built this" signal and are more specific than CCP's factionID. The Upwell haulers are the
  // case that proves it: the Squall, Deluge, Torrent and Avalanche all require "Upwell Hauler" but
  // are tagged factionID 500027 (EDENCOM), so a faction-first rule files them next to the
  // Thunderchild. The EDENCOM combat hulls require "EDENCOM <class>" skills, so the skill separates
  // the two families cleanly where the faction cannot.
  // Empire skills stay subordinate to the faction — that is the whole point of the faction lookup
  // (the Vendetta requires "Gallente Carrier" and is Serpentis).
  const nonEmpireSkillRace = races.length === 0 && (precursor || edencom || ore || upwell) ? skillRace : null;
  const race = nonEmpireSkillRace ?? factionBucket ?? skillRace;
  const special = rec?.s === 1;
  // metaGroupID 4 = Faction. Absent on plain T1 hulls (the Rokh and the Abaddon carry no `mg` at
  // all), so "not 4" is the test, never "is 1".
  const tier = precursor ? "precursor"
    : edencom ? "edencom"
    : races.length >= 2 ? "pirate"      // pirate hulls require TWO racial skills; navy ones require one
    : t.mg === 4 ? "navy"
    : "standard";
  return { race, skillRace, factionBucket, tier, mining, special };
}

function routeFor(t, typeID) {
  const g = t.gn;
  if ((t.c ?? t.category) === 65) {
    return STRUCTURE_HULL_GROUPS.has(g) ? { path: ["Structures", g], race: null } : null;
  }
  if (EXCLUDED_GROUPS.has(g)) return null;

  const { race, skillRace, factionBucket, tier, mining, special } = classifyHull(t, typeID);
  const seClass = SPECIAL_EDITION_CLASS[g];

  // Mining first: the Perseverance is flagged special edition by CCP but is still a mining
  // destroyer, and that is how anyone looking for it will browse.
  if (mining && MINING_NODE[g]) return { path: ["Mining Barges", MINING_NODE[g]], race: null };

  if (special && seClass) return { path: ["Special Edition Ships", seClass], race: null };

  const fixed = GROUP_ROUTES[g];
  if (fixed) return { path: fixed.p, race: fixed.r ? (race ?? "Other") : null };

  const base = BASE_GROUPS[g];
  if (base) {
    const [top, word] = base;
    // Nothing to file it under: no racial skill AND no faction. That is exactly what "Special
    // Edition" is for.
    if (!skillRace && !factionBucket) return { path: ["Special Edition Ships", seClass].filter(Boolean), race: null };
    if (tier === "precursor") return { path: [top, `Precursor ${word}`], race: null };
    if (tier === "standard") return { path: [top, `Standard ${word}`], race };
    // A non-empire faction names itself. This is sharper than the tier alone: the Guardian-Vexor
    // requires only ONE racial skill so the tier reads "navy", but it is a Serpentis hull and
    // belongs with the other pirates.
    const label = factionBucket && !RACES.has(factionBucket) ? factionBucket
      : tier === "navy" ? "Navy Faction" : tier === "pirate" ? "Pirate Faction" : "EDENCOM";
    return { path: [top, `Faction ${word}`, label], race: null };
  }
  return { path: ["Special Edition Ships", seClass].filter(Boolean), race: null };
}

const raceRank = r => { const i = RACE_ORDER.indexOf(r); return i < 0 ? RACE_ORDER.length : i; };

/**
 * Build the nested browser tree.
 * Node: { key, label, raceID?, children?: Node[], ships?: [{name,typeID,raceID}] }
 * A node has `children` OR `ships`, never both.
 */
export function buildShipTaxonomy(types = TYPES) {
  const root = { key: "", label: "", children: [], ships: [], _byLabel: new Map() };

  const child = (parent, label, raceID) => {
    let n = parent._byLabel.get(label);
    if (!n) {
      n = { key: parent.key ? `${parent.key}/${label}` : label, label, raceID, children: [], ships: [], _byLabel: new Map() };
      parent._byLabel.set(label, n);
      parent.children.push(n);
    }
    return n;
  };

  for (const [tid, t] of Object.entries(types)) {
    const cat = t.c ?? t.category;
    if ((cat !== 6 && cat !== 65) || !t.n || !t.gn) continue;
    const r = routeFor(t, tid);
    if (!r) continue;
    let node = root;
    for (const seg of r.path) node = child(node, seg);
    if (r.race) node = child(node, r.race, RACE_ICON_ID[r.race]);
    node.ships.push({ name: t.n, typeID: Number(tid), raceID: RACE_ICON_ID[classifyHull(t, tid).race] ?? null });
  }

  // A node either lists ships or lists children. Where both turned up (a group routed to the same
  // node with and without a race level), the loose ships are collected under "Other" so the node
  // stays a pure branch and nothing is dropped.
  const finish = n => {
    delete n._byLabel;
    if (n.children.length && n.ships.length) {
      const other = { key: `${n.key}/Other`, label: "Other", children: [], ships: n.ships };
      n.children.push(other);
      n.ships = [];
    }
    if (n.children.length) {
      n.children.forEach(finish);
      // Race levels sort in the traditional EVE order and hull-class levels by size; everything
      // else is alphabetical.
      const allRaces = n.children.every(c => RACE_ORDER.includes(c.label));
      const allSizes = n.children.every(c => SIZE_ORDER.includes(c.label));
      n.children.sort(allRaces
        ? (a, b) => raceRank(a.label) - raceRank(b.label)
        : allSizes
          ? (a, b) => SIZE_ORDER.indexOf(a.label) - SIZE_ORDER.indexOf(b.label)
          : (a, b) => a.label.localeCompare(b.label));
      delete n.ships;
    } else {
      n.ships.sort((a, b) => a.name.localeCompare(b.name));
      delete n.children;
    }
  };
  finish(root);

  const order = new Map(TOP_ORDER.map((l, i) => [l, i]));
  root.children.sort((a, b) => (order.get(a.label) ?? 99) - (order.get(b.label) ?? 99));
  return root.children;
}

/** Every hull under a node, recursively — used for the "N ships" subtitle and fit counts. */
export function shipsUnder(node) {
  if (node.ships) return node.ships;
  const out = [];
  for (const c of node.children ?? []) out.push(...shipsUnder(c));
  return out;
}

/** Resolve a "Battleships/Faction Battleships" key path to its node, or null. */
export function nodeAtPath(tree, path) {
  let list = tree, node = null;
  for (const label of path) {
    node = (list ?? []).find(n => n.label === label);
    if (!node) return null;
    list = node.children;
  }
  return node;
}
