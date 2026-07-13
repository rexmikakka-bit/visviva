import { useState, useEffect, useRef, useMemo } from "react";
import shipsData        from "./data/ships.json";
import modulesData      from "./data/modules.json";
import chargesData      from "./data/charges.json";
import dronesData       from "./data/drones.json";
import marketGroupsData from "./data/marketGroups.json";
import marketTreeData   from "./data/market-tree.json";
import mutaplasmidData  from "./data/mutaplasmids.json";
import TYPE_ICONS       from "./data/type-icons.json";
import { calcFitStats, computeCommandBursts, computeProjectedReps, calcRangeFactor, getModuleStats, layerEHP, peakRegen, calcAlignTime, calcLockTime, stackingPenalty, rangeFactor, calcTurretCTH, calcTurretMult, calcMissileFactor, SKILL_DEFAULTS, TYPES, tidByName, boosterSideEffectsFor, isT3Cruiser, subsystemsForHull, t3cSlotLayout, T3C_SUBSYSTEM_GROUPS, ATTR_ID_TO_NAME, simulateCapTrace } from "./calc.js";
import { DAMAGE_PROFILES } from "./data/damage-profiles.js";

// ── Mutaplasmid (abyssal module) indexes ─────────────────────────────────────
// mutaplasmidData[mutaTypeID] = { n:name, a:{attrID:[min,max]}, t:[baseTypeIDs], r:resultingType }
import { C } from "./theme.js";
import { eveIcon, eveRender } from "./lib/icons.js";
import { META_BY_MG, metaOf, META_COLORS, META_ORDER } from "./lib/meta.js";
import { ATTRIBUTE_IMPLANTS, HARDWIRING_IMPLANTS, BOOSTER_DATA } from "./data/static-tables.js";
import { GraphTab, GRAPH_CONFIG, generateCurve } from "./components/GraphTab.jsx";
import { BackupPanel } from "./components/backup.jsx";
import { SnapshotModal } from "./components/snapshot.jsx";
import { DRONE_TYPES } from "./dogma-engine-init.js";
import { CMD_SHIP_FITS, FIGHTER_CATALOG, GLOBAL_CSS, MT_ALL_ITEMS, MT_CHILDREN, MT_ITEMS, MT_ROOTS, REAL_DRONE_BROWSER, SAVED_FITS_SEED, WARFARE_BUFF_UNIT, _bundleListeners, _bundleReady, buildSlotsFromEFT, generateEmptySlots, getCompatibleCharges, haptic, implantData, lookupShip, navIcons, raceIcons, shipTraits, shipsByClass } from "./lib/core.js";
import { ATTR_UNIT, AccordionSection, BottomSheet, DamageProfileSheet, HIDDEN_ATTRS, ImportFitSheet, MUTA_ATTR_LABELS, ModuleBrowserSheet, ModuleInfoTab, ModuleMenu, ModuleVariationsTab, MutaplasmidEditor, NumpadModal, RESIST_ATTRS, ResourceStrip, SubsystemPickerSheet, abyssalToText, fmtAttrName, fmtAttrVal, fmtMutaVal, mutaLabel, parseAbyssal } from "./components/ui.jsx";
import { FitTab, StatsTab } from "./components/tabs.jsx";
function ActiveFitBar({activeFit,onReturn}){
  if(!activeFit)return null;
  const ship=lookupShip(activeFit.ship);
  return(<div onClick={onReturn} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 14px",background:C.accentLight,borderBottom:`1px solid ${C.accentBorder}`,cursor:"pointer",flexShrink:0}}>
    <div style={{display:"flex",alignItems:"center",gap:9}}>
      {ship.typeID&&<img className="eve-icon" src={eveRender(ship.typeID,32)} width={28} height={28} alt="" style={{borderRadius:4}} onError={e=>{e.target.style.display="none";}}/>}
      <div><div style={{fontSize:11,fontWeight:700,color:C.accent,lineHeight:1.2}}>{activeFit.ship}</div><div style={{fontSize:10,color:C.textMid,marginTop:1}}>{activeFit.fitName}</div></div>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:11,fontWeight:600,color:C.accent}}>Return to Fit</span><span style={{fontSize:16,color:C.accent}}>{">"}</span></div>
  </div>);
}

// ═══ FITTINGS SCREEN ═══════════════════════════════════════════
function RecentFitsList({fitsDB, activeFit, loadFit}) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('pyfa_recent_open') !== '0'; } catch { return true; }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem('pyfa_recent_open', next ? '1' : '0'); } catch {}
  };
  const recentFits = Object.entries(fitsDB)
    .flatMap(([ship, fits]) => fits.map(f => ({ship, fit:f})))
    .sort((a,b) => (b.fit.modified||0) - (a.fit.modified||0))
    .slice(0, 8);
  if (!recentFits.length) return null;
  return (
    <div style={{marginBottom:12}}>
      <div onClick={toggle} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',padding:'4px 0',marginBottom:open?6:0}}>
        <span style={{fontSize:11,fontWeight:700,color:C.textMute,textTransform:'uppercase',letterSpacing:.5}}>Recent Fits</span>
        <span style={{fontSize:11,color:C.textMute}}>{open ? '▲' : '▼'}</span>
      </div>
      {open && recentFits.map(({ship, fit}) => (
        <div key={fit.id} onClick={()=>loadFit(ship, fit.name)}
          style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderRadius:8,cursor:'pointer',
                  background:activeFit?.fitName===fit.name&&activeFit?.ship===ship?C.accentLight:C.surface,
                  border:`1px solid ${activeFit?.fitName===fit.name&&activeFit?.ship===ship?C.accentBorder:C.border}`,marginBottom:4}}>
          <img src={eveIcon(Object.entries(shipsByClass||{}).flatMap(([,ships])=>ships).find(s=>s.name===ship)?.typeID,32)}
               style={{width:32,height:32,borderRadius:4,objectFit:'contain',background:C.surfaceAlt,flexShrink:0}} 
               onError={e=>e.target.style.display='none'} alt=""/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fit.name}</div>
            <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{ship}</div>
          </div>
        </div>
      ))}
    </div>
  );
}


