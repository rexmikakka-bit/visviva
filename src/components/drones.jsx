import { useState } from "react";
import { C } from "../theme.js";
import { eveIcon } from "../lib/icons.js";
import { BottomSheet, AccordionSection, ItemDetailSheet } from "./ui.jsx";
import { REAL_DRONE_BROWSER, FIGHTER_CATALOG } from "../lib/core.js";
import { TYPES, tidByName } from "../calc.js";

export function DroneBrowserSheet({existingDrones,onAdd,onClose}){
  const[search,setSearch]=useState("");
  const[drillSub,setDrillSub]=useState(null);
  const allDrones=REAL_DRONE_BROWSER.flatMap(g=>g.subGroups?g.subGroups.flatMap(s=>s.drones):(g.drones??[]));
  const searchResults=search.trim().length>1?allDrones.filter(d=>d.name.toLowerCase().includes(search.toLowerCase())).slice(0,40):null;
  const drilledGroup=drillSub?REAL_DRONE_BROWSER.find(g=>g.topGroup===drillSub):null;

  function DroneRow({d}){
    const already=existingDrones.find(e=>e.name===d.name);
    return(<div onClick={()=>{onAdd(d);onClose();}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:already?C.accentLight:"transparent"}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
          {d.typeID&&<img className="eve-icon" src={eveIcon(d.typeID,32)} width={26} height={26} alt="" onError={e=>{e.target.style.display="none";}}/>}
          <span style={{fontSize:14,fontWeight:600,color:already?C.accent:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.name}</span>
          <span style={{fontSize:10,color:C.textMute,background:C.border,borderRadius:99,padding:"1px 6px",flexShrink:0}}>{d.meta}</span>
        </div>
        <div style={{display:"flex",gap:10,fontSize:11,color:C.textMute}}>
          {d.dps>0&&<span>DPS <span style={{color:C.danger,fontWeight:600}}>{d.dps}</span></span>}
          {d.dps===0&&d.dmgType&&<span style={{color:C.high}}>{d.dmgType}</span>}
          {d.range>0&&<span>Range {d.range}km</span>}
          {d.tracking&&d.tracking>0&&<span>Tr {d.tracking.toFixed(3)}</span>}
          {d.hp>0&&<span>HP {d.hp.toLocaleString()}</span>}
        </div>
      </div>
      {already?<span style={{color:C.accent,fontSize:12,fontWeight:700,marginLeft:10,flexShrink:0}}>+Add</span>:<span style={{color:C.textMute,fontSize:20,marginLeft:10,flexShrink:0}}>+</span>}
    </div>);
  }

  function renderBody(){
    if(searchResults){if(searchResults.length===0)return(<div style={{textAlign:"center",color:C.textMute,padding:"32px 0"}}>No drones found</div>);return searchResults.map(d=><DroneRow key={d.typeID??d.name} d={d}/>);}
    if(drillSub&&drilledGroup){
      if(drilledGroup.subGroups)return drilledGroup.subGroups.map(sub=>(<AccordionSection key={sub.name} title={`${sub.name} (${sub.drones.length})`}>{sub.drones.map(d=><DroneRow key={d.typeID??d.name} d={d}/>)}</AccordionSection>));
      return (drilledGroup.drones??[]).map(d=><DroneRow key={d.typeID??d.name} d={d}/>);
    }
    return REAL_DRONE_BROWSER.map(group=>{
      const count=group.subGroups?group.subGroups.reduce((s,sg)=>s+sg.drones.length,0):(group.drones?.length??0);
      if(group.subGroups?.length)return(<div key={group.topGroup} onClick={()=>setDrillSub(group.topGroup)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}><div><div style={{fontSize:14,fontWeight:600,color:C.text}}>{group.topGroup}</div><div style={{fontSize:11,color:C.textMute,marginTop:2}}>{count} drones</div></div><span style={{fontSize:20,color:C.textMute}}>{">"}</span></div>);
      return(<AccordionSection key={group.topGroup} title={`${group.topGroup} (${count})`}>{(group.drones??[]).map(d=><DroneRow key={d.typeID??d.name} d={d}/>)}</AccordionSection>);
    });
  }

  return(<BottomSheet title="Add Drone" onClose={onClose} height="88vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px"}}>
        <span style={{fontSize:16,color:C.textMute}}>&#128269;</span>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search drones..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:14}}/>
        {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:18,padding:0}}>x</button>}
      </div>
    </div>
    {!searchResults&&drillSub&&(<div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}><button onClick={()=>setDrillSub(null)} style={{background:"none",border:"none",color:C.accent,fontSize:14,fontWeight:700,cursor:"pointer",padding:0}}>Back</button><span style={{fontSize:13,fontWeight:600,color:C.text}}>{drillSub}</span></div>)}
    <div>{renderBody()}</div>
  </BottomSheet>);
}

