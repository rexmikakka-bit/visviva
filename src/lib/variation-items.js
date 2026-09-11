import { TYPES } from '../calc.js';
import { differingAttributes, directionOf } from './compare.js';
import { libraryModule } from './abyssal-library.js';

const attrs=mod=>({...((TYPES[mod.typeID]?.attrs??TYPES[mod.typeID]?.a)??{}),...mod.mutations});
export function fittedAbyssalIds(slots,exceptId){
  return new Set(Object.values(slots??{}).flatMap(v=>Array.isArray(v)?v:[])
    .filter(m=>m&&m.id!==exceptId).map(m=>m.abyssalItemId).filter(Boolean));
}

export function filterVariationItems(rows,showAbyssals,source='owned'){
  return rows.filter(r=>r.isBaseline||!r.record||(showAbyssals&&(source==='owned'||
    JSON.stringify([String(r.record.characterId),String(r.record.locationId)])===source)));
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
  const values=choices.map(c=>attrs(c.mod)),base=values[0];
  const differing=differingAttributes([...family],{limit:Infinity,extraAttrs:values});
  const keys=[...new Set([...differing,...choices.flatMap(c=>Object.keys(c.mod.mutations??{}))])];
  const attributes=[...new Set(['cpu','power','upgradeCost',...keys])].filter(k=>values.some(a=>typeof a[k]==='number'&&Number.isFinite(a[k])));
  const rows=choices.map((c,i)=>({...c,typeID:c.mod.typeID,values:values[i],stats:keys.filter(k=>!['cpu','power','upgradeCost'].includes(k)).map(key=>{
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