function ShipInfoSheet({ship, onClose}) {
  const [tab, setTab] = useState('traits');
  const traits = ship?.typeID ? ((shipTraits??{})[String(ship.typeID)] ?? {}) : {};
  const tabs = ['traits','description','attributes'];

  const TraitSection = ({header, bonuses}) => (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:6}}>{header}</div>
      {(bonuses||[]).map((b,i) => (
        <div key={i} style={{display:'flex',gap:8,padding:'3px 0'}}>
          {b.number && <span style={{fontSize:12,fontWeight:700,color:C.accent,minWidth:44,flexShrink:0}}>{b.number}</span>}
          <span style={{fontSize:12,color:C.textMid}}>{b.text}</span>
        </div>
      ))}
    </div>
  );

  const attrs = {
    fitting: [
      ['CPU Output', `${ship?.cpu ?? '-'} tf`],
      ['Powergrid Output', `${ship?.pg ?? '-'} MW`],
      ['High Slots', ship?.highSlots ?? '-'],
      ['Mid Slots', ship?.midSlots ?? '-'],
      ['Low Slots', ship?.lowSlots ?? '-'],
      ['Rig Slots', ship?.rigSlots ?? '-'],
      ['Turret Hardpoints', ship?.turrets ?? '-'],
    ],
    structure: [
      ['Shield HP', `${ship?.shieldHP ?? '-'} HP`],
      ['Armor HP', `${ship?.armorHP ?? '-'} HP`],
      ['Hull HP', `${ship?.hullHP ?? '-'} HP`],
      ['Mass', ship?.mass ? `${(ship.mass/1e6).toFixed(2)}M kg` : '-'],
      ['Max Velocity', `${ship?.maxVelocity ?? '-'} m/s`],
      ['Drone Bay', `${ship?.droneBay ?? '-'} m³`],
      ['Drone Bandwidth', `${ship?.droneBW ?? '-'} Mbit/s`],
    ],
  };

  return (
    <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',flexDirection:'column'}}
         onClick={onClose}>
      <div style={{flex:1,background:'rgba(0,0,0,.5)'}}/>
      <div style={{background:C.surface,borderRadius:'16px 16px 0 0',maxHeight:'85vh',
                   display:'flex',flexDirection:'column',boxShadow:'0 -8px 32px rgba(0,0,0,.5)'}}
           onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'16px 16px 12px',borderBottom:`1px solid ${C.border}`}}>
          <img src={eveIcon(ship?.typeID,64)}
               style={{width:48,height:48,borderRadius:8,background:'#0d0d1a',flexShrink:0}}
               onError={e=>e.target.style.opacity='0'} alt=""/>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:C.text}}>{ship?.name}</div>
            <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{ship?.groupName}</div>
          </div>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',
            color:C.textMute,fontSize:20,cursor:'pointer',padding:'0 4px'}}>×</button>
        </div>
        {/* Tab bar */}
        <div style={{display:'flex',borderBottom:`1px solid ${C.border}`}}>
          {tabs.map(t => (
            <button key={t} onClick={()=>setTab(t)}
              style={{flex:1,padding:'9px 4px',background:'none',border:'none',cursor:'pointer',
                      fontSize:12,fontWeight:600,color:tab===t?C.accent:C.textMute,
                      borderBottom:tab===t?`2px solid ${C.accent}`:'2px solid transparent',
                      textTransform:'capitalize'}}>
              {t}
            </button>
          ))}
        </div>
        {/* Tab content */}
        <div style={{flex:1,overflowY:'auto',padding:'14px 16px'}}>
          {tab==='traits' && (
            <div>
              {traits.skills?.map((s,i) => <TraitSection key={i} header={s.header} bonuses={s.bonuses}/>)}
              {traits.role && <TraitSection header={traits.role.header||'Role Bonus:'} bonuses={traits.role.bonuses}/>}
              {traits.misc && <TraitSection header={traits.misc.header||'Misc:'} bonuses={traits.misc.bonuses}/>}
              {!traits.skills?.length && !traits.role && (
                <div style={{color:C.textMute,fontSize:13}}>No trait data available.</div>
              )}
            </div>
          )}
          {tab==='description' && (
            <div style={{fontSize:13,color:C.textMid,lineHeight:1.6}}>
              {traits.desc || 'No description available.'}
            </div>
          )}
          {tab==='attributes' && (
            <div>
              {Object.entries(attrs).map(([section, rows]) => (
                <div key={section} style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.textMute,textTransform:'uppercase',
                    letterSpacing:.5,marginBottom:8}}>{section}</div>
                  {rows.filter(([,v]) => v !== '-' && v !== 'undefined').map(([label, val]) => (
                    <div key={label} style={{display:'flex',justifyContent:'space-between',
                      padding:'5px 0',borderBottom:`1px solid ${C.border}`}}>
                      <span style={{fontSize:12,color:C.textMid}}>{label}</span>
                      <span style={{fontSize:12,fontWeight:600,color:C.text}}>{val}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function FittingsScreen({activeFit,setActiveFit,loadFit,view,setView,fitsDB,setFitsDB,slots,setSlots,setDrones,setFighters,fighters,setCargoItems,setImplants,setBoosters,setProjFits,setCmdFits,skills,implants,boosters,drones,factorInReload,setFactorInReload,externalBursts,projectedReps,projectedEffects,dmgProfile,setDmgProfile}){
  const[selectedClass,setSelectedClass]=useState(null);
  const[selectedShip,setSelectedShip]=useState(activeFit?.ship??null);
  const[fitSubTab,setFitSubTab]=useState("Fit");
  // Horizontal swipe between Fit / Stats / Graph. Only fires on horizontal-dominant swipes
  // past a threshold, so vertical scrolling and module drag-reorder are unaffected.
  const _SUBTABS=["Fit","Stats","Graph"];
  const _swipe=useRef({x:0,y:0});
  const _onSwipeStart=e=>{const t=e.touches[0];if(t)_swipe.current={x:t.clientX,y:t.clientY};};
  const _onSwipeEnd=e=>{const t=e.changedTouches[0];if(!t)return;const dx=t.clientX-_swipe.current.x,dy=t.clientY-_swipe.current.y;
    if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.6){const i=_SUBTABS.indexOf(fitSubTab);
      if(dx<0&&i<_SUBTABS.length-1){setFitSubTab(_SUBTABS[i+1]);haptic();}
      else if(dx>0&&i>0){setFitSubTab(_SUBTABS[i-1]);haptic();}}};
  const[search,setSearch]=useState("");
  const[nextId,setNextId]=useState(()=>Object.values(fitsDB).reduce((max,fits)=>fits.reduce((m,f)=>Math.max(m,f.id+1),max),20));
  const[editingFitId,setEditingFitId]=useState(null);
  const[editName,setEditName]=useState("");
  const[renamingFit,setRenamingFit]=useState(false);
  // showShipInfo moved to App() state
  const[newFitName,setNewFitName]=useState("");

  // Slots lifted here so StatsTab + GraphTab can read fitted modules
  const activeShip=activeFit?.ship?lookupShip(activeFit.ship):null;
  // slots/setSlots lifted to App root to persist across tab switches

  const saveRename=(ship,fitId)=>{
    const name=editName.trim()||"Unnamed Fit";
    const now=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    setFitsDB(prev=>({...prev,[ship]:prev[ship].map(f=>f.id===fitId?{...f,name,modified:now}:f)}));
    if(activeFit?.ship===ship&&activeFit?.fitName===fitsDB[ship]?.find(f=>f.id===fitId)?.name)
      setActiveFit(prev=>({...prev,fitName:name}));
    setEditingFitId(null);
  };

  const createNewFit=ship=>{
    const now=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    const emptySlots=generateEmptySlots(lookupShip(ship));
    const nf={id:nextId,name:"New Fit",modified:now,slots:emptySlots};
    setFitsDB(prev=>({...prev,[ship]:[...(prev[ship]||[]),nf]}));
    setNextId(n=>n+1);
    setActiveFit({ship,fitName:"New Fit"});
    setSlots(emptySlots);
    setDrones([]);setFighters([]);setCargoItems([]);setImplants(Array.from({length:10},(_,i)=>({slot:i+1,name:"[Empty]",bonus:null})));setBoosters([]);setProjFits([]);setCmdFits([]);
    setSelectedShip(ship);
    setView("active");
  };

  const searchResults=search.trim().length>1?(()=>{
    const q=search.toLowerCase(),results=[];
    Object.entries(shipsByClass||{}).forEach(([cls,ships])=>{
      ships.forEach(s=>{
        if(s.name.toLowerCase().includes(q))results.push({type:"ship",ship:s.name,hull:cls,race:"",color:C.rig});
        (fitsDB[s.name]||[]).forEach(fit=>{if(fit.name.toLowerCase().includes(q))results.push({type:"fit",ship:s.name,hull:cls,race:"",fitName:fit.name,modified:fit.modified,color:C.accent});});
      });
    });
    return results;
  })():null;

  // Browse view
  if(view==="browse")return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{padding:"8px 10px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px"}}>
        <span style={{fontSize:14,color:C.textMute}}>&#128269;</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search ships or fit names..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13}}/>
        {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:16,padding:0}}>x</button>}
      </div>
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"8px 10px"}}>
      {!search&&<RecentFitsList fitsDB={fitsDB} activeFit={activeFit} loadFit={loadFit}/>}
      {searchResults&&(<>
        <div style={{fontSize:11,color:C.textMute,marginBottom:8}}>{searchResults.length} result{searchResults.length!==1?"s":""} for "{search}"</div>
        {searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0"}}>No ships or fits found</div>}
        {searchResults.map((rr,i)=>(<div key={i} onClick={()=>{setSelectedShip(rr.ship);setView(rr.type==="fit"?"active":"fits");if(rr.type==="fit")loadFit(rr.ship,rr.fitName);}} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:4,cursor:"pointer"}}>
          <img src={eveIcon((Object.values(shipsByClass||{}).flat().find(s=>s.name===rr.ship)||{}).typeID,32)} style={{width:28,height:28,borderRadius:4,objectFit:'contain',background:'#1a1a2e',flexShrink:0}} onError={e=>{e.target.style.background=rr.color;e.target.style.display='block';}} alt=""/>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{rr.type==="fit"?rr.fitName:rr.ship}</div><div style={{fontSize:10,color:C.textMute,marginTop:1}}>{rr.ship} / {rr.hull} / {rr.race}</div></div>
          <span style={{fontSize:10,color:rr.type==="fit"?C.accent:C.textMute,background:rr.type==="fit"?C.accentLight:C.border,borderRadius:99,padding:"1px 7px",fontWeight:600,flexShrink:0}}>{rr.type==="fit"?"fit":"ship"}</span>
        </div>))}
      </>)}
      {!searchResults&&Object.entries(shipsByClass||{}).sort(([a],[b])=>a.localeCompare(b)).map(([cls, ships])=>{
        const fitCount=ships.reduce((s,sh)=>s+(fitsDB[sh.name]||[]).length,0);
        return (
          <div key={cls} onClick={()=>{setSelectedClass(cls);setView("class-ships");}}
            style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:selectedClass===cls?C.accentLight:"transparent"}}>
            <span style={{fontSize:16}}>🚀</span>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:selectedClass===cls?C.accent:C.text}}>{cls}</div>
              <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{ships.length} ships{fitCount>0?` · ${fitCount} fits`:""}</div>
            </div>
            <span style={{color:C.textMute,fontSize:16}}>{">"}</span>
          </div>
        );
      })}
    </div>
  </div>);

  // Class-ships view
  if(view==="class-ships"){
    const classShips=(shipsByClass[selectedClass]||[]).sort((a,b)=>a.name.localeCompare(b.name));
    return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={()=>setView("browse")} style={{background:"none",border:"none",color:C.accent,fontSize:13,cursor:"pointer",fontWeight:600,padding:0}}>Back</button>
        <span style={{fontSize:16}}>🚀</span><span style={{fontSize:14,fontWeight:700,color:C.text,flex:1}}>{selectedClass}</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"8px 10px"}}>
        {classShips.map(s=>{
          const sfits=(fitsDB[s.name]||[]);
          return(<div key={s.typeID} style={{marginBottom:4}}>
            <div onClick={()=>{setSelectedShip(s.name);setView('fits');}} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,cursor:"pointer",background:selectedShip===s.name?C.accentLight:C.surface,border:`1px solid ${selectedShip===s.name?C.accentBorder:C.border}`}}>
              <img src={eveIcon(s.typeID,64)}
                   style={{width:40,height:40,borderRadius:4,objectFit:'contain',background:'#1a1a2e',flexShrink:0}}
                   onError={e=>{e.target.style.display='none';}} alt=""/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:5}}>
                  {(raceIcons??{})[String(s.raceID)]&&<img src={raceIcons[String(s.raceID)]} style={{width:14,height:14,objectFit:'contain',flexShrink:0}} alt=""/>}
                  <span style={{fontSize:13,fontWeight:600,color:selectedShip===s.name?C.accent:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</span>
                </div>
                <div style={{fontSize:10,color:C.textMute,marginTop:2}}>{sfits.length>0?`${sfits.length} fit${sfits.length!==1?'s':''}`:'No fits'}</div>
              </div>
            </div>
            {selectedShip===s.name&&sfits.length>0&&<div style={{paddingLeft:16,marginTop:2}}>
              {sfits.map(fit=>(<div key={fit.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",borderRadius:6,cursor:"pointer",background:C.surfaceAlt,marginBottom:2,border:`1px solid ${activeFit?.fitName===fit.name&&activeFit?.ship===s.name?C.accentBorder:C.border}`}} onClick={()=>loadFit(s.name,fit.name)}>
                <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:activeFit?.fitName===fit.name&&activeFit?.ship===s.name?C.accent:C.text}}>{fit.name}</div><div style={{fontSize:10,color:C.textMute,marginTop:1}}>Modified {fit.modified}</div></div>
                <span style={{color:C.textMute,fontSize:13}}>{">"}</span>
              </div>))}
            </div>}
          </div>);
        })}
      </div>
    </div>);
  }

  // Fits list view
  if(view==="fits"){
    const fits=fitsDB[selectedShip]||[];
    return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={()=>setView(selectedClass?"class-ships":"browse")} style={{background:"none",border:"none",color:C.accent,fontSize:13,cursor:"pointer",fontWeight:600,padding:0}}>Back</button>
        <span style={{fontSize:14,fontWeight:700,color:C.text,flex:1}}>{selectedShip}</span>
        <button onClick={()=>createNewFit(selectedShip)} style={{padding:"6px 12px",background:C.accent,border:"none",borderRadius:7,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ New Fit</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:12}}>
        {fits.length===0&&<div style={{textAlign:"center",color:C.textMute,marginTop:40,fontSize:13}}>No saved fits - tap + New Fit to start</div>}
        {fits.map(fit=>(<div key={fit.id} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 14px",background:C.surface,border:`1px solid ${activeFit?.fitName===fit.name&&activeFit?.ship===selectedShip?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8}}>
          <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>{if(editingFitId!==fit.id){loadFit(selectedShip,fit.name);setView("active");}}}>
            {editingFitId===fit.id
              ?<input autoFocus value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveRename(selectedShip,fit.id);if(e.key==="Escape")setEditingFitId(null);}} onBlur={()=>saveRename(selectedShip,fit.id)} onClick={e=>e.stopPropagation()} style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.accentBorder}`,borderRadius:6,padding:"4px 8px",color:C.text,fontSize:13,fontWeight:600,boxSizing:"border-box"}}/>
              :<div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fit.name}</div>
            }
            <div style={{fontSize:11,color:C.textMute,marginTop:2}}>Modified {fit.modified}</div>
          </div>
          <button onClick={e=>{e.stopPropagation();setEditingFitId(fit.id);setEditName(fit.name);}} style={{width:28,height:28,borderRadius:6,background:editingFitId===fit.id?C.accentLight:C.surfaceAlt,border:`1px solid ${editingFitId===fit.id?C.accentBorder:C.border}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>&#9998;</button>
          <button onClick={e=>{e.stopPropagation();if(window.confirm(`Delete fit "${fit.name}"?`)){setFitsDB(prev=>{const next={...prev,[selectedShip]:(prev[selectedShip]||[]).filter(f=>f.id!==fit.id)};if(!next[selectedShip].length)delete next[selectedShip];return next;});if(activeFit?.fitName===fit.name&&activeFit?.ship===selectedShip)setActiveFit(null);}}} style={{width:28,height:28,borderRadius:6,background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:C.danger,flexShrink:0,lineHeight:1}} title="Delete fit">&times;</button>
          <button onClick={()=>{loadFit(selectedShip,fit.name);setView("active");}} style={{width:28,height:28,borderRadius:6,background:C.surfaceAlt,border:`1px solid ${C.border}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:C.textMute,flexShrink:0}}>{">"}</button>
        </div>))}
      </div>
    </div>);
  }

  // Active fit view
  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",padding:"6px 12px 0",gap:8}}>
        <button onClick={()=>{setSelectedShip(activeFit?.ship??null);setView("fits");}} style={{background:"none",border:"none",color:C.accent,fontSize:12,cursor:"pointer",fontWeight:600,padding:"3px 0",flexShrink:0}}>Fits</button>
        <div style={{flex:1,minWidth:0}}>
          {renamingFit
            ?<input autoFocus value={newFitName} onChange={e=>setNewFitName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){const now=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});setFitsDB(prev=>({...prev,[activeFit.ship]:(prev[activeFit.ship]||[]).map(f=>f.name===activeFit.fitName?{...f,name:newFitName.trim()||activeFit.fitName,modified:now}:f)}));setActiveFit(prev=>({...prev,fitName:newFitName.trim()||prev.fitName}));setRenamingFit(false);}if(e.key==="Escape")setRenamingFit(false);}} onBlur={()=>setRenamingFit(false)} style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.accentBorder}`,borderRadius:6,padding:"3px 8px",color:C.text,fontSize:12,fontWeight:700,boxSizing:"border-box"}}/>
            :<button onClick={()=>{setNewFitName(activeFit?.fitName||"");setRenamingFit(true);}} style={{background:"none",border:"none",cursor:"pointer",textAlign:"center",padding:0,display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%"}}>
              <span style={{fontSize:12,fontWeight:700,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{activeFit?.fitName||"Unnamed Fit"}</span>
              <span style={{fontSize:10,color:C.textMute,flexShrink:0}}>&#9998;</span>
            </button>
          }
        </div>

      </div>
      <div style={{display:"flex"}}><div style={{width:60}}/>{["Fit","Stats","Graph"].map(t=><button key={t} onClick={()=>setFitSubTab(t)} style={{flex:1,padding:"7px 0",fontSize:13,fontWeight:600,background:"none",border:"none",cursor:"pointer",color:fitSubTab===t?C.accent:C.textMute,borderBottom:fitSubTab===t?`2px solid ${C.accent}`:"2px solid transparent"}}>{t}</button>)}</div>
    </div>
    <div onTouchStart={_onSwipeStart} onTouchEnd={_onSwipeEnd} style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
    {fitSubTab==="Fit"   &&<FitTab   ship={activeShip} slots={slots} setSlots={setSlots} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} externalBursts={externalBursts} projectedEffects={projectedEffects} dmgProfile={dmgProfile}/>}
    {fitSubTab==="Stats" &&<StatsTab ship={activeShip} slots={slots} skills={skills} implants={implants} boosters={boosters} drones={drones} fighters={fighters} factorInReload={factorInReload} setFactorInReload={setFactorInReload} externalBursts={externalBursts} projectedReps={projectedReps} projectedEffects={projectedEffects} dmgProfile={dmgProfile} setDmgProfile={setDmgProfile}/>}
    {fitSubTab==="Graph" &&<GraphTab ship={activeShip} slots={slots} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} externalBursts={externalBursts} projectedEffects={projectedEffects}/>}
    </div>
  </div>);
}

