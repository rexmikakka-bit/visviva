// Temporary dev-server fixture. Not an application entry point or production asset.
import React from 'react';
import {createRoot} from 'react-dom/client';
import './src/index.css';
import {TYPES, ATTR_ID_TO_NAME} from './src/calc.js';
import mutators from './src/data/mutaplasmids.json';
import {dynamicItemToModule} from './src/lib/abyssal-library.js';
const prefix='axis-preview-';
async function samples(remove=false){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('axis-abyssals',1);r.onupgradeneeded=()=>r.result.createObjectStore('modules',{keyPath:'itemId'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const rows=[];const seen=new Set();
 if(!remove)for(const [id,m] of Object.entries(mutators)){
  const baseId=m.t.find(id=>TYPES[id]?.c===7 && /II$/.test(TYPES[id].n))??m.t.find(id=>TYPES[id]?.c===7);
  if(!baseId||seen.has(m.r))continue;
  seen.add(m.r);
  const base=TYPES[baseId],attrs=base.attrs??base.a??{};
  for(let n=0;n<3;n++){
   const dogma_attributes=Object.entries(m.a).map(([key,range],i)=>({attribute_id:Number(key),value:(attrs[ATTR_ID_TO_NAME[key]]??attrs[key]??0)*(range[0]+(range[1]-range[0])*(((i*3+n*5)%11)/10))}));
   const owner=n===1?'Preview Combat Pilot':'Preview Storage Alt';
   const row=dynamicItemToModule({item_id:1,type_id:m.r,location_id:n===2?9002:9001},{source_type_id:baseId,mutator_type_id:Number(id),dogma_attributes},{characterId:n===1?-2:-1,characterName:owner},n===2?'Jita 4-4 / Spare rolls':'Jita 4-4 / Sample abyssal container');
   rows.push({...row,itemId:prefix+m.r+'-'+n,favorite:n===0,available:n!==2});
  }
 }
 await new Promise((resolve,reject)=>{const tx=db.transaction('modules','readwrite'),s=tx.objectStore('modules'),r=s.getAllKeys();r.onsuccess=()=>{for(const key of r.result)if(String(key).startsWith(prefix))s.delete(key);for(const row of rows)s.put(row);};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
 db.close();return rows.length;
}
function Preview(){const [status,setStatus]=React.useState('');async function run(remove){try{const n=await samples(remove);setStatus(remove?'Sample modules removed.':`${n} sample modules added. Open Axis, choose a ship, then an empty module slot → My Abyssals.`);}catch(e){setStatus(e.message);}}
 const style={padding:12,marginRight:8,marginBottom:12,cursor:'pointer'};
 return <main style={{padding:24,maxWidth:680,margin:'auto',color:'#eee',fontFamily:'system-ui'}}><h1>Abyssal browser preview</h1><p>Temporary synthetic rolls across module types, with two sample owners, favorites, and missing-item states. No EVE login required.</p><button style={style} onClick={()=>run(false)}>Add sample modules</button><button style={style} onClick={()=>run(true)}>Remove sample modules</button><p role="status">{status}</p><a href="/" style={{color:'#6bb4ff'}}>Open Axis →</a><p>Samples are identified by “Preview” owners. Removal only deletes these sample library records; existing imports are preserved. Fits made with samples retain their copied rolls.</p></main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
