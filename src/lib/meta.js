import { TYPES } from "../calc.js";

// ── Meta group (authoritative) ────────────────────────────────────────────────
// The precomputed data-bundle's `meta` strings are unreliable (faction/storyline/deadspace/officer
// modules were all being labelled "T2"). CCP's metaGroupID is the real source of truth, so it ships
// on every type in dogma-types.json as `mg`. Resolve from that, falling back to the bundle string
// only when a type has no mg (e.g. abyssal/mutated items).
// Named/compact/enduring/scoped variants are metaGroup 1 and are shown as plain T1, same as CCP.
const META_BY_MG={1:"T1",2:"T2",3:"Storyline",4:"Faction",5:"Officer",6:"Deadspace",
                  14:"T3",15:"Abyssal",17:"Premium",19:"Limited"};
const metaOf=(typeID,fallback)=>{
  const t=typeID!=null?TYPES[typeID]:null;
  if(!t||t.mg==null) return fallback??"T1";
  return META_BY_MG[Number(t.mg)] ?? (fallback??"T1");
};
const META_COLORS={T1:"#94a3b8",T2:"#f5a524",Storyline:"#a3e635",Faction:"#22c55e",
                   Deadspace:"#3b82f6",Officer:"#a855f7",T3:"#2dd4bf",Abyssal:"#f472b6",
                   Premium:"#a855f7",Limited:"#f5a524"};
const META_ORDER={T1:0,T2:1,Storyline:2,Faction:3,Deadspace:4,Officer:5,T3:6,Abyssal:7,Premium:8,Limited:9};
export { META_BY_MG, metaOf, META_COLORS, META_ORDER };