// ═══ CARGO SCREEN - drill-down browser ═════════════════════════
// ═══ MARKET BROWSER (pyfa market tree) ═════════════════════════
function CargoBrowserSheet({onAdd,onClose,slots}){
  const[search,setSearch]=useState("");
  const[path,setPath]=useState([]);        // drill path of market group ids
  const[fitCharges,setFitCharges]=useState(false);
  const cur=path.length?path[path.length-1]:null;
  const subGroups=cur==null?MT_ROOTS:(MT_CHILDREN[cur]??[]);
  const items=cur==null?[]:(MT_ITEMS[cur]??[]);
  const searchResults=search.trim().length>1
    ?MT_ALL_ITEMS.filter(i=>i.name.toLowerCase().includes(search.toLowerCase())).slice(0,60)
    :null;
  const crumb=path.map(g=>marketTreeData.g[g]?.n).filter(Boolean).join(" > ");

  // "Charges for Active Fit": union of compatible charges across all fitted modules (pyfa feature)
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

  return(<BottomSheet title="Add Cargo" onClose={onClose} height="86vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px"}}>
        <span style={{fontSize:16,color:C.textMute}}>&#128269;</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search market..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:14}}/>
        {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:18,padding:0}}>x</button>}
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

function CargoScreen({items,setItems,shipCapacity=1150,slots}){
  const[numpad,setNumpad]=useState(null);
  const[showCargoPicker,setShowCargoPicker]=useState(false);
  // Resolve any missing/zero volumes from TYPES (charges.json lacks T2/faction ammo)
  // Authoritative volume: always prefer the type data (resolved by typeID, else by name) over any
  // stored vol — old imported cargo may carry wrong volumes (e.g. ammo saved at 0.25 instead of 0.015).
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
    setNumpad(ni); // jump straight to quantity entry (ammo etc.)
  };
  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      <div><span style={{fontSize:12,fontWeight:700,color:C.text}}>Cargo Bay</span><span style={{fontSize:11,color:C.textMute,marginLeft:8}}>{totalVol} / {cap.toLocaleString()} m3</span></div>
      <button onClick={()=>setShowCargoPicker(true)} style={{padding:"5px 10px",background:C.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Add</button>
    </div>
    <div style={{height:3,background:C.border}}><div style={{width:`${cap>0?Math.min((parseFloat(totalVol)/cap)*100,100):0}%`,height:"100%",background:parseFloat(totalVol)>cap?C.danger:C.accent}}/></div>
    <div style={{flex:1,overflowY:"auto",padding:12}}>
      {items.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:13}}>Cargo bay is empty</div>}
      {items.map(item=>(<div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:6}}>
        <div style={{width:32,height:32,borderRadius:7,background:C.surfaceAlt,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,overflow:"hidden"}}>{(()=>{const tid=item.typeID??tidByName(item.name);return tid?<img className="eve-icon" src={eveIcon(tid,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>:<span style={{fontSize:14}}>📦</span>;})()}</div>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.name}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{(item.qty*volOf(item)).toFixed(1)} m3</div></div>
        <button onClick={()=>setNumpad(item)} style={{display:"flex",flexDirection:"column",alignItems:"center",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,padding:"5px 10px",cursor:"pointer"}}>
          <span style={{fontSize:14,fontWeight:800,color:C.text}}>{item.qty.toLocaleString()}</span>
          <span style={{fontSize:8,color:C.textMute,marginTop:1}}>tap to edit</span>
        </button>
      </div>))}
    </div>
    {numpad&&<NumpadModal label={numpad.name} initial={numpad.qty} onConfirm={qty=>setItems(items.map(i=>i.id===numpad.id?{...i,qty}:i))} onClose={()=>setNumpad(null)}/>}
    {showCargoPicker&&<CargoBrowserSheet slots={slots} onAdd={addItem} onClose={()=>setShowCargoPicker(false)}/>}
  </div>);
}

// ═══ DRONES SCREEN ══════════════════════════════════════════════
function DroneBrowserSheet({existingDrones,onAdd,onClose}){
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
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search drones..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:14}}/>
        {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:18,padding:0}}>x</button>}
      </div>
    </div>
    {!searchResults&&drillSub&&(<div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}><button onClick={()=>setDrillSub(null)} style={{background:"none",border:"none",color:C.accent,fontSize:14,fontWeight:700,cursor:"pointer",padding:0}}>Back</button><span style={{fontSize:13,fontWeight:600,color:C.text}}>{drillSub}</span></div>)}
    <div>{renderBody()}</div>
  </BottomSheet>);
}

function FighterBrowserSheet({onAdd,onClose}){
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
    {!anyMatch&&<div style={{textAlign:"center",padding:"36px 20px",color:C.textMute,fontSize:13}}>No {cls.toLowerCase()} fighters match “{q}”.</div>}
  </BottomSheet>);
}

