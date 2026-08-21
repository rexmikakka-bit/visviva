import { useState, useMemo } from "react";
import { C } from "../theme.js";
import { eveIcon } from "../lib/icons.js";
import { ItemDetailSheet, BottomSheet, InfoButton } from "./ui.jsx";
import { haptic, implantSetMembers, applyImplantSet, implantData, searchImplants } from "../lib/core.js";
// An implant restored from a saved fit or an EFT paste carries only a NAME — the picker is the only
// path that records a typeID — so the detail sheet has to resolve one or it opens on "no data".
import { tidByName } from "../calc.js";
import { SkillMark } from "./skill-mark.jsx";

// "Deadeye (Missile Bombardment)" -> "Missile Bombardment". The leading word is the hardwiring's
// brand nickname (Deadeye, Snapshot, Squire, ...), which tells you nothing about what the implant
// does; the skill in the parentheses is the entire point. Only rewritten when the whole group name
// is <SingleWord> (<something>), so set names like "Amulet" and item-named groups are untouched.
// Hardwirings arrive as one group PER SKILL — 96 of them, so "where do I find the missile implant"
// meant scrolling a wall of near-identical names. They are rolled into the broad areas people
// actually think in. Only the "<Nickname> (<Skill>)" groups are touched; implant SETS (Amulet,
// Snake, ...) and the attribute boosters already have good category names and are left alone.
const HARDWIRING_BUCKETS=[
  ["Missiles",["Cruise Missiles","Defender Missiles","Guided Missile Precision","Heavy Assault Missiles",
    "Heavy Missiles","Launcher CPU Efficiency","Light Missiles","Missile Bombardment","Missile Projection",
    "Rapid Launch","Rockets","Torpedoes","Auto-Targeting Explosion Radius"]],
  ["Turrets",["Controlled Bursts","Gunnery","Motion Prediction","Sharpshooter","Surgical Strike",
    "Trajectory Analysis","Weapon Upgrades","Energy Pulse Weapons","Target Navigation Prediction",
    "Small Energy Turret","Medium Energy Turret","Large Energy Turret",
    "Small Hybrid Turret","Medium Hybrid Turret","Large Hybrid Turret",
    "Small Projectile Turret","Medium Projectile Turret","Large Projectile Turret"]],
  ["Shields",["Shield Emission Systems","Shield Management","Shield Operation","Shield Upgrades"]],
  ["Armor & Hull",["Hull Upgrades","Mechanic","Remote Armor Repair Systems","Repair Proficiency","Repair Systems"]],
  ["Capacitor & Engineering",["CPU Management","Capacitor Emission Systems","Capacitor Management",
    "Capacitor Systems Operation","Energy Grid Upgrades","Power Grid Management","Electronics Upgrades"]],
  ["Navigation",["Acceleration Control","Afterburner","Evasive Maneuvering","Fuel Conservation",
    "High Speed Maneuvering","Navigation","Warp Drive Operation","Warp Drive Speed"]],
  ["Targeting & EWAR",["Electronic Warfare","Long Range Targeting","Propulsion Jamming","Sensor Linking",
    "Signature Analysis","Stasis Webifier","Target Painting","Weapon Disruption"]],
  ["Drones",["Drone Durability","Drone Navigation","Drone Sharpshooting","Drone Tuner","Repair Drone Operation"]],
  ["Scanning & Exploration",["Archaeology","Astrometric Acquisition","Astrometric Pinpointing",
    "Astrometric Rangefinding","Hacking","Environmental Analysis","Salvaging"]],
  ["Industry & Science",["Biology","Gas Harvesting","Ice Harvesting","Industry","Metallurgy","Mining",
    "Mining Upgrades","Reprocessing","Research","Science","Neurotoxin Control","Neurotoxin Recovery",
    "Implant","Entanglement Optimizer"]],
];
const HARDWIRING_BUCKET_OF=(()=>{const m=new Map();
  for(const [bucket,skills] of HARDWIRING_BUCKETS)for(const sk of skills)m.set(sk,bucket);
  return m;})();
const HARDWIRING_BUCKET_ORDER=HARDWIRING_BUCKETS.map(([b])=>b).concat(["Other Hardwirings"]);

