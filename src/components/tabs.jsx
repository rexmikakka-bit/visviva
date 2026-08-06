// The two main fitting tabs (FitTab, StatsTab).

import { useState, useEffect, useRef, useMemo } from "react";
import { C } from "../theme.js";
import { eveIcon } from "../lib/icons.js";
import modulesData from "../data/modules.json";
import { TYPES, tidByName, calcFitStats, peakRegen, isT3Cruiser, t3cSlotLayout } from "../calc.js";
import { DMG, STATE_COLORS, computeDisplayRows, defaultChargeFor, isGroupableModule, fmtN, haptic, moduleTakesCharges, slotIcons } from "../lib/core.js";
import { metaOf } from "../lib/meta.js";

// Named attr keys for canFitShipGroup/canFitShipType (TYPES[].a uses names, not numeric IDs)
const CAN_FIT_GROUP_KEYS = ['canFitShipGroup01','canFitShipGroup02','canFitShipGroup03','canFitShipGroup04','canFitShipGroup05','canFitShipGroup06','canFitShipGroup07','canFitShipGroup08','canFitShipGroup09','canFitShipGroup10','canFitShipGroup11','canFitShipGroup12','canFitShipGroup13','canFitShipGroup14','canFitShipGroup15','canFitShipGroup16','canFitShipGroup17','canFitShipGroup18','canFitShipGroup19','canFitShipGroup20'];
const CAN_FIT_TYPE_KEYS  = ['canFitShipType1','canFitShipType2','canFitShipType3','canFitShipType4','canFitShipType5','canFitShipType6','canFitShipType7','canFitShipType8','canFitShipType9','canFitShipType10','canFitShipType11','canFitShipType12'];
// Group names that consume a turret hardpoint
const TURRET_GROUPS = new Set(['Projectile Weapon','Energy Weapon','Hybrid Weapon','Mining Laser','Frequency Mining Laser','Citizen Mining Laser','Precursor Weapon']);
const isTurretWeapon    = tid => TURRET_GROUPS.has(TYPES[String(tid)]?.gn ?? '');
const isMissileLauncher = tid => /^Missile Launcher/i.test(TYPES[String(tid)]?.gn ?? '');

// Returns null if module can fit the ship, or an error string if not.
function checkFitRestriction(modTypeID, ship) {
  if (!ship?.typeID || !modTypeID) return null;
  const attrs = TYPES[String(modTypeID)]?.a ?? {};

  // Rig size check: rig's rigSize must match the ship's rigSize
  const modRigSize = attrs.rigSize;
  if (modRigSize != null) {
    const shipRigSize = TYPES[String(ship.typeID)]?.a?.rigSize ?? null;
    if (shipRigSize != null && modRigSize !== shipRigSize) {
      const SIZE_NAME = {1:'Small',2:'Medium',3:'Large',4:'Capital'};
      return `${SIZE_NAME[modRigSize]??'Wrong-size'} rig cannot be fit to a ${SIZE_NAME[shipRigSize]??'this'} ship`;
    }
  }

  // Structure modules must go on structures and ship modules on ships. eos enforces this as a
  // separate rule from canFitShipType (Fit.canFit: `isinstance(self.ship, Citadel) is not
  // item.isStandup`), because the two catch different mistakes — this one catches a whole wrong
  // class of module, which an EFT/ESI import can introduce even though the module browser can't.
  const shipIsStructure = (TYPES[String(ship.typeID)]?.c ?? TYPES[String(ship.typeID)]?.category) === 65;
  const modIsStandup    = (TYPES[String(modTypeID)]?.c ?? TYPES[String(modTypeID)]?.category) === 66;
  if (shipIsStructure !== modIsStandup) {
    return shipIsStructure
      ? 'Only Standup (structure) modules can be fit to a structure'
      : 'Standup (structure) modules cannot be fit to a ship';
  }

  // canFitShipGroupN / canFitShipTypeN / fitsToShipType — an explicit CCP whitelist of hulls.
  // This applies to structures exactly as it does to ships (eos runs the same check for both).
  // Do NOT be tempted to skip it for structures because a list "looks incomplete": Standup Market
  // Hub I legitimately omits Astrahus/Raitaru/Athanor because a market genuinely requires a
  // medium-or-larger structure, and Standup Metenox Moon Drill lists exactly one hull (81826, the
  // Metenox itself). Skipping the check let both fit anywhere.
  const allowedGroups = CAN_FIT_GROUP_KEYS.map(k => attrs[k]).filter(v => v != null);
  const allowedTypes  = CAN_FIT_TYPE_KEYS.map(k => attrs[k]).filter(v => v != null);
  if (attrs.fitsToShipType != null) allowedTypes.push(attrs.fitsToShipType); // T3 subsystems
  if (!allowedGroups.length && !allowedTypes.length) return null;
  const shipGroupID = TYPES[String(ship.typeID)]?.g ?? null;
  if (allowedGroups.includes(shipGroupID) || allowedTypes.includes(ship.typeID)) return null;
  return `Cannot be fit to ${ship.hullClass || ship.name || 'this ship'}`;
}
import { ModuleBrowserSheet, ModuleMenu, ResourceStrip, SubsystemPickerSheet, DamageProfileSheet, TargetProfileSheet } from "./ui.jsx";
import { fetchPrices, MARKET_HUBS } from "../prices.js";