// Interactive booster side effects: data-driven from EVE booster penalty attrs.
// Values shown are skill-adjusted (Neurotoxin Recovery/Control V): e.g. Improved
// Exile = 22.5% chance of an 18.75% drawback. Toggling a drawback applies it to the fit.
function BoosterSideEffects({booster, onUpdate}) {
  // Use stored data-driven side effects, or rebuild from type data (migrates old saved boosters)
  const stored = booster.sideEffects;
  const se = (stored?.length && stored[0].key) ? stored : boosterSideEffectsFor(booster.name).map(s => {
    // carry over enabled flags by label if migrating
    const old = stored?.find(o => o.attr === s.label || o.label === s.label);
    return { ...s, enabled: old?.enabled ?? false };
  });
  if (!se.length) return null;
  const NEURO = 0.75; // Neurotoxin Control & Recovery at V: chance and magnitude × 0.75
  const chancePct = Math.round((se[0]?.chance ?? 0.3) * NEURO * 1000) / 10;
  const toggle = (i) => {
    const next = se.map((s, j) => j === i ? { ...s, enabled: !s.enabled } : s);
    onUpdate({ ...booster, sideEffects: next });
  };
  return (
    <div style={{padding:'6px 12px 8px',borderTop:`1px solid ${C.border}`,background:'rgba(245,158,11,0.05)'}}>
      <div style={{fontSize:9,fontWeight:700,color:C.warning,textTransform:'uppercase',letterSpacing:.5,marginBottom:5}}>
        Side effects ({chancePct}% chance each) - tap to simulate
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
        {se.map((s,i)=>{
          const mag = Math.round(Math.abs(s.value) * NEURO * 100) / 100;
          const sign = s.value < 0 ? '-' : '+';
          return (
            <button key={s.key} onClick={()=>toggle(i)}
              style={{fontSize:10,fontWeight:s.enabled?700:500,cursor:'pointer',
                color:s.enabled?'#fff':C.danger,
                background:s.enabled?C.danger:'rgba(239,68,68,0.1)',
                border:`1px solid ${s.enabled?C.danger:'rgba(239,68,68,0.25)'}`,
                borderRadius:5,padding:'3px 8px'}}>
              {s.enabled?'[x] ':''}{sign}{mag}% {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DronesScreen({drones,setDrones,droneInfo=[],fighters,setFighters,fighterInfo=[],activeDroneDps=0,shipDroneBay=0,shipDroneBandwidth=0,shipFighter={cap:0,tubes:0,light:0,heavy:0,support:0}}){
  const[showDronePicker,setShowDronePicker]=useState(false);
  const[showFighterPicker,setShowFighterPicker]=useState(false);
  const _droneTypeRec=(d)=>{
    const tid = d.typeID ?? (d.name ? tidByName(d.name) : null);
    if(tid==null) return null;
    return TYPES[tid] ?? TYPES[String(tid)] ?? null;
  };
  const getDroneVol=(d)=>{const t=_droneTypeRec(d);return t?.attrs?.volume ?? d.volume ?? 5;};
  const getDroneBW=(d)=>{const t=_droneTypeRec(d);return t?.attrs?.droneBandwidthUsed ?? d.bandwidth ?? 5;};
  const bayUsed=drones.reduce((s,d)=>s+d.qty*getDroneVol(d),0);
  const addDrone=d=>{const ex=drones.find(e=>e.name===d.name);if(ex){setDrones(drones.map(e=>e.name===d.name?{...e,qty:e.qty+5}:e));return;}setDrones(prev=>{
      // Authoritative stats from TYPES (named attrs), resolved by typeID or name.
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
  // Toggle a fighter ability on/off (stores the explicit inverse of the current effective state).
  const toggleFighterAbility=(id,abilityKey,currentActive)=>setFighters(fighters.map(f=>
    f.id===id?{...f,abilities:{...(f.abilities||{}),[abilityKey]:!currentActive}}:f));
  const setFighterQty=(id,delta)=>setFighters(fighters.map(f=>f.id===id?{...f,qty:Math.max(1,(f.qty??1)+delta)}:f));
  const sizeColor=s=>s==="Light"?C.rig:s==="Medium"?C.accent:s==="Heavy"?C.warning:s==="Sentry"?C.high:C.textMid;
  // ── Fighter-bay accounting ────────────────────────────────────────────────
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
      {/* Launch tubes + per-class squadron slots, shown as segmented pips */}
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
            <button onClick={()=>setDrones(drones.map(d=>d.id===drone.id?{...d,active:!d.active}:d))} style={{width:24,height:24,borderRadius:5,background:drone.active?C.accentLight:"none",border:`1px solid ${drone.active?C.accentBorder:C.borderStrong}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,lineHeight:1,color:drone.active?C.accent:""}}>{drone.active?"\u2713":""}</button>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              {drone.typeID&&<img className="eve-icon" src={eveIcon(drone.typeID,32)} width={24} height={24} alt="" onError={e=>{e.target.style.display="none";}}/>}
              <div><div style={{fontSize:12,fontWeight:600,color:drone.active?C.text:C.textMid,lineHeight:1.2,wordBreak:"break-word"}}>{drone.name}</div><span style={{fontSize:9,color:sizeColor(drone.size),fontWeight:700}}>{drone.size}</span></div>
            </div>
            {(()=>{
              // Effective stats from the engine (skills, implants, boosters, ship bonuses all applied).
              // These used to be read from a snapshot taken when the drone was ADDED, so a Federation
              // Navy Hobgoblin showed 0 range / base tracking / base speed regardless of the fit.
              const info=droneInfo.find(x=>x.name===drone.name)??{};
              const r=info.optimal??0, f=info.falloff??0, trk=info.trackingNorm??0,
                    v=info.velocity??0, ehp=info.ehp??0;
              // pyfa's list shows tracking normalised to a 40,000 m reference sig, formatted with a
              // k suffix (3.93k), NOT the raw attribute (2.46). Match the list, since that's what a
              // user is comparing against.
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
                  style={{width:24,height:24,borderRadius:5,flexShrink:0,background:isActive?C.accentLight:"none",border:`1px solid ${isActive?C.accentBorder:C.borderStrong}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:isActive?C.accent:""}}>{isActive?"v":""}</button>
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
  </div>);
}

// ═══ IMPLANTS - full Pyfa-style drill-down browser ════════════════
// Matches the module browser drill-down pattern
// Slot 1-5: Attribute enhancers, Slot 6-10: Hardwirings
const IMPLANT_SETS = {
  attribute:[
    {name:"Snake Set",desc:"Max Velocity",slots:{1:"Alpha",2:"Beta",3:"Gamma",4:"Delta",5:"Epsilon",6:"Zeta (Omega)"},
     grades:["Low-grade","Mid-grade","High-grade"],bonus:"+5/+10/+20% Max Velocity"},
    {name:"Ascendancy Set",desc:"Warp Speed",slots:{1:"Alpha",2:"Beta",3:"Gamma",4:"Delta",5:"Epsilon",6:"Omega"},
     grades:["Low-grade","Mid-grade","High-grade"],bonus:"+15/+25/+50% Warp Speed"},
    {name:"Slave Set",desc:"Armor HP",slots:{1:"Alpha",2:"Beta",3:"Gamma",4:"Delta",5:"Epsilon",6:"Omega"},
     grades:["Low-grade","Mid-grade","High-grade"],bonus:"+13/+22/+33% Armor HP"},
    {name:"Crystal Set",desc:"Shield Resists",slots:{1:"Alpha",2:"Beta",3:"Gamma",4:"Delta",5:"Epsilon"},
     grades:["Low-grade","Mid-grade","High-grade"],bonus:"+4/+6/+9% Shield Resists"},
    {name:"Halo Set",desc:"Signature Radius",slots:{1:"Alpha",2:"Beta",3:"Gamma",4:"Delta",5:"Epsilon"},
     grades:["Low-grade","Mid-grade","High-grade"],bonus:"-9/-12/-18% Signature Radius"},
    {name:"Attribute Enhancers",desc:"Core attributes",slots:{1:"Ocular Filter",2:"Memory Augmentation",3:"Neural Boost",4:"Cybernetic Subprocessor",5:"Social Adaptation Chip"},
     grades:["Basic","Standard","Improved","Enhanced","Basic (Attribute Set)"],bonus:"+1 to +5 attribute"},
  ],
  hardwiring:{
    6:["Zainou Deadeye GU-705 (+5% Turret Dmg)","Zainou Deadeye RR-605 (+5% ROF)","Inherent Implants Squire PG6 (+2% PG)","Inherent Implants Squire PG7 (+3% PG)","Inherent Implants Squire PG8 (+5% PG)","Eifyr Rogue SY-1 (+5% Velocity)","Inherent Implants Noble HG-1005 (+5% Shield HP)"],
    7:["Zainou Deadeye ZMT510 (+5% Tracking)","Inherent Implants Squire EE-603 (+3% Cap Rech)","Inherent Implants Squire EE-605 (+5% Cap Rech)","Eifyr Rogue AY-2 (+3% Armor Rep)","Zainou Gypsy BX-704 (+4% Drone Dmg)"],
    8:["Zainou Deadeye BX-804 (+4% Tracking)","Inherent Implants Lancer SB8 (+3% Velocity)","Eifyr Rogue AY-3 (+5% Armor Rep)","Eifyr Alchemist SY-1 (+5% Shield Boost)"],
    9:["Zainou Deadeye GU-905 (+5% Turret Dmg)","Zainou Gnome SK-705 (+5% Shield HP)","Inherent Implants Noble HG-1006 (+6% Armor HP)","Eifyr Rogue WS-615 (+5% Web)"],
    10:["Zainou Deadeye GU-705 (+5% Turret Dmg)","Eifyr Rogue WS-615 (+5% Web Strength)","Inherent Implants Squire PG10 (+5% PG)","Zainou Gypsy BX-805 (+5% Drone Dmg)"],
  },
};

function ImplantPicker({slot,current,onSelect,onClear,onClose}){
  const[search,setSearch]=useState("");
  const[drill,setDrill]=useState(null);
  
  const slotData=implantData?.[String(slot)];
  const groups=slotData?.groups??{};
  const groupNames=Object.keys(groups).sort();
  const drillItems=drill?groups[drill]??[]:[];
  
  // Search all items in this slot:
  const allItems=Object.values(groups).flat();
  const results=search.trim().length>1
    ? allItems.filter(i=>i.name.toLowerCase().includes(search.toLowerCase()))
    : null;

  const ItemRow=({item})=>(
    <div onClick={()=>{onSelect({name:item.name,typeID:item.typeID,slot,bonus:""});onClose();}}
      style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",
              borderBottom:`1px solid ${C.border}`,cursor:"pointer",
              background:current===item.name?C.accentLight:"transparent"}}>
      <div>
        <div style={{fontSize:13,fontWeight:600,color:current===item.name?C.accent:C.text}}>{item.name}</div>
        {item.metaGroupID>0&&<div style={{fontSize:10,color:C.textMute,marginTop:1}}>Meta {item.metaLevel??0}</div>}
      </div>
      {current===item.name?<span style={{color:C.accent}}>✓</span>:<span style={{color:C.textMute}}>+</span>}
    </div>
  );

  if(drill){
    return(<BottomSheet title={`Slot ${slot} › ${drill}`} onClose={()=>setDrill(null)} height="82vh">
      {drillItems.map(item=><ItemRow key={item.typeID} item={item}/>)}
    </BottomSheet>);
  }

  return(<BottomSheet title={`Slot ${slot} Implants`} onClose={onClose} height="82vh">
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
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search implants..."
        style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",color:C.text,fontSize:13,boxSizing:"border-box"}}/>
    </div>
    {results
      ? results.map(item=><ItemRow key={item.typeID} item={item}/>)
      : groupNames.map(gn=>(
          <div key={gn} onClick={()=>setDrill(gn)}
            style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
            <div style={{fontSize:13,color:C.text}}>{gn}</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:C.textMute}}>{groups[gn]?.length??0}</span>
              <span style={{color:C.textMute}}>›</span>
            </div>
          </div>
        ))
    }
  </BottomSheet>);
}

function ImplantsScreen({implants,setImplants}){
  const[loadouts,setLoadouts]=useState([]);
  const[picker,setPicker]=useState(null);
  const[savingName,setSavingName]=useState(false);
  const[newLoadoutName,setNewLoadoutName]=useState("");
  const[editingLoadout,setEditingLoadout]=useState(null);
  const[editLoadoutName,setEditLoadoutName]=useState("");
  const filled=implants.filter(i=>i.name!=="[Empty]").length;

  function saveLoadout(){
    if(!newLoadoutName.trim())return;
    setLoadouts(prev=>[...prev,{id:Date.now(),name:newLoadoutName.trim(),implants:[...implants]}]);
    setNewLoadoutName("");setSavingName(false);
  }
  function loadLoadout(lo){
    if(!lo.implants?.length){alert(`"${lo.name}" has no implants saved.`);return;}
    setImplants(lo.implants.map(i=>({...i})));
  }
  function renameLoadout(id){
    setLoadouts(prev=>prev.map(l=>l.id===id?{...l,name:editLoadoutName.trim()||l.name}:l));
    setEditingLoadout(null);setEditLoadoutName("");
  }
  function deleteLoadout(id){setLoadouts(prev=>prev.filter(l=>l.id!==id));}

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
      {loadouts.length>0&&<div className="hs" style={{overflowX:"auto",display:"flex",gap:6}}>
        {loadouts.map(l=>(
          <div key={l.id} style={{display:"flex",alignItems:"center",gap:3,flexShrink:0}}>
            {editingLoadout===l.id
              ?<input autoFocus value={editLoadoutName} onChange={e=>setEditLoadoutName(e.target.value)}
                 onKeyDown={e=>{if(e.key==="Enter")renameLoadout(l.id);if(e.key==="Escape")setEditingLoadout(null);}}
                 onBlur={()=>renameLoadout(l.id)}
                 style={{width:120,padding:"3px 7px",background:C.surface,border:`1px solid ${C.accentBorder}`,borderRadius:6,color:C.text,fontSize:11}}/>
              :<button onClick={()=>loadLoadout(l)}
                 style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",background:C.surface,border:`1px solid ${C.border}`,color:C.textMid}}>
                {l.name} <span style={{color:C.textMute,fontSize:9}}>({l.implants?.filter(i=>i.name!=="[Empty]").length??0})</span>
              </button>
            }
            <button onClick={()=>{setEditingLoadout(l.id);setEditLoadoutName(l.name);}} style={{width:20,height:20,borderRadius:4,background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.textMute,flexShrink:0}}>&#9998;</button>
            <button onClick={()=>deleteLoadout(l.id)} style={{width:20,height:20,borderRadius:4,background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.danger,flexShrink:0}}>x</button>
          </div>
        ))}
      </div>}
    </div>
    <div style={{flex:1,overflowY:"auto",padding:12}}>
      {/* Slot groups */}
      {[{label:"Attribute Enhancers",slots:[1,2,3,4,5],color:C.accent},{label:"Hardwirings",slots:[6,7,8,9,10],color:C.high}].map(grp=>(
        <div key={grp.label} style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,padding:"0 2px"}}>
            <div style={{width:8,height:8,borderRadius:99,background:grp.color}}/>
            <span style={{fontSize:11,fontWeight:700,color:grp.color,letterSpacing:.4}}>{grp.label.toUpperCase()}</span>
          </div>
          {grp.slots.map(slotNum=>{
            const imp=implants.find(i=>i.slot===slotNum);
            const empty=!imp||imp.name==="[Empty]";
            return(<div key={slotNum} onClick={()=>setPicker(imp||{slot:slotNum,name:"[Empty]"})} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:C.surface,border:`1px solid ${empty?C.border:grp.color+"44"}`,borderRadius:8,marginBottom:5,cursor:"pointer"}}>
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
    {picker&&<ImplantPicker slot={picker.slot} current={picker.name}
      onSelect={opt=>setImplants(prev=>prev.map(i=>i.slot===picker.slot?{...i,name:opt.name,bonus:opt.bonus??null}:i))}
      onClear={()=>setImplants(prev=>prev.map(i=>i.slot===picker.slot?{...i,name:"[Empty]",bonus:null}:i))}
      onClose={()=>setPicker(null)}/>}
  </div>);
}

// ═══ EFFECTS SCREEN - Boosters with side effects ════════════════
// Pyfa booster side effects: each grade has a % chance to apply a penalty
const BOOSTER_SIDE_EFFECTS = {
  "Blue Pill":     [{attr:"Shield Capacity",penalty:"-22.5%"},{attr:"Turret Optimal Range",penalty:"-22.5%"},{attr:"Cap Capacity",penalty:"-22.5%"},{attr:"Missile Explosion Velocity",penalty:"-22.5%"}],
  "Crash":         [{attr:"Capacitor Capacity",penalty:"-10%"},{attr:"Armor Repairer Duration",penalty:"+10%"}],
  "Drop":          [{attr:"Shield Capacity",penalty:"-10%"},{attr:"Capacitor Capacity",penalty:"-10%"}],
  "Exile":         [{attr:"Capacitor Capacity",penalty:"-10%"},{attr:"Armor Repairer Duration",penalty:"+10%"}],
  "Mindflood":     [{attr:"Shield Capacity",penalty:"-5%"},{attr:"Armor HP",penalty:"-5%"}],
  "Sooth Sayer":   [{attr:"Armor HP",penalty:"-5%"},{attr:"Capacitor Recharge",penalty:"-10%"}],
  "X-Instinct":    [{attr:"Velocity",penalty:"-5%"},{attr:"Agility",penalty:"+5%"}],
  "Frentix":       [{attr:"Tracking Speed",penalty:"-5%"},{attr:"Falloff",penalty:"-5%"}],
  "Pyrolancea":    [{attr:"Capacitor Capacity",penalty:"-5%"},{attr:"Shield HP",penalty:"-5%"}],
};
const GRADE_SIDE_EFFECT_CHANCE = {Synth:0,Standard:0.15,Improved:0.20,Strong:0.30};

function buildBoosterFromName(name){
  const grade=["Synth","Improved","Standard","Strong"].find(g=>name.startsWith(g))
              ||(name.includes("Synth")?"Synth":"Standard");
  const drugBase=name.replace(/^(Synth|Improved|Standard|Strong|Nugoehuvi Synth) /,"");
  const seKey=drugBase.replace(/ Booster$/,"");
  // Agency/AIR/event boosters (slot 11/14-17) have NO side effects:
  // Data-driven side effects from EVE booster penalty attrs (raw values; UI/calc apply Neurotoxin skills)
  const se=boosterSideEffectsFor(name);
  return{id:Date.now()+Math.random(),name,effect:drugBase,active:true,color:C.warning,
         sideEffects:se};
}

// Pyfa-style booster categories - organized by primary benefit
const BOOSTER_CATEGORIES=[
  {label:"Shield",      color:C.mid,     drugs:["Blue Pill","Sooth Sayer"]},
  {label:"Armor",       color:C.warning, drugs:["Crash","Exile","Drop"]},
  {label:"Agency",      color:"#8b5cf6", drugs:["Agency Booster (Slot 11)","Agency Booster (Slot 14)","Agency Booster (Slot 15)","Agency Booster (Slot 16)","Agency Booster (Slot 17)"]},
  {label:"Turret",      color:C.danger,  drugs:["Frentix","Pyrolancea"]},
  {label:"Cap/Nav",     color:C.rig,     drugs:["Mindflood","X-Instinct"]},
];

function BoosterPickerSheet({onAdd,onClose}){
  const[slotDrill,setSlotDrill]=useState(null);  // booster slot (1,2,3)
  const[catDrill,setCatDrill]=useState(null);    // drug category
  const[search,setSearch]=useState("");
  const gradeColor={Synth:C.rig,Standard:C.textMid,Improved:C.accent,Strong:C.danger};
  const gradeChance={Synth:0,Standard:0.15,Improved:0.20,Strong:0.30};
  const slotData=slotDrill?BOOSTER_DATA[slotDrill]??{}:{};
  const catNames=Object.keys(slotData);
  const drugs=catDrill?(slotData[catDrill]??[]):[];

  // All boosters flat for search
  const allBoosters=Object.values(BOOSTER_DATA).flatMap(s=>Object.values(s).flat());
  const searchResults=search.trim().length>1?allBoosters.filter(n=>n.toLowerCase().includes(search.toLowerCase())):null;

  const back=()=>{if(catDrill)setCatDrill(null);else if(slotDrill)setSlotDrill(null);};
  const breadcrumb=[slotDrill?`Slot ${slotDrill}`:null,catDrill].filter(Boolean).join(' > ');

  const addDrug=(name)=>{
    // Parse grade from name: "Synth X-Instinct Booster" -> grade="Synth"
    const grade=["Synth","Improved","Standard","Strong"].find(g=>name.startsWith(g))||"Standard";
    const drugBase=name.replace(/^(Synth|Improved|Standard|Strong|Nugoehuvi Synth) /,'');
    onAdd({id:Date.now(),name,effect:drugBase,active:true,color:C.warning,
           sideEffects:boosterSideEffectsFor(name)});
    onClose();
  };

  return(<BottomSheet title="Add Booster Drug" onClose={onClose} height="82vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px"}}>
        <span style={{fontSize:16,color:C.textMute}}>&#128269;</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search boosters..."
          style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13}}/>
        {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:16}}>x</button>}
      </div>
    </div>
    {breadcrumb&&(
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={back} style={{background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer",padding:0}}>&laquo; Back</button>
        <span style={{fontSize:12,color:C.textMute}}>{breadcrumb}</span>
      </div>
    )}

    {/* Search results */}
    {searchResults&&<div style={{overflowY:"auto"}}>
      {searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0"}}>No boosters found</div>}
      {searchResults.map(n=>(
        <div key={n} onClick={()=>addDrug(n)}
          style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
          <div style={{fontSize:13,fontWeight:600,color:C.text}}>{n}</div>
        </div>
      ))}
    </div>}

    {/* Level 1: Booster slots */}
    {!searchResults&&!slotDrill&&[1,2,3,11,14,15,16,17].map(slot=>(
      <div key={slot} onClick={()=>setSlotDrill(slot)}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:C.text}}>Slot {slot}</div>
          <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{Object.keys(BOOSTER_DATA[slot]??{}).join(", ")}</div>
        </div>
        <span style={{color:C.textMute}}>{">"}</span>
      </div>
    ))}

    {/* Level 2: Drug categories in slot */}
    {!searchResults&&slotDrill&&!catDrill&&catNames.map(cat=>(
      <div key={cat} onClick={()=>setCatDrill(cat)}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
        <div>
          <div style={{fontSize:14,fontWeight:600,color:C.text}}>{cat}</div>
          <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{(slotData[cat]??[]).length} variant{(slotData[cat]??[]).length!==1?"s":""}</div>
          {BOOSTER_SIDE_EFFECTS[cat]&&<div style={{fontSize:10,color:C.warning,marginTop:2}}>! {BOOSTER_SIDE_EFFECTS[cat].length} side effect{BOOSTER_SIDE_EFFECTS[cat].length>1?"s":""}</div>}
        </div>
        <span style={{color:C.textMute}}>{">"}</span>
      </div>
    ))}

    {/* Level 3: Drug variants */}
    {!searchResults&&catDrill&&drugs.map(drugName=>(
      <div key={drugName} onClick={()=>addDrug(drugName)}
        style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:C.text}}>{drugName}</div>
          {(()=>{
            const grade=["Synth","Improved","Standard","Strong"].find(g=>drugName.startsWith(g))||"Standard";
            const chance=gradeChance[grade]??0;
            return chance>0
              ?<div style={{fontSize:10,color:C.warning,marginTop:2}}>{Math.round(chance*100)}% side effect chance</div>
              :<div style={{fontSize:10,color:C.rig,marginTop:2}}>No side effects</div>;
          })()}
        </div>
        <span style={{color:C.textMute}}>+</span>
      </div>
    ))}
  </BottomSheet>);
}