const IMPLANT_GROUP_NICKNAME=/^[A-Z][A-Za-z'-]*\s*\((.+)\)$/;
const implantGroupLabel=n=>IMPLANT_GROUP_NICKNAME.exec(String(n??""))?.[1]??n;

// One implant, as a tappable row. Shared by the per-slot picker and the cross-slot search, which
// want the same affordances (art, skill mark, fit-the-whole-set) and differ only in whether the slot
// is already known — hence `badge`, which the search fills in and the picker leaves off.
function ImplantRow({item,fitted,badge,onPick,onPickSet,onInfo}){
  // Set implants get a second action: fit the whole set at once. Six slots for one intent.
  const set=implantSetMembers(item.name);
  const sub=[badge,item.metaGroupID>0?`Meta ${item.metaLevel??0}`:null].filter(Boolean);
  return(
  <div onClick={()=>{haptic();onPick(item);}}
    style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"12px 16px",
            borderBottom:`1px solid ${C.border}`,cursor:"pointer",
            background:fitted?C.accentLight:"transparent"}}>
    {/* Item art, same as the module and booster browsers. Hidden on failure so the rare implant
        with no bundled icon leaves a gap rather than a broken-image box. */}
    <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
      {item.typeID&&<img className="eve-icon" src={eveIcon(item.typeID,32)} width={28} height={28} alt=""
        style={{borderRadius:5,flexShrink:0}} onError={e=>{e.target.style.visibility="hidden";}}/>}
      <div style={{minWidth:0}}>
      <div style={{fontSize:13,fontWeight:600,color:fitted?C.accent:C.text}}>{item.name}</div>
      {sub.length>0&&<div style={{fontSize:10,color:C.textMute,marginTop:1}}>{sub.join(" · ")}</div>}
      </div>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
      <SkillMark typeID={item.typeID}/>
      {set&&<button onClick={e=>{e.stopPropagation();haptic();onPickSet(set);}}
        title={`Fit all ${set.members.length} ${set.setName} implants`}
        style={{padding:"4px 9px",borderRadius:99,fontSize:10,fontWeight:700,cursor:"pointer",
                background:C.accentLight,border:`1px solid ${C.accentBorder}`,color:C.accent}}>+ Set</button>}
      {/* Reading an implant's description used to require FITTING it first — the row's only action
          was to fit, and the trailing "+" said so without offering anything else. It is replaced
          rather than joined by the info button because the row itself is still the fit affordance,
          so the "+" was never doing any work the tap target wasn't already doing. The ✓ stays: it
          is state, not an action, and it is the only thing marking what you already have. */}
      {fitted&&<span style={{color:C.accent}}>✓</span>}
      {item.typeID&&<InfoButton onClick={e=>{e.stopPropagation();haptic();onInfo(item);}} title={`About ${item.name}`}/>}
    </div>
  </div>);
}

