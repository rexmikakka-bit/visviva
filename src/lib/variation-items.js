import { TYPES } from '../calc.js';
import { differingAttributes, directionOf, derivedAttributes, DERIVED_KEYS } from './compare.js';
import { libraryModule } from './abyssal-library.js';
import { CHARACTER_SOURCE } from './abyssal-browser.js';

const attrs=mod=>({...((TYPES[mod.typeID]?.attrs??TYPES[mod.typeID]?.a)??{}),...mod.mutations});
export function fittedAbyssalIds(slots,exceptId){
  return new Set(Object.values(slots??{}).flatMap(v=>Array.isArray(v)?v:[])
    .filter(m=>m&&m.id!==exceptId).map(m=>m.abyssalItemId).filter(Boolean));
}

export const MARKET_SOURCE='mutamarket';
export function containerSource(record){return JSON.stringify([String(record.characterId),String(record.locationId)]);}

// A source is one of: every owned module, one character's, one container's, or MutaMarket listings.
// Market listings have no characterId at all — they are not in anyone's hangar — so they can only
// ever match the market source, and an owned roll can never match it.
export function matchesSource(record,source){
  if(record.source===MARKET_SOURCE)return source===MARKET_SOURCE;
  if(source===MARKET_SOURCE)return false;
  if(source==='owned')return true;
  if(source.startsWith(CHARACTER_SOURCE))return `${CHARACTER_SOURCE}${record.characterId}`===source;
  return containerSource(record)===source;
}

// Several sources at once, because "my hangar and the market" is the question the compare tab is
// usually being asked — the roll you already own only means something next to what it would cost to
// beat it. A UNION, so adding a source can only ever lengthen the list; no source can veto a roll
// another one offers, which is what makes the ticks in the sheet independent of each other.
//
// An EMPTY selection matches nothing. That is the honest reading of "no sources", and it is a state
// the sheet can be left in deliberately, so it is said out loud there rather than quietly treated as
// "all of them" — which would make unticking the last source look broken.
export function matchesAnySource(record,sources){
  return (sources??[]).some(s=>matchesSource(record,s));
}

// A row is excluded only when we have a PRICE for it and that price is over the ceiling. An unpriced
// row — an owned roll, a type Fuzzwork has no orders for — is neither free nor too expensive, and
// dropping it would quietly hide exactly the modules the market has nothing to say about.
export function withinPriceCeiling(price,ceiling){
  return ceiling==null||price==null||price<=ceiling;
}

export function filterVariationItems(rows,showAbyssals,sources=['owned']){
  return rows.filter(r=>r.isBaseline||!r.record||(showAbyssals&&matchesAnySource(r.record,sources)));
}

// Every physical roll gets its own row. The baseline always uses the saved fit's
// snapshot, even when a refreshed library record for that item has changed.
export function variationItems(variants,baseline,owned=[]){
  const family=new Set(variants.map(v=>String(v.typeID)));family.add(String(baseline.typeID));
  const current=owned.find(r=>r.itemId===baseline.abyssalItemId);
  const choices=[{key:'fitted',mod:baseline,record:current,isBaseline:true}];
  const stock=new Map(variants.map(v=>[String(v.typeID),v]));
  if(!stock.has(String(baseline.typeID)))stock.set(String(baseline.typeID),{name:baseline.name,typeID:baseline.typeID});
  for(const v of stock.values()){
    const same=String(v.typeID)===String(baseline.typeID);
    if(same&&!baseline.mutations)continue;
    choices.push({key:`stock:${v.typeID}`,mod:v,isBaseline:false,isStockBase:same});
  }
  for(const record of owned){
    if(!family.has(String(record.typeID))||record.itemId===baseline.abyssalItemId)continue;
    choices.push({key:`owned:${record.itemId}`,mod:libraryModule(record),record,isBaseline:false});
  }
  const raw=choices.map(c=>attrs(c.mod));
  const differing=differingAttributes([...family],{limit:Infinity,extraAttrs:raw});
  const keys=[...new Set([...differing,...choices.flatMap(c=>Object.keys(c.mod.mutations??{}))])];
  // Derived values ride in the same bag as real attributes, so sorting, the per-attribute locks and
  // the row display all reach them through the paths they already use. They lead `attributes`
  // because they are what a roll is actually judged by, and the sort sheet is a scrolling list.
  const values=raw.map(a=>({...a,...derivedAttributes(a)})),base=values[0];
  const has=k=>values.some(a=>typeof a[k]==='number'&&Number.isFinite(a[k]));
  const derived=[...DERIVED_KEYS].filter(has);
  const attributes=[...new Set([...derived,'cpu','power','upgradeCost',...keys])].filter(has);
  // …but TRAIL the row's stats, where the first six with a delta win the space. A rate is a summary
  // of attributes already on the row, so it must not push the halves it is made of off the end.
  const statKeys=[...keys.filter(k=>!['cpu','power','upgradeCost'].includes(k)),...derived];
  const rows=choices.map((c,i)=>({...c,typeID:c.mod.typeID,values:values[i],stats:statKeys.map(key=>{
    const value=values[i][key]??null,b=base[key]??null;
    const delta=value!=null&&b!=null?value-b:null;
    return {key,value,delta,better:delta==null||delta===0?null:directionOf(key,value,b,c.mod.typeID)};
  })}));
  return {rows,attributes};
}

// Explicit fields clear the old roll and ownership when returning to a stock module.
export function variationRoll(mod){
  return {mutaplasmid:mod.mutaplasmid,mutations:mod.mutations?{...mod.mutations}:undefined,abyssalItemId:mod.abyssalItemId};
}