function FitPickerSheet({title,fitsDB,onSelect,onClose,filterFn}){
  const[search,setSearch]=useState("");
  const allFits=[];
  Object.entries(fitsDB).forEach(([ship,fits])=>fits.forEach(f=>{if(!filterFn||filterFn(ship,f))allFits.push({ship,fit:f});}));
  const filtered=search.trim()?allFits.filter(({ship,fit})=>ship.toLowerCase().includes(search.toLowerCase())||fit.name.toLowerCase().includes(search.toLowerCase())):allFits;
  return(<BottomSheet title={title} onClose={onClose} height="75vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px"}}>
        <span style={{fontSize:14,color:C.textMute}}>&#128269;</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search fits..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13}}/>
      </div>
    </div>
    {filtered.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:13}}>No fits found</div>}
    {filtered.map(({ship,fit})=>(
      <div key={fit.id} onClick={()=>{onSelect(ship,fit);onClose();}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
        <div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{fit.name}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{ship} / Modified {fit.modified}</div></div>
        <span style={{fontSize:14,color:C.textMute,flexShrink:0}}>{">"}</span>
      </div>
    ))}
  </BottomSheet>);
}

function EffectsScreen({fitsDB,boosters,setBoosters,projFits,setProjFits,cmdFits,setCmdFits}){
  const[section,setSection]=useState("boosters");
  const[showBoosterPicker,setShowBoosterPicker]=useState(false);
  const[showProjPicker,setShowProjPicker]=useState(false);
  const[showCmdPicker,setShowCmdPicker]=useState(false);
  const cmdShips=Object.keys(CMD_SHIP_FITS);

  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{display:"flex",background:C.surface,borderBottom:`1px solid ${C.border}`}}>
      {[{tabId:"boosters",label:"Boosters"},{tabId:"projected",label:"Projected"},{tabId:"command",label:"Command"}].map(t=>(<button key={t.tabId} onClick={()=>setSection(t.tabId)} style={{flex:1,padding:"8px 0",fontSize:12,fontWeight:600,background:"none",border:"none",cursor:"pointer",color:section===t.tabId?C.accent:C.textMute,borderBottom:section===t.tabId?`2px solid ${C.accent}`:"2px solid transparent"}}>{t.label}</button>))}
    </div>
    {section==="boosters"&&(<div style={{flex:1,overflowY:"auto",padding:12}}>
      <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Toggle boosters to simulate their stat effects on this fit.</div>
      {boosters.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"24px 0",fontSize:13}}>No boosters added</div>}
      {boosters.map(b=>(<div key={b.id} style={{background:C.surface,border:`1px solid ${b.active?C.accentBorder:C.border}`,borderRadius:8,marginBottom:6,overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px"}}>
          <button onClick={()=>setBoosters(boosters.map(x=>x.id===b.id?{...x,active:!x.active}:x))} style={{width:24,height:24,borderRadius:5,background:b.active?C.accentLight:"none",border:`1px solid ${b.active?C.accentBorder:C.borderStrong}`,cursor:"pointer",fontSize:11,fontWeight:700,color:b.active?C.accent:C.textMute}}>{b.active?"v":""}</button>
          <div style={{flex:1}}>
            <div style={{fontSize:12,fontWeight:600,color:b.active?C.text:C.textMid}}>{b.name}</div>
            <div style={{fontSize:10,color:C.rig,marginTop:1}}>{b.effect}</div>
          </div>
          <button onClick={()=>setBoosters(boosters.filter(x=>x.id!==b.id))} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14}}>x</button>
        </div>
        <BoosterSideEffects booster={b} onUpdate={nb=>setBoosters(boosters.map(x=>x.id===b.id?nb:x))}/>
      </div>))}
      <button onClick={()=>setShowBoosterPicker(true)} style={{width:"100%",padding:"10px 0",background:C.surfaceAlt,border:`1px dashed ${C.border}`,borderRadius:8,color:C.textMid,fontSize:12,fontWeight:600,cursor:"pointer",marginTop:4}}>+ Add Booster</button>
      {showBoosterPicker&&<BoosterPickerSheet onAdd={b=>setBoosters(prev=>[...prev,b])} onClose={()=>setShowBoosterPicker(false)}/>}
    </div>)}
    {section==="projected"&&(<div style={{flex:1,overflowY:"auto",padding:12}}>
      <div style={{fontSize:11,color:C.textMute,marginBottom:12}}>Project another fit's effects onto this ship. Remote reps and EWAR scale with range. Modules use the source fit's active/overheated state.</div>
      {projFits.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"24px 0",fontSize:13}}>No projected fits applied</div>}
      {projFits.map((f,i)=>{
        const srcFit=fitsDB[f.ship]?.find(x=>x.name===f.fitName);
        const rangeKm=f.rangeKm??30;
        const eff=srcFit?computeProjectedReps({name:f.ship,typeID:tidByName(f.ship)},srcFit.slots,SKILL_DEFAULTS,{implants:srcFit.implants,boosters:srcFit.boosters}):{reps:[],webs:[],neuts:[]};
        const rf=(o,fo)=>calcRangeFactor(o,fo,rangeKm*1000,true);
        const totals={shield:0,armor:0,hull:0};
        for(const r of eff.reps)totals[r.kind]+=r.rawPS*rf(r.optimal,r.falloff);
        // Web speed multiplier (stacking-penalised) + total neut drain at this range
        const webMs=eff.webs.map(w=>1+(w.speedFactor*rf(w.optimal,w.falloff))/100);
        const webMult=webMs.length?stackingPenalty(webMs):1;
        const neutGJs=eff.neuts.reduce((s,n)=>s+n.gjPerSec*rf(n.optimal,n.falloff),0);
        const stk=(arr)=>arr.length?(stackingPenalty(arr.map(p=>1+p/100))-1)*100:0;
        const painterSig=stk((eff.painters||[]).map(p=>p.sigBonus*rf(p.optimal,p.falloff)));
        const dampLock=stk((eff.damps||[]).map(d=>d.lockBonus*rf(d.optimal,d.falloff)));
        const tdTrack=stk((eff.trackDisr||[]).map(t=>t.tracking*rf(t.optimal,t.falloff)));
        const gdRange=stk((eff.guideDisr||[]).map(g=>g.missileRange*rf(g.optimal,g.falloff)));
        const hasReps=totals.shield+totals.armor+totals.hull>0.5;
        const hasWeb=webMs.length>0, hasNeut=neutGJs>0.05;
        const hasPaint=Math.abs(painterSig)>0.5, hasDamp=Math.abs(dampLock)>0.5, hasTD=Math.abs(tdTrack)>0.5, hasGD=Math.abs(gdRange)>0.5;
        const hasAny=hasReps||hasWeb||hasNeut||hasPaint||hasDamp||hasTD||hasGD;
        const setRange=(km)=>setProjFits(projFits.map((p,j)=>j===i?{...p,rangeKm:Math.max(0,km)}:p));
        return(<div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div><div style={{fontSize:12,fontWeight:700,color:C.text}}>{f.fitName}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{f.ship}</div></div>
            <button onClick={()=>setProjFits(projFits.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14}}>x</button>
          </div>
          {/* Range control */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <span style={{fontSize:11,color:C.textMid,minWidth:42}}>Range</span>
            <input type="range" min={0} max={150} step={1} value={rangeKm} onChange={e=>setRange(Number(e.target.value))} style={{flex:1,accentColor:C.accent}}/>
            <input type="number" inputMode="numeric" value={rangeKm} onChange={e=>setRange(Number(e.target.value)||0)} style={{width:52,padding:"3px 5px",borderRadius:5,fontSize:12,fontWeight:700,textAlign:"center",background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text}}/>
            <span style={{fontSize:10,color:C.textMute}}>km</span>
          </div>
          {/* Projected effects */}
          {hasAny?(
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {totals.shield>0&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.mid}}>{Math.round(totals.shield)}</div><div style={{fontSize:9,color:C.textMute}}>shield HP/s in</div></div>}
              {totals.armor>0&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.warning}}>{Math.round(totals.armor)}</div><div style={{fontSize:9,color:C.textMute}}>armor HP/s in</div></div>}
              {totals.hull>0&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.danger}}>{Math.round(totals.hull)}</div><div style={{fontSize:9,color:C.textMute}}>hull HP/s in</div></div>}
              {hasWeb&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>-{Math.round((1-webMult)*100)}%</div><div style={{fontSize:9,color:C.textMute}}>your speed (web)</div></div>}
              {hasNeut&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.danger}}>{Math.round(neutGJs)}</div><div style={{fontSize:9,color:C.textMute}}>GJ/s neut</div></div>}
              {hasPaint&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.warning}}>+{Math.round(painterSig)}%</div><div style={{fontSize:9,color:C.textMute}}>your sig (paint)</div></div>}
              {hasDamp&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{Math.round(dampLock)}%</div><div style={{fontSize:9,color:C.textMute}}>your lock range</div></div>}
              {hasTD&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{Math.round(tdTrack)}%</div><div style={{fontSize:9,color:C.textMute}}>your tracking</div></div>}
              {hasGD&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{Math.round(gdRange)}%</div><div style={{fontSize:9,color:C.textMute}}>your missile range</div></div>}
            </div>
          ):<div style={{fontSize:11,color:C.textMute,paddingLeft:2}}>No reps, webs, or neuts on this fit (more EWAR coming soon)</div>}
        </div>);
      })}
      <button onClick={()=>setShowProjPicker(true)} style={{width:"100%",padding:"10px 0",background:C.surfaceAlt,border:`1px dashed ${C.border}`,borderRadius:8,color:C.textMid,fontSize:12,fontWeight:600,cursor:"pointer",marginTop:4}}>+ Add Projected Fit</button>
      {showProjPicker&&<FitPickerSheet title="Project a Fit" fitsDB={fitsDB} onSelect={(ship,fit)=>setProjFits(prev=>[...prev,{ship,fitName:fit.name,rangeKm:30}])} onClose={()=>setShowProjPicker(false)}/>}
    </div>)}
    {section==="command"&&(<div style={{flex:1,overflowY:"auto",padding:12}}>
      <div style={{fontSize:11,color:C.textMute,marginBottom:12}}>Apply command burst bonuses from a fleet support ship fit. Bursts use the source fit's modules, charges, and active state.</div>
      {cmdFits.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"24px 0",fontSize:13}}>No command fits applied</div>}
      {cmdFits.map((f,i)=>{
        const srcFit=fitsDB[f.ship]?.find(x=>x.name===f.fitName);
        const bursts=srcFit?computeCommandBursts({name:f.ship,typeID:tidByName(f.ship)},srcFit.slots,SKILL_DEFAULTS,{implants:srcFit.implants,boosters:srcFit.boosters}):[];
        return(<div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}><div><div style={{fontSize:12,fontWeight:700,color:C.text}}>{f.fitName}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{f.ship}</div></div><button onClick={()=>setCmdFits(cmdFits.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14}}>x</button></div>
          {bursts.length===0&&<div style={{fontSize:11,color:C.textMute,paddingLeft:8}}>No active command bursts on this fit</div>}
          {bursts.map((b,j)=><div key={j} style={{fontSize:11,color:C.rig,paddingLeft:8,marginBottom:3}}>- {b.label}: {b.value>0?"+":""}{Math.round(b.value*10)/10}{WARFARE_BUFF_UNIT[b.buffID]||"%"}</div>)}
        </div>);
      })}
      <button onClick={()=>setShowCmdPicker(true)} style={{width:"100%",padding:"12px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer"}}>+ Add Command Fit</button>
      {showCmdPicker&&<FitPickerSheet title="Select Command Ship Fit" fitsDB={fitsDB} onSelect={(ship,fit)=>setCmdFits(prev=>[...prev,{ship,fitName:fit.name}])} onClose={()=>setShowCmdPicker(false)}/>}
    </div>)}
  </div>);
}

