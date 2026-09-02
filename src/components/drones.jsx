import { useState } from "react";
import { C } from "../theme.js";
import { eveIcon } from "../lib/icons.js";
import { BottomSheet, AccordionSection, DroneMenu, SheetSearchBar } from "./ui.jsx";
import { REAL_DRONE_BROWSER, FIGHTER_CATALOG, droneAddQty } from "../lib/core.js";
import { TYPES, tidByName } from "../calc.js";
import { SkillMark } from "./skill-mark.jsx";
import { abyssalGrade, mutaplasmidName } from "../lib/eft-export.js";

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
          <SkillMark typeID={d.typeID}/>
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

  return(<BottomSheet title="Add Drone" onClose={onClose} height="88vh" fillHeight>
    {/* Search stays at the TOP here, unlike the module browser's footer bar: this sheet closes on
        the first pick, so there is no "keep searching with the keyboard up" flow for a footer to
        serve. Only the multi-add browsers (modules, cargo) put it above the keyboard. */}
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <SheetSearchBar value={search} onChange={setSearch} placeholder="Search drones..."/>
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
  return(<BottomSheet title="Add Fighter" onClose={onClose} height="82vh" fillHeight>
    <div style={{display:"flex",gap:6,padding:"10px 12px 8px"}}>
      {["Light","Heavy","Support"].map(c=>(
        <button key={c} onClick={()=>setCls(c)} style={{flex:1,padding:"8px 0",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
          background:cls===c?classColor[c]+"22":"transparent",border:`1px solid ${cls===c?classColor[c]:C.border}`,color:cls===c?classColor[c]:C.textMid}}>{c}</button>
      ))}
    </div>
    <div style={{padding:"0 12px 8px"}}>
      <SheetSearchBar value={q} onChange={setQ} placeholder={`Search ${cls.toLowerCase()} fighters…`}/>
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
              <SkillMark typeID={f.typeID}/>
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

export function DronesScreen({drones,setDrones,droneInfo=[],fittedDrones=null,fighters,setFighters,fighterInfo=[],maxActiveDrones=5,shipDroneBay=0,shipDroneBandwidth=0,shipFighter={cap:0,tubes:0,light:0,heavy:0,support:0}}){
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
  // Bandwidth counts only ACTIVE drones — the bay holds spares, the bandwidth flies them.
  const bwUsed=drones.filter(d=>d.active).reduce((s,d)=>s+d.qty*getDroneBW(d),0);
  // Bandwidth is not the drone limit, and on most drone boats it is the looser of the two: a Vexor's
  // 75 Mbit flies seven mediums, the game flies five. Counted across every flying stack, because the
  // limit is on drones in space and not on any one stack.
  const activeCount=drones.filter(d=>d.active).reduce((s,d)=>s+d.qty,0);
  const droneSlotsFree=maxActiveDrones-activeCount;
  const addDrone=d=>{
    const bayFree=shipDroneBay-bayUsed, bwFree=shipDroneBandwidth-bwUsed;
    // An abyssal roll is its own item, never merged with a plain stack of the same name — pyfa
    // never stacks a mutated drone with an unmutated one either.
    const ex=drones.find(e=>e.name===d.name && !e.mutaplasmid);
    // Topping up a stack already in the bay: the bay always caps it, but bandwidth only does if that
    // stack is flying — spares cost none. Its active state is the user's and is left alone.
    if(ex){
      const{qty}=droneAddQty({bandwidth:getDroneBW(ex),volume:getDroneVol(ex),
                              bwFree:ex.active?bwFree:Infinity,bayFree,
                              max:ex.active?Math.max(1,droneSlotsFree):maxActiveDrones});
      setDrones(drones.map(e=>e===ex?{...e,qty:e.qty+qty}:e));return;
    }
    setDrones(prev=>{
      const dtid = d.typeID ?? (d.name ? tidByName(d.name) : null);
      const dta = dtid!=null ? (TYPES[dtid]?.attrs ?? TYPES[String(dtid)]?.attrs ?? null) : null;
      const bw  = dta?.droneBandwidthUsed ?? d.bandwidth ?? 5;
      const vol = dta?.volume ?? d.volume ?? 5;
      const rng = dta?.maxRange ?? d.maxRange ?? d.range ?? 0;
      const fal = dta?.falloff  ?? d.falloff  ?? 0;
      const trk = dta?.trackingSpeed ?? d.tracking ?? 0;
      const vel = dta?.maxVelocity ?? d.maxVelocity ?? d.velocity ?? 0;
      const hp_ = dta?.hp ?? d.hp ?? 0;
      const{qty,active}=droneAddQty({bandwidth:bw,volume:vol,bwFree,bayFree,max:Math.max(1,droneSlotsFree)});
      // Launched only if it fits under BOTH limits. Added while already flying a full set, the stack
      // goes to the bay rather than silently putting the fit over — the bay is where spares live and
      // carrying them is legal, so there is nothing to warn about.
      return [...prev,{id:Date.now(),name:d.name,size:d.size,qty,active:active&&qty<=droneSlotsFree,range:rng,falloff:fal,tracking:trk,velocity:vel,hp:hp_,dps:d.dps??0,bandwidth:bw,volume:vol,typeID:d.typeID}];
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
        {/* These two are what you check on every change here, and they were 11px at textMute —
            about 2.4:1 on this surface, below any sensible floor for small text. Used value at full
            text colour and 12px, the ship's total one step back at textMid AND 10px rather than
            vanishing, and tabular-nums so digits don't jitter as drones are added. The size step
            matches the fitting strip: the capacity is a fixed property of the hull, so it is context
            for the figure that moves and should not compete with it. The "BW:" label is gone:
            "Mbit/s" already identifies it, and the label was competing with the number for
            attention. Both turn red when over, which is the only state worth interrupting for. */}
        <span style={{fontSize:12,marginLeft:8,fontVariantNumeric:"tabular-nums"}}>
          <span style={{fontWeight:700,color:bayUsed>shipDroneBay?C.danger:C.text}}>{Math.round(bayUsed)}</span>
          <span style={{fontSize:10,color:C.textMid}}>/{shipDroneBay} m³</span>
        </span>
        <span style={{fontSize:12,marginLeft:12,fontVariantNumeric:"tabular-nums"}}>
          <span style={{fontWeight:700,color:bwUsed>shipDroneBandwidth?C.danger:C.text}}>{bwUsed}</span>
          <span style={{fontSize:10,color:C.textMid}}>/{shipDroneBandwidth} Mbit/s</span>
        </span>
      </div>
        {/* Drone DPS used to sit here, and it was the one number on this screen you could not act on
            — it is already on the stats panel, and it cost a whole second calcFitStats pass to put a
            duplicate in the corner. What you cannot see anywhere else is how many drones are in
            space, because bandwidth does not answer it and nothing else on this screen counts them.
            Red is a real warning: over the limit the fit cannot be flown as drawn. */}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:11,fontWeight:600,fontVariantNumeric:"tabular-nums",
                        color:activeCount>maxActiveDrones?C.danger:C.textMid}}>
            Active: <span style={{fontSize:12,color:activeCount>maxActiveDrones?C.danger:C.text,fontWeight:700}}>{activeCount}</span><span style={{fontSize:10}}>/{maxActiveDrones}</span>
          </span>
          <button onClick={()=>setShowDronePicker(true)} style={{padding:"5px 10px",background:C.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Add</button></div>
      </div>
      <div style={{height:4,background:C.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${shipDroneBay>0?Math.min((bayUsed/shipDroneBay)*100,100):0}%`,height:"100%",background:bayUsed>shipDroneBay?C.danger:C.rig,borderRadius:99}}/></div>
    </div>
    ) : (
    <div style={{padding:"10px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span style={{fontSize:12,fontWeight:700,color:C.text}}>Fighter Bay</span>
          {/* Same treatment as the drone bay readout above — see the contrast note there. */}
          <span style={{fontSize:12,fontVariantNumeric:"tabular-nums"}}>
            <span style={{fontWeight:700,color:fighterBayUsed>shipFighter.cap?C.danger:C.text}}>{fmtM3(fighterBayUsed)}</span>
            <span style={{fontSize:10,color:C.textMid}}>/{fmtM3(shipFighter.cap)} m³</span>
          </span>
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
      <div style={{display:"grid",gridTemplateColumns:"36px 1fr 60px 50px 50px 50px",gap:4,padding:"5px 23px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
        {["","Name","Range","Track","Speed","EHP"].map((h,i)=><span key={i} style={{fontSize:9,fontWeight:700,color:C.textMute,textAlign:i>1?"center":"left"}}>{h}</span>)}
      </div>
      {drones.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:13}}>No drones - tap + Add</div>}
      <div style={{padding:"8px 10px"}}>
        {drones.map(drone=>(<div key={drone.id} style={{background:C.surface,border:`1px solid ${drone.active?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8,overflow:"hidden"}}>
          <div style={{cursor:"pointer"}} onClick={()=>setInfoItem({typeID:drone.typeID??tidByName(drone.name),name:drone.name,droneId:drone.id})}>
            <div style={{display:"grid",gridTemplateColumns:"36px 1fr 60px 50px 50px 50px",gap:4,padding:`10px 12px ${drone.mutaplasmid?4:10}px`,alignItems:"center"}}>
              <button onClick={(e)=>{e.stopPropagation();setDrones(drones.map(d=>d.id===drone.id?{...d,active:!d.active}:d));}} style={{width:24,height:24,borderRadius:5,background:drone.active?C.accentLight:"none",border:`1px solid ${drone.active?C.accentBorder:C.borderStrong}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,lineHeight:1,color:drone.active?C.accent:""}}>{drone.active?"✓":""}</button>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                {drone.typeID&&<img className="eve-icon" src={eveIcon(drone.typeID,32)} width={24} height={24} alt="" onError={e=>{e.target.style.display="none";}}/>}
                <div><div style={{fontSize:12,fontWeight:600,color:drone.active?C.text:C.textMid,lineHeight:1.2,wordBreak:"break-word"}}>{drone.name}</div>
                  <span style={{fontSize:9,color:sizeColor(drone.size),fontWeight:700}}>{drone.size}</span>
                </div>
              </div>
              {(()=>{
                // Matched by row id, not name: an abyssal roll and a plain drone of the same base
                // type are now two separate rows (never merged), and matching by name alone would
                // let one row's stats leak onto the other.
                const info=(drone.id!=null?droneInfo.find(x=>x.id===drone.id):null)
                  ??droneInfo.find(x=>x.name===drone.name)??{};
                const r=info.optimal??0, f=info.falloff??0, trk=info.trackingNorm??0,
                      v=info.velocity??0, ehp=info.ehp??0;
                const kfmt=n=>n>=1000?`${(n/1000).toFixed(2).replace(/0$/,"")}k`:n.toFixed(2);
                const trimZeros=n=>parseFloat(n.toFixed(2));
                const cells=[
                  r>0?`${trimZeros(r/1000)}${f>0?`+${trimZeros(f/1000)}`:""} km`:"-",
                  trk>0?kfmt(trk):"-",
                  v>0?`${Math.round(v)} m/s`:"-",
                  ehp>0?Math.round(ehp).toLocaleString():"-",
                ];
                return cells.map((val,i)=><span key={i} style={{fontSize:10,color:C.textMid,textAlign:"center",lineHeight:1.2}}>{val}</span>);
              })()}
            </div>
            {drone.mutaplasmid&&(
              <div style={{display:"grid",gridTemplateColumns:"36px 1fr 60px 50px 50px 50px",gap:4,padding:"0 12px 8px"}}>
                <span/>
                <span title={mutaplasmidName(drone.mutaplasmid)} style={{justifySelf:"start",fontSize:9,lineHeight:1,fontWeight:800,letterSpacing:.3,textTransform:"uppercase",color:C.danger,background:`${C.danger}22`,border:`1px solid ${C.danger}`,borderRadius:4,padding:"2px 5px",display:"inline-flex",alignItems:"center",gap:3}}>▲ {abyssalGrade(drone.mutaplasmid)}</span>
              </div>
            )}
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
    {/* Keyed by the drone ROW's id, not its name: two rows can hold the same drone type, and the
        engine tracks them separately. Mirrors ModuleMenu's updateMod — a partial object merged
        into the row by id, so the Mutate tab's per-keystroke updates don't need the whole row. */}
    {infoItem&&(()=>{
      const drone=drones.find(d=>d.id===infoItem.droneId);
      if(!drone)return null;
      const updateDrone=(updated,keepOpen=false)=>{
        setDrones(ds=>ds.map(d=>d.id===infoItem.droneId?{...d,...updated}:d));
        if(!keepOpen)setInfoItem(null);
      };
      return <DroneMenu drone={drone} onClose={()=>setInfoItem(null)}
        onUpdateDrone={u=>updateDrone(u)} onUpdateDroneLive={u=>updateDrone(u,true)}
        engineItem={fittedDrones?.get(infoItem.droneId)}/>;
    })()}
  </div>);
}
