import { mergeAbyssalScan } from './abyssal-library.js';

// Version 2 adds `listings`: the contract a market module was chosen from, so a saved fit's
// `abyssalItemId` can still be turned into something buyable long after the session that picked it.
// `modules` is created defensively as well — `onupgradeneeded` fires from whatever version the
// browser already has, including 0 on a fresh install, and version 1's handler does not run again.
let database;
function open(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('axis-abyssals',2);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('modules'))db.createObjectStore('modules',{keyPath:'itemId'});
      if(!db.objectStoreNames.contains('listings'))db.createObjectStore('listings',{keyPath:'itemId'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Close other Axis tabs and try again.'));
  }).catch(e=>{database=null;throw e;});
  return database;
}
function readAll(name,failure){
  return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(name,'readonly'),req=tx.objectStore(name).getAll();
    tx.oncomplete=()=>resolve(req.result);
    tx.onerror=tx.onabort=()=>reject(tx.error??new Error(failure));
  }));
}
export function readAbyssals(){return readAll('modules','Unable to read abyssal library');}
async function update(transform){
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('modules','readwrite'),store=tx.objectStore('modules'),req=store.getAll();
    let result;
    req.onsuccess=()=>{try{result=transform(req.result);for(const row of result)store.put(row);}catch(e){tx.abort();reject(e);}};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=tx.onabort=()=>reject(tx.error??new Error('Unable to save abyssal library'));
  });
}

export function readListings(){return readAll('listings','Unable to read saved contracts');}

// Written when a listing is chosen, not when one is merely seen: a page of 100 results is browsing,
// and caching all of it would fill the store with contracts nobody is buying.
export async function rememberListings(listings){
  const rows=(listings??[]).filter(l=>l?.itemId);
  if(!rows.length)return readListings();
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('listings','readwrite'),store=tx.objectStore('listings');
    for(const row of rows)store.put({...row,itemId:String(row.itemId)});
    const req=store.getAll();
    tx.oncomplete=()=>resolve(req.result);
    tx.onerror=tx.onabort=()=>reject(tx.error??new Error('Unable to save contract details'));
  });
}

export async function forgetListing(itemId){
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('listings','readwrite'),store=tx.objectStore('listings');
    store.delete(String(itemId));
    const req=store.getAll();
    tx.oncomplete=()=>resolve(req.result);
    tx.onerror=tx.onabort=()=>reject(tx.error??new Error('Unable to update saved contracts'));
  });
}
// The one path in this store that DELETES saved rolls, so it is keyed on characterId and nothing
// else: a label, a location and a container name can all be shared between pilots, an owner cannot.
// Rows are removed rather than flagged, because a tombstone would be resurrected by the next scan
// that merged the same hangar — "forget these" has to mean the library no longer knows them.
//
// Deliberately separate from disconnecting the ESI session. Unlinking a character is routine and
// reversible; this is not, so the sheet asks for it as its own answer rather than folding it in.
export async function forgetCharacterAbyssals(characterId){
  const id=String(characterId),db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('modules','readwrite'),store=tx.objectStore('modules'),req=store.getAll();
    let kept=[];
    req.onsuccess=()=>{
      kept=req.result.filter(row=>String(row.characterId)!==id);
      for(const row of req.result)if(String(row.characterId)===id)store.delete(row.itemId);
    };
    tx.oncomplete=()=>resolve(kept);
    tx.onerror=tx.onabort=()=>reject(tx.error??new Error('Unable to update abyssal library'));
  });
}
export function saveAbyssalScan(imported,scan){return update(old=>mergeAbyssalScan(old,imported,scan.assets,scan.character,scan.names));}
export function editAbyssal(itemId,changes){return update(old=>old.map(r=>r.itemId===itemId?{...r,label:changes.label??r.label,favorite:changes.favorite??r.favorite}:r));}