function FitTab({undo,undoDepth,ship,slots,setSlots,skills,implants,boosters,drones,factorInReload,externalBursts,projectedEffects,dmgProfile}){
  const _cs=(ship&&slots)?calcFitStats(ship,slots,drones??[],skills,{implants,boosters,factorInReload,externalBursts,projectedWebMult:projectedEffects?.webMult,projectedNeutGJs:projectedEffects?.neutGJs,projectedCapGJs:projectedEffects?.capGJs,projectedDebuffs:projectedEffects?.debuffs,projectedBoosts:projectedEffects?.boosts,damageProfile:dmgProfile?.p,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity})??{}:{};
  // Keyed by SLOT id, not typeID: two slots holding the same module can have genuinely different
  // stats. A missile launcher's range comes entirely from its charge (velocity x flight time), so an
  // unloaded launcher has no range at all — keying by typeID let a loaded launcher's range bleed onto
  // an identical unloaded one. Same for any two launchers carrying different ammo.
  const engineStatsBySlotID=new Map();
  if(_cs.slotEngineStats){for(const[slot,stats]of _cs.slotEngineStats){if(slot.id!=null)engineStatsBySlotID.set(slot.id,stats);}}
  const[grouped,setGrouped]=useState(true);
  const[dragUI,setDragUI]=useState(null); // {secKey,fromIdx,overIdx} — visual state during pointer drag
  const dragInfo=useRef(null);             // live drag data (avoids re-render churn during move)
  const rowRefs=useRef({});                // `${secKey}:${rowIdx}` → row element (for hit-testing)
  const[expanded,setExpanded]=useState(["subsystems","high","mid","low","rigs","services"]);
  const[moduleMenu,setModuleMenu]=useState(null);
  const[emptySlot,setEmptySlot]=useState(null);
  const[fitError,setFitError]=useState(null);
  const showFitError=msg=>{setFitError(msg);setTimeout(()=>setFitError(null),3000);};

  // Drag-and-drop handler: swap two slot positions within a section
  // ── Drag-to-reorder (pointer events: works for both touch and mouse) ──────
  // Reorders by DISPLAY ROW (grouped rows move as a unit), then rebuilds the raw
  // slot array from the new row order via each row's groupIds.
  const reorderRows=(secKey,fromIdx,toIdx)=>{
    setSlots(prev=>{
      const rows=computeDisplayRows(prev[secKey],secKey,grouped);
      if(fromIdx<0||toIdx<0||fromIdx>=rows.length||toIdx>=rows.length||fromIdx===toIdx)return prev;
      const newRows=[...rows];
      const[mv]=newRows.splice(fromIdx,1);
      newRows.splice(toIdx,0,mv);
      const byId=new Map(prev[secKey].map(m=>[m.id,m]));
      return{...prev,[secKey]:newRows.flatMap(r=>r.groupIds.map(id=>byId.get(id)).filter(Boolean))};
    });
  };
  // While a row drag is live, selection is disabled on the WHOLE DOCUMENT. Marking only the handle
  // unselectable was not enough: the press lands on the handle but the drag travels across the
  // module names either side of it, and that is what the browser starts selecting. Clearing any
  // selection that did sneak in stops the blue highlight appearing at all.
  const setDragSelection=(on)=>{
    const st=document.body.style;
    if(on){st.userSelect="none";st.webkitUserSelect="none";st.webkitTouchCallout="none";
           try{window.getSelection?.()?.removeAllRanges?.();}catch{}}
    else{st.userSelect="";st.webkitUserSelect="";st.webkitTouchCallout="";}
  };
  const startRowDrag=(secKey,fromIdx)=>e=>{
    e.preventDefault();e.stopPropagation();
    try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}
    setDragSelection(true);
    dragInfo.current={secKey,fromIdx,overIdx:fromIdx};
    setDragUI({secKey,fromIdx,overIdx:fromIdx});
    haptic("medium");                    // "you have picked this up"
  };
  const moveRowDrag=e=>{
    const d=dragInfo.current;if(!d)return;
    e.preventDefault();
    const y=e.clientY;
    let best=d.overIdx,bestDist=Infinity;
    for(const[key,el] of Object.entries(rowRefs.current)){
      if(!el||!key.startsWith(d.secKey+":"))continue;
      const idx=Number(key.split(":")[1]);
      const r=el.getBoundingClientRect();
      if(r.height===0)continue;
      const dist=Math.abs(y-(r.top+r.height/2));
      if(dist<bestDist){bestDist=dist;best=idx;}
    }
    // A tick each time the row would land somewhere new — the thing that makes a drag feel like it
    // is gripping positions rather than sliding over a surface.
    if(best!==d.overIdx){d.overIdx=best;setDragUI({...d});haptic("light");}
  };
  const endRowDrag=()=>{
    const d=dragInfo.current;dragInfo.current=null;
    setDragSelection(false);
    setDragUI(null);
    if(d&&d.overIdx!==d.fromIdx){reorderRows(d.secKey,d.fromIdx,d.overIdx);haptic("success");}
  };
  // Belt and braces: a drag interrupted by a phone call or an app switch never reaches endRowDrag,
  // and leaving the document unselectable forever would be a strange bug to track down later.
  useEffect(()=>()=>setDragSelection(false),[]);

  const _isT3C = isT3Cruiser(ship?.name);
  const _isStructure = (TYPES[ship?.typeID]?.c ?? TYPES[ship?.typeID]?.category) === 65;
  const SECS=[
    ...(_isT3C?[{key:"subsystems",label:"Subsystems",color:C.accent}]:[]),
    {key:"high",label:"High Slots",color:C.high},{key:"mid",label:"Mid Slots",color:C.mid},{key:"low",label:"Low Slots",color:C.low},{key:"rigs",label:"Rigs",color:C.rig},
    ...(_isStructure?[{key:"services",label:"Service Slots",color:C.accent}]:[]),
  ];
  // T3 Destroyer tactical modes (Defense/Propulsion/Sharpshooter). Detect by hull class and
  // by the existence of "<Ship> <Mode> Mode" types. Default to Defense if none chosen yet.
  // Tactical modes. Standard T3Ds expose "<Ship> <Mode> Mode" types; the Skua reuses the Caldari
  // (Jackdaw) Defense/Sharpshooter/Propulsion modes, and the Anhinga has its own Primary/Secondary/
  // Tertiary modes. calc.js applies the actual bonuses; here we just drive the selector.
  const MODE_SETS = { Skua: ["Defense","Sharpshooter","Propulsion"], Anhinga: ["Primary","Secondary","Tertiary"] };
  const isT3D = ship?.hullClass === "Tactical Destroyer" && !!tidByName(`${ship.name} Defense Mode`);
  const shipModes = MODE_SETS[ship?.name] ?? (isT3D ? ["Defense","Sharpshooter","Propulsion"] : null);
  const tacticalMode = slots.tactical ?? (shipModes ? shipModes[0] : null);
  const setTacticalMode = (mode) => setSlots(prev => ({ ...prev, tactical: mode }));

  // Pilot security-status bonus ships. CONCORD hulls (Marshal/Enforcer/Pacifier, effect 6871) gain
  // tank from POSITIVE sec (0..5); AT frigates (Sidewinder, effect 12165) gain damage from NEGATIVE
  // sec (-10..0). The engine/calc apply the bonus from slots.pilotSec (see dogma-engine section 5g).
  const shipEffs = TYPES[ship?.typeID]?.e ?? [];
  const isATFrig = shipEffs.includes(12165);
  const showPilotSec = shipEffs.includes(6871) || isATFrig;
  const secRange = isATFrig ? [-10, 0] : [0, 5];
  const pilotSec = slots.pilotSec ?? 0;
  const setPilotSec = (v) => setSlots(prev => ({ ...prev, pilotSec: v }));
  const pilotSecHint = isATFrig
    ? `+${((TYPES[ship?.typeID]?.a?.[5727] ?? -7.5) * Math.max(-10, Math.min(0, pilotSec))).toFixed(1)}% small turret & rocket/light-missile damage`
    : `+${(Math.max(0, Math.min(5, pilotSec)) * 10).toFixed(0)}% armor rep & shield boost amount`;

  // SYSTEM security — where a STRUCTURE is anchored. Unrelated to pilot security above: it scales
  // structure rig bonuses (hiSecModifier/lowSecModifier/nullSecModifier -> `securityModifier`), so
  // the same rig is 20% weaker in hisec. Defaults to nullsec because eos does and pyfa is the
  // reference; only shown when the fit actually has structure rigs to be affected.
  const SYS_SEC_OPTS = [
    { key: 'hisec',   label: 'Hi',   hint: 'High security'   },
    { key: 'lowsec',  label: 'Low',  hint: 'Low security'    },
    { key: 'nullsec', label: 'Null', hint: 'Null security'   },
    { key: 'wspace',  label: 'W-C',  hint: 'Wormhole space'  },
  ];
  const systemSecurity = slots.systemSecurity ?? 'nullsec';
  const setSystemSecurity = (v) => setSlots(prev => ({ ...prev, systemSecurity: v }));
  const _rigsAffected = (slots.rigs ?? []).some(r =>
    r?.typeID && TYPES[r.typeID]?.a?.nullSecModifier != null);

  const updateMod=(secKey,modId,updated,keepOpen=false)=>{
    setSlots(prev=>{
      const sec=[...prev[secKey]],idx=sec.findIndex(m=>m.id===modId);
      if(idx<0)return prev;
      // Loading a charge fans out to every identical module in the rack — but only for things
      // that are actually GROUPED. It used to match on name alone, so two Skirmish Command
      // Bursts always ended up with the same charge and running two different scripts was
      // impossible. Bursts (and anything else non-groupable) are one row each already.
      if(grouped&&secKey==="high"&&updated.ammo!==undefined&&isGroupableModule(sec[idx])){const origName=sec[idx].name;return{...prev,[secKey]:sec.map(m=>m.name===origName&&isGroupableModule(m)?{...m,...updated,id:m.id}:m)};}
      sec[idx]={...sec[idx],...updated};

      // EVE only lets ONE propulsion module run at a time: activating an MWD shuts off an
      // afterburner and vice versa. Enforce it here rather than in the engine, so the fit the user
      // sees is the fit that gets calculated.
      if(updated.state==="active"||updated.state==="overheated"){
        const isProp=m=>{const g=TYPES[m?.typeID]?.gn; return g==="Propulsion Module";};
        if(isProp(sec[idx])){
          const out={...prev,[secKey]:sec};
          for(const k of ["high","mid","low"]){
            const arr=(k===secKey?sec:out[k])??[];
            out[k]=arr.map(m=>(m.id!==modId&&isProp(m)&&(m.state==="active"||m.state==="overheated"))
              ?{...m,state:"online"}:m);
          }
          return out;
        }
      }
      return{...prev,[secKey]:sec};
    });if(!keepOpen)setModuleMenu(null);
  };
  const removeMod=(secKey,modId)=>{
    const ship_=ship??{};
    const labels={high:"High",mid:"Mid",low:"Low",rigs:"Rig"};
    setSlots(prev=>({...prev,[secKey]:prev[secKey].map(m=>m.id===modId?{id:m.id,name:`[Empty ${labels[secKey]} Slot]`,icon:null,type:"empty"}:m)}));
  };
  const duplicateMod=(secKey,mod)=>{
    const empty=slots[secKey].find(m=>m.type==="empty");
    if(!empty)return;
    addMod(secKey,empty.id,{name:mod.name,typeID:mod.typeID,mutaplasmid:mod.mutaplasmid,mutations:mod.mutations?{...mod.mutations}:undefined});
    setModuleMenu(null);
  };
  const addMod=(secKey,id,modData)=>{
    if(ship&&modData.typeID){
      const fitErr=checkFitRestriction(modData.typeID,ship);
      if(fitErr){showFitError(fitErr);return;}
      if(secKey==='high'&&isTurretWeapon(modData.typeID)){
        const used=(slots.high??[]).filter(s=>s.typeID&&isTurretWeapon(s.typeID)).length;
        if(used>=(ship.turrets??0)){showFitError('No turret hardpoints available');return;}
      }
      if(secKey==='high'&&isMissileLauncher(modData.typeID)){
        const used=(slots.high??[]).filter(s=>s.typeID&&isMissileLauncher(s.typeID)).length;
        if(used>=(ship.launchers??0)){showFitError('No launcher hardpoints available');return;}
      }
    }
    const modInfo=Object.values(modulesData).find(m=>m.name===modData.name);
    const takesCharges=moduleTakesCharges(modData.typeID,modData.name);
    const hasIntrinsicDmg=!!(modInfo?.emDmg||modInfo?.thDmg||modInfo?.kinDmg||modInfo?.expDmg);
    const isWeaponMod=(modInfo?.dmgMult!=null&&modInfo?.rof!=null)||hasIntrinsicDmg||
      (takesCharges&&/Launcher|Turret|Weapon/i.test(TYPES[modData.typeID]?.gn??TYPES[modData.typeID]?.groupName??''));
    const hasCharges=takesCharges||!!(modInfo?.chargeGroups?.length);
    const isCapBooster=modInfo?.groupName==="Capacitor Booster";
    const isRigMod=secKey==="rigs";
    const modType=isCapBooster?"capbooster":isWeaponMod?"weapon":isRigMod?"rig":"passive";
    // Modules that cycle (weapons, active hardeners, repairers, prop mods, etc.) default to active
    const hasCycle=!!(modInfo?.duration&&modInfo.duration>0)||(modInfo?.capUse!=null&&modInfo.capUse>0);
    const defaultState=isRigMod?"online":(isWeaponMod||isCapBooster||hasCycle)?"active":"online";
    // Ancillary boosters/repairers arrive pre-loaded — see defaultChargeFor. Anything else
    // starts empty, as before.
    const preload=defaultChargeFor(modData.typeID);
    setSlots(prev=>({...prev,[secKey]:prev[secKey].map(m=>m.id===id?{...m,name:modData.name,icon:null,typeID:modData.typeID,type:modType,state:defaultState,ammo:preload?.name,charges:preload?.qty,maxCharges:preload?.qty,optimal:modInfo?.optimal??undefined,falloff:modInfo?.falloff??undefined,tracking:modInfo?.tracking??undefined,mutaplasmid:modData.mutaplasmid??undefined,mutations:modData.mutations??undefined}:m)}));
  };

  const getDisplayRows=(secKey)=>computeDisplayRows(slots[secKey]??[],secKey,grouped);
  const menuMod=moduleMenu?slots[moduleMenu.secKey].find(m=>m.id===moduleMenu.modId):null;

  return(
    <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>
      {fitError&&<div style={{position:'fixed',top:16,left:16,right:16,zIndex:500,background:C.danger,color:'#fff',borderRadius:8,padding:'10px 16px',fontSize:13,fontWeight:600,textAlign:'center',boxShadow:'0 4px 16px rgba(0,0,0,.4)',pointerEvents:'none'}}>{fitError}</div>}
      <ResourceStrip ship={ship} slots={slots} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload}/>
      {shipModes&&(
        <div style={{display:"flex",gap:6,padding:"8px 10px 4px"}}>
          {shipModes.map((mode)=>{
            const on=tacticalMode===mode;
            return(<button key={mode} onClick={()=>{haptic("medium");setTacticalMode(mode);}}
              style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"9px 4px",borderRadius:8,cursor:"pointer",
                background:on?C.accentLight:C.surface,border:`1px solid ${on?C.accent:C.border}`}}>
              <span style={{fontSize:12,fontWeight:700,color:on?C.accent:C.text}}>{mode}</span>
            </button>);
          })}
        </div>
      )}
      {showPilotSec&&(
        <div style={{padding:"8px 10px 4px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <span style={{fontSize:11,fontWeight:700,letterSpacing:".3px",color:C.textMute}}>PILOT SECURITY STATUS</span>
            <span style={{fontSize:13,fontWeight:700,color:C.accent}}>{pilotSec.toFixed(1)}</span>
          </div>
          <input type="range" min={secRange[0]} max={secRange[1]} step={0.1} value={pilotSec}
            onChange={e=>setPilotSec(parseFloat(e.target.value))}
            style={{width:"100%",accentColor:C.accent,cursor:"pointer"}}/>
          <div style={{fontSize:10,color:C.textMute,marginTop:3}}>{pilotSecHint}</div>
        </div>
      )}
      {_isStructure&&(
        <div style={{padding:"8px 10px 4px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <span style={{fontSize:11,fontWeight:700,letterSpacing:".3px",color:C.textMute}}>SYSTEM SECURITY</span>
            <span style={{fontSize:10,color:C.textMute}}>{_rigsAffected?'affects rig bonuses':'no rigs affected'}</span>
          </div>
          <div style={{display:"flex",gap:6}}>
            {SYS_SEC_OPTS.map(o=>{
              const on=systemSecurity===o.key;
              return(<button key={o.key} onClick={()=>setSystemSecurity(o.key)} title={o.hint} aria-pressed={on}
                style={{flex:1,padding:"5px 0",borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer",
                        background:on?C.accentLight:"none",border:`1px solid ${on?C.accent:C.border}`,
                        color:on?C.accent:C.textMute}}>{o.label}</button>);
            })}
          </div>
          <div style={{fontSize:10,color:C.textMute,marginTop:3}}>
            Structure rig bonuses are {systemSecurity==='hisec'?'at base strength in hi-sec':'20% stronger outside hi-sec'}
          </div>
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 10px 4px"}}>
        {/* Undo covers every edit to the fit (modules, charges, drones, cargo, implants, boosters,
            projected/command fits) because the history snapshots the same state App.jsx persists.
            Disabled rather than hidden so the control doesn't shift position as you edit. */}
        <button onClick={()=>undoDepth>0&&undo?.()} disabled={!undoDepth}
          title={undoDepth?`Undo last change (${undoDepth})`:"Nothing to undo"}
          style={{display:"flex",alignItems:"center",gap:4,padding:"3px 10px",borderRadius:6,fontSize:10,fontWeight:700,
                  background:"none",border:`1px solid ${undoDepth?C.border:"transparent"}`,
                  color:undoDepth?C.textMid:C.textMute,opacity:undoDepth?1:0.4,
                  cursor:undoDepth?"pointer":"default"}}>
          <span style={{fontSize:12,lineHeight:1}}>↶</span>Undo
        </button>
        <button onClick={()=>setGrouped(g=>!g)} style={{padding:"3px 10px",borderRadius:6,fontSize:10,fontWeight:700,background:grouped?C.accentLight:"none",border:`1px solid ${grouped?C.accentBorder:C.border}`,color:grouped?C.accent:C.textMute,cursor:"pointer"}}>{grouped?"Grouped":"Ungrouped"}</button>
      </div>
      <div style={{flex:1,padding:"0 10px 12px"}}>
        {SECS.map(sec=>{
          const rows=getDisplayRows(sec.key);
          return(<div key={sec.key} style={{marginBottom:6}}>
            <button onClick={()=>setExpanded(e=>e.includes(sec.key)?e.filter(k=>k!==sec.key):[...e,sec.key])} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",cursor:"pointer",padding:"7px 4px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <img src={(slotIcons??{})[sec.key==="rigs"?"rig":sec.key]} style={{width:12,height:12,objectFit:"contain",filter:"brightness(10)",marginRight:2}} alt=""/>
                <span style={{fontSize:12,fontWeight:700,color:C.text}}>{sec.label}</span>
                <span style={{fontSize:10,color:C.textMute,background:C.border,borderRadius:99,padding:"1px 7px",fontWeight:600}}>{(slots[sec.key]??[]).length}</span>
              </div>
              <span style={{color:C.textMute,fontSize:11}}>{expanded.includes(sec.key)?"^":"v"}</span>
            </button>
            {expanded.includes(sec.key)&&rows.map((row,rowIdx)=>{
              if(row.type==="empty")return(
                <div key={row.id} ref={el=>{rowRefs.current[sec.key+":"+rowIdx]=el;}} onClick={()=>setEmptySlot({secKey:sec.key,id:row.id})} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:8,marginBottom:4,background:C.surface,border:`1px dashed ${C.borderStrong}`,cursor:"pointer"}}>
                  <div style={{width:30,height:30,borderRadius:7,background:C.surfaceAlt,border:`1px dashed ${C.borderStrong}`,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:C.borderStrong,fontSize:20}}>+</span></div>
                  <span style={{fontSize:13,color:C.textMute}}>{row.name}</span>
                  <span style={{marginLeft:"auto",fontSize:11,color:C.accent,fontWeight:600}}>Add module</span>
                </div>
              );
              const stateColor=STATE_COLORS[row.state]||C.textMid;
              const isDragSrc=dragUI?.secKey===sec.key&&dragUI?.fromIdx===rowIdx;
              const isDragOver=dragUI?.secKey===sec.key&&dragUI?.overIdx===rowIdx&&dragUI?.fromIdx!==rowIdx;
              return(
                // no-select on the ROW, not just the handle: the press starts on the handle but the
                // drag travels across the module names either side, and those are what the browser
                // was selecting.
                <div key={row.id||row.name} className="no-select"
                ref={el=>{rowRefs.current[sec.key+":"+rowIdx]=el;}}
                onClick={()=>sec.key==="subsystems"?setEmptySlot({secKey:"subsystems",id:row.id}):setModuleMenu({secKey:sec.key,modId:row.id})}
                style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:8,marginBottom:4,cursor:"pointer",opacity:isDragSrc?0.45:1,background:isDragOver?C.accentLight:C.surface,border:`1px solid ${isDragSrc?C.accent:isDragOver?C.accentBorder:C.border}`,borderTop:isDragOver?`2px solid ${C.accent}`:undefined,transition:"opacity .15s ease, background-color .15s ease, border-color .15s ease"}}>
                  <div style={{width:6,height:6,borderRadius:99,background:stateColor,flexShrink:0,boxShadow:row.state==="overheated"?`0 0 6px ${stateColor}`:"none"}}/>
                  <div style={{width:30,height:30,borderRadius:7,flexShrink:0,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",background:`${sec.color}18`,border:`1px solid ${sec.color}35`,opacity:row.state==="offline"?0.4:1}}>
                    {row.typeID?<img className="eve-icon" src={eveIcon(row.typeID,32)} width={28} height={28} alt="" onError={e=>{e.target.style.display="none";}}/>:<span style={{fontSize:14}}>{row.icon||"?"}</span>}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:5}}>
                      {row.count>1&&<span style={{fontSize:9,fontWeight:800,color:sec.color,background:`${sec.color}20`,borderRadius:4,padding:"1px 5px"}}>{row.count}x</span>}
                      {row.mutaplasmid&&<span title="Abyssal (mutated) module" style={{fontSize:9,lineHeight:1,fontWeight:800,color:C.danger,background:`${C.danger}22`,border:`1px solid ${C.danger}`,borderRadius:4,padding:"2px 4px",flexShrink:0,display:"inline-flex",alignItems:"center"}}>▲</span>}
                      <span style={{fontSize:12,fontWeight:600,color:row.state==="offline"?C.textMute:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sec.key==="subsystems"?(row.name||"").replace(/^.+?\s-\s/,""):row.name}</span>
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:2}}>
                      {row.ammo&&<><span style={{fontSize:11,color:C.textMute}}>{(row.ammo||"").replace(/\s*\(\d+\)$/,"")} / {row.charges}/{row.maxCharges}</span><button title={row.count>1?`Unload charge from all ${row.count}`:"Unload charge"} onClick={e=>{e.stopPropagation();setSlots(prev=>{
                        // A grouped row stands for every slot in row.groupIds (identical module +
                        // identical ammo), so unloading has to clear all of them — clearing only the
                        // representative left the rest loaded while the row rendered as unloaded.
                        const ids=new Set(row.groupIds??[row.id]);
                        return{...prev,[sec.key]:prev[sec.key].map(m=>ids.has(m.id)?{...m,ammo:null,charges:undefined,maxCharges:undefined}:m)};
                      });}} style={{background:'none',border:'none',padding:'0 3px',cursor:'pointer',borderRadius:3,lineHeight:1,marginLeft:1}}><span style={{fontSize:11,color:C.textMute}}>✕</span></button></>}
                      {(()=>{
                        if(!row.typeID)return row.optimal>0||row.falloff>0?<span style={{fontSize:11,color:C.rig}}>{row.optimal}+{row.falloff} km</span>:null;
                        const eStats=engineStatsBySlotID.get(row.id);
                        if(eStats&&(eStats.optimal>0||eStats.falloff>0)){
                          const _fal=eStats.falloff>0?`+${eStats.falloff}`:'';
                          const _isOH=row.state==='overheated';
                          // heatedOptimal comes from calc and includes subsystem overload enhancements
                          // (e.g. Loki Core raises a web's heated range to 45.7km).
                          const _ohHint=(eStats.heatedOptimal!=null&&!_isOH)?<span style={{fontSize:11,color:C.overheat,marginLeft:6}}>OH: {eStats.heatedOptimal} km</span>:null;
                          return <span style={{fontSize:11,color:C.rig}}>{eStats.optimal}{_fal} km{_ohHint}</span>;
                        }
                        const a=TYPES[row.typeID]?.attrs??{};
                        const _ra=row.ammo?.replace(/\s*\(\d+\)$/,"");const ca=_ra?TYPES[tidByName(_ra)]?.attrs??{}:{};
                        const opt=Math.round((a.maxRange??0)*(ca.weaponRangeMultiplier??1)/1000*10)/10;
                        const fal=Math.round(((a.falloff??a.falloffEffectiveness??0))*(ca.fallofMultiplier??1)/1000*10)/10;
                        return (opt>0||fal>0)?<span style={{fontSize:11,color:C.rig}}>{opt}{fal>0?`+${fal}`:''} km</span>:null;
                      })()}
                      {(()=>{
                        if(!row.typeID)return row.tracking>0?<span style={{fontSize:11,color:C.warning}}>Tr {(+row.tracking).toFixed(1)}</span>:null;
                        const eSt=engineStatsBySlotID.get(row.id);
                        if(eSt?.tracking>0)return <span style={{fontSize:11,color:C.warning}}>Tr {(+eSt.tracking).toFixed(1)}</span>;
                        const a=TYPES[row.typeID]?.attrs??{};
                        const _ra=row.ammo?.replace(/\s*\(\d+\)$/,"");const ca=_ra?TYPES[tidByName(_ra)]?.attrs??{}:{};
                        const trk=Math.round((a.trackingSpeed??0)*(ca.trackingSpeedMultiplier??1)*1000)/1000;
                        return trk>0?<span style={{fontSize:11,color:C.warning}}>Tr {trk.toFixed(1)}</span>:null;
                      })()}
                      {(()=>{
                        const eAar=engineStatsBySlotID.get(row.id);
                        if(!eAar?.isAAR) return null;
                        const fmt=v=>v>=1000?`${(v/1000).toFixed(1)}k`:Math.round(v).toString();
                        if(eAar.hasPaste){
                          const dispHP=eAar.totalEHP??eAar.totalHP;
                          return <span style={{fontSize:11,color:'#a78bfa',marginLeft:2}}>{fmt(dispHP)}/{eAar.totalS}s</span>;
                        }
                        const ehps=eAar.ehpS??Math.round(eAar.repPerCycle/(eAar.cycleMs/1000));
                        return <span style={{fontSize:11,color:C.textMute,marginLeft:2}}>{fmt(ehps)} EHP/s</span>;
                      })()}
                      {(()=>{
                        const eAsb=engineStatsBySlotID.get(row.id);
                        if(!eAsb?.isASB) return null;
                        const fmt=v=>v>=1000?`${(v/1000).toFixed(1)}k`:Math.round(v).toString();
                        if(eAsb.hasCharges){
                          const dispHP=eAsb.totalEHP??eAsb.totalHP;
                          const reloadS=Math.round(eAsb.totalS_withReload-eAsb.totalS);
                          return <span style={{fontSize:11,color:'#a78bfa',marginLeft:2}}>{fmt(dispHP)} / {eAsb.totalS}s (+{reloadS}s)</span>;
                        }
                        return <span style={{fontSize:11,color:C.textMute,marginLeft:2}}>{fmt(eAsb.ehpS)} EHP/s</span>;
                      })()}
                      {(()=>{
                        const eRah=engineStatsBySlotID.get(row.id);
                        if(!eRah?.isRAH||!eRah.rahResistPct) return null;
                        // Current adapted resist split as four color-coded figures (EM / Th / Kin / Exp).
                        const pct=eRah.rahResistPct; // [em,th,kin,exp] percent
                        const cols=[DMG.em.color,DMG.th.color,DMG.kin.color,DMG.exp.color];
                        return(<span style={{display:"inline-flex",alignItems:"center",fontSize:11,fontWeight:700,marginLeft:2}}>
                          {pct.map((v,i)=>(<span key={i}>
                            {i>0&&<span style={{color:C.textMute,margin:"0 3px"}}>/</span>}
                            <span style={{color:cols[i]}}>{Number(v.toFixed(1))}%</span>
                          </span>))}
                        </span>);
                      })()}
                      {(()=>{
                        const eW=engineStatsBySlotID.get(row.id);
                        if(!eW?.isWDFG) return null;
                        const km=Math.round((eW.warpScrambleRange??0)/100)/10;
                        return <span style={{fontSize:11,color:C.rig,marginLeft:2}}>{km} km</span>;
                      })()}
                      {(()=>{
                        const eB=engineStatsBySlotID.get(row.id);
                        if(!eB?.isBreacher) return null;
                        if(eB.noPod) return <span style={{fontSize:11,color:C.textMute,marginLeft:2}}>load a pod</span>;
                        // pyfa format: total absolute / total %-of-HP "over" duration, resist-ignoring.
                        const fmtK=(n)=>n>=1000?(n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,'')+"k":Math.round(n).toString();
                        return <span title={`Pure damage inflicted over time, minimum of absolute / relative.\nFull DPS from ${fmtK(eB.fullDpsHP)} target HP`}
                          style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,marginLeft:2,cursor:"help"}}>
                          <span style={{color:C.danger}}>{fmtK(eB.totalAbs)}/{Math.round(eB.totalPct)}%</span>
                          <span style={{color:C.textMute,fontWeight:400}}>over {Math.round(eB.durationS)}s</span>
                        </span>;
                      })()}
                    </div>
                  </div>
                  <div
                    onPointerDown={startRowDrag(sec.key,rowIdx)}
                    onPointerMove={moveRowDrag}
                    onPointerUp={endRowDrag}
                    onPointerCancel={endRowDrag}
                    onClick={e=>e.stopPropagation()}
                    title="Drag to reorder"
                    className="no-select"
                    style={{touchAction:"none",cursor:"grab",flexShrink:0,padding:"6px 4px 6px 8px",marginRight:-4,color:C.textMute,fontSize:14,lineHeight:1,display:"flex",alignItems:"center"}}>
                    &#8801;
                  </div>
                </div>
              );
            })}
          </div>);
        })}
      </div>
      {menuMod&&<ModuleMenu mod={menuMod} onClose={()=>setModuleMenu(null)} onUpdateMod={u=>updateMod(moduleMenu.secKey,moduleMenu.modId,u)} onUpdateModLive={u=>updateMod(moduleMenu.secKey,moduleMenu.modId,u,true)} onRemove={()=>removeMod(moduleMenu.secKey,moduleMenu.modId)} onDuplicate={slots[moduleMenu.secKey]?.some(m=>m.type==="empty")?()=>duplicateMod(moduleMenu.secKey,menuMod):null}/>}
      {emptySlot&&emptySlot.secKey==="subsystems"&&(
        <SubsystemPickerSheet ship={ship} slotId={emptySlot.id}
          current={(slots.subsystems??[]).find(s=>s.id===emptySlot.id)}
          onSelect={sub=>{setSlots(prev=>{
            const subs=[...(prev.subsystems??[])];
            const idx=subs.findIndex(s=>s.id===emptySlot.id);
            if(idx>=0)subs[idx]={...subs[idx],name:sub.name,typeID:sub.typeID,type:"subsystem"};
            // Recompute slot layout from the new subsystem set; preserve filled module slots where possible.
            const layout=t3cSlotLayout(subs.filter(s=>s.typeID));
            const fit=(key,count)=>{const cur=prev[key]??[];const out=[];for(let i=0;i<count;i++)out.push(cur[i]??{id:`${key[0]}${i}`,name:`[Empty ${key==='mid'?'Mid':key==='rigs'?'Rig':key.charAt(0).toUpperCase()+key.slice(1)} Slot]`,icon:null,type:"empty"});return out;};
            return{...prev,subsystems:subs,high:fit("high",layout.hiSlots),mid:fit("mid",layout.medSlots),low:fit("low",layout.lowSlots),rigs:fit("rigs",layout.rigSlots)};
          });setEmptySlot(null);}}
          onClose={()=>setEmptySlot(null)}/>
      )}
      {emptySlot&&emptySlot.secKey!=="subsystems"&&<ModuleBrowserSheet slotType={emptySlot.secKey} isStructure={_isStructure} hullRigSize={TYPES[ship?.typeID]?.a?.rigSize??null} onSelect={m=>addMod(emptySlot.secKey,emptySlot.id,m)} onClose={()=>setEmptySlot(null)}/>}
    </div>
  );
}

