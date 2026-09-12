// MutaMarket filters contracts by REGION; its contract payload carries no station. Owen's
// requirement is Jita 4-4 specifically, and the difference is not cosmetic — of 400 clean Forge
// listings sampled live, 371 were at Jita 4-4 and 29 sat at another Forge station. Showing those 29
// as Jita would send someone 20 jumps for a module that isn't there.
//
// ESI's public contract list for a region carries `start_location_id`, and its `contract_id` is the
// SAME id MutaMarket reports: all 400 sampled ids matched, with identical prices. So one region scan
// gives us station resolution for every listing at once.
//
// The cost is one scan, not one request per contract: The Forge is ~35 pages / ~35,000 contracts and
// took 2.1s fetched 8 pages at a time. ESI caches it for 30 minutes, so the index is reused for the
// whole session — `expiresAt` is exposed so the UI can show when it was last checked.
import { retryESI } from './abyssal-import.js';

export const ESI_BASE='https://esi.evetech.net/latest';
const PAGE_CONCURRENCY=8;

async function fetchPage(regionId,page,signal){
  const resp=await fetch(`${ESI_BASE}/contracts/public/${regionId}/?page=${page}`,{signal});
  if(!resp.ok)throw Object.assign(new Error(`ESI contract lookup failed (${resp.status})`),
    {status:resp.status,retryAfter:resp.headers.get('Retry-After')});
  return {rows:await resp.json(),pages:Number(resp.headers.get('x-pages'))||1,expires:resp.headers.get('expires')};
}

// A partially fetched index is worse than none: a contract missing from it is indistinguishable from
// one sitting outside the region, so a dropped page would silently hide real Jita listings rather
// than fail visibly. Same rule `scanAbyssals` applies to asset pages.
export async function fetchContractIndex(regionId,{signal,onProgress=()=>{},api={page:fetchPage}}={}){
  const first=await retryESI(s=>api.page(regionId,1,s),signal);
  const index=new Map(),add=rows=>{for(const c of rows??[])if(c?.contract_id!=null)index.set(Number(c.contract_id),Number(c.start_location_id));};
  add(first.rows);
  const pages=first.pages;
  onProgress({stage:'contracts',done:1,total:pages});
  for(let page=2;page<=pages;page+=PAGE_CONCURRENCY){
    const batch=Array.from({length:Math.min(PAGE_CONCURRENCY,pages-page+1)},(_,i)=>page+i);
    const results=await Promise.all(batch.map(p=>retryESI(s=>api.page(regionId,p,s),signal)));
    for(const result of results)add(result.rows);
    onProgress({stage:'contracts',done:Math.min(page+PAGE_CONCURRENCY-1,pages),total:pages});
  }
  const expiresAt=Date.parse(first.expires??'');
  return {regionId,index,fetchedAt:Date.now(),expiresAt:Number.isFinite(expiresAt)?expiresAt:null};
}

// One scan per region per ESI cache window, shared by every module you open. Without this, browsing
// six modules on the market means six full 35-page scans of The Forge for an index that ESI itself
// holds still for 30 minutes. The in-flight promise is shared too, so opening two modules quickly
// does not start two scans — and deliberately takes no AbortSignal: one caller navigating away must
// not cancel a scan the others are waiting on.
let cachedIndex=null,pendingIndex=null;
export function contractIndexFor(regionId,{onProgress}={}){
  if(cachedIndex?.regionId===regionId&&!contractIndexExpired(cachedIndex))return Promise.resolve(cachedIndex);
  if(pendingIndex?.regionId===regionId)return pendingIndex.promise;
  const promise=fetchContractIndex(regionId,{onProgress}).then(
    index=>{cachedIndex=index;pendingIndex=null;return index;},
    e=>{pendingIndex=null;throw e;});
  pendingIndex={regionId,promise};
  return promise;
}

export function contractIndexExpired(contractIndex,now=Date.now()){
  return !contractIndex||(contractIndex.expiresAt!=null&&now>=contractIndex.expiresAt);
}

// Returns null when the contract is not in the index, which is NOT the same as "not at this
// station" — an expired or newly issued contract simply isn't there yet. Callers must treat null as
// unknown and say so, never fold it into a station match.
export function stationOf(contractIndex,contractId){
  const station=contractIndex?.index?.get(Number(contractId));
  return station==null?null:station;
}

// `stationId` null means "wherever it is" and keeps listings whose station could not be resolved;
// a real station ID drops them, because an unresolved contract cannot be claimed to be at Jita 4-4.
export function withStations(listings,contractIndex,{stationId=null}={}){
  const located=listings.map(l=>({...l,stationId:stationOf(contractIndex,l.contractId)}));
  return stationId==null?located:located.filter(l=>l.stationId===stationId);
}