function ImplantPicker({slot,current,onSelect,onSelectSet,onClear,onClose}){
  const[search,setSearch]=useState("");
  const[drill,setDrill]=useState(null);
  const[infoItem,setInfoItem]=useState(null);   // {typeID,name} for the shared Info/Variations sheet

  const slotData=implantData?.[String(slot)];
  const rawGroups=slotData?.groups??{};
  // Hardwiring skill groups collapse into their bucket; everything else passes through untouched.
  const groups=useMemo(()=>{
    const out={};
    for(const [name,items] of Object.entries(rawGroups)){
      const skill=IMPLANT_GROUP_NICKNAME.exec(name)?.[1];
      const key=skill?(HARDWIRING_BUCKET_OF.get(skill)??"Other Hardwirings"):name;
      (out[key]??=[]).push(...items);
    }
    for(const list of Object.values(out))list.sort((x,y)=>x.name.localeCompare(y.name));
    return out;
  },[rawGroups]);
  // Buckets first, in the order declared above; the pass-through groups stay alphabetical after.
  const groupNames=useMemo(()=>Object.keys(groups).sort((a,b)=>{
    const ia=HARDWIRING_BUCKET_ORDER.indexOf(a),ib=HARDWIRING_BUCKET_ORDER.indexOf(b);
    if(ia>=0&&ib>=0)return ia-ib;
    if(ia>=0)return -1;
    if(ib>=0)return 1;
    return a.localeCompare(b);
  }),[groups]);
  const drillItems=drill?groups[drill]??[]:[];

  const allItems=Object.values(groups).flat();
  const results=search.trim().length>1
    ? allItems.filter(i=>i.name.toLowerCase().includes(search.toLowerCase()))
    : null;

  const fit=it=>{onSelect({name:it.name,typeID:it.typeID,slot,bonus:""});onClose();};
  const ItemRow=({item})=><ImplantRow item={item} fitted={current===item.name}
    onPick={fit} onPickSet={set=>{onSelectSet(set);onClose();}} onInfo={setInfoItem}/>;

  // ONE sheet for both levels, with an in-content Back bar — the same shape as the module browser.
  // Rendering a second <BottomSheet> for the drilled level put a different element at the same tree
  // position, so React reused the instance and its half-finished `closing` state: after backing out
  // of a group the sheet stayed translated off-screen while its full-screen overlay kept eating every
  // tap, which reads as the whole app freezing.
  return(<>
    <BottomSheet title={drill?`Slot ${slot} › ${implantGroupLabel(drill)}`:`Slot ${slot} Implants`} onClose={onClose} height="82vh">
    {drill&&(
      <div style={{position:"sticky",top:0,zIndex:3,display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={()=>{haptic();setDrill(null);}} style={{background:"none",border:"none",color:C.accent,fontSize:14,fontWeight:700,cursor:"pointer",padding:0}}>&#8249; Back</button>
        <span style={{fontSize:12,color:C.textMute,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{implantGroupLabel(drill)}</span>
      </div>
    )}
    {drill
      ? drillItems.map(item=><ItemRow key={item.typeID} item={item}/>)
      : <>
    {current&&current!=="[Empty]"&&(
      <div style={{padding:"10px 14px 0"}}>
        <div style={{padding:"9px 12px",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,marginBottom:4}}>
          <div style={{fontSize:10,color:C.textMute}}>Fitted</div>
          <div style={{fontSize:12,fontWeight:600,color:C.accent}}>{current}</div>
        </div>
        <button onClick={()=>{onClear();onClose();}} style={{width:"100%",padding:"8px 0",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:C.danger,fontSize:12,fontWeight:700,cursor:"pointer",marginBottom:8}}>Remove implant</button>
      </div>
    )}
    <div style={{padding:"10px 14px 4px"}}>
      <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search implants..."
        style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",color:C.text,fontSize:13,boxSizing:"border-box"}}/>
    </div>
    {results
      ? results.map(item=><ItemRow key={item.typeID} item={item}/>)
      : groupNames.map(gn=>(
          <div key={gn} onClick={()=>setDrill(gn)}
            style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
            <div style={{fontSize:13,color:C.text}}>{implantGroupLabel(gn)}</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:C.textMute}}>{groups[gn]?.length??0}</span>
              <span style={{color:C.textMute}}>›</span>
            </div>
          </div>
        ))
    }
      </>}
    </BottomSheet>
    {/* A SIBLING of the browser, not a child — the same shape the module browser uses. Nesting it
        would put a second sheet inside the one being scrolled, and the browser stays mounted
        underneath so closing the info card returns you to where you were in the list. */}
    {infoItem&&<ItemDetailSheet typeID={infoItem.typeID} name={infoItem.name}
      actions={[{label:"Fit implant",primary:true,onClick:()=>fit(infoItem)}]}
      onSwap={v=>fit(v)} onClose={()=>setInfoItem(null)}/>}
  </>);
}

// Searchable loadout list. Replaces a horizontal chip strip that grew a scroll bar the moment you
// had more than a few — and put rename and (mislabelled) delete buttons beside every single one.
function ImplantLoadoutSheet({loadouts,onLoad,onRename,onDelete,onClose}){
  const[q,setQ]=useState("");
  const[editing,setEditing]=useState(null);
  const[draft,setDraft]=useState("");
  const term=q.trim().toLowerCase();
  const shown=term?loadouts.filter(l=>l.name.toLowerCase().includes(term)):loadouts;
  return(<BottomSheet title="Implant Loadouts" onClose={onClose} height="70vh">
    {loadouts.length>6&&<div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px"}}>
        <span style={{fontSize:14,color:C.textMute}}>&#128269;</span>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search"
          value={q} onChange={e=>setQ(e.target.value)} placeholder="Search loadouts..."
          style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13,outline:"none"}}/>
      </div>
    </div>}
    {!shown.length&&<div style={{textAlign:"center",color:C.textMute,padding:"28px 0",fontSize:13}}>No loadouts match "{q}"</div>}
    {shown.map(l=>(
      <div key={l.id} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderBottom:`1px solid ${C.border}`}}>
        {editing===l.id
          ?<input autoFocus value={draft} onChange={e=>setDraft(e.target.value)}
             onKeyDown={e=>{if(e.key==="Enter"){onRename(l.id,draft);setEditing(null);}if(e.key==="Escape")setEditing(null);}}
             onBlur={()=>{onRename(l.id,draft);setEditing(null);}}
             style={{flex:1,padding:"5px 9px",background:C.surface,border:`1px solid ${C.accentBorder}`,borderRadius:6,color:C.text,fontSize:12}}/>
          :<div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>{onLoad(l);onClose();}}>
             <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.name}</div>
             <div style={{fontSize:10,color:C.textMute,marginTop:2}}>{l.implants?.filter(i=>i.name!=="[Empty]").length??0} implants</div>
           </div>}
        <button title="Rename" onClick={()=>{setEditing(l.id);setDraft(l.name);}}
          style={{width:26,height:26,borderRadius:5,background:"none",border:`1px solid ${C.border}`,cursor:"pointer",fontSize:11,color:C.textMute,flexShrink:0}}>&#9998;</button>
        <button title="Delete this loadout" onClick={()=>onDelete(l.id)}
          style={{width:26,height:26,borderRadius:5,background:"none",border:`1px solid ${C.border}`,cursor:"pointer",fontSize:12,color:C.danger,flexShrink:0}}>x</button>
      </div>
    ))}
  </BottomSheet>);
}