export function FighterBrowserSheet({onAdd,onClose}){
  const [cls,setCls]=useState("Light");
  const [q,setQ]=useState("");
  const tierColor={T1:C.textMid,T2:C.accent,Navy:C.warning};
  const classColor={Light:C.rig,Heavy:C.warning,Support:C.accent};
  const races=FIGHTER_CATALOG[cls]||{};
  const RACE_ORDER=["Amarr","Caldari","Gallente","Minmatar","Faction"];
  const ql=q.trim().toLowerCase();
  const anyMatch=RACE_ORDER.some(r=>races[r]?.some(f=>!ql||f.name.toLowerCase().includes(ql)));
  return(<BottomSheet title="Add Fighter" onClose={onClose} height="82vh">
    <div style={{display:"flex",gap:6,padding:"10px 12px 8px"}}>
      {["Light","Heavy","Support"].map(c=>(
        <button key={c} onClick={()=>setCls(c)} style={{flex:1,padding:"8px 0",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
          background:cls===c?classColor[c]+"22":"transparent",border:`1px solid ${cls===c?classColor[c]:C.border}`,color:cls===c?classColor[c]:C.textMid}}>{c}</button>
      ))}
    </div>
    <div style={{padding:"0 12px 8px"}}>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder={`Search ${cls.toLowerCase()} fighters…`} style={{width:"100%",boxSizing:"border-box",padding:"9px 11px",borderRadius:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,fontSize:13,outline:"none"}}/>
    </div>
    {RACE_ORDER.filter(r=>races[r]).map(r=>{
      const list=races[r].filter(f=>!ql||f.name.toLowerCase().includes(ql));
      if(!list.length) return null;
      return(<div key={r}>
        <div style={{padding:"6px 16px",fontSize:10,fontWeight:800,color:C.textMute,textTransform:"uppercase",letterSpacing:0.5,background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>{r}</div>
        {list.map(f=>(
          <div key={f.typeID} onClick={()=>{onAdd({...f,cls});onClose();}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
            <div style={{display:"flex",alignItems:"center",gap:9}}>
              <img className="eve-icon" src={eveIcon(f.typeID,32)} width={28} height={28} alt="" onError={e=>{e.target.style.visibility="hidden";}}/>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{f.name}</div>
                <span style={{fontSize:9,fontWeight:800,color:classColor[cls],textTransform:"uppercase",letterSpacing:0.3}}>{cls} fighter</span>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:10,fontWeight:800,color:tierColor[f.tier]||C.textMid,background:`${tierColor[f.tier]||C.textMid}22`,borderRadius:4,padding:"2px 7px"}}>{f.tier}</span>
              <span style={{color:C.high,fontSize:18}}>+</span>
            </div>
          </div>
        ))}
      </div>);
    })}
    {!anyMatch&&<div style={{textAlign:"center",padding:"36px 20px",color:C.textMute,fontSize:13}}>No {cls.toLowerCase()} fighters match "{q}".</div>}
  </BottomSheet>);
}

export function DronesScreen({drones,setDrones,droneInfo=[],fighters,setFighters,fighterInfo=[],activeDroneDps=0,shipDroneBay=0,shipDroneBandwidth=0,shipFighter={cap:0,tubes:0,light:0,heavy:0,support:0}}){
  const[showDronePicker,setShowDronePicker]=useState(false);
  const[showFighterPicker,setShowFighterPicker]=useState(false);
  const[infoItem,setInfoItem]=useState(null);   // {typeID,name} for the shared Info/Variations sheet
  const _droneTypeRec=(d)=>{
    const tid = d.typeID ?? (d.name ? tidByName(d.name) : null);
    if(tid==null) return null;
    return TYPES[tid] ?? TYPES[String(tid)] ?? null;
  };
  const getDroneVol=(d)=>{const t=_droneTypeRec(d);return t?.attrs?.volume ?? d.volume ?? 5;};
  const getDroneBW=(d)=>{const t=_droneTypeRec(d);return t?.attrs?.droneBandwidthUsed ?? d.bandwidth ?? 5;};
  const bayUsed=drones.reduce((s,d)=>s+d.qty*getDroneVol(d),0);
  const addDrone=d=>{const ex=drones.find(e=>e.name===d.name);if(ex){setDrones(drones.map(e=>e.name===d.name?{...e,qty:e.qty+5}:e));return;}setDrones(prev=>{
      const dtid = d.typeID ?? (d.name ? tidByName(d.name) : null);
      const dta = dtid!=null ? (TYPES[dtid]?.attrs ?? TYPES[String(dtid)]?.attrs ?? null) : null;
      const bw  = dta?.droneBandwidthUsed ?? d.bandwidth ?? 5;
      const vol = dta?.volume ?? d.volume ?? 5;
      const rng = dta?.maxRange ?? d.maxRange ?? d.range ?? 0;
      const fal = dta?.falloff  ?? d.falloff  ?? 0;
      const trk = dta?.trackingSpeed ?? d.tracking ?? 0;
      const vel = dta?.maxVelocity ?? d.maxVelocity ?? d.velocity ?? 0;
      const hp_ = dta?.hp ?? d.hp ?? 0;
      return [...prev,{id:Date.now(),name:d.name,size:d.size,qty:5,active:false,range:rng,falloff:fal,tracking:trk,velocity:vel,hp:hp_,dps:d.dps??0,bandwidth:bw,volume:vol,typeID:d.typeID}];
    });}
  const addFighter=f=>{setFighters(prev=>[...prev,{id:Date.now(),name:f.name,tier:f.tier,typeID:f.typeID,role:f.role||null,qty:1,active:true,abilities:{}}]);};
  const toggleFighterActive=id=>setFighters(fighters.map(f=>f.id===id?{...f,active:f.active===false?true:false}:f));
  const toggleFighterAbility=(id,abilityKey,currentActive)=>setFighters(fighters.map(f=>
    f.id===id?{...f,abilities:{...(f.abilities||{}),[abilityKey]:!currentActive}}:f));
  const setFighterQty=(id,delta)=>setFighters(fighters.map(f=>f.id===id?{...f,qty:Math.max(1,(f.qty??1)+delta)}:f));
  const sizeColor=s=>s==="Light"?C.rig:s==="Medium"?C.accent:s==="Heavy"?C.warning:s==="Sentry"?C.high:C.textMid;
  const usesFighters = (shipFighter?.tubes ?? 0) > 0;
  const _ftrVol=(name)=>{const t=name?tidByName(name):null;const a=t!=null?(TYPES[t]?.attrs??TYPES[String(t)]?.attrs):null;return a?.volume??0;};
  const fighterBayUsed = fighters.reduce((s,f,i)=>{const sz=fighterInfo[i]?.sqSize ?? (()=>{const t=f.name?tidByName(f.name):null;return (t!=null?TYPES[t]?.attrs?.fighterSquadronMaxSize:0)??0;})();return s+(f.qty??1)*sz*_ftrVol(f.name);},0);
  const classOf=(f,i)=>fighterInfo[i]?.class ?? (()=>{const t=f.name?tidByName(f.name):null;const a=t!=null?TYPES[t]?.attrs:null;return a?.fighterSquadronIsHeavy?"Heavy":a?.fighterSquadronIsSupport?"Support":"Light";})();
  const squadTotals={Light:0,Heavy:0,Support:0}, squadActive={Light:0,Heavy:0,Support:0};
  fighters.forEach((f,i)=>{const c=classOf(f,i);const q=f.qty??1;if(squadTotals[c]!=null){squadTotals[c]+=q;if(f.active!==false)squadActive[c]+=q;}});
  const totalSquads = fighters.reduce((s,f)=>s+(f.qty??1),0);
  const activeSquads = fighters.reduce((s,f)=>s+(f.active!==false?(f.qty??1):0),0);
  const fighterDpsActive = fighterInfo.reduce((s,d)=>s+(d?.active!==false?(d?.dps||0):0),0);
  const fmtM3=v=>v>=1000?(v/1000).toFixed(1)+"k":Math.round(v);
  const CLASS_META=[{k:"Light",cap:shipFighter?.light??0,col:C.rig},{k:"Heavy",cap:shipFighter?.heavy??0,col:C.warning},{k:"Support",cap:shipFighter?.support??0,col:C.accent}];

  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    {!usesFighters ? (
    <div style={{padding:"10px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div>
        <span style={{fontSize:12,fontWeight:700,color:C.text}}>Drone Bay</span>
        <span style={{fontSize:11,color:C.textMute,marginLeft:8}}>{Math.round(bayUsed)} / {shipDroneBay} m³</span>
        <span style={{fontSize:11,color:C.textMute,marginLeft:12}}>BW:</span>
        <span style={{fontSize:11,color:C.textMute,marginLeft:4}}>{drones.filter(d=>d.active).reduce((s,d)=>s+d.qty*getDroneBW(d),0)} / {shipDroneBandwidth} Mbit/s</span>
      </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{fontSize:11,color:C.danger,fontWeight:600}}>Active DPS: {activeDroneDps>=100?Math.round(activeDroneDps):activeDroneDps.toFixed(1)}</span><button onClick={()=>setShowDronePicker(true)} style={{padding:"5px 10px",background:C.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Add</button></div>
      </div>
      <div style={{height:4,background:C.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${shipDroneBay>0?Math.min((bayUsed/shipDroneBay)*100,100):0}%`,height:"100%",background:bayUsed>shipDroneBay?C.danger:C.rig,borderRadius:99}}/></div>
    </div>
    ) : (
    <div style={{padding:"10px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span style={{fontSize:12,fontWeight:700,color:C.text}}>Fighter Bay</span>
          <span style={{fontSize:11,color:fighterBayUsed>shipFighter.cap?C.danger:C.textMute}}>{fmtM3(fighterBayUsed)} / {fmtM3(shipFighter.cap)} m³</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:11,color:C.high,fontWeight:700}}>{fighterDpsActive.toLocaleString()} DPS</span>
          <button onClick={()=>setShowFighterPicker(true)} style={{padding:"5px 10px",background:C.high+"22",border:`1px solid ${C.high}55`,borderRadius:6,color:C.high,fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Add</button>
        </div>
      </div>
      <div style={{height:4,background:C.border,borderRadius:99,overflow:"hidden",marginBottom:9}}><div style={{width:`${shipFighter.cap>0?Math.min((fighterBayUsed/shipFighter.cap)*100,100):0}%`,height:"100%",background:fighterBayUsed>shipFighter.cap?C.danger:C.high,borderRadius:99}}/></div>
      <div style={{display:"flex",gap:6}}>
        {[{label:"Tubes",used:activeSquads,cap:shipFighter.tubes,col:C.high},
          ...CLASS_META.filter(c=>c.cap>0).map(c=>({label:c.k,used:squadTotals[c.k],cap:c.cap,col:c.col}))
         ].map(chip=>{
          const over=chip.used>chip.cap, n=Math.max(chip.cap,chip.used,1);
          return(<div key={chip.label} style={{flex:1,minWidth:0,background:C.surface,border:`1px solid ${over?C.danger:C.border}`,borderRadius:8,padding:"6px 8px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
              <span style={{fontSize:8.5,fontWeight:800,letterSpacing:0.4,color:chip.col,textTransform:"uppercase"}}>{chip.label}</span>
              <span style={{fontSize:10,fontWeight:700,color:over?C.danger:C.text}}>{chip.used}/{chip.cap}</span>
            </div>
            <div style={{display:"flex",gap:2}}>
              {Array.from({length:n}).map((_,i)=>(<div key={i} style={{flex:1,height:4,borderRadius:2,background:i<chip.used?(i>=chip.cap?C.danger:chip.col):C.borderStrong}}/>))}
            </div>
          </div>);
        })}
      </div>
    </div>
    )}
    <div style={{flex:1,overflowY:"auto"}}>
      {!usesFighters&&(<>
      <div style={{display:"grid",gridTemplateColumns:"36px 1fr 60px 50px 50px 50px",gap:4,padding:"5px 12px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
        {["","Name","Range","Track","Speed","EHP"].map((h,i)=><span key={i} style={{fontSize:9,fontWeight:700,color:C.textMute,textAlign:i>1?"center":"left"}}>{h}</span>)}
      </div>
      {drones.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:13}}>No drones - tap + Add</div>}
      <div style={{padding:"8px 10px"}}>
        {drones.map(drone=>(<div key={drone.id} style={{background:C.surface,border:`1px solid ${drone.active?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"36px 1fr 60px 50px 50px 50px",gap:4,padding:"10px 12px",alignItems:"center"}}>
            <button onClick={()=>setDrones(drones.map(d=>d.id===drone.id?{...d,active:!d.active}:d))} style={{width:24,height:24,borderRadius:5,background:drone.active?C.accentLight:"none",border:`1px solid ${drone.active?C.accentBorder:C.borderStrong}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,lineHeight:1,color:drone.active?C.accent:""}}>{drone.active?"✓":""}</button>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              {drone.typeID&&<img className="eve-icon" src={eveIcon(drone.typeID,32)} width={24} height={24} alt="" onError={e=>{e.target.style.display="none";}}/>}
              <div style={{cursor:"pointer"}} onClick={()=>setInfoItem({typeID:drone.typeID??tidByName(drone.name),name:drone.name})}><div style={{fontSize:12,fontWeight:600,color:drone.active?C.text:C.textMid,lineHeight:1.2,wordBreak:"break-word"}}>{drone.name}</div><span style={{fontSize:9,color:sizeColor(drone.size),fontWeight:700}}>{drone.size}</span></div>
            </div>
            {(()=>{
              const info=droneInfo.find(x=>x.name===drone.name)??{};
              const r=info.optimal??0, f=info.falloff??0, trk=info.trackingNorm??0,
                    v=info.velocity??0, ehp=info.ehp??0;
              const kfmt=n=>n>=1000?`${(n/1000).toFixed(2).replace(/0$/,"")}k`:n.toFixed(2);
              const cells=[
                r>0?`${(r/1000).toFixed(2)}${f>0?`+${(f/1000).toFixed(2)}`:""} km`:"-",
                trk>0?kfmt(trk):"-",
                v>0?`${Math.round(v)} m/s`:"-",
                ehp>0?Math.round(ehp).toLocaleString():"-",
              ];
              return cells.map((val,i)=><span key={i} style={{fontSize:10,color:C.textMid,textAlign:"center"}}>{val}</span>);
            })()}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px 8px",borderTop:`1px solid ${C.border}`}}>
            <span style={{fontSize:10,color:C.textMute}}>Qty:</span>
            <button onClick={()=>setDrones(drones.map(d=>d.id===drone.id?{...d,qty:Math.max(0,d.qty-1)}:d))} style={{width:22,height:22,borderRadius:5,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>-</button>
            <span style={{fontSize:12,fontWeight:700,color:C.text,minWidth:24,textAlign:"center"}}>{drone.qty}</span>
            <button onClick={()=>setDrones(drones.map(d=>d.id===drone.id?{...d,qty:d.qty+1}:d))} style={{width:22,height:22,borderRadius:5,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
            {drone.active&&<span style={{fontSize:10,color:C.accent,marginLeft:4}}>Active</span>}
            <button onClick={()=>setDrones(drones.filter(d=>d.id!==drone.id))} style={{marginLeft:"auto",background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:13}}>x</button>
          </div>
        </div>))}
      </div>
      </>)}
      {usesFighters&&(<div style={{padding:"10px 10px 4px"}}>
        {fighters.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"40px 0",fontSize:13}}>No fighter squadrons — tap + Add</div>}
        {fighters.map((f,i)=>{
          const info=fighterInfo[i]||{};
          const abils=info.abilities||[];
          const isActive=f.active!==false;
          const kindColor=k=>k==="damage"?C.high:k==="speed"?C.accent:k==="tackle"?C.warning:C.textMid;
          return(<div key={f.id} style={{background:C.surface,border:`1px solid ${isActive?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8,padding:"10px 12px",opacity:isActive?1:0.55}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:9,flex:1}}>
                <button onClick={()=>toggleFighterActive(f.id)} title={isActive?"Active squadron (in space)":"Inactive (in tube)"}
                  style={{width:24,height:24,borderRadius:5,flexShrink:0,background:isActive?C.accentLight:"none",border:`1px solid ${isActive?C.accentBorder:C.borderStrong}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,lineHeight:1,color:isActive?C.accent:""}}>{isActive?"✓":""}</button>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600,color:C.text}}>{f.name} <span style={{fontSize:10,color:C.textMute,fontWeight:400}}>{info.class||f.tier}</span></div>
                  <div style={{display:"flex",gap:12,marginTop:3,fontSize:10,color:C.textMid,flexWrap:"wrap"}}>
                    <span>DPS <b style={{color:info.dps?C.high:C.textMute}}>{info.dps??0}</b></span>
                    <span>Speed <b style={{color:C.text}}>{info.speedActive??info.speed??0}</b>{info.burstFrom?<span style={{color:C.accent}}> m/s ({info.burstFrom})</span>:<span style={{color:C.textMute}}> m/s</span>}</span>
                    <span>EHP <b style={{color:C.text}}>{info.ehp?(info.ehp>=1000?(info.ehp/1000).toFixed(1)+"k":info.ehp):0}</b></span>
                    <span>Sqd <b style={{color:C.text}}>{info.sqSize||6}</b></span>
                  </div>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <button onClick={()=>setFighterQty(f.id,-1)} style={{width:22,height:22,borderRadius:5,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,cursor:"pointer",fontSize:13}}>-</button>
                <span style={{fontSize:11,color:C.text,minWidth:38,textAlign:"center"}}>×{f.qty??1} sq</span>
                <button onClick={()=>setFighterQty(f.id,1)} style={{width:22,height:22,borderRadius:5,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,cursor:"pointer",fontSize:13}}>+</button>
                <button onClick={()=>setFighters(fighters.filter(x=>x.id!==f.id))} style={{marginLeft:4,background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14}}>×</button>
              </div>
            </div>
            {abils.length>0&&<div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap",paddingLeft:33}}>
              {abils.map(ab=>{
                const col=kindColor(ab.kind);
                return(<button key={ab.key} onClick={()=>toggleFighterAbility(f.id,ab.key,ab.active)}
                  style={{display:"flex",alignItems:"center",gap:4,padding:"4px 9px",borderRadius:6,cursor:"pointer",fontSize:10,fontWeight:600,
                    background:ab.active?col+"22":"transparent",border:`1px solid ${ab.active?col+"88":C.borderStrong}`,color:ab.active?col:C.textMute}}>
                  {ab.label}{ab.kind==="damage"&&ab.active&&ab.dps?<span style={{opacity:0.8}}>· {ab.dps}</span>:null}
                </button>);
              })}
            </div>}
          </div>);
        })}
      </div>)}
    </div>
    {showDronePicker&&<DroneBrowserSheet existingDrones={drones} onAdd={addDrone} onClose={()=>setShowDronePicker(false)}/>}
    {showFighterPicker&&<FighterBrowserSheet onAdd={addFighter} onClose={()=>setShowFighterPicker(false)}/>}
    {infoItem&&<ItemDetailSheet typeID={infoItem.typeID} name={infoItem.name} onClose={()=>setInfoItem(null)}/>}
  </div>);
}
