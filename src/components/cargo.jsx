import { useState } from "react";
import marketTreeData from "../data/market-tree.json";
import { C } from "../theme.js";
import { eveIcon } from "../lib/icons.js";
import { BottomSheet, NumpadModal } from "./ui.jsx";
import { MT_ALL_ITEMS, MT_CHILDREN, MT_ITEMS, MT_ROOTS, getCompatibleCharges, haptic } from "../lib/core.js";
import { TYPES, tidByName } from "../calc.js";

export function CargoBrowserSheet({onAdd,onClose,slots}){
  const[search,setSearch]=useState("");
  const[path,setPath]=useState([]);
  const[fitCharges,setFitCharges]=useState(false);
  const cur=path.length?path[path.length-1]:null;
  const subGroups=cur==null?MT_ROOTS:(MT_CHILDREN[cur]??[]);
  const items=cur==null?[]:(MT_ITEMS[cur]??[]);
  const searchResults=search.trim().length>1
    ?MT_ALL_ITEMS.filter(i=>i.name.toLowerCase().includes(search.toLowerCase())).slice(0,60)
    :null;
  const crumb=path.map(g=>marketTreeData.g[g]?.n).filter(Boolean).join(" > ");

  const fitChargeList=(()=>{
    if(!fitCharges||!slots)return null;
    const seen=new Map();
    for(const sec of ["high","mid","low"]){
      for(const m of (slots[sec]??[])){
        if(m.type==="empty"||!m.name)continue;
        for(const c of getCompatibleCharges(m)){
          if(!seen.has(c.name)){
            const mt=marketTreeData.t[c.typeID];
            seen.set(c.name,{typeID:c.typeID,name:c.name,vol:c.volume??mt?.[2]??0.01,forMod:m.name});
          }
        }
      }
    }
    return Array.from(seen.values()).sort((a,b)=>a.name.localeCompare(b.name));
  })();

  function ItemRow({item}){
    return(<div onClick={()=>{onAdd({name:item.name,vol:item.vol??0,typeID:item.typeID});}}
      style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
      <div style={{width:32,height:32,borderRadius:7,flexShrink:0,overflow:"hidden",background:C.surfaceAlt,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
        {item.typeID?<img className="eve-icon" src={eveIcon(item.typeID,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>:<span style={{fontSize:14}}>{item.icon||"?"}</span>}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.name}</div>
        <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{item.vol!=null?`${item.vol} m3`:""}{item.forMod?` - fits ${item.forMod}`:""}</div>
      </div>
      <span style={{fontSize:11,color:C.accent,fontWeight:700,flexShrink:0}}>+ Add</span>
    </div>);
  }
  function GroupRow({gid}){
    const g=marketTreeData.g[gid];
    const nSub=(MT_CHILDREN[gid]??[]).length,nItems=(MT_ITEMS[gid]??[]).length;
    return(<div onClick={()=>setPath(p=>[...p,gid])} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
      <div style={{width:32,height:32,borderRadius:7,flexShrink:0,overflow:"hidden",background:C.surfaceAlt,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
        {g.i?<img className="eve-icon" src={eveIcon(g.i,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>:null}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:600,color:C.text}}>{g.n}</div>
        <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{nSub>0?`${nSub} groups`:`${nItems} items`}</div>
      </div>
      <span style={{fontSize:18,color:C.textMute,flexShrink:0}}>{">"}</span>
    </div>);
  }

  return(<BottomSheet title="Add Cargo" onClose={onClose} height="86vh" fillHeight>
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px"}}>
        <span style={{fontSize:16,color:C.textMute}}>&#128269;</span>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search market..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:14}}/>
        {search&&<button onClick={()=>setSearch("")} aria-label="Clear search" style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:18,lineHeight:1,padding:10,margin:-10,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>x</button>}
      </div>
    </div>
    {!searchResults&&!fitCharges&&path.length===0&&(
      <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`}}>
        <button onClick={()=>setFitCharges(true)} style={{width:"100%",padding:"10px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:12,fontWeight:700,cursor:"pointer"}}>Charges for Active Fit</button>
      </div>
    )}
    {!searchResults&&(fitCharges||path.length>0)&&(
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={()=>fitCharges?setFitCharges(false):setPath(p=>p.slice(0,-1))} style={{background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer",padding:0}}>&laquo; Back</button>
        <span style={{fontSize:12,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fitCharges?"Charges for Active Fit":crumb}</span>
      </div>
    )}
    <div style={{flex:1,overflowY:"auto"}}>
      {searchResults?(
        <div>{searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0"}}>No items found</div>}{searchResults.map(item=><ItemRow key={item.typeID} item={item}/>)}</div>
      ):fitCharges?(
        <div>{(fitChargeList??[]).length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:12}}>No charge-compatible modules fitted</div>}{(fitChargeList??[]).map(item=><ItemRow key={item.typeID??item.name} item={item}/>)}</div>
      ):(
        <div>
          {subGroups.map(gid=><GroupRow key={gid} gid={gid}/>)}
          {items.map(item=><ItemRow key={item.typeID} item={item}/>)}
        </div>
      )}
    </div>
  </BottomSheet>);
}

export function CargoScreen({items,setItems,shipCapacity=1150,slots}){
  const[numpad,setNumpad]=useState(null);
  const[showCargoPicker,setShowCargoPicker]=useState(false);
  const volOf=it=>{
    const t=it.typeID??tidByName(it.name);
    const typeVol=t?(TYPES[t]?.attrs?.volume??TYPES[t]?.a?.['161']):undefined;
    return typeVol??(it.vol>0?it.vol:0);
  };
  const totalVol=items.reduce((s,i)=>s+i.qty*volOf(i),0).toFixed(1);
  const cap=Math.round(shipCapacity||0);
  const addItem=item=>{
    const ex=items.find(e=>e.name===item.name);
    if(ex){setItems(items.map(e=>e.name===item.name?{...e,qty:e.qty+1}:e));setNumpad({...ex,qty:ex.qty+1});return;}
    const ni={id:Date.now(),name:item.name,qty:1,vol:item.vol??volOf(item),icon:item.icon,typeID:item.typeID};
    setItems(prev=>[...prev,ni]);
    setNumpad(ni);
  };
  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      {/* Same treatment as the drone bay readouts and the fitting strip: used volume at full text
          colour, capacity one step back in both colour AND size, tabular-nums, and red once you are
          over. This was 11px at textMute, which is the figure you are actually watching while
          loading cargo. The capacity is a fixed property of the hull — it is context for the number
          that moves, so it should not compete with it at the same size. */}
      <div><span style={{fontSize:12,fontWeight:700,color:C.text}}>Cargo Bay</span>
        <span style={{fontSize:12,marginLeft:8,fontVariantNumeric:"tabular-nums"}}>
          <span style={{fontWeight:700,color:totalVol>cap?C.danger:C.text}}>{totalVol}</span>
          <span style={{fontSize:10,color:C.textMid}}>/{cap.toLocaleString()} m³</span>
        </span>
      </div>
      <button className="press" onClick={()=>{haptic();setShowCargoPicker(true);}} style={{padding:"5px 10px",background:C.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Add</button>
    </div>
    <div style={{height:3,background:C.border}}><div style={{width:`${cap>0?Math.min((parseFloat(totalVol)/cap)*100,100):0}%`,height:"100%",background:parseFloat(totalVol)>cap?C.danger:C.accent}}/></div>
    <div style={{flex:1,overflowY:"auto",padding:12}}>
      {items.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:13}}>Cargo bay is empty</div>}
      {items.map(item=>(<div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:6}}>
        <div style={{width:32,height:32,borderRadius:7,background:C.surfaceAlt,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,overflow:"hidden"}}>{(()=>{const tid=item.typeID??tidByName(item.name);return tid?<img className="eve-icon" src={eveIcon(tid,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>:<span style={{fontSize:14}}>📦</span>;})()}</div>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.name}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{(item.qty*volOf(item)).toFixed(1)} m3</div></div>
        <button className="press" onClick={()=>{haptic();setNumpad(item);}} style={{display:"flex",flexDirection:"column",alignItems:"center",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,padding:"5px 10px",cursor:"pointer"}}>
          <span style={{fontSize:14,fontWeight:800,color:C.text}}>{item.qty.toLocaleString()}</span>
          <span style={{fontSize:8,color:C.textMute,marginTop:1}}>tap to edit</span>
        </button>
        {/* There was no way to take anything back OUT of the cargo bay. */}
        <button className="press" onClick={()=>{haptic("heavy");setItems(items.filter(i=>i.id!==item.id));}} aria-label={`Remove ${item.name}`} title="Remove from cargo"
          style={{width:28,height:28,flexShrink:0,borderRadius:7,background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",color:C.danger,fontSize:16,lineHeight:1,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>&times;</button>
      </div>))}
    </div>
    {numpad&&(()=>{
      const unitVol=volOf(numpad);
      const otherVol=items.filter(i=>i.id!==numpad.id).reduce((s,i)=>s+i.qty*volOf(i),0);
      const fillMax=unitVol>0?Math.max(0,Math.floor((cap-otherVol)/unitVol)):null;
      return <NumpadModal label={numpad.name} initial={numpad.qty} fillMax={fillMax} onConfirm={qty=>setItems(items.map(i=>i.id===numpad.id?{...i,qty}:i))} onClose={()=>setNumpad(null)}/>;
    })()}
    {showCargoPicker&&<CargoBrowserSheet slots={slots} onAdd={addItem} onClose={()=>setShowCargoPicker(false)}/>}
  </div>);
}
