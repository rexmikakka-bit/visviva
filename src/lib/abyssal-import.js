import { getCharacterAssetsPage, getCharacterAssetNames } from './esi.js';
import { abyssalAssets, assetLocation, dynamicItemToModule, ASSET_SCOPE } from './abyssal-library.js';

function cancelled(signal){if(signal?.aborted)throw new DOMException('Import cancelled','AbortError');}
function pause(ms,signal){return new Promise((resolve,reject)=>{
  const stop=()=>{clearTimeout(timer);reject(new DOMException('Import cancelled','AbortError'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);
  signal?.addEventListener('abort',stop,{once:true});
});}
export async function retryESI(request,signal){
  for(let attempt=0;;attempt++){
    cancelled(signal);
    const controller=new AbortController();
    const abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,30000);
    try{return await request(controller.signal);}catch(e){
      cancelled(signal);
      if(attempt>=2||[400,401,403,404].includes(e.status))throw Object.assign(e,{status:e.status??0});
      const delay=Number(e.retryAfter);
      // Do not hammer a rate-limited endpoint or silently wait for minutes.
      if(delay>30)throw Object.assign(new Error(`ESI is busy. Try again in ${Math.ceil(delay/60)} minutes.`),{status:429});
      await pause(Math.max(1000*2**attempt,(delay||0)*1000),signal);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
}
async function publicJSON(path,signal){
  const resp=await fetch(`https://esi.evetech.net/latest${path}`,{signal});
  if(!resp.ok)throw Object.assign(new Error(`ESI request failed (${resp.status})`),{status:resp.status,retryAfter:resp.headers.get('Retry-After')});
  return resp.json();
}
const defaultAPI={assets:getCharacterAssetsPage,names:getCharacterAssetNames,
  dynamic:(a,signal)=>publicJSON(`/dogma/dynamic/items/${a.type_id}/${a.item_id}/`,signal),
  station:(id,signal)=>publicJSON(`/universe/stations/${id}/`,signal)};

export async function scanAbyssals(character,{signal,onProgress=()=>{},api=defaultAPI}={}){
  if(!character?.scopes?.includes(ASSET_SCOPE))throw new Error('Asset access is required. Connect this character again.');
  let assets=[],pages=1;
  for(let page=1;page<=pages;page++){
    onProgress({stage:'scan',done:page,total:pages});
    const result=await retryESI(s=>api.assets(character.characterId,page,s),signal);
    if(!Array.isArray(result.items)||!Number.isInteger(result.pages)||result.pages<1)throw new Error('Incomplete asset response');
    if(page>1&&result.pages!==pages)throw new Error('Your asset list changed during the scan. Please scan again.');
    pages=result.pages;assets.push(...result.items);
  }
  if(new Set(assets.map(a=>a.item_id)).size!==assets.length)throw new Error('Asset pages overlap. Please scan again.');
  const candidates=abyssalAssets(assets),byId=new Map(assets.map(a=>[a.item_id,a])),containers=new Set(),stations=new Set();
  for(const item of candidates){
    let node=item;const visited=new Set();
    while(!visited.has(node.location_id)){
      visited.add(node.location_id);
      const parent=byId.get(node.location_id);
      if(!parent){if(node.location_type==='station')stations.add(node.location_id);break;}
      containers.add(parent.item_id);node=parent;
    }
  }
  const names={},warnings=[];
  const ids=[...containers];
  for(let i=0;i<ids.length;i+=1000){
    try{
      const rows=await retryESI(s=>api.names(character.characterId,ids.slice(i,i+1000),s),signal);
      for(const row of rows)if(row.name&&row.name!=='None')names[row.item_id]=row.name;
    }catch(e){cancelled(signal);warnings.push(e.message);break;}
  }
  for(const id of stations){
    try{const station=await retryESI(s=>api.station(id,s),signal);names[id]=station.name;}
    catch(e){cancelled(signal);warnings.push(e.message);break;}
  }
  return {character,assets,candidates,names,warnings};
}

// Existing rolls are immutable: only ownership and location need refreshing. Commit in batches
// so cancelling a large first import retains progress and the next import can reuse it.
export async function importAbyssals(scan,selectedLocations,previous,{signal,onProgress=()=>{},onBatch=async()=>{},api=defaultAPI}={}){
  const selected=new Set(selectedLocations),byId=new Map(scan.assets.map(a=>[a.item_id,a]));
  const items=scan.candidates.filter(a=>selected.has(String(a.location_id)));
  const saved=new Map(previous.map(r=>[r.itemId,r])),failures=[];let batch=[],done=0,imported=0;
  for(const asset of items){
    cancelled(signal);
    try{
      const old=saved.get(String(asset.item_id)),location=assetLocation(asset,byId,scan.names);
      const record=old?.dynamicTypeId===asset.type_id?{...old,characterId:scan.character.characterId,characterName:scan.character.characterName,
        location,locationId:String(asset.location_id),available:true,lastSeen:Date.now()}:
        dynamicItemToModule(asset,await retryESI(s=>api.dynamic(asset,s),signal),scan.character,location);
      batch.push(record);imported++;
    }catch(e){
      cancelled(signal);
      if(e.status!==undefined&&e.status!==404)throw e;
      failures.push({itemId:String(asset.item_id),message:e.message});
    }
    onProgress({stage:'import',done:++done,total:items.length});
    if(batch.length>=20){await onBatch(batch);batch=[];}
  }
  await onBatch(batch); // also updates availability when no new modules were selected
  return {imported,failures};
}