export function ImplantsScreen({implants,setImplants,loadouts,setLoadouts}){
  const[picker,setPicker]=useState(null);
  const[detail,setDetail]=useState(null);
  const[savingName,setSavingName]=useState(false);
  const[newLoadoutName,setNewLoadoutName]=useState("");
  const[showLoadouts,setShowLoadouts]=useState(false);
  const[query,setQuery]=useState("");
  const filled=implants.filter(i=>i.name!=="[Empty]").length;
  // Cross-slot search. The per-slot picker can only ever answer "which Amulet goes HERE", but the
  // question a player usually arrives with is the reverse — they know the implant and not the slot,
  // and answering it meant opening slots one at a time until one of them had the thing. Results
  // carry their own slot and fit straight into it, so the slot never has to be guessed at all.
  const results=useMemo(()=>searchImplants(query),[query]);
  // Fitting from the search CLEARS the query, which is what puts the slot list back. Here the query
  // IS the browser — the results replace the list rather than sitting above it (see the note further
  // down) — so leaving it in place after a pick left you on the same rows, with the implant you just
  // fitted nowhere on screen and no way out but emptying the box by hand. Everything else in the app
  // dismisses on pick: ImplantPicker's own `fit` calls onClose, the loadout row does onLoad+onClose,
  // and ItemDetailSheet closes itself after any action. This is the same gesture.
  const dismissSearch=()=>setQuery("");
  const fitInto=item=>{setImplants(prev=>prev.map(i=>i.slot===item.slot?{...i,name:item.name,bonus:null}:i));dismissSearch();};
  // ONE update for the whole set: six separate writes would each recalculate the fit, five of them
  // against a half-fitted set. The mapping itself lives in core.js so it can be tested.
  const fitSet=set=>{setImplants(prev=>applyImplantSet(prev,set));dismissSearch();};

  function saveLoadout(){
    if(!newLoadoutName.trim())return;
    setLoadouts(prev=>[...prev,{id:Date.now(),name:newLoadoutName.trim(),implants:[...implants]}]);
    setNewLoadoutName("");setSavingName(false);
  }
  function loadLoadout(lo){
    if(!lo.implants?.length){alert(`"${lo.name}" has no implants saved.`);return;}
    setImplants(lo.implants.map(i=>({...i})));
  }
  function renameLoadout(id,name){
    const n=(name??"").trim();
    setLoadouts(prev=>prev.map(l=>l.id===id?{...l,name:n||l.name}:l));
  }
  function deleteLoadout(id){ setLoadouts(prev=>prev.filter(l=>l.id!==id)); }

  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{padding:"10px 12px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:11,fontWeight:700,color:C.textMute,letterSpacing:.6,textTransform:"uppercase"}}>{filled}/10 fitted</span>
        {savingName
          ?<div style={{display:"flex",alignItems:"center",gap:6}}>
            <input autoFocus value={newLoadoutName} onChange={e=>setNewLoadoutName(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")saveLoadout();if(e.key==="Escape")setSavingName(false);}}
              placeholder="Loadout name..." style={{width:130,padding:"4px 8px",background:C.surface,border:`1px solid ${C.accentBorder}`,borderRadius:6,color:C.text,fontSize:11}}/>
            <button onClick={saveLoadout} style={{padding:"4px 10px",background:C.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,cursor:"pointer"}}>Save</button>
            <button onClick={()=>setSavingName(false)} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:18,padding:0}}>x</button>
          </div>
          :<button onClick={()=>setSavingName(true)} style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer",background:C.accentLight,border:`1px solid ${C.accentBorder}`,color:C.accent}}>+ Save Loadout</button>
        }
      </div>
      {/* Was a horizontal chip strip: three buttons per loadout, scrolling sideways forever once you
          had more than a handful, and its red "x" cleared the CURRENT FIT rather than deleting the
          loadout it sat next to — which reads exactly backwards. Now one button opening a
          searchable list, which is how every other long list in the app works. */}
      <div style={{display:"flex",gap:6}}>
        <button className="press" onClick={()=>setShowLoadouts(true)} disabled={!loadouts.length}
          style={{flex:1,padding:"7px 0",borderRadius:7,fontSize:11,fontWeight:700,cursor:loadouts.length?"pointer":"default",
                  background:loadouts.length?C.surface:"transparent",border:`1px solid ${C.border}`,color:loadouts.length?C.textMid:C.textMute}}>
          {loadouts.length?`Load a loadout (${loadouts.length})`:"No saved loadouts"}
        </button>
        {filled>0&&<button onClick={()=>setImplants(Array.from({length:10},(_,i)=>({slot:i+1,name:"[Empty]",bonus:null})))}
          title="Clear every implant from this fit"
          style={{padding:"7px 12px",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",background:"none",border:`1px solid ${C.border}`,color:C.danger}}>Clear</button>}
      </div>
      {/* The x is the way OUT, not a convenience. Emptying this box is the only thing that brings the
          slot list back, so a query matching nothing left you on a bare "no implants match" page with
          no exit but backspacing it clear — which reads as the screen being stuck. */}
      <div style={{position:"relative",marginTop:6}}>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={query}
          onChange={e=>setQuery(e.target.value)} placeholder="Search all implants..."
          style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"7px 10px",paddingRight:query?30:10,color:C.text,fontSize:12,boxSizing:"border-box"}}/>
        {query&&<button onClick={()=>{haptic();dismissSearch();}} title="Clear search"
          style={{position:"absolute",right:0,top:0,bottom:0,width:30,display:"flex",alignItems:"center",justifyContent:"center",
                  background:"none",border:"none",padding:0,cursor:"pointer",color:C.textMute,fontSize:15}}>&#10005;</button>}
      </div>
    </div>
    {/* While searching, the results REPLACE the slot list rather than sitting above it: a result is
        already labelled with the slot it fills, so showing both puts the same ten slots on screen
        twice. Clearing the box brings the list straight back. */}
    <div style={{flex:1,overflowY:"auto",padding:results?0:12}}>
      {results
        ? (results.length
            ? results.map(item=><ImplantRow key={item.typeID} item={item} badge={`Slot ${item.slot}`}
                fitted={implants.find(i=>i.slot===item.slot)?.name===item.name}
                onPick={fitInto} onPickSet={fitSet} onInfo={it=>setDetail({...it,typeID:it.typeID??tidByName(it.name)})}/>)
            : <div style={{padding:"24px 16px",textAlign:"center",fontSize:12,color:C.textMute}}>No implants match "{query.trim()}"</div>)
        : [{label:"Attribute Enhancers",slots:[1,2,3,4,5],color:C.accent},{label:"Hardwirings",slots:[6,7,8,9,10],color:C.high}].map(grp=>(
        <div key={grp.label} style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,padding:"0 2px"}}>
            <div style={{width:8,height:8,borderRadius:99,background:grp.color}}/>
            <span style={{fontSize:11,fontWeight:700,color:grp.color,letterSpacing:.4}}>{grp.label.toUpperCase()}</span>
          </div>
          {grp.slots.map(slotNum=>{
            const imp=implants.find(i=>i.slot===slotNum);
            const empty=!imp||imp.name==="[Empty]";
            // Tapping a FITTED implant opens its info/variations sheet; an empty slot has nothing
            // to describe, so it goes straight to the picker as before. "Change implant" inside the
            // sheet is what keeps the picker reachable for an occupied slot.
            return(<div key={slotNum} onClick={()=>empty?setPicker({slot:slotNum,name:"[Empty]"}):setDetail({...imp,slot:slotNum,typeID:imp.typeID??tidByName(imp.name)})} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:C.surface,border:`1px solid ${empty?C.border:grp.color+"44"}`,borderRadius:8,marginBottom:5,cursor:"pointer"}}>
              <div style={{width:26,height:26,borderRadius:6,background:empty?C.surfaceAlt:`${grp.color}18`,border:`1px solid ${empty?C.borderStrong:grp.color+"44"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={{fontSize:10,fontWeight:800,color:empty?C.textMute:grp.color}}>{slotNum}</span>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:empty?400:600,color:empty?C.textMute:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{empty?"Empty":imp.name}</div>
                {!empty&&imp.bonus&&<div style={{fontSize:10,color:C.rig,marginTop:1}}>{imp.bonus}</div>}
              </div>
              <span style={{fontSize:14,color:C.textMute}}>{">"}</span>
            </div>);
          })}
        </div>
      ))}
    </div>
    {detail&&(()=>{
      const set=implantSetMembers(detail.name);
      // The sheet is reached two ways now — from the slot list (where this implant IS fitted) and
      // from a search result (where it may not be) — so the actions follow what is actually in the
      // slot rather than how the sheet was opened.
      const fitted=implants.find(i=>i.slot===detail.slot)?.name===detail.name;
      const acts=[];
      if(set)acts.push({label:`+ ${set.setName} set`,primary:true,
        title:`Fit all ${set.members.length} ${set.setName} implants`,
        onClick:()=>fitSet(set)});
      if(!fitted)acts.push({label:"Fit implant",primary:!set,onClick:()=>fitInto(detail)});
      else{
        acts.push({label:"Change implant",onClick:()=>setPicker({slot:detail.slot,name:detail.name})});
        // Removing an implant used to live one level DOWN, inside the picker you reached via Change
        // implant — so taking something off meant opening a browser you had no intention of
        // browsing, and reading as if the only way to empty a slot was to replace it.
        acts.push({label:"Remove implant",danger:true,
          onClick:()=>setImplants(prev=>prev.map(i=>i.slot===detail.slot?{...i,name:"[Empty]",bonus:null}:i))});
      }
      return<ItemDetailSheet typeID={detail.typeID} name={detail.name} actions={acts}
        onSwap={v=>setImplants(prev=>prev.map(i=>i.slot===detail.slot?{...i,name:v.name,bonus:null}:i))}
        onClose={()=>setDetail(null)}/>;
    })()}
    {picker&&<ImplantPicker slot={picker.slot} current={picker.name}
      onSelect={opt=>setImplants(prev=>prev.map(i=>i.slot===picker.slot?{...i,name:opt.name,bonus:opt.bonus??null}:i))}
      onSelectSet={fitSet}
      onClear={()=>setImplants(prev=>prev.map(i=>i.slot===picker.slot?{...i,name:"[Empty]",bonus:null}:i))}
      onClose={()=>setPicker(null)}/>}
    {showLoadouts&&<ImplantLoadoutSheet loadouts={loadouts} onLoad={loadLoadout}
      onRename={renameLoadout} onDelete={deleteLoadout} onClose={()=>setShowLoadouts(false)}/>}
  </div>);
}

export function ImplantLoadoutsManager({implants,setImplants,loadouts,setLoadouts}){
  const[savingName,setSavingName]=useState(false);
  const[newName,setNewName]=useState('');
  const[editing,setEditing]=useState(null);
  const[editName,setEditName]=useState('');
  function save(){
    if(!newName.trim())return;
    setLoadouts(prev=>[...prev,{id:Date.now(),name:newName.trim(),implants:implants.map(i=>({...i}))}]);
    setNewName('');setSavingName(false);
  }
  function load(lo){
    if(!lo.implants?.length){alert(`"${lo.name}" has no implants saved.`);return;}
    setImplants(lo.implants.map(i=>({...i})));
  }
  function rename(id){
    if(!editName.trim()){setEditing(null);return;}
    setLoadouts(prev=>prev.map(l=>l.id===id?{...l,name:editName.trim()}:l));
    setEditing(null);setEditName('');
  }
  function del(id){setLoadouts(prev=>prev.filter(l=>l.id!==id));}
  const inp={padding:'6px 10px',background:C.surfaceAlt,border:`1px solid ${C.accentBorder}`,borderRadius:7,color:C.text,fontSize:12,outline:'none'};
  return(
    <div>
      {savingName
        ?<div style={{display:'flex',gap:6,marginBottom:12}}>
           <input autoFocus value={newName} onChange={e=>setNewName(e.target.value)}
             onKeyDown={e=>{if(e.key==='Enter')save();if(e.key==='Escape')setSavingName(false);}}
             placeholder="Loadout name..." style={{...inp,flex:1}}/>
           <button onClick={save} style={{padding:'6px 12px',background:C.accent,border:'none',borderRadius:7,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>Save</button>
           <button onClick={()=>setSavingName(false)} style={{padding:'6px 10px',background:'none',border:`1px solid ${C.border}`,borderRadius:7,color:C.textMid,fontSize:12,cursor:'pointer'}}>Cancel</button>
         </div>
        :<button onClick={()=>setSavingName(true)} style={{width:'100%',padding:'9px 0',background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:12,fontWeight:700,cursor:'pointer',marginBottom:12}}>
           + Save Current Implants as Loadout
         </button>
      }
      {loadouts.length===0
        ?<div style={{padding:'14px',background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,fontSize:12,color:C.textMute,textAlign:'center'}}>No loadouts saved yet.</div>
        :loadouts.map(l=>(
          <div key={l.id} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,marginBottom:6}}>
            {editing===l.id
              ?<input autoFocus value={editName} onChange={e=>setEditName(e.target.value)}
                 onKeyDown={e=>{if(e.key==='Enter')rename(l.id);if(e.key==='Escape')setEditing(null);}}
                 onBlur={()=>rename(l.id)}
                 style={{...inp,flex:1}}/>
              :<div style={{flex:1,minWidth:0}}>
                 <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.name}</div>
                 <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{l.implants?.filter(i=>i.name!=='[Empty]').length??0} implants fitted</div>
               </div>
            }
            <button onClick={()=>load(l)} style={{padding:'5px 11px',background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:6,color:C.accent,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0}}>Load</button>
            <button onClick={()=>{setEditing(l.id);setEditName(l.name);}} style={{width:26,height:26,background:'none',border:'none',cursor:'pointer',fontSize:14,color:C.textMute,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>&#9998;</button>
            <button onClick={()=>del(l.id)} style={{width:26,height:26,background:'none',border:'none',cursor:'pointer',fontSize:16,color:C.danger,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>&#10005;</button>
          </div>
        ))
      }
    </div>
  );
}
