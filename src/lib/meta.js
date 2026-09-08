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

// ── pyfa's ordering for a list of siblings ────────────────────────────────────
// pyfa blocks items into FOUR tabs, not one per metaGroup (`Market.META_MAP`, service/market.py):
// storyline rides with faction, and structure-faction (52) with both. Within a block the order is
// CCP's metaLevel, then name (`itemSort`). Those two facts together are what produce the list a
// player recognises: all the C-types, then all the B-types, then all the A-types (metaLevel 10 /
// 12 / 14), and the officer modules laid out by tier instead of alphabetically.
//
// Sorting on the display tier instead — Storyline, then Faction, then Deadspace, then Officer, each
// alphabetical — is what we did before, and it interleaved A/B/C-types and scrambled the officers.
const META_TAB_BY_MG={3:1,4:1,52:1,6:2,5:3};
const metaTabOf=typeID=>META_TAB_BY_MG[Number(TYPES[typeID]?.mg)]??0;
// metaLevel is `ml` on the type. It is ABSENT rather than 0 on the T1 base of a family (the bundle
// omits falsy values), so the attribute is the fallback and 0 the floor.
const metaLevelOf=typeID=>{
  const t=typeID!=null?TYPES[typeID]:null;
  if(!t) return 0;
  const a=t.attrs??t.a??{};
  return Number(t.ml??a.metaLevel??a['633']??0)||0;
};
// Deliberately NOT the tab order. Everywhere you are CHOOSING what to fit — the module browser and
// the module search — T2 leads, because it is the default choice far more often than T1, and the T1
// module is the fallback rather than the starting point. It is the one place we diverge from pyfa.
const browserMetaRank=typeID=>metaOf(typeID,null)==='T2'?-1:metaTabOf(typeID);
// Both browsers and the Variations tab sort with this; `rank` is what makes the two orders differ.
// The name comes off the TYPE rather than the row, because the Variations tab's compare rows are
// {typeID, stats} and carry none — the display name is looked up separately, at render time.
const sortName=x=>String(TYPES[x.typeID]?.n??x.name??'');
const compareByMeta=(a,b,rank=metaTabOf)=>
  rank(a.typeID)-rank(b.typeID)
  ||metaLevelOf(a.typeID)-metaLevelOf(b.typeID)
  ||sortName(a).localeCompare(sortName(b));
const compareForBrowser=(a,b)=>compareByMeta(a,b,browserMetaRank);
export { META_BY_MG, metaOf, META_COLORS, META_ORDER, metaTabOf, metaLevelOf, browserMetaRank, compareByMeta, compareForBrowser };
