import { TYPES, ATTR_ID_TO_NAME } from '../calc.js';
import mutators from '../data/mutaplasmids.json' with { type: 'json' };
import { guessSlotFromDogma } from './core.js';

export const ASSET_SCOPE='esi-assets.read_assets.v1';
export const MANUAL_OWNER='axis-manual';

export function manualAbyssalId(){
  const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `axis-manual:${Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}`;
}

// A simulated roll is a separate saved copy, never a claim to own a market item.
export function customAbyssal(mod,{itemId=manualAbyssalId(),label='',ownerName,locationName,now=Date.now()}={}){
  if(!/^axis-manual:[a-zA-Z0-9-]+$/.test(itemId))throw new Error('Invalid custom module identity');
  const m=mutators[mod?.mutaplasmid],base=TYPES[mod?.typeID];
  if(!m||base?.c!==7||!m.t.includes(mod.typeID))throw new Error('Unsupported module or mutaplasmid');
  const mutations={};
  for(const id of Object.keys(m.a)){
    const name=ATTR_ID_TO_NAME[id],value=mod.mutations?.[name];
    if(!name||typeof value!=='number'||!Number.isFinite(value))throw new Error(`Missing rolled attribute ${id}`);
    mutations[name]=value;
  }
  return {itemId,dynamicTypeId:m.r,typeID:mod.typeID,name:base.n,mutaplasmid:mod.mutaplasmid,mutations,
    slot:guessSlotFromDogma(mod.typeID),characterId:MANUAL_OWNER,characterName:ownerName,
    locationId:MANUAL_OWNER,location:locationName,label:String(label).trim().slice(0,120),favorite:false,
    manual:true,available:true,lastSeen:now,importedAt:now};
}
const resultTypes=new Set(Object.values(mutators).filter(m=>m.t.some(id=>TYPES[id]?.c===7)).map(m=>m.r));
export function abyssalAssets(assets){return assets.filter(a=>a.is_singleton&&resultTypes.has(a.type_id));}

// Asset location IDs may point at other assets. Walk containers and fitted ships up to the root.
export function assetLocation(asset, assetsById, names={}){
  const parts=[],visited=new Set([asset.item_id]);
  let id=asset.location_id;
  while(!visited.has(id)){
    visited.add(id);
    const parent=assetsById.get(id);
    parts.unshift(names[id]|| (parent?`${TYPES[parent.type_id]?.n??'Container'} #${id}`:`Location #${id}`));
    if(!parent)break;
    id=parent.location_id;
  }
  return parts.join(' / ');
}

export function dynamicItemToModule(asset, dynamic, character, location, now=Date.now()){
  const base=TYPES[dynamic?.source_type_id],m=mutators[dynamic?.mutator_type_id];
  if(!base||base.c!==7||!m||m.r!==asset.type_id||!m.t.includes(dynamic.source_type_id))
    throw new Error('Unsupported module or mutaplasmid. Update Axis game data before importing this item.');
  const attributes=new Map((dynamic.dogma_attributes??[]).map(a=>[String(a.attribute_id),a.value]));
  const mutations={};
  for(const id of Object.keys(m.a)){
    const name=ATTR_ID_TO_NAME[id],value=attributes.get(id);
    if(!name||typeof value!=='number'||!Number.isFinite(value))throw new Error(`Missing rolled attribute ${id}`);
    mutations[name]=value;
  }
  if(!Object.keys(mutations).length)throw new Error('No rolled attributes returned');
  return {itemId:String(asset.item_id),dynamicTypeId:asset.type_id,typeID:dynamic.source_type_id,
    name:base.n,mutaplasmid:dynamic.mutator_type_id,mutations,slot:guessSlotFromDogma(dynamic.source_type_id),
    characterId:character.characterId,characterName:character.characterName,locationId:String(asset.location_id),
    location,available:true,lastSeen:now,importedAt:now};
}

// Called only with a complete asset scan. Missing rolls stay usable in saved fits and the library.
export function mergeAbyssalScan(previous, imported, assets, character, names={},now=Date.now()){
  const byId=new Map(assets.map(a=>[String(a.item_id),a]));
  const locationMap=new Map(assets.map(a=>[a.item_id,a]));
  const merged=new Map(previous.map(old=>{
    if(old.characterId!==character.characterId)return [old.itemId,old];
    const found=byId.get(old.itemId);
    return [old.itemId,found?{...old,available:true,lastSeen:now,locationId:String(found.location_id),location:assetLocation(found,locationMap,names)}:{...old,available:false}];
  }));
  for(const item of imported){
    const old=merged.get(item.itemId);
    merged.set(item.itemId,{...item,label:old?.label??'',favorite:old?.favorite??false,importedAt:old?.importedAt??item.importedAt});
  }
  return [...merged.values()];
}

export function libraryModule(item){
  return {name:item.name,typeID:item.typeID,mutaplasmid:item.mutaplasmid,mutations:{...item.mutations},abyssalItemId:item.itemId};
}