// ═══ STATS TAB ══════════════════════════════════════════════════
function StatsTab({ship,slots,skills,implants,boosters,drones,fighters,factorInReload,setFactorInReload,externalBursts,projectedReps,projectedEffects,dmgProfile,setDmgProfile,tgtProfile,setTgtProfile,priceHub,setPriceHub,priceSource}){
  // Per-section collapse state — all open by default.
  const [collapsed,setCollapsed]=useState({});
  const toggle=(k)=>setCollapsed(c=>({...c,[k]:!c[k]}));
  const isOpen=(k)=>!collapsed[k];
  // Firepower: which stat's damage-type split to show. Cap: toggle readouts.
  const [dmgSource,setDmgSource]=useState("weapon");
  const [capDeltaMode,setCapDeltaMode]=useState("net");
  const [peakMode,setPeakMode]=useState("regen");
  // Incoming damage profile is lifted to FittingsScreen (shared with the Fit tab's readouts).
  const [showProfilePicker,setShowProfilePicker]=useState(false);
  const [showTargetPicker,setShowTargetPicker]=useState(false);
  // Market price state — hub controlled from Settings > Market, prices fetched from Fuzzwork.
  const [prices,setPrices]=useState(null);
  const [priceLoading,setPriceLoading]=useState(false);
  // Collect typeID+qty pairs per display group for pricing.
  const priceItems=useMemo(()=>{
    const allSlots=[...(slots.high??[]),...(slots.mid??[]),...(slots.low??[]),...(slots.rigs??[]),...(slots.subsystems??[])];
    const resolveAmmo=s=>{const nm=(s.ammo||'').replace(/\s*\(\d+\)$/,'');return nm?tidByName(nm):null;};
    return{
      ship:ship?.typeID?[{typeID:ship.typeID,qty:1}]:[],
      // `abyssal` modules keep their BASE typeID and carry the roll in `mutaplasmid`/`mutations`,
      // so a market lookup would price them as the unmutated module — which is meaningless: a
      // rolled module's value depends entirely on the roll and ranges over orders of magnitude.
      // They're listed but never priced, and are left out of the totals.
      modules:allSlots.filter(s=>s?.typeID).map(s=>({typeID:s.typeID,qty:1,
        abyssal:s.mutaplasmid!=null||metaOf(s.typeID,null)==='Abyssal'})),
      charges:allSlots.filter(s=>s?.ammo).map(s=>({typeID:resolveAmmo(s),qty:1})).filter(s=>s.typeID),
      character:[
        ...(implants??[]).filter(i=>i?.name&&i.name!=='[Empty]').map(i=>({typeID:tidByName(i.name),qty:1})),
        ...(boosters??[]).map(b=>({typeID:tidByName(b.name),qty:1})),
      ].filter(s=>s.typeID),
      drones:(drones??[]).map(d=>({typeID:d.typeID??tidByName(d.name),qty:d.qty??1})).filter(d=>d.typeID),
    };
  },[ship,slots,implants,boosters,drones]);
  const allPriceIDs=useMemo(()=>{const s=new Set();for(const g of Object.values(priceItems))for(const{typeID}of g)if(typeID)s.add(typeID);return[...s];},[priceItems]);
  const fitFingerprint=useMemo(()=>allPriceIDs.slice().sort((a,b)=>a-b).join(','),[allPriceIDs]);
  useEffect(()=>{
    if(!allPriceIDs.length)return;
    let cancelled=false;
    setPriceLoading(true);
    fetchPrices(allPriceIDs,priceHub,priceSource)
      .then(m=>{if(!cancelled){setPrices(m);setPriceLoading(false);}})
      .catch(()=>{if(!cancelled)setPriceLoading(false);});
    return()=>{cancelled=true;};
  },[fitFingerprint,priceHub,priceSource]);// eslint-disable-line react-hooks/exhaustive-deps
  const groupTotals=useMemo(()=>{
    const sum=items=>items.reduce((acc,{typeID,qty,abyssal})=>acc+(abyssal?0:(prices?.get(typeID)??0)*qty),0);
    return{ship:sum(priceItems.ship),modules:sum(priceItems.modules),charges:sum(priceItems.charges),character:sum(priceItems.character),drones:sum(priceItems.drones)};
  },[priceItems,prices]);
  const totalPrice=useMemo(()=>Object.values(groupTotals).reduce((a,b)=>a+b,0),[groupTotals]);
  // The hull-and-fit cost is the number you compare against another fit; implants and boosters are
  // a property of the PILOT and follow you from ship to ship, so a total that silently folds in a
  // set of high-grades tells you very little about the fit itself. Both are shown, split by colour
  // rather than by a label, since the pair reads fine without one.
  const hullPrice=useMemo(()=>totalPrice-(groupTotals.character??0),[totalPrice,groupTotals]);
  // Per-item breakdown behind each Fit Value row. Identical typeIDs are merged (a fit with 6 of the
  // same launcher reads "6x …" on one line rather than six lines), then sorted by TOTAL value
  // descending so the expensive things are what you see first.
  const priceBreakdown=useMemo(()=>{
    const out={};
    for(const[group,items]of Object.entries(priceItems)){
      const merged=new Map();
      for(const{typeID,qty,abyssal}of items){
        if(!typeID)continue;
        // Keyed by typeID AND the abyssal flag, so a rolled module never merges with an unrolled
        // one of the same base type — they'd share a row but not a price.
        const key=abyssal?`${typeID}*`:String(typeID);
        const e=merged.get(key)??{typeID,abyssal:!!abyssal,qty:0,unit:abyssal?null:(prices?.get(typeID)??0)};
        e.qty+=qty??1;
        merged.set(key,e);
      }
      out[group]=[...merged.values()]
        .map(e=>({...e,name:TYPES[String(e.typeID)]?.n??`#${e.typeID}`,total:e.abyssal?null:e.unit*e.qty}))
        // Unpriced (abyssal) rows sort last; the rest by value descending.
        .sort((a,b)=>(a.total==null)-(b.total==null)||(b.total??0)-(a.total??0));
    }
    return out;
  },[priceItems,prices]);
  // Separate from `collapsed` (which is open-by-default): these nested rows default to CLOSED,
  // so absence from the set means closed.
  const[openPriceGroups,setOpenPriceGroups]=useState({});
  const togglePriceGroup=k=>setOpenPriceGroups(o=>({...o,[k]:!o[k]}));
  const fmtISK=n=>{if(!n)return'—';if(n>=1e12)return`${(n/1e12).toFixed(2)}T ISK`;if(n>=1e9)return`${(n/1e9).toFixed(2)}B ISK`;if(n>=1e6)return`${(n/1e6).toFixed(2)}M ISK`;if(n>=1e3)return`${(n/1e3).toFixed(1)}K ISK`;return`${Math.round(n).toLocaleString()} ISK`;};
  // The selected profile also drives any Reactive Armor Hardener set to "fit pattern" (damageProfile).
  const cs=calcFitStats(ship,slots,drones??[],skills,{implants,boosters,factorInReload,externalBursts,projectedWebMult:projectedEffects?.webMult,projectedNeutGJs:projectedEffects?.neutGJs,projectedCapGJs:projectedEffects?.capGJs,projectedDebuffs:projectedEffects?.debuffs,projectedBoosts:projectedEffects?.boosts,damageProfile:dmgProfile.p,targetResists:tgtProfile?.r,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity,fighters:(fighters??[]).map(f=>({name:f.name,qty:f.qty??1,active:f.active,abilities:f.abilities}))})??{};
  // Profile-weighted EHP: rawHP / Σ(profile_i × resonance_i), resonance = 1 - resist/100.
  const ehpForProfile=(rawHP,res)=>{
    const p=dmgProfile.p;
    const div=p[0]*(1-(res?.em??0)/100)+p[1]*(1-(res?.th??0)/100)+p[2]*(1-(res?.kin??0)/100)+p[3]*(1-(res?.exp??0)/100);
    return rawHP/Math.max(1e-4,div);
  };
  const r=cs.resists??ship?.resists??{};
  const fmtN=n=>(n==null||n===0)?"0":n>=1e6?`${(n/1e6).toFixed(2)}M`:n>=1000?`${(n/1000).toFixed(1)}k`:String(Math.round(n));
  const fmtF=n=>n==null?"0.0":n>=100?n.toFixed(0):n.toFixed(2);
  const fmtDps=n=>n==null||n<0.05?"0":n>=100?n.toFixed(0):n.toFixed(1);

  const card={background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,marginBottom:8,overflow:"hidden"};
  const hd={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt};
  const Row=({label,value,color,last})=>(<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 12px",borderBottom:last?"none":`1px solid ${C.border}`}}><span style={{fontSize:11,color:C.textMid}}>{label}</span><span style={{fontSize:11,fontWeight:600,color:color||C.text}}>{value}</span></div>);
  // Collapsible section header — click toggles open/closed; `right` is optional header-right content.
  const SectionHead=({id,title,right})=>(
    <div style={{...hd,cursor:"pointer",borderBottom:isOpen(id)?hd.borderBottom:"none"}} onClick={()=>toggle(id)}>
      <span style={{display:"flex",alignItems:"center",gap:6}}>
        <span style={{fontSize:10,color:C.textMute,transform:isOpen(id)?"rotate(90deg)":"none",transition:"transform 0.15s",display:"inline-block",width:10}}>▶</span>
        <span style={{fontSize:11,fontWeight:700,color:C.text}}>{title}</span>
      </span>
      {right}
    </div>
  );

  const shieldEHPp = ehpForProfile(cs.shieldHP??0, r.shield);
  const armorEHPp  = ehpForProfile(cs.armorHP??0,  r.armor);
  const hullEHPp   = ehpForProfile(cs.hullHP??0,   r.hull);
  const totalEHPp  = shieldEHPp + armorEHPp + hullEHPp;
  const layers=[
    {key:"shield",label:"Shield",hp:fmtN(cs.shieldHP??0),ehp:fmtN(shieldEHPp),
     em:r.shield?.em??0,th:r.shield?.th??0,kin:r.shield?.kin??0,exp:r.shield?.exp??0,
     regen:`${fmtF(cs.passiveShieldRegen??0)} HP/s`, repLabel:cs.shieldRepPS>0?`Boost: ${fmtF(cs.shieldRepPS)} HP/s`:""},
    {key:"armor", label:"Armor", hp:fmtN(cs.armorHP??0), ehp:fmtN(armorEHPp),
     em:r.armor?.em??0, th:r.armor?.th??0, kin:r.armor?.kin??0, exp:r.armor?.exp??0,
     regen:cs.armorRepPS>0?`Rep: ${fmtF(cs.armorRepEhpS??cs.armorRepPS)} EHP/s`:"", repLabel:""},
    {key:"hull",  label:"Hull",  hp:fmtN(cs.hullHP??0),  ehp:fmtN(hullEHPp),
     em:r.hull?.em??0,  th:r.hull?.th??0,  kin:r.hull?.kin??0,  exp:r.hull?.exp??0,
     regen:cs.hullRepPS>0?`Rep: ${fmtF(cs.hullRepPS)} HP/s`:"", repLabel:""},
  ];

  // With a target resist profile selected, every firepower figure shown is the RESIST-WEIGHTED one
  // (cs.effective); with "None" the two are identical, so this needs no branching of its own.
  // cs.weaponDps and friends stay raw for anything that wants unmitigated numbers.
  const _tgtOn = !!(tgtProfile?.r && tgtProfile.r.some(v=>v>0));
  const eff = cs.effective ?? {};
  const _wDps = (_tgtOn?eff.weaponDps:cs.weaponDps)??{}, _tDps = (_tgtOn?eff.totalDps:cs.totalDps)??{};
  const _tVol = (_tgtOn?eff.totalVolley:cs.totalVolley)??{};
  const _dDps = _tgtOn?eff.droneDps:cs.droneDps, _fDps = _tgtOn?eff.fighterDps:cs.fighterDps;
  const _wDpsMax = (_tgtOn?eff.weaponDpsMax:cs.weaponDpsMax)??0;
  const _tDpsMax = (_tgtOn?eff.totalDpsMax:cs.totalDpsMax)??0;
  const _tVolMax = (_tgtOn?eff.totalVolleyMax:cs.totalVolleyMax)??0;
  const weapDpsTotal  = fmtDps(_wDps.total??0);
  const droneDpsTotal = fmtDps((_dDps?.total??0) + (_fDps?.total??0));
  const totalDpsN     = fmtDps(_tDps.total??0);
  const totalVolleyN  = fmtDps(_tVol.total??0);
  // Entropic disintegrators spool up: show min–max ranges for the spooled weapon/total.
  const hasSpool      = !!cs.hasSpoolWeapon;
  const weapDpsDisp   = hasSpool ? `${weapDpsTotal}-${fmtDps(_wDpsMax)}` : weapDpsTotal;
  const totalDpsDisp  = hasSpool ? `${totalDpsN}-${fmtDps(_tDpsMax)}`    : totalDpsN;
  const totalVolDisp  = hasSpool ? `${totalVolleyN}-${fmtDps(_tVolMax)}` : totalVolleyN;
  // Selected firepower stat's damage-type split (tap a column to switch). Fighters are lumped
  // with drones (as Pyfa does) in the "Drone" column.
  const _dfSplit = ['em','th','kin','exp','total'].reduce((o,k)=>{o[k]=(_dDps?.[k]??0)+(_fDps?.[k]??0);return o;},{});
  const dmgSplit      = ({weapon:_wDps,drone:_dfSplit,total:_tDps,volley:_tVol}[dmgSource])??{};
  const dmgSourceLabel= ({weapon:"Weapon",drone:"Drone",total:"Total",volley:"Volley"}[dmgSource]);
  // Cap: incoming GJ/s (peak regen + injector fill) and cap-battery neut resistance %.
  const capInGJs      = peakRegen(cs.capCapacity,cs.capRechargeMs)+(cs.capFillPS??0);
  const neutResistPct = (1-(cs.energyWarfareResist??1))*100;

  return(
    <div style={{flex:1,overflowY:"auto",padding:"10px 10px 20px"}}>
      {showProfilePicker&&<DamageProfileSheet current={dmgProfile} onSelect={setDmgProfile} onClose={()=>setShowProfilePicker(false)}/>}
      {showTargetPicker&&<TargetProfileSheet current={tgtProfile} onSelect={setTgtProfile} onClose={()=>setShowTargetPicker(false)}/>}

      {/* Fit Validation */}
      {(()=>{
        const fr=n=>Math.abs(n)>=100?String(Math.round(Math.abs(n))):Math.abs(n).toFixed(1);
        const issues=[];
        if((cs.cpuUsed??0)>(cs.cpuTotal??0)+0.01) issues.push({sev:"err",msg:`CPU overloaded by ${fr(cs.cpuUsed-cs.cpuTotal)} tf`});
        if((cs.pgUsed??0)>(cs.pgTotal??0)+0.01) issues.push({sev:"err",msg:`Powergrid overloaded by ${fr(cs.pgUsed-cs.pgTotal)} MW`});
        if((cs.calUsed??0)>(cs.calTotal??0)+0.01) issues.push({sev:"err",msg:`Calibration exceeded by ${fr(cs.calUsed-cs.calTotal)} points`});
        const _dRec=(d)=>TYPES[d.typeID]??TYPES[tidByName(d.name)];
        const _dBW=(d)=>{const t=_dRec(d);return t?.attrs?.droneBandwidthUsed ?? t?.a?.droneBandwidthUsed ?? d.bandwidth ?? 5;};
        const _dVol=(d)=>{const t=_dRec(d);return t?.attrs?.volume ?? t?.a?.volume ?? d.volume ?? 5;};
        const bayUsed=(drones??[]).reduce((s,d)=>s+(d.qty??0)*_dVol(d),0);
        const bwUsed=(drones??[]).filter(d=>d.active).reduce((s,d)=>s+(d.qty??0)*_dBW(d),0);
        if((cs.droneBay??0)>0&&bayUsed>cs.droneBay+0.01) issues.push({sev:"err",msg:`Drone bay over capacity by ${fr(bayUsed-cs.droneBay)} m³`});
        if((cs.droneBandwidth??0)>0&&bwUsed>cs.droneBandwidth+0.01) issues.push({sev:"err",msg:`Drone bandwidth exceeded by ${fr(bwUsed-cs.droneBandwidth)} Mbit/s`});
        const hasErr=issues.some(i=>i.sev==="err");
        const accent=hasErr?C.danger:(issues.length?C.warning:C.success);
        return(
          <div style={{...card,border:`1px solid ${issues.length?accent:C.border}`}}>
            <SectionHead id="validation" title="Validation" right={<span style={{fontSize:11,fontWeight:700,color:accent}}>{issues.length?`${issues.length} issue${issues.length>1?"s":""}`:"Valid"}</span>}/>
            {isOpen("validation")&&(issues.length
              ?<div style={{padding:"2px 0"}}>{issues.map((it,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",borderBottom:i<issues.length-1?`1px solid ${C.border}`:"none"}}>
                    <span style={{width:7,height:7,borderRadius:99,background:it.sev==="err"?C.danger:C.warning,flexShrink:0}}/>
                    <span style={{fontSize:11,color:C.text}}>{it.msg}</span>
                  </div>))}</div>
              :<div style={{padding:"8px 12px",fontSize:11,color:C.textMid,display:"flex",alignItems:"center",gap:8}}><span style={{color:C.success,fontWeight:800}}>✓</span> No fitting issues detected.</div>)}
          </div>
        );
      })()}

      {/* Resistances */}
      <div style={card}>
        <SectionHead id="resists" title="Resistances" right={<span style={{fontSize:11,color:C.textMute}}>EHP: <span style={{color:C.rig,fontWeight:700}}>{fmtN(totalEHPp)}</span></span>}/>
        {isOpen("resists")&&<div onClick={()=>setShowProfilePicker(true)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 12px",borderBottom:`1px solid ${C.border}`,background:`${C.surfaceAlt}88`,cursor:"pointer"}}>
          <span style={{fontSize:10,color:C.textMute}}>Incoming damage</span>
          <span style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{display:"flex",gap:3}}>
              {[["em",dmgProfile.p[0]],["th",dmgProfile.p[1]],["kin",dmgProfile.p[2]],["exp",dmgProfile.p[3]]].map(([k,v])=>(<span key={k} style={{width:5,height:5,borderRadius:99,background:DMG[k].color,opacity:v>0.001?0.4+v*0.6:0.12}}/>))}
            </span>
            <span style={{fontSize:11,fontWeight:700,color:C.accent,borderBottom:`1px dotted ${C.accent}`}}>{dmgProfile.name}</span>
          </span>
        </div>}
        {isOpen("resists")&&<>
        <div style={{display:"grid",gridTemplateColumns:"52px 1fr 1fr 1fr 1fr 44px",padding:"5px 12px 4px",borderBottom:`1px solid ${C.border}`}}>
          <span/>{Object.values(DMG).map(d=><span key={d.label} style={{fontSize:10,fontWeight:700,color:d.color,textAlign:"center"}}>{d.label}</span>)}<span style={{fontSize:10,fontWeight:700,color:C.textMute,textAlign:"right"}}>EHP</span>
        </div>
        {layers.map((layer,li)=>(<div key={layer.key}>
          <div style={{display:"grid",gridTemplateColumns:"52px 1fr 1fr 1fr 1fr 44px",padding:"5px 12px",alignItems:"center",borderBottom:`1px solid ${C.border}`}}>
            <span style={{fontSize:10,fontWeight:600,color:C.textMid}}>{layer.label}</span>
            {[{v:layer.em,d:DMG.em},{v:layer.th,d:DMG.th},{v:layer.kin,d:DMG.kin},{v:layer.exp,d:DMG.exp}].map(({v,d})=>(
              <div key={d.label} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <div style={{width:"80%",height:3,background:C.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${v}%`,height:"100%",background:d.color,borderRadius:99}}/></div>
                <span style={{fontSize:10,fontWeight:600,color:d.color}}>{typeof v === "number" ? v.toFixed(1) : v}%</span>
              </div>
            ))}
            <span style={{fontSize:10,fontWeight:700,color:C.text,textAlign:"right"}}>{layer.ehp}</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"52px 1fr auto",padding:"3px 12px",borderBottom:(layers.length-1>li)?`1px solid ${C.border}`:"none",background:`${C.surfaceAlt}88`}}>
            <span style={{fontSize:9,color:C.textMute}}>HP: {layer.hp}</span>
            <span style={{fontSize:9,color:C.textMute,textAlign:"center"}}>{layer.regen||layer.repLabel||""}</span>
            <span style={{fontSize:9,fontWeight:700,color:C.rig,textAlign:"right"}}>{ehpForProfile(1,{em:layer.em,th:layer.th,kin:layer.kin,exp:layer.exp}).toFixed(2)}x</span>
          </div>
        </div>))}
        </>}
      </div>

      {/* Recharge Rates */}
      <div style={card}>
        <SectionHead id="recharge" title="Recharge Rates"/>
        {isOpen("recharge")&&(() => {
            // Convert HP/s to EHP/s using the selected incoming damage profile.
            const avgR=(r)=>((r?.em??0)+(r?.th??0)+(r?.kin??0)+(r?.exp??0))/4;
            const toEhp=(hps,layer)=>hps*ehpForProfile(1,cs.resists?.[layer]);
            // Precomputed cs.*EhpS were derived with AVERAGE resists in calc; reweight to the profile
            // (preserves their paste-phase raw rep nuance, swaps only the resist weighting).
            const avgMultOf=(layer)=>{const a=avgR(cs.resists?.[layer]);return a>=100?1:1/(1-a/100);};
            const reweight=(ehpS,layer)=>ehpS*ehpForProfile(1,cs.resists?.[layer])/Math.max(1e-6,avgMultOf(layer));
            // AAR/ASB EhpS arrive already profile-weighted from calc.js (their ehpMult uses the same
            // damage profile); regular-repairer EhpS use layerEHP (average resist) and must be
            // reweighted to the profile. `profiled` flags which case applies so we don't double-count.
            const repEhp=(ehpS,layer,profiled)=>profiled?ehpS:reweight(ehpS,layer);
            const shieldEhpS=toEhp(cs.passiveShieldRegen??0,'shield');
            const shieldRepEhpS=cs.shieldRepEhpS>0?repEhp(cs.shieldRepEhpS,'shield',cs.shieldRepIsASB):toEhp(cs.shieldRepPS??0,'shield');
            // Use slotEngineStats-based EHP/s (Pyfa style: paste phase, with resists)
            const armorRepEhpS=cs.armorRepEhpS>0?repEhp(cs.armorRepEhpS,'armor',cs.armorRepIsAAR):toEhp(cs.armorRepPS??0,'armor');
            const hullRepEhpS=toEhp(cs.hullRepPS??0,'hull');
            // Sustained (cap-limited) rep — pyfa style. Only differs from peak when cap-unstable.
            const susShieldEhpS=cs.shieldRepSustainedEhpS!=null?repEhp(cs.shieldRepSustainedEhpS,'shield',cs.shieldRepIsASB):toEhp(cs.sustainedShieldRepPS??cs.shieldRepPS??0,'shield');
            const susArmorEhpS =cs.armorRepSustainedEhpS!=null?repEhp(cs.armorRepSustainedEhpS,'armor',cs.armorRepIsAAR):toEhp(cs.sustainedArmorRepPS??cs.armorRepPS??0,'armor');
            const susHullEhpS  =toEhp(cs.sustainedHullRepPS??cs.hullRepPS??0,'hull');
            // Incoming remote reps (projected) → EHP/s by own resists. Included in FULL in both peak and
            // sustained, independent of the supplying ship's capacitor stability.
            const incShield=toEhp(projectedReps?.shield??0,'shield');
            const incArmor =toEhp(projectedReps?.armor??0,'armor');
            const incHull  =toEhp(projectedReps?.hull??0,'hull');
            const hasInc=(incShield+incArmor+incHull)>0.05;
            // Does the layer show a rep value at all (local rep present OR incoming reps present)?
            const showShield=(cs.shieldRepPS??0)>0||incShield>0.05;
            const showArmor =(cs.armorRepPS??0)>0||incArmor>0.05;
            const showHull  =(cs.hullRepPS??0)>0||incHull>0.05;
            const peak=[
              {label:"Shield Regen", val:`${fmtF(shieldEhpS)} EHP/s`, color:C.mid},
              {label:"Shield Boost", val:showShield?`${fmtF(shieldRepEhpS+incShield)} EHP/s`:"0 EHP/s", color:C.mid},
              {label:"Armor Rep",    val:showArmor?`${fmtF(armorRepEhpS+incArmor)} EHP/s`:"0 EHP/s",   color:C.warning},
              {label:"Hull Rep",     val:showHull?`${fmtF(hullRepEhpS+incHull)} EHP/s`:"0 EHP/s",     color:C.danger},
            ];
            // Sustained row values, aligned to the same columns (regen has no sustained variant → blank).
            // Sustained includes the full incoming remote rep (supplier-cap-independent).
            const sustained=[
              null,
              showShield?`${fmtF(susShieldEhpS+incShield)} EHP/s`:null,
              showArmor ?`${fmtF(susArmorEhpS+incArmor)} EHP/s`:null,
              showHull  ?`${fmtF(susHullEhpS+incHull)} EHP/s`:null,
            ];
            // Show the sustained row only when any LOCAL rep is cap-throttled (sustained < peak).
            const showSustained = (
              ((cs.shieldRepPS??0)>0 && susShieldEhpS < shieldRepEhpS-0.05) ||
              ((cs.armorRepPS??0)>0  && susArmorEhpS  < armorRepEhpS-0.05) ||
              ((cs.hullRepPS??0)>0   && susHullEhpS   < hullRepEhpS-0.05)
            );
            return(<>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",borderBottom:showSustained?`1px solid ${C.border}`:"none"}}>
                {peak.map((rr,i,arr)=>(
                  <div key={rr.label} style={{padding:"8px 8px",textAlign:"center",borderRight:arr.length>(i+1)?`1px solid ${C.border}`:"none"}}>
                    <div style={{fontSize:9,fontWeight:700,color:C.textMute,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>{rr.label}</div>
                    <div style={{fontSize:12,fontWeight:700,color:rr.val.startsWith("0")?C.textMute:rr.color}}>{rr.val}</div>
                  </div>
                ))}
              </div>
              {showSustained&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",background:`${C.surfaceAlt}88`}}>
                {sustained.map((val,i)=>(
                  <div key={i} style={{padding:"5px 8px",textAlign:"center",borderRight:i<3?`1px solid ${C.border}`:"none"}}>
                    {i===0
                      ? <div style={{fontSize:8,fontWeight:700,color:C.textMute,textTransform:"uppercase",letterSpacing:0.5}}>Sustained</div>
                      : <div style={{fontSize:11,fontWeight:700,color:val?peak[i].color:C.textMute}}>{val??"—"}</div>}
                  </div>
                ))}
              </div>}
              {hasInc&&<div style={{padding:"5px 12px",background:`${C.surfaceAlt}88`,fontSize:10,color:C.textMute,display:"flex",gap:10,flexWrap:"wrap"}}>
                <span style={{fontWeight:700,color:C.rig}}>incl. remote:</span>
                {incShield>0.05&&<span><span style={{color:C.mid,fontWeight:700}}>+{fmtF(incShield)}</span> shield</span>}
                {incArmor>0.05&&<span><span style={{color:C.warning,fontWeight:700}}>+{fmtF(incArmor)}</span> armor</span>}
                {incHull>0.05&&<span><span style={{color:C.danger,fontWeight:700}}>+{fmtF(incHull)}</span> hull</span>}
                <span>EHP/s</span>
              </div>}
            </>);
          })()}
      </div>

      {/* Firepower */}
      <div style={card}>
        <SectionHead id="firepower" title="Firepower" right={
          <button onClick={e=>{e.stopPropagation();setFactorInReload&&setFactorInReload(v=>!v);}}
            style={{display:"flex",alignItems:"center",gap:5,padding:"2px 7px",borderRadius:6,fontSize:9,fontWeight:700,cursor:"pointer",
              background:factorInReload?C.accentLight:C.surface,border:`1px solid ${factorInReload?C.accent:C.border}`,color:factorInReload?C.accent:C.textMute}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:factorInReload?C.accent:C.textMute,display:"inline-block"}}/>
            Reload
          </button>
        }/>
        {isOpen("firepower")&&<div onClick={()=>setShowTargetPicker(true)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 12px",borderBottom:`1px solid ${C.border}`,background:`${C.surfaceAlt}88`,cursor:"pointer"}}>
          <span style={{fontSize:10,color:C.textMute}}>Target resists</span>
          <span style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{display:"flex",gap:3}}>
              {[["em",tgtProfile?.r?.[0]??0],["th",tgtProfile?.r?.[1]??0],["kin",tgtProfile?.r?.[2]??0],["exp",tgtProfile?.r?.[3]??0]].map(([k,v])=>(<span key={k} style={{width:5,height:5,borderRadius:99,background:DMG[k].color,opacity:v>0.001?0.4+v*0.6:0.12}}/>))}
            </span>
            <span style={{fontSize:11,fontWeight:700,color:C.accent,borderBottom:`1px dotted ${C.accent}`}}>{tgtProfile?.n??"None (0%)"}</span>
          </span>
        </div>}
        {isOpen("firepower")&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",borderBottom:`1px solid ${C.border}`}}>
          {[["Weapon DPS",weapDpsDisp,"weapon"],["Drone DPS",droneDpsTotal,"drone"],["Total DPS",totalDpsDisp,"total"],["Volley",totalVolDisp,"volley"]].map(([label,val,srcKey],i,arr)=>{
            const sel=dmgSource===srcKey;
            return(
            <div key={label} onClick={()=>setDmgSource(srcKey)} style={{padding:"8px 6px",textAlign:"center",borderRight:arr.length>(i+1)?`1px solid ${C.border}`:"none",cursor:"pointer",background:sel?C.accentLight:"transparent"}}>
              <div style={{fontSize:14,fontWeight:800,color:val==="0"?C.textMute:(sel?C.accent:C.text)}}>{val}</div>
              <div style={{fontSize:9,color:sel?C.accent:C.textMute,marginTop:1}}>{label}</div>
            </div>);
          })}
        </div>
        {hasSpool&&(cs.weaponSpoolTimeS??0)>0&&<div style={{padding:"5px 12px",background:`${C.surfaceAlt}88`,display:"flex",justifyContent:"space-between",fontSize:10,borderBottom:`1px solid ${C.border}`}}>
          <span style={{color:C.textMute}}>Spool-up time</span>
          <span style={{color:C.text,fontWeight:700}}>{fmtF(cs.weaponSpoolTimeS)}s</span>
        </div>}
        {(dmgSplit.total??0)>0&&<div style={{padding:"6px 12px",background:`${C.surfaceAlt}88`,display:"flex",gap:10,fontSize:10,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{color:C.textMute,fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:.3}}>{dmgSourceLabel}</span>
          {[["EM",dmgSplit.em,DMG.em.color],["Thermal",dmgSplit.th,DMG.th.color],["Kinetic",dmgSplit.kin,DMG.kin.color],["Explosive",dmgSplit.exp,DMG.exp.color]].filter(([,v])=>(v??0)>0.05).map(([l,v,c])=>(
            <span key={l}><span style={{color:c,fontWeight:700}}>{fmtDps(v)}</span> <span style={{color:C.textMute}}>{l}</span></span>
          ))}
        </div>}
        </>}
      </div>

      {/* Remote Reps — text labels, same style as other sections */}
      {(cs.remoteRepModules?.length??0)>0&&(()=>{
        // Triglavian logistics: a Mutadaptive remote armor repairer spools its rep amount.
        const spoolRep = (cs.remoteRepModules||[]).find(m=>(m.spoolFactor??1)>1);
        const armorMax = spoolRep ? (cs.remoteArmorPS??0) - (spoolRep.repPS??0) + (spoolRep.repPSMax??0) : (cs.remoteArmorPS??0);
        // pyfa column order: Cap, Shield, Armor, Hull
        const cols=[
          {key:"cap",   label:"Cap",    unit:"GJ/s", val:cs.remoteCapPS??0,    color:C.rig},
          {key:"shield",label:"Shield", unit:"HP/s", val:cs.remoteShieldPS??0, color:C.mid},
          {key:"armor", label:"Armor",  unit:"HP/s", val:cs.remoteArmorPS??0,  color:C.warning,
            disp: spoolRep ? `${fmtF(cs.remoteArmorPS??0)}-${fmtF(armorMax)} HP/s` : null},
          {key:"hull",  label:"Hull",   unit:"HP/s", val:cs.remoteHullPS??0,   color:C.danger},
        ];
        return(
          <div style={card}>
            <SectionHead id="remotereps" title="Remote Reps"/>
            {isOpen("remotereps")&&<>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",borderBottom:spoolRep?`1px solid ${C.border}`:"none"}}>
              {cols.map((col,i)=>(
                <div key={col.key} style={{padding:"8px 6px",textAlign:"center",borderRight:i<cols.length-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{fontSize:9,fontWeight:700,color:C.textMute,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>{col.label}</div>
                  <div style={{fontSize:12,fontWeight:700,color:col.val>0?col.color:C.textMute}}>{col.disp??`${fmtF(col.val)} ${col.unit}`}</div>
                </div>
              ))}
            </div>
            {spoolRep&&(spoolRep.spoolTimeS??0)>0&&<div style={{padding:"5px 12px",background:`${C.surfaceAlt}88`,display:"flex",justifyContent:"space-between",fontSize:10}}>
              <span style={{color:C.textMute}}>Spool-up time</span>
              <span style={{color:C.text,fontWeight:700}}>{fmtF(spoolRep.spoolTimeS)}s</span>
            </div>}
            </>}
          </div>
        );
      })()}

      {/* Cap */}
      <div style={card}>
        <SectionHead id="cap" title="Capacitor" right={(()=>{
          const fmtDur=(s)=>{if(s==null)return "?";s=Math.round(s);if(s<60)return s+"s";const m=Math.floor(s/60),sec=s%60;if(m<60)return sec?`${m}m ${sec}s`:`${m}m`;const h=Math.floor(m/60),mm=m%60;return mm?`${h}h ${mm}m`:`${h}h`;};
          return cs.capStable
            ?<span style={{fontSize:11,fontWeight:700,color:C.success}}>Stable at {((cs.capLevel??1)*100).toFixed(1)}%</span>
            :<span style={{fontSize:11,fontWeight:700,color:C.danger}}>Unstable - depleted in {fmtDur(cs.capTime)}</span>;
        })()}/>
        {isOpen("cap")&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",borderBottom:`1px solid ${C.border}`}}>
          <div style={{padding:"7px 8px",textAlign:"center",borderRight:`1px solid ${C.border}`}}><div style={{fontSize:12,fontWeight:700,color:C.warning}}>{fmtN(cs.capCapacity??0)} GJ</div><div style={{fontSize:9,color:C.textMute}}>Capacity</div></div>
          <div onClick={()=>setCapDeltaMode(m=>m==="net"?"inout":"net")} style={{padding:"7px 8px",textAlign:"center",borderRight:`1px solid ${C.border}`,cursor:"pointer"}}>
            {capDeltaMode==="net"
              ?<><div style={{fontSize:12,fontWeight:700,color:cs.capDelta>=0?C.success:C.danger}}>{(cs.capDelta??0)>=0?"+":""}{fmtF(cs.capDelta??0)}</div><div style={{fontSize:9,color:C.textMute,borderBottom:`1px dotted ${C.textMute}`,display:"inline-block",lineHeight:1.3}}>Net GJ/s</div></>
              :<><div style={{fontSize:11,fontWeight:700,lineHeight:1.35}}><span style={{color:C.success}}>+{fmtF(capInGJs)}</span> <span style={{color:C.danger}}>-{fmtF(cs.capDrainPS??0)}</span></div><div style={{fontSize:9,color:C.textMute,borderBottom:`1px dotted ${C.textMute}`,display:"inline-block",lineHeight:1.3}}>In / Out GJ/s</div></>}
          </div>
          <div onClick={()=>setPeakMode(m=>m==="regen"?"neut":"regen")} style={{padding:"7px 8px",textAlign:"center",cursor:"pointer"}}>
            {peakMode==="regen"
              ?<><div style={{fontSize:12,fontWeight:700,color:C.textMid}}>{fmtF(peakRegen(cs.capCapacity,cs.capRechargeMs))} GJ/s</div><div style={{fontSize:9,color:C.textMute,borderBottom:`1px dotted ${C.textMute}`,display:"inline-block",lineHeight:1.3}}>Peak regen</div></>
              :<><div style={{fontSize:12,fontWeight:700,color:neutResistPct>0.05?C.rig:C.textMid}}>{neutResistPct.toFixed(1)}%</div><div style={{fontSize:9,color:C.textMute,borderBottom:`1px dotted ${C.textMute}`,display:"inline-block",lineHeight:1.3}}>Neut resist</div></>}
          </div>
        </div>
        <Row label="Recharge time" value={`${((cs.capRechargeMs??0)/1000).toFixed(0)} s`} last/>
        </>}
      </div>

      {/* Targeting & Misc */}
      <div style={card}>
        <SectionHead id="targeting" title="Targeting and Misc"/>
        {isOpen("targeting")&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}>
          {[
            ["Targets",   String(Math.round(cs.maxTargets??0))],
            ["Speed", `${Math.round((cs.maxVelocityAB&&cs.maxVelocityAB!==cs.maxVelocity)?cs.maxVelocityAB:(cs.maxVelocity??0))} m/s`],
            ["Lock range",`${fmtF(cs.targetRange??0)} km`],
            ["Align",     `${fmtF(cs.alignTime??0)} s`],
            ["Scan res.", `${fmtN(cs.scanRes??0)} mm`],
            ["Signature", `${fmtN(cs.sigRadius??0)} m`],
            ["Sensor",    `${cs.sensorStrength??0} ${cs.sensorType??""}`],
            ["Warp",      `${fmtF(cs.warpSpeed??3)} AU/s`],
            ...(cs.droneBay>0?[["Drone range",`${fmtN(Math.round((cs.droneControlRange??0)/1000))} km`]]:[]),
            ["Cargo",     `${fmtN(cs.cargoCapacity??0)} m³`],
            // Engine-computed, so it already includes plate/MWD massAddition and any Higgs Anchor
            // multiplier — the same value feeding the align-time cell above it.
            ["Mass",      `${fmtN(cs.mass??0)} kg`],
          ].map(([label,val],i,arr)=>{
            const bb=arr.length>(i+2)?`1px solid ${C.border}`:"none";
            const br=(i%2===0)?`1px solid ${C.border}`:"none";
            return(<div key={label} style={{padding:"5px 12px",fontSize:11,borderBottom:bb,borderRight:br,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:C.textMid}}>{label}</span><span style={{fontWeight:600,color:C.text}}>{val}</span>
            </div>);
          })}
        </div>}
      </div>

      {/* Fit Value */}
      <div style={card}>
        <SectionHead id="fitvalue" title="Fit Value" right={
          <span style={{fontSize:11,fontWeight:700,display:"flex",alignItems:"baseline",gap:5}}>
            <span style={{color:C.rig}}>{priceLoading?'…':fmtISK(hullPrice)}</span>
            {!priceLoading&&(groupTotals.character??0)>0&&
              <span style={{color:C.accent}} title="Including implants and boosters">{fmtISK(totalPrice)}</span>}
          </span>
        }/>
        {isOpen("fitvalue")&&<>
          {[['Ship','ship'],['Modules','modules'],['Charges','charges'],['Character','character'],['Drones','drones']].map(([label,key],i,arr)=>{
            const val=groupTotals[key], items=priceBreakdown[key]??[], last=i===arr.length-1;
            const expandable=items.length>0&&!priceLoading;
            const open=expandable&&openPriceGroups[key];
            return(<div key={label}>
              <div onClick={expandable?()=>togglePriceGroup(key):undefined}
                style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 12px",
                        borderBottom:(last&&!open)?"none":`1px solid ${C.border}`,cursor:expandable?"pointer":"default"}}>
                <span style={{fontSize:11,color:C.textMid,display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:8,color:C.textMute,width:8,display:"inline-block",
                                transform:open?"rotate(90deg)":"none",transition:"transform 0.15s",
                                opacity:expandable?1:0}}>▶</span>
                  {label}
                </span>
                <span style={{fontSize:11,fontWeight:600,color:C.text}}>{priceLoading?'…':fmtISK(val)}</span>
              </div>
              {open&&items.map((it,j)=>(
                <div key={it.typeID} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,
                     padding:"4px 12px 4px 26px",background:`${C.surfaceAlt}88`,
                     borderBottom:(last&&j===items.length-1)?"none":`1px solid ${C.border}`}}>
                  <span style={{fontSize:11,color:C.textMid,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {it.qty>1&&<span style={{color:C.textMute,fontWeight:700}}>{it.qty}x </span>}{it.name}
                  </span>
                  <span title={it.abyssal?"Abyssal module — value depends on the roll, not the base type":undefined}
                        style={{fontSize:11,fontWeight:600,color:it.abyssal?C.textMute:C.text,flexShrink:0}}>{it.abyssal?'—':fmtISK(it.total)}</span>
                </div>
              ))}
            </div>);
          })}
        </>}
      </div>
    </div>
  );
}

// ═══ GRAPH TAB ══════════════════════════════════════════════════

export { FitTab, StatsTab };