// ═══ APP CHROME ════════════════════════════════════════════════
// ═══ SKILLS PANEL ═══════════════════════════════════════════════
const SKILL_GROUPS=[
  {label:"Engineering & Fitting",color:C.warning,skills:[
    {key:"cpuManagement",       label:"CPU Management",           desc:"+5% CPU output/lv"},
    {key:"powerGridManagement", label:"Power Grid Management",    desc:"+5% PG output/lv"},
    {key:"weaponUpgrades",      label:"Weapon Upgrades",          desc:"-5% turret/launcher CPU/lv"},
    {key:"advWeaponUpgrades",   label:"Adv. Weapon Upgrades",     desc:"-2% turret/launcher PG/lv"},
    {key:"energyManagement",    label:"Energy Management",        desc:"+5% cap capacity/lv"},
    {key:"energySystemsOp",     label:"Energy Systems Operation", desc:"-5% cap recharge time/lv"},
  ]},
  {label:"Shield",color:C.mid,skills:[
    {key:"shieldManagement", label:"Shield Management", desc:"+5% shield HP/lv"},
    {key:"shieldOperation",  label:"Shield Operation",  desc:"-5% shield recharge time/lv"},
  ]},
  {label:"Armor & Hull",color:C.warning,skills:[
    {key:"hullUpgrades", label:"Hull Upgrades", desc:"+5% armor HP/lv"},
    {key:"mechanic",     label:"Mechanic",       desc:"+5% hull HP/lv"},
  ]},
  {label:"Navigation",color:C.rig,skills:[
    {key:"navigation",         label:"Navigation",          desc:"+5% max velocity/lv"},
    {key:"evasiveManeuvering", label:"Evasive Maneuvering", desc:"+5% agility reduction/lv"},
  ]},
  {label:"Gunnery",color:C.danger,skills:[
    {key:"gunnery",            label:"Gunnery",             desc:"+2% turret ROF/lv"},
    {key:"rapidFiring",        label:"Rapid Firing",        desc:"+4% turret ROF/lv"},
    {key:"surgicalStrike",     label:"Surgical Strike",     desc:"+3% turret damage/lv"},
    {key:"sharpshooter",       label:"Sharpshooter",        desc:"+5% optimal range/lv"},
    {key:"trajectoryAnalysis", label:"Trajectory Analysis", desc:"+4% falloff range/lv"},
    {key:"motionPrediction",   label:"Motion Prediction",   desc:"+5% tracking speed/lv"},
  ]},
  {label:"Missiles",color:C.high,skills:[
    {key:"missileLaunchers", label:"Missile Launcher Operation", desc:"-2% launcher ROF/lv"},
    {key:"warheadUpgrades",  label:"Warhead Upgrades",           desc:"+2% missile damage/lv"},
  ]},
  {label:"Drones",color:C.rig,skills:[
    {key:"droneInterfacing", label:"Drone Interfacing", desc:"+20% drone damage/lv"},
  ]},
  {label:"Ship Command",color:C.high,skills:[
    {key:"minmatarBattleship",   label:"Minmatar Battleship",    desc:"+per-level ship bonus"},
    {key:"amarrBattleship",      label:"Amarr Battleship",        desc:"+per-level ship bonus"},
    {key:"gallenteBattleship",   label:"Gallente Battleship",     desc:"+per-level ship bonus"},
    {key:"caldariBattleship",    label:"Caldari Battleship",      desc:"+per-level ship bonus"},
    {key:"marauders",            label:"Marauders",               desc:"+per-level tracking/repair"},
    {key:"heavyAssaultCruisers", label:"Heavy Assault Cruisers",  desc:"+per-level bonus"},
  ]},
];

