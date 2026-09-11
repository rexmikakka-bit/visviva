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

export function abyssalBrowseLevel(tree,path){
  let nodes=tree,records=[];const breadcrumb=[];
  for(const id of path){
    const node=nodes.find(n=>n.id===id);
    if(!node)return {nodes:[],records:[],breadcrumb};
    breadcrumb.push(node);records=node.records??[];nodes=node.children;
  }
  return {nodes,records,breadcrumb};
}
