// Turns a PARSED fit (the shape parseEFT returns, which esi-fits.js and pyfa-xml.js also emit) into
// the record that actually lives in fitsDB: {id, name, modified, slots, drones, fighters, cargo,
// implants, boosters}.
//
// This lived inside App.jsx's importFit until the pyfa XML importer needed it. A bulk import builds
// hundreds of entries with no React state anywhere in sight, and copying the assembly would mean two
// places that have to agree about drone bandwidth fallbacks, T3 subsystem ordering and cargo volume
// — the sort of duplication that drifts silently and only shows up as "imported fits are subtly
// different from pasted ones".
//
// React-free on purpose, like core.js: the regression suite imports it.

import { TYPES, tidByName, isT3Cruiser, T3C_SUBSYSTEM_GROUPS } from "../calc.js";
import { DRONE_TYPES } from "../dogma-engine-init.js";
import { buildSlotsFromEFT } from "./core.js";

export const emptyImplants = () => Array.from({ length: 10 }, (_, i) => ({ slot: i + 1, name: "[Empty]", bonus: null }));

export const fitDateStamp = (d = new Date()) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// A T3 cruiser's slot layout comes from its subsystems, so they must be placed by GROUP (Core /
// Defensive / Offensive / Propulsion) rather than in the order they were listed.
function subsystemSlots(shipName, parsedSubs) {
  if (!isT3Cruiser(shipName)) return undefined;
  const order = ["Core", "Defensive", "Offensive", "Propulsion"];
  const byGroup = {};
  for (const s of (parsedSubs ?? [])) {
    const gn = TYPES[s.typeID]?.gn ?? TYPES[s.typeID]?.groupName ?? "";
    const key = Object.entries(T3C_SUBSYSTEM_GROUPS).find(([, g]) => g === gn)?.[0];
    if (key) byGroup[key] = { id: `sub${order.indexOf(key)}`, name: s.name, typeID: s.typeID, type: "subsystem", subGroup: key };
  }
  return order.map((k, i) => byGroup[k] ?? { id: `sub${i}`, name: `[Empty ${k} Subsystem Slot]`, icon: null, type: "empty", subGroup: k });
}

// `buildBooster` is injected because the only implementation lives in components/effects.jsx, which
// this file must not import (core/lib sits below the components layer). Callers with no boosters to
// build — every XML import, since pyfa's exportXml writes none — simply omit it.
export function buildFitEntry(parsed, { id, modified = fitDateStamp(), buildBooster = null } = {}) {
  const { shipName, fitName, ship, mods, drones: pDrones, fighters: pFighters, cargo: pCargo,
          implantNames, boosterNames, subsystems: pSubs } = parsed;

  // ids only have to be unique WITHIN their own array — they are React keys and the handle every
  // edit path matches on. Kept as `now + index` rather than a bare index so an imported fit is
  // byte-identical to a pasted one, and so no id is ever 0.
  const now = Date.now();

  const slots = buildSlotsFromEFT(ship, mods, subsystemSlots(shipName, pSubs));

  const drones = (pDrones ?? []).map((d, i) => {
    const dta = d.drone?.typeID ? DRONE_TYPES?.[String(d.drone.typeID)]?.a : null;
    return {
      id: now + i, name: d.name, size: d.drone?.size, qty: d.qty, active: false,
      range: d.drone?.range ?? 0, tracking: d.drone?.tracking ?? 0, velocity: d.drone?.velocity ?? 0,
      hp: d.drone?.hp ?? 0, dps: d.drone?.dps ?? 0,
      bandwidth: dta?.droneBandwidthUsed ?? d.drone?.bandwidth ?? 5,
      volume: dta?.volume ?? d.drone?.volume, typeID: d.drone?.typeID,
      mutaplasmid: d.mutaplasmid ?? undefined, mutations: d.mutations ?? undefined,
    };
  });

  const fighters = (pFighters ?? []).map((f, i) => {
    const t = f.typeID ?? tidByName(f.name);
    const gn = TYPES[t]?.gn ?? TYPES[t]?.groupName ?? "";
    return { id: now + 1000 + i, name: f.name, qty: f.qty, tier: / II$/.test(f.name) ? "T2" : "T1", dps: 0,
             role: /Support/i.test(gn) ? "Support" : null, hp: 0, active: true, typeID: t };
  });

  const cargo = (pCargo ?? []).map((c, i) => {
    const tid = c.typeID ?? tidByName(c.name);
    return { id: now + i, name: c.name, qty: c.qty,
             vol: tid != null ? (TYPES[tid]?.attrs?.volume ?? TYPES[String(tid)]?.attrs?.volume ?? 1) : 1,
             typeID: tid ?? undefined };
  });

  const implants = emptyImplants();
  for (const ip of (implantNames ?? [])) {
    const idx = implants.findIndex(i => i.slot === ip.slot);
    if (idx >= 0) implants[idx] = { slot: ip.slot, name: ip.name, bonus: null };
  }

  const boosters = buildBooster ? (boosterNames ?? []).map(buildBooster) : [];

  return { id, name: fitName, modified, slots, drones, fighters, cargo, implants, boosters };
}