function SkillsPanel({skills,setSkills}){
  const setAll=lv=>setSkills(Object.fromEntries(Object.keys(SKILL_DEFAULTS).map(k=>[k,lv])));
  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <button onClick={()=>setAll(5)} style={{flex:1,padding:"8px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:12,fontWeight:700,cursor:"pointer"}}>All V (Max)</button>
        <button onClick={()=>setAll(4)} style={{flex:1,padding:"8px 0",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,color:C.textMid,fontSize:12,fontWeight:700,cursor:"pointer"}}>All IV</button>
        <button onClick={()=>setAll(0)} style={{flex:1,padding:"8px 0",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,color:C.danger,fontSize:12,fontWeight:700,cursor:"pointer"}}>Clear All</button>
      </div>
      {SKILL_GROUPS.map(grp=>(
        <div key={grp.label} style={{marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,paddingBottom:4,borderBottom:`1px solid ${C.border}`}}>
            <div style={{width:8,height:8,borderRadius:99,background:grp.color}}/>
            <span style={{fontSize:11,fontWeight:700,color:C.text,textTransform:"uppercase",letterSpacing:.5}}>{grp.label}</span>
          </div>
          {grp.skills.map(sk=>(
            <div key={sk.key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}22`}}>
              <div style={{flex:1,minWidth:0,marginRight:8}}>
                <div style={{fontSize:12,fontWeight:600,color:C.text}}>{sk.label}</div>
                <div style={{fontSize:10,color:C.textMute}}>{sk.desc}</div>
              </div>
              <div style={{display:"flex",gap:3,flexShrink:0}}>
                {[1,2,3,4,5].map(lv=>(
                  <button key={lv} onClick={()=>setSkills(prev=>({...prev,[sk.key]:lv}))}
                    style={{width:24,height:24,borderRadius:5,border:"none",cursor:"pointer",fontWeight:700,fontSize:11,
                      background:skills[sk.key]>=lv?grp.color:C.surfaceAlt,
                      color:skills[sk.key]>=lv?"#fff":C.textMute}}>
                    {lv}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      <div style={{marginTop:10,padding:"10px 12px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,fontSize:10,color:C.textMute}}>
        Ship hull bonuses (e.g. Raven missile damage, Drake resists) are not yet included — they require per-ship bonus data.
      </div>
    </div>
  );
}

function SettingsOverlay({onClose,skills,setSkills,factorInReload,setFactorInReload}){
  const[market,setMarket]=useState("evetycoon");
  const[section,setSection]=useState("skills");
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:100,display:"flex",flexDirection:"column",justifyContent:"flex-end",alignItems:"center"}}>
    <div style={{width:"100%",maxWidth:430,background:C.surface,borderRadius:"16px 16px 0 0",maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{width:36,height:4,background:C.border,borderRadius:99,margin:"10px auto 0"}}/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:16,fontWeight:700,color:C.text}}>Settings</span><button onClick={onClose} style={{background:"none",border:"none",color:C.textMid,fontSize:20,cursor:"pointer",padding:"0 4px"}}>x</button></div>
      <div className="hs" style={{overflowX:"auto",display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        {[{key:"skills",label:"Skills"},{key:"backup",label:"Backup"},{key:"esi",label:"ESI"},{key:"market",label:"Market"},{key:"implants",label:"Loadouts"},{key:"overrides",label:"Overrides"}].map(n=><button key={n.key} onClick={()=>setSection(n.key)} style={{flexShrink:0,padding:"9px 14px",fontSize:12,fontWeight:600,background:"none",border:"none",cursor:"pointer",color:section===n.key?C.accent:C.textMute,borderBottom:section===n.key?`2px solid ${C.accent}`:"2px solid transparent"}}>{n.label}</button>)}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {section==="skills"&&<SkillsPanel skills={skills} setSkills={setSkills}/>}
        {section==="backup"&&<BackupPanel/>}
        {section==="esi"&&<div><div style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}><div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:4}}>EVE ESI Connection</div><div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Connect your EVE account to import skills, implants, and fits. Cloud fit sync coming soon.</div><div style={{marginBottom:10,padding:"8px 12px",background:C.surface,border:`1px dashed ${C.border}`,borderRadius:8,fontSize:11,color:C.textMute,textAlign:"center"}}>Not connected</div><button style={{width:"100%",padding:"10px 0",background:C.accent,border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Connect with EVE SSO</button></div></div>}
        {section==="market"&&<div>{[{key:"ceve",label:"ceve-market.org"},{key:"evetycoon",label:"EVE Tycoon"},{key:"fuzzwork",label:"Fuzzwork Market"}].map(m=>(<div key={m.key} onClick={()=>setMarket(m.key)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:C.surface,border:`1px solid ${market===m.key?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8,cursor:"pointer"}}><div style={{width:18,height:18,borderRadius:99,border:`2px solid ${market===m.key?C.accent:C.borderStrong}`,display:"flex",alignItems:"center",justifyContent:"center"}}>{market===m.key&&<div style={{width:8,height:8,borderRadius:99,background:C.accent}}/>}</div><span style={{fontSize:13,fontWeight:market===m.key?700:500,color:market===m.key?C.text:C.textMid}}>{m.label}</span></div>))}</div>}
        {section==="implants"&&<div>
          <div style={{fontSize:12,color:C.textMid,marginBottom:12}}>Manage your implant loadouts from the <strong>Implants</strong> tab - use the "Save Current" button to save, tap any loadout to load it.</div>
          <div style={{padding:"12px 14px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,fontSize:11,color:C.textMute}}>Loadouts are saved per-session. Cloud sync via EVE SSO coming in a future update.</div>
        </div>}
        {section==="overrides"&&<div>{[["Max Velocity","1,240 m/s"],["Signature Radius","385 m"],["Align Time","11.2 s"],["Scan Resolution","108 mm"]].map(([label,ph])=>(<div key={label} style={{marginBottom:10}}><div style={{fontSize:11,color:C.textMid,marginBottom:4}}>{label}</div><input placeholder={ph} style={{width:"100%",padding:"8px 10px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,fontSize:12,boxSizing:"border-box"}}/></div>))}<button style={{width:"100%",marginTop:8,padding:"10px 0",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:C.danger,fontSize:12,fontWeight:600,cursor:"pointer"}}>Reset All Overrides</button></div>}
      </div>
      <div style={{flexShrink:0,padding:"10px 16px calc(10px + env(safe-area-inset-bottom, 0px))",borderTop:`1px solid ${C.border}`,background:C.surfaceAlt,fontSize:10,lineHeight:1.5,color:C.textMute,textAlign:"center"}}>
        Unofficial, fan-made tool — not affiliated with, endorsed by, or sponsored by CCP Games / Fenris Creations. EVE Online and all related materials are used with limited permission; all intellectual property belongs to CCP hf.
      </div>
    </div>
  </div>);
}

// ═══ EXPORT FIT MODAL ═══════════════════════════════════════════════
const EXPORT_PREFS_KEY = 'pyfa_export_prefs';
function ExportFitModal({activeFit, slots, implants, boosters, cargo, onClose}) {
  const _lsGet=()=>{try{return JSON.parse(localStorage.getItem(EXPORT_PREFS_KEY)||'{}');}catch{return {};}};
  const _p=_lsGet();
  const [incCharges,  setIncCharges]  = useState(_p.charges  ?? true);
  const [incImplants, setIncImplants] = useState(_p.implants ?? true);
  const [incBoosters, setIncBoosters] = useState(_p.boosters ?? true);
  const [incCargo,    setIncCargo]    = useState(_p.cargo    ?? false);
  const [copied,      setCopied]      = useState(false);

  const genEFT = () => {
    const ship = activeFit?.ship ?? 'Unknown';
    const name = activeFit?.fitName ?? 'Unnamed';
    const lines = [`[${ship}, ${name}]`];
    // Sections in EFT order: high, mid, low, rigs
    for (const sec of ['high', 'mid', 'low', 'rigs']) {
      for (const slot of (slots?.[sec] ?? [])) {
        if (!slot.typeID) { lines.push(''); continue; }
        const charge = incCharges && slot.ammo ? `, ${slot.ammo}` : '';
        lines.push(`${slot.name}${charge}`);
      }
      if (sec !== 'rigs') lines.push('');
    }
    if (incImplants && implants?.length) {
      lines.push('');
      for (const imp of implants) lines.push(imp.name ?? '');
    }
    if (incBoosters && boosters?.length) {
      lines.push('');
      for (const b of boosters) lines.push(b.name ?? '');
    }
    if (incCargo && cargo?.length) {
      lines.push('');
      for (const c of cargo) { const qty = c.qty > 1 ? ` x${c.qty}` : ''; lines.push(`${c.name}${qty}`); }
    }
    return lines.join('\n');
  };

  const doExport = () => {
    try { localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify({charges:incCharges,implants:incImplants,boosters:incBoosters,cargo:incCargo})); } catch(e) {}
    const txt = genEFT();
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{
        // Fallback for clipboard permission denied:
        const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);setCopied(true);setTimeout(()=>setCopied(false),2000);
      });
    } else {
      // HTTP fallback:
      const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);setCopied(true);setTimeout(()=>setCopied(false),2000);
    }
  };

  const CheckRow = ({label, val, setVal}) => (
    <div onClick={()=>setVal(v=>!v)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderBottom:`1px solid ${C.border}`,cursor:'pointer'}}>
      <div style={{width:20,height:20,borderRadius:4,border:`2px solid ${val?C.accent:C.border}`,background:val?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,color:'#fff',fontSize:12,fontWeight:700}}>
        {val?'✓':''}
      </div>
      <span style={{fontSize:13,color:C.text}}>{label}</span>
    </div>
  );

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'flex-end'}} onClick={onClose}>
      <div style={{width:'100%',background:C.surface,borderRadius:'16px 16px 0 0',padding:20,boxShadow:'0 -8px 32px rgba(0,0,0,.5)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:4}}>Export EFT Fit</div>
        <div style={{fontSize:11,color:C.textMute,marginBottom:16}}>Select what to include in the exported fit text</div>
        <CheckRow label="Loaded Charges (e.g. Hail L)" val={incCharges} setVal={setIncCharges}/>
        <CheckRow label="Implants" val={incImplants} setVal={setIncImplants}/>
        <CheckRow label="Boosters" val={incBoosters} setVal={setIncBoosters}/>
        <CheckRow label="Cargo" val={incCargo} setVal={setIncCargo}/>
        <button onClick={doExport} style={{width:'100%',marginTop:16,padding:'14px',borderRadius:10,border:'none',background:copied?C.rig:C.accent,color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer'}}>
          {copied ? '✓ Copied to clipboard!' : 'Copy EFT to Clipboard'}
        </button>
        <button onClick={onClose} style={{width:'100%',marginTop:8,padding:'10px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.textMute,fontSize:13,cursor:'pointer'}}>
          Cancel
        </button>
      </div>
    </div>
  );
}


function HamburgerMenu({onClose,onOpenSettings,onImportFit,onExportFit,onSnapshot}){
  return(<div style={{position:"fixed",inset:0,zIndex:90}} onClick={onClose}>
    <div style={{position:"absolute",top:0,left:0,bottom:0,width:260,background:C.surface,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",boxShadow:"4px 0 24px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"20px 16px 12px",borderBottom:`1px solid ${C.border}`}}><div style={{fontSize:18,fontWeight:800,color:C.text,marginBottom:2}}>Pyfa Mobile</div><div style={{fontSize:11,color:C.textMute}}>EVE Online Fitting Tool</div></div>
      {[{icon:"&#128229;",label:"Import Fit",sub:"EFT from clipboard",action:"import"},{icon:"&#128228;",label:"Export Fit",sub:"Copy EFT to clipboard",action:"export"},{icon:"&#128247;",label:"Export Snapshot",sub:"Shareable image of the fit",action:"snapshot"},{icon:"&#128176;",label:"Optimize Fit Price",sub:"Swap modules to reduce cost"},{icon:"&#9881;",label:"Settings",sub:"ESI, market, overrides",action:"settings"}].map(item=>(<button key={item.label} onClick={()=>{if(item.action==="settings"){onOpenSettings();onClose();}else if(item.action==="import"){onImportFit();onClose();}else if(item.action==="export"){if(onExportFit)onExportFit();onClose();}else if(item.action==="snapshot"){if(onSnapshot)onSnapshot();onClose();}else onClose();}} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:"none",border:"none",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:20}} dangerouslySetInnerHTML={{__html:item.icon}}/><div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{item.label}</div><div style={{fontSize:11,color:C.textMute,marginTop:1}}>{item.sub}</div></div></button>))}
    </div>
  </div>);
}

function AppHeader({onHamburger,activeFit,onShipInfo}){
  const ship=activeFit?.ship?lookupShip(activeFit.ship):{};
  const shipName=activeFit?.ship??"Pyfa Mobile";
  const subLabel=ship.hullClass?`${ship.race??""} ${ship.hullClass}`.trim():"EVE Online Fitting Tool";
  return(<div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"14px 14px 12px"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div>
        <div style={{fontSize:10,fontWeight:600,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",marginBottom:2}}>Pyfa Mobile</div>
        <div style={{fontSize:19,fontWeight:700,color:C.text,lineHeight:1.2}}>{shipName}</div>
        <div style={{fontSize:12,color:C.textMid,marginTop:1}}>{subLabel}</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button onClick={onShipInfo} style={{width:52,height:52,borderRadius:11,background:C.surfaceAlt,border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",cursor:onShipInfo?'pointer':'default',padding:0}}>
          {ship.typeID
            ?<img src={eveRender(ship.typeID,64)} width={52} height={52} alt="" style={{borderRadius:11}} onError={e=>{e.target.style.display="none";}}/>
            :<span style={{fontSize:26}}>&#128640;</span>
          }
        </button>
        <button onClick={onHamburger} style={{width:40,height:40,borderRadius:9,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>&#9776;</button>
      </div>
    </div>
  </div>);
}

// Local pyfa booster-bottle icon (the equippable-booster emblem the EVE image server won't
// serve — it returns the crafting-material vial for booster typeIDs). new URL(..., import.meta.url)
// lets Vite fingerprint + bundle the asset for both dev and the built/Capacitor app.
// The pyfa checkout is optional (and gitignored), so resolve this through eveIcon(), which
// falls back to CCP's image server when the local icon set is absent. Hard-coding the file
// path meant a fresh clone showed a broken image here.
const BOOSTER_ICON=eveIcon(3211,32);

function BottomNav({active,onChange}){
  const tabs=[
    {key:"fittings",label:"Fittings",navKey:"fit"},
    {key:"cargo",   label:"Cargo",   navKey:"cargo"},
    {key:"drones",  label:"Drones",  navKey:"drones"},
    {key:"implants",label:"Implants",navKey:"implants"},
    {key:"effects", label:"Effects", navKey:"effects"},
  ];
  // High-res EVE item icons (served at 64px, crisp when scaled to 22px) in place of the
  // low-res bundle icons: Reactor Control Unit (Fittings), Expanded Cargohold (Cargo),
  // Hobgoblin II (Drones), Ocular Filter (Implants), Drop Booster (Effects).
  const NAV_ICON_TYPEIDS={fit:1353,cargo:1317,drones:24395,implants:10216};
  return(<div style={{display:"flex",background:C.surface,borderTop:`1px solid ${C.border}`,paddingBottom:"env(safe-area-inset-bottom, 0px)"}}>
    {tabs.map(t=>{const ovTid=NAV_ICON_TYPEIDS[t.navKey];const src=ovTid?eveIcon(ovTid,64):(navIcons?.[t.navKey]??'');const dim=active===t.key?1:0.5;return(<button key={t.key} onClick={()=>onChange(t.key)} style={{flex:1,padding:"7px 0 8px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <img src={t.navKey==="effects"?BOOSTER_ICON:src} width={22} height={22} alt="" style={{objectFit:"contain",opacity:dim}} onError={e=>{e.target.style.visibility="hidden";}}/>
      <span style={{fontSize:9,fontWeight:700,color:active===t.key?C.accent:C.textMute,letterSpacing:.3}}>{t.label}</span>
      {active===t.key&&<div style={{width:20,height:2,background:C.accent,borderRadius:99,marginTop:1}}/>}
    </button>);})}
  </div>);
}

// ═══ ROOT APP ══════════════════════════════════════════════════
export default function App(){
  const[_tick,_setTick]=useState(0);
  useEffect(()=>{
    if(_bundleReady){_setTick(1);return;}
    _bundleListeners.push(()=>_setTick(t=>t+1));
  },[]);
  // Native shell setup (no-op on web). Uses the Capacitor runtime bridge so there is no build-time
  // dependency on the plugins: light status-bar content over the dark theme, kept out of the webview
  // (so the header isn't clipped), and dismiss the splash once React has mounted.
  useEffect(()=>{
    const Cap=(typeof window!=="undefined")&&window.Capacitor;
    if(!Cap?.isNativePlatform?.())return;
    try{
      const SB=Cap.Plugins?.StatusBar;
      if(SB){SB.setStyle?.({style:"DARK"});SB.setOverlaysWebView?.({overlay:false});SB.setBackgroundColor?.({color:"#0e0e10"});}
      Cap.Plugins?.SplashScreen?.hide?.();
    }catch(e){}
  },[]);
  const[bottomTab,setBottomTab]=useState("fittings");
  const[showHamburger,setShowHamburger]=useState(false);
  const[showSettings,setShowSettings]=useState(false);
  const[fitsDB,setFitsDB]=useState(()=>{try{const s=localStorage.getItem("pyfa-fitsdb");if(s)return JSON.parse(s);}catch{}return SAVED_FITS_SEED;});
  const[activeFit,setActiveFit]=useState(()=>{try{const s=localStorage.getItem("pyfa-activefit");if(s)return JSON.parse(s);}catch{}return{ship:"Hyperion",fitName:"PvP Blaster Hyperion"};});
  const initialFit=(()=>{try{const db=JSON.parse(localStorage.getItem("pyfa-fitsdb")||"null");const af=JSON.parse(localStorage.getItem("pyfa-activefit")||"null");if(db&&af)return db[af.ship]?.find(f=>f.name===af.fitName)||null;}catch{}return null;})();
  const emptyImplants=()=>Array.from({length:10},(_,i)=>({slot:i+1,name:"[Empty]",bonus:null}));
  const[slots,setSlots]=useState(initialFit?.slots??generateEmptySlots(lookupShip("Hyperion")));
  const[drones,setDrones]=useState(initialFit?.drones??[]);
  const[fighters,setFighters]=useState(initialFit?.fighters??[]);
  // Incoming damage profile (shared: Stats resists/EHP + RAH, Fit-tab readouts, fighter EHP).
  const[dmgProfile,setDmgProfile]=useState({name:"Uniform",p:[0.25,0.25,0.25,0.25]});
  const[cargoItems,setCargoItems]=useState(initialFit?.cargo??[]);
  const[implants,setImplants]=useState(initialFit?.implants??emptyImplants());
  const[boosters,setBoosters]=useState(initialFit?.boosters??[]);
  // Projected fits (EWAR/remote reps) and command fits (burst projection), lifted to App level so
  // the stats/graph calc can consume them. Each entry references a saved fit + projection options.
  const[projFits,setProjFits]=useState(initialFit?.projFits??[]);
  const[cmdFits,setCmdFits]=useState(initialFit?.cmdFits??[]);
  const[skills,setSkills]=useState(()=>{try{const s=localStorage.getItem("pyfa-skills");if(s)return{...SKILL_DEFAULTS,...JSON.parse(s)};}catch{}return SKILL_DEFAULTS;});
  // Effective command-burst buffs projected from the selected command fits, applied to this fit.
  const externalBursts=useMemo(()=>{
    const out=[];
    for(const cf of cmdFits){
      const fit=fitsDB[cf.ship]?.find(f=>f.name===cf.fitName);
      if(!fit)continue;
      const bursts=computeCommandBursts({name:cf.ship,typeID:tidByName(cf.ship)},fit.slots,skills,{implants:fit.implants,boosters:fit.boosters});
      for(const b of bursts)out.push(b);
    }
    return out;
  },[cmdFits,fitsDB,skills]);
  // Aggregate projected effects from projected fits at their ranges: remote reps (HP/s by layer),
  // a stacking-penalised web speed multiplier, and total neut cap drain (GJ/s).
  const projectedEffects=useMemo(()=>{
    const reps={shield:0,armor:0,hull:0};
    const webMults=[]; let neutGJs=0;
    // Collect per-effect debuff bonuses (range-scaled) for stacking.
    const col={sig:[],lock:[],scan:[],trk:[],topt:[],tfall:[],mrng:[],edly:[],avel:[],acld:[]};
    for(const pf of projFits){
      const fit=fitsDB[pf.ship]?.find(f=>f.name===pf.fitName);
      if(!fit)continue;
      const eff=computeProjectedReps({name:pf.ship,typeID:tidByName(pf.ship)},fit.slots,skills,{implants:fit.implants,boosters:fit.boosters});
      const rangeM=(pf.rangeKm??30)*1000;
      const rf=(o,fo)=>calcRangeFactor(o,fo,rangeM,true);
      for(const r of eff.reps)reps[r.kind]+=r.rawPS*rf(r.optimal,r.falloff);
      for(const w of eff.webs)webMults.push(1+(w.speedFactor*rf(w.optimal,w.falloff))/100);
      for(const n of eff.neuts)neutGJs+=n.gjPerSec*rf(n.optimal,n.falloff);
      for(const p of (eff.painters||[]))col.sig.push(p.sigBonus*rf(p.optimal,p.falloff));
      for(const d of (eff.damps||[])){col.lock.push(d.lockBonus*rf(d.optimal,d.falloff));col.scan.push(d.scanResBonus*rf(d.optimal,d.falloff));}
      for(const t of (eff.trackDisr||[])){const f=rf(t.optimal,t.falloff);col.trk.push(t.tracking*f);col.topt.push(t.optimalBonus*f);col.tfall.push(t.falloffBonus*f);}
      for(const g of (eff.guideDisr||[])){const f=rf(g.optimal,g.falloff);col.mrng.push(g.missileRange*f);col.edly.push(g.explosionDelay*f);col.avel.push(g.aoeVel*f);col.acld.push(g.aoeCloud*f);}
    }
    const webMult=webMults.length?stackingPenalty(webMults):1;
    const stackPct=(arr)=>arr.length?(stackingPenalty(arr.map(p=>1+p/100))-1)*100:0;
    const debuffs={sig:stackPct(col.sig),lockRange:stackPct(col.lock),scanRes:stackPct(col.scan),tracking:stackPct(col.trk),turretOptimal:stackPct(col.topt),turretFalloff:stackPct(col.tfall),missileRange:stackPct(col.mrng),explosionDelay:stackPct(col.edly),aoeVel:stackPct(col.avel),aoeCloud:stackPct(col.acld)};
    const hasDebuff=Object.values(debuffs).some(v=>Math.abs(v)>0.05);
    return {reps,webMult,neutGJs,debuffs:hasDebuff?debuffs:null};
  },[projFits,fitsDB,skills]);
  const projectedReps=projectedEffects.reps;
  // Real active-drone DPS (skills + hull bonuses), so the Drones window matches the Stats window.
  // Per-drone EFFECTIVE stats (range/tracking/speed/EHP) for the Drones tab. Computed from the fit,
  // not snapshotted when the drone was added, so skills/implants/boosters/ship bonuses are included.
  // Full stats for the shareable snapshot card.
  const snapshotStats=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName) return null;
    try{
      return calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],skills,{implants,boosters,externalBursts,projectedEffects});
    }catch{ return null; }
  },[activeFit,slots,drones,skills,implants,boosters,externalBursts,projectedEffects]);

  const droneInfo=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName) return [];
    try{
      const cs=calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],skills,{implants,boosters,externalBursts,projectedEffects});
      return cs?.droneInfo ?? [];
    }catch{ return []; }
  },[activeFit,slots,drones,skills,implants,boosters,externalBursts,projectedEffects]);

  const activeDroneDps=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName) return 0;
    try{
      const cs=calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],skills,{implants,boosters,externalBursts,projectedWebMult:projectedEffects?.webMult,projectedNeutGJs:projectedEffects?.neutGJs,projectedDebuffs:projectedEffects?.debuffs});
      return cs?.droneDps?.total ?? 0;
    }catch{ return 0; }
  },[activeFit,slots,drones,skills,implants,boosters,externalBursts,projectedEffects]);
  // Per-squadron computed detail (DPS, speed, EHP, ability states) for the fighter management UI.
  const fighterInfo=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName||!(fighters?.length)) return [];
    try{
      const cs=calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],skills,{implants,boosters,externalBursts,damageProfile:dmgProfile?.p,fighters:fighters.map(f=>({name:f.name,qty:f.qty??1,active:f.active,abilities:f.abilities}))});
      return cs?.fighterDetails ?? [];
    }catch{ return []; }
  },[activeFit,slots,drones,skills,implants,boosters,fighters,dmgProfile]);
  const[factorInReload,setFactorInReload]=useState(()=>{try{return localStorage.getItem("pyfa-factor-reload")==="1";}catch{return false;}});
  const[fittingsView,setFittingsView]=useState("active");
  const[showShipInfo,setShowShipInfo]=useState(false);
  const[showImportFit,setShowImportFit]=useState(false);
  const[showExportFit,setShowExportFit]=useState(false);
  const[showSnapshot,setShowSnapshot]=useState(false);
  const loadFit=(ship,fitName)=>{
    const fit=fitsDB[ship]?.find(f=>f.name===fitName);
    setActiveFit({ship,fitName});
    setSlots(fit?.slots??generateEmptySlots(lookupShip(ship)));
    setDrones(fit?.drones??[]);
    setFighters(fit?.fighters??[]);
    setCargoItems(fit?.cargo??[]);
    setImplants(fit?.implants??emptyImplants());
    setBoosters(fit?.boosters??[]);
    setProjFits(fit?.projFits??[]);
    setCmdFits(fit?.cmdFits??[]);
    setFittingsView("active");
    setBottomTab("fittings");
  };
  const importFit=(parsed)=>{
    const{shipName,fitName,ship,mods,drones:pDrones,fighters:pFighters,cargo:pCargo,implantNames,boosterNames,subsystems:pSubs}=parsed;
    const modified=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    // Build subsystem slot objects (4 slots, ordered Core/Defensive/Offensive/Propulsion).
    const subSlots=isT3Cruiser(shipName)?(()=>{
      const order=["Core","Defensive","Offensive","Propulsion"];
      const byGroup={};
      for(const s of (pSubs??[])){
        const gn=TYPES[s.typeID]?.gn??TYPES[s.typeID]?.groupName??"";
        const key=Object.entries(T3C_SUBSYSTEM_GROUPS).find(([,g])=>g===gn)?.[0];
        if(key)byGroup[key]={id:`sub${order.indexOf(key)}`,name:s.name,typeID:s.typeID,type:"subsystem",subGroup:key};
      }
      return order.map((k,i)=>byGroup[k]??{id:`sub${i}`,name:"[Empty Subsystem Slot]",icon:null,type:"empty",subGroup:k});
    })():undefined;
    const newSlots=buildSlotsFromEFT(ship,mods,subSlots);
    const newDrones=pDrones.map((d,i)=>{
      const dta=(typeof DRONE_TYPES!=='undefined'&&d.drone.typeID)?DRONE_TYPES?.[String(d.drone.typeID)]?.a:null;
      const bw=dta?.droneBandwidthUsed ?? d.drone.bandwidth ?? 5;
      return {id:Date.now()+i,name:d.name,size:d.drone.size,qty:d.qty,active:false,
        range:d.drone.range??0,tracking:d.drone.tracking??0,velocity:d.drone.velocity??0,hp:d.drone.hp??0,
        dps:d.drone.dps??0,bandwidth:bw,volume:dta?.volume??d.drone.volume,typeID:d.drone.typeID};
    });
    const newFighters=(pFighters??[]).map((f,i)=>{
      const t=f.typeID??tidByName(f.name); const gn=TYPES[t]?.gn??TYPES[t]?.groupName??"";
      const role=/Support/i.test(gn)?"Support":null;
      return{id:Date.now()+1000+i,name:f.name,qty:f.qty,tier:/ II$/.test(f.name)?"T2":"T1",dps:0,role,hp:0,active:true,typeID:t};
    });
    const newCargo=pCargo.map((c,i)=>{const tid=c.typeID??tidByName(c.name);return{id:Date.now()+i,name:c.name,qty:c.qty,vol:tid!=null?(TYPES[tid]?.attrs?.volume??TYPES[String(tid)]?.attrs?.volume??1):1,typeID:tid??undefined};});
    const newImplants=emptyImplants();
    for(const ip of implantNames){const idx=newImplants.findIndex(i=>i.slot===ip.slot);if(idx>=0)newImplants[idx]={slot:ip.slot,name:ip.name,bonus:null};}
    const newBoosters=boosterNames.map(buildBoosterFromName);
    setFitsDB(db=>{
      const existing=db[shipName]||[];
      const idx=existing.findIndex(f=>f.name===fitName);
      const entry={id:idx>=0?existing[idx].id:Date.now(),name:fitName,modified,slots:newSlots,
        drones:newDrones,fighters:newFighters,cargo:newCargo,implants:newImplants,boosters:newBoosters};
      if(idx>=0){const u=[...existing];u[idx]=entry;return{...db,[shipName]:u};}
      return{...db,[shipName]:[...existing,entry]};
    });
    setActiveFit({ship:shipName,fitName});
    setSlots(newSlots);setDrones(newDrones);setFighters(newFighters);setCargoItems(newCargo);
    setImplants(newImplants);setBoosters(newBoosters);
    setProjFits([]);setCmdFits([]);
    setBottomTab("fittings");
    setFittingsView("active");
  };
  useEffect(()=>{if(!activeFit?.ship||!activeFit?.fitName)return;setFitsDB(db=>{const sf=db[activeFit.ship];if(!sf)return db;const idx=sf.findIndex(f=>f.name===activeFit.fitName);if(idx<0)return db;const u=[...sf];u[idx]={...u[idx],slots,drones,fighters,cargo:cargoItems,implants,boosters,projFits,cmdFits};return{...db,[activeFit.ship]:u};});},[slots,drones,fighters,cargoItems,implants,boosters,projFits,cmdFits,activeFit]);
  useEffect(()=>{try{localStorage.setItem("pyfa-fitsdb",JSON.stringify(fitsDB));}catch{}},[fitsDB]);
  useEffect(()=>{try{localStorage.setItem("pyfa-activefit",JSON.stringify(activeFit));}catch{}},[activeFit]);
  useEffect(()=>{try{localStorage.setItem("pyfa-skills",JSON.stringify(skills));}catch{}},[skills]);
  useEffect(()=>{try{localStorage.setItem("pyfa-factor-reload",factorInReload?"1":"0");}catch{}},[factorInReload]);
  const returnToFit=()=>{setBottomTab("fittings");setFittingsView("active");};
  return(<div style={{background:C.bg,minHeight:"100vh",display:"flex",justifyContent:"center"}}>
    <style>{GLOBAL_CSS}</style>
    <div style={{width:"100%",maxWidth:430,minHeight:"100vh",display:"flex",flexDirection:"column",background:C.bg}}>
      <AppHeader onHamburger={()=>setShowHamburger(true)} activeFit={activeFit} onShipInfo={()=>setShowShipInfo(true)}/>
      {bottomTab!=="fittings"&&<ActiveFitBar activeFit={activeFit} onReturn={returnToFit}/>}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {bottomTab==="fittings"&&<FittingsScreen activeFit={activeFit} setActiveFit={setActiveFit} loadFit={loadFit} view={fittingsView} setView={setFittingsView} fitsDB={fitsDB} setFitsDB={setFitsDB} slots={slots} setSlots={setSlots} setDrones={setDrones} setFighters={setFighters} fighters={fighters} setCargoItems={setCargoItems} setImplants={setImplants} setBoosters={setBoosters} setProjFits={setProjFits} setCmdFits={setCmdFits} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} setFactorInReload={setFactorInReload} externalBursts={externalBursts} projectedReps={projectedReps} projectedEffects={projectedEffects} dmgProfile={dmgProfile} setDmgProfile={setDmgProfile}/>}
        {bottomTab==="cargo"   &&<CargoScreen items={cargoItems} setItems={setCargoItems} slots={slots} shipCapacity={(()=>{const t=tidByName(activeFit?.ship);return t&&TYPES[t]?(TYPES[t].attrs?.capacity??1150):1150;})()} />}
        {bottomTab==="drones"  &&<DronesScreen drones={drones} setDrones={setDrones} droneInfo={droneInfo} fighters={fighters} setFighters={setFighters} fighterInfo={fighterInfo} activeDroneDps={activeDroneDps} shipDroneBay={(()=>{const t=tidByName(activeFit?.ship);return t&&TYPES[t]?(TYPES[t].attrs?.droneCapacity??0):0;})()} shipDroneBandwidth={(()=>{const t=tidByName(activeFit?.ship);return t&&TYPES[t]?(TYPES[t].attrs?.droneBandwidth??0):0;})()} shipFighter={(()=>{const t=tidByName(activeFit?.ship);const a=t&&TYPES[t]?TYPES[t].attrs:null;return a?{cap:a.fighterCapacity??0,tubes:a.fighterTubes??0,light:a.fighterLightSlots??0,heavy:a.fighterHeavySlots??0,support:a.fighterSupportSlots??0}:{cap:0,tubes:0,light:0,heavy:0,support:0};})()} />}
        {bottomTab==="implants"&&<ImplantsScreen implants={implants} setImplants={setImplants}/>}
        {bottomTab==="effects" &&<EffectsScreen fitsDB={fitsDB} boosters={boosters} setBoosters={setBoosters} projFits={projFits} setProjFits={setProjFits} cmdFits={cmdFits} setCmdFits={setCmdFits}/>}
      </div>
      <BottomNav active={bottomTab} onChange={setBottomTab}/>
    </div>
    {showHamburger&&<HamburgerMenu onClose={()=>setShowHamburger(false)} onOpenSettings={()=>{setShowSettings(true);setShowHamburger(false);}} onImportFit={()=>setShowImportFit(true)} onExportFit={()=>{setShowExportFit(true);setShowHamburger(false);}} onSnapshot={()=>{setShowSnapshot(true);setShowHamburger(false);}} onExportFit={()=>setShowExportFit(true)}/>}
    {showShipInfo&&activeFit?.ship&&<ShipInfoSheet ship={lookupShip(activeFit.ship)??{name:activeFit.ship}} onClose={()=>setShowShipInfo(false)}/>}
    {showExportFit&&<ExportFitModal activeFit={activeFit} slots={slots} implants={implants} boosters={boosters} cargo={[]} onClose={()=>setShowExportFit(false)}/>}
    {showSnapshot&&<SnapshotModal onClose={()=>setShowSnapshot(false)} fitName={activeFit?.name} shipName={activeFit?.ship} shipTypeID={tidByName(activeFit?.ship)} slots={slots} cs={snapshotStats} drones={drones} implants={implants} boosters={boosters}/>}
    {showSettings &&<SettingsOverlay onClose={()=>setShowSettings(false)} skills={skills} setSkills={setSkills} factorInReload={factorInReload} setFactorInReload={setFactorInReload}/>}
    {showImportFit&&<ImportFitSheet onClose={()=>setShowImportFit(false)} onImport={importFit}/>}
  </div>);
}
