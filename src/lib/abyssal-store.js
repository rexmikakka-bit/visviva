import { mergeAbyssalScan } from './abyssal-library.js';
let database;
function open(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('axis-abyssals',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('modules',{keyPath:'itemId'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Close other Axis tabs and try again.'));
  }).catch(e=>{database=null;throw e;});
  return database;
}
export async function readAbyssals(){
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('modules','readonly'),req=tx.objectStore('modules').getAll();
    tx.oncomplete=()=>resolve(req.result);
    tx.onerror=tx.onabort=()=>reject(tx.error??new Error('Unable to read abyssal library'));
  });
}
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
export function saveAbyssalScan(imported,scan){return update(old=>mergeAbyssalScan(old,imported,scan.assets,scan.character,scan.names));}
export function editAbyssal(itemId,changes){return update(old=>old.map(r=>r.itemId===itemId?{...r,label:changes.label??r.label,favorite:changes.favorite??r.favorite}:r));}
