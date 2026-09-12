import { JITA_4_4_STATION_ID } from './mutamarket.js';

// Jita 4-4 is where abyssal trading actually happens, so "can I hand this over today" is a yes/no
// question about ONE station rather than a place to browse to.
//
// It is answered off the DISPLAYED path, not off `locationId`, because `locationId` is a record's
// IMMEDIATE parent: anything sitting in a can names the can, not the station. The station is the
// root of that walk, which is the first segment of `location` — the same string the row already
// shows, so the filter can never disagree with what you are reading.
//
// The raw id is accepted as well: when ESI cannot resolve a name the walk renders `Location #60003760`,
// and that is still the same station. Matching only the pretty name would make the filter silently
// empty exactly when name resolution failed.
export const JITA_4_4_NAME='Jita IV - Moon 4 - Caldari Navy Assembly Plant';
export function abyssalStation(record){return String(record?.location??'').split(' / ')[0].trim();}
export function atJita44(record){
  const root=abyssalStation(record);
  return root===JITA_4_4_NAME||root===`Location #${JITA_4_4_STATION_ID}`
    ||String(record?.locationId)===String(JITA_4_4_STATION_ID);
}

// Browse the same saved items by CCP's existing module tree or by physical location.
// Never group by module name or container label: both can be shared by distinct items.
export function abyssalsForSlot(records,slotType){
  const slot=slotType==='rigs'?'rig':slotType;
  return records.filter(r=>(r.slot==='rigs'?'rig':r.slot)===slot);
}

export function abyssalMarketGroups(records,marketTree){
  const byType=new Map(),placed=new Set();
  for(const record of records){
    const key=String(record.typeID);
    if(!byType.has(key))byType.set(key,[]);
    byType.get(key).push(record);
  }
  const walk=nodes=>nodes.map(node=>{
    const own=[];
    for(const mod of node.mods??[])for(const record of byType.get(String(mod.typeID))??[]){
      if(!placed.has(record.itemId)){own.push(record);placed.add(record.itemId);}
    }
    const children=walk(node.children??[]);
    return {...node,records:own,children,count:own.length+children.reduce((n,c)=>n+c.count,0)};
  }).filter(node=>node.count>0);
  const groups=walk(marketTree);
  // Off-market / older records remain reachable even if their base type has no tree node.
  const other=records.filter(r=>!placed.has(r.itemId));
  if(other.length)groups.push({id:'abyssal-other',other:true,records:other,children:[],count:other.length});
  return groups;
}

export function abyssalContainerGroups(records){
  const groups=new Map();
  for(const record of records){
    const id=JSON.stringify([String(record.characterId),String(record.locationId)]);
    if(!groups.has(id))groups.set(id,{id,locationId:record.locationId,name:record.location,subtitle:record.characterName,
      records:[],children:[],count:0});
    const group=groups.get(id);group.records.push(record);group.count++;
  }
  const labels=new Map();
  for(const group of groups.values()){
    const label=JSON.stringify([group.name,group.subtitle]);
    labels.set(label,(labels.get(label)??0)+1);
  }
  const result=[...groups.values()].map(group=>labels.get(JSON.stringify([group.name,group.subtitle]))>1
    ?{...group,subtitle:`${group.subtitle} · #${group.locationId}`}:group);
  return result.sort((a,b)=>a.name.localeCompare(b.name)||a.subtitle.localeCompare(b.subtitle)||a.id.localeCompare(b.id));
}

// The same containers, but nested under the character who owns them, for choosing which slice of a
// library to compare against. A flat container list is fine for one pilot with a hangar; a player
// with several characters and years of loot gets hundreds of rows and no way through them. Character
// first is the only split that is always meaningful — location names repeat, labels are user-typed,
// and a module's owner is the one thing that never collides.
//
// Shares `abyssalBrowseLevel`'s node shape, so this drills with the same primitive the library uses.
export const CHARACTER_SOURCE='char:';
export function abyssalSourceTree(records){
  const containers=abyssalContainerGroups(records),byCharacter=new Map();
  for(const container of containers){
    const record=container.records[0];
    const id=`${CHARACTER_SOURCE}${record.characterId}`;
    if(!byCharacter.has(id))byCharacter.set(id,{id,name:record.characterName,subtitle:'',records:[],children:[],count:0});
    const node=byCharacter.get(id);
    node.children.push(container);
    node.records.push(...container.records);
    node.count+=container.count;
  }
  return [...byCharacter.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}

// The source tree above is built from SAVED ROLLS, so it only knows characters who have imported
// something. The sheet also has to show the ones you have merely linked — otherwise connecting a
// character and finding the list unchanged reads as a failed login rather than as "now scan their
// assets". They arrive with a count of 0 and are a legitimate source that matches nothing yet.
//
// The reverse case matters too and is the one that is easy to miss: a character can be UNLINKED and
// still own rolls, because unlinking deliberately leaves the library alone. Those nodes stay — the
// saved rolls are still real and still comparable offline — so `linked` is carried per node rather
// than being the same question as "is this node here at all".
export function mergeLinkedCharacters(tree,characters=[]){
  const known=new Set(tree.map(n=>n.id));
  const linked=new Set(characters.map(c=>`${CHARACTER_SOURCE}${c.characterId}`));
  const extra=characters.filter(c=>!known.has(`${CHARACTER_SOURCE}${c.characterId}`))
    .map(c=>({id:`${CHARACTER_SOURCE}${c.characterId}`,name:c.characterName,subtitle:'',records:[],children:[],count:0}));
  return [...tree,...extra].map(n=>({...n,linked:linked.has(n.id)}))
    .sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}

export function abyssalBrowseLevel(tree,path){
  let nodes=tree,records=[];const breadcrumb=[];
  for(const id of path){
    const node=nodes.find(n=>n.id===id);
    if(!node)return {nodes:[],records:[],breadcrumb};
    breadcrumb.push(node);records=node.records??[];nodes=node.children;
  }
  return {nodes,records,breadcrumb};
}
