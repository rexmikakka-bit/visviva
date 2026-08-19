import { TYPES } from "../calc.js";

// ── Meta group (authoritative) ────────────────────────────────────────────────
// The precomputed data-bundle's `meta` strings are unreliable (faction/storyline/deadspace/officer
// modules were all being labelled "T2"). CCP's metaGroupID is the real source of truth, so it ships
// on every type in dogma-types.json as `mg`. Resolve from that, falling back to the bundle string
// only when a type has no mg (e.g. abyssal/mutated items).
// Named/compact/enduring/scoped variants are metaGroup 1 and are shown as plain T1, same as CCP.
//
// 52/53/54 are CCP's SEPARATE structure-module tiers ("Structure Faction", "Structure Tech II",
// "Structure Tech I" in invmetagroups) — a Standup M-Set rig carries 53/54, never 1/2. They were
// missing here, so every structure T2 rig fell through the `??` and was badged T1 (413 types
// across the three groups). They map onto the same display tiers as their ship equivalents rather
// than getting their own labels, because META_COLORS/META_ORDER are keyed by these strings and a
// Standup ... II genuinely IS the Tech II tier.
const META_BY_MG={1:"T1",2:"T2",3:"Storyline",4:"Faction",5:"Officer",6:"Deadspace",
                  14:"T3",15:"Abyssal",17:"Premium",19:"Limited",
                  52:"Faction",53:"T2",54:"T1"};
const metaOf=(typeID,fallback)=>{
  const t=typeID!=null?TYPES[typeID]:null;
  if(!t||t.mg==null) return fallback??"T1";
  return META_BY_MG[Number(t.mg)] ?? (fallback??"T1");
};
const META_COLORS={T1:"#94a3b8",T2:"#f5a524",Storyline:"#a3e635",Faction:"#22c55e",
                   Deadspace:"#3b82f6",Officer:"#a855f7",T3:"#2dd4bf",Abyssal:"#f472b6",
                   Premium:"#a855f7",Limited:"#f5a524"};
const META_ORDER={T1:0,T2:1,Storyline:2,Faction:3,Deadspace:4,Officer:5,T3:6,Abyssal:7,Premium:8,Limited:9};
// Deliberately NOT META_ORDER. META_ORDER is the canonical tier sequence (T1 first) and still drives
// ammo and the meta pills; wherever you are CHOOSING what to fit — the module browser and the module
// search — T2 leads, because it is the default choice far more often than T1. The T1 module is
// usually the fallback, not the starting point.
const BROWSER_META_ORDER={T2:0,T1:1,Storyline:2,Faction:3,Deadspace:4,Officer:5,T3:6,Abyssal:7,Premium:8,Limited:9};
const browserMetaRank=(typeID,fallback)=>BROWSER_META_ORDER[metaOf(typeID,fallback)]??99;
export { META_BY_MG, metaOf, META_COLORS, META_ORDER, BROWSER_META_ORDER, browserMetaRank };
