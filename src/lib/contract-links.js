import { networkJSON } from './network-request.js';
const validSystem=id=>Number.isSafeInteger(id)&&id>=30000000&&id<33000000;
const escape=text=>String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\r\n]/g,' ');

export function contractLinkList(rows,systems=new Map()){
  const lines=[],seen=new Set();let unresolved=0;
  for(const row of rows){
    if(row.state!=='buyable'||!Number.isSafeInteger(row.contractId)||row.contractId<=0||seen.has(row.contractId))continue;
    seen.add(row.contractId);
    const system=systems.get(Number(row.stationId));
    if(!validSystem(system)){unresolved++;continue;}
    const price=typeof row.price==='number'&&Number.isFinite(row.price)&&row.price>0?` ISK ${row.price.toLocaleString('en-US',{maximumFractionDigits:2})}`:'';
    lines.push(`<url=contract:${system}//${row.contractId}>Contract ${row.contractId} (${escape(row.name??'Abyssal module')})${price}</url>`);
  }
  return {text:lines.join('\n'),count:lines.length,unresolved};
}

const CACHE_KEY='axis_station_systems';
export async function stationSystems(stationIds,{fetcher=globalThis.fetch,storage,signal}={}){
  let cached={};try{storage??=globalThis.localStorage;cached=JSON.parse(storage?.getItem(CACHE_KEY)??'{}')??{};}catch{}
  const result=new Map(),unknown=[];
  for(const id of new Set(stationIds.map(Number))){
    if(!Number.isSafeInteger(id)||id<60000000||id>=64000000)continue;
    if(validSystem(cached[id]))result.set(id,cached[id]);else unknown.push(id);
  }
  let failed=0;
  for(let i=0;i<unknown.length;i+=4){
    await Promise.all(unknown.slice(i,i+4).map(async id=>{
      try{
        const {body}=await networkJSON(`https://esi.evetech.net/latest/universe/stations/${id}/`,{signal,timeout:10000,fetcher});
        if(!validSystem(body.system_id))throw new Error('Unknown station system');
        cached[id]=body.system_id;result.set(id,body.system_id);
      }catch{failed++;}
    }));
  }
  try{storage?.setItem(CACHE_KEY,JSON.stringify(cached));}catch{}
  return {systems:result,failed};
}
