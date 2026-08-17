import { useState, useRef, useMemo, useEffect } from "react";
import { buildShipTaxonomy, shipsUnder, nodeAtPath } from "../lib/ship-taxonomy.js";
import { nextFitId } from "../lib/fit-tabs.js";
import { useTabSwipe, slideClass } from "../lib/use-tab-swipe.js";
import { C } from "../theme.js";
import { eveIcon, eveRender } from "../lib/icons.js";
import shipSmallIcon from "../assets/ship_small.png";
import { shipTraits, shipsByClass, raceIcons, generateEmptySlots, lookupShip, haptic } from "../lib/core.js";
import { isT3Cruiser, t3cSlotLayout } from "../calc.js";
import { TAG_PALETTE, MAX_TAG_LEN, normalizeTag, tagKey, tagsOf, hasTag, toggleTag,
         allTags, fitsWithTag, colorForTag, setTagColor, renameTag, removeTagEverywhere } from "../lib/fit-tags.js";
import { FitTab, StatsTab } from "./tabs.jsx";
import { InfoButton, TraitsPanel } from "./ui.jsx";
import { GraphTab } from "./GraphTab.jsx";

// Module scope on purpose: FittingsScreen reads this inside a useState initializer, which runs
// BEFORE a const declared later in the component body exists — the temporal dead zone would throw
// on first render, and no-undef cannot see it.
const _SUBTABS=["Fit","Stats","Graph"];

export function ActiveFitBar({activeFit,onReturn}){
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

export function RecentFitsList({fitsDB, activeFit, loadFit, recents}) {
  const [open, setOpen] = useState(() => {
    // Closed by default: the list is a shortcut, not the primary navigation, and open by default
    // it pushed the ship classes below the fold on a phone. The choice is remembered either way.
    try { return localStorage.getItem('pyfa_recent_open') === '1'; } catch { return false; }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem('pyfa_recent_open', next ? '1' : '0'); } catch {}
  };
  // Driven by an explicit most-recently-OPENED list maintained in App.jsx, not by `modified`.
  // The old sort was `(b.fit.modified||0) - (a.fit.modified||0)`, but `modified` is a display
  // STRING ("Aug 6, 2026") — subtracting two of them is NaN, so the comparator never reordered
  // anything and the list was simply the first 8 fits in object order. Even parsed it would have
  // been wrong twice over: it is day-granular (everything edited today ties) and "modified" is not
  // "opened" anyway.
  const recentFits = (recents ?? [])
    .map(r => { const fit = fitsDB[r.ship]?.find(f => (r.id != null ? f.id === r.id : f.name === r.name)); return fit ? {ship: r.ship, fit} : null; })
    .filter(Boolean)          // drops fits deleted or renamed since they were opened
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

// A tag reads as a coloured pill. The tag's colour is the BORDER and the text, over a heavily
// transparent fill of the same colour, so eight palette entries stay legible on the dark surface —
// solid pills at this size turned the fit list into confetti and buried the fit names.
export function TagChip({name, color, onClick, onRemove, dim}) {
  return (
    <span onClick={onClick} className={onClick?"press":undefined}
      style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:99,
              fontSize:10,fontWeight:700,lineHeight:1.5,whiteSpace:"nowrap",cursor:onClick?"pointer":"default",
              color:dim?C.textMute:color,background:dim?"transparent":`${color}1f`,
              border:`1px solid ${dim?C.border:`${color}59`}`}}>
      {name}
      {onRemove&&<span onClick={e=>{e.stopPropagation();onRemove();}} aria-label={`Remove tag ${name}`}
        style={{fontSize:12,lineHeight:1,opacity:.7,cursor:"pointer",paddingLeft:1}}>&times;</span>}
    </span>
  );
}

// Assign/unassign tags for ONE fit. Creating is folded into the same text input as searching, so a
// new tag costs one line of typing and no colour decision — the palette assigns itself, and
// recolouring lives in the tag's own view where it isn't in the way.
function TagSheet({fit, tagColors, allNames, onToggle, onClose}) {
  const [draft, setDraft] = useState("");
  const mine = tagsOf(fit);
  const n = normalizeTag(draft);
  const others = allNames.filter(t=>!hasTag(fit,t)&&(!n||t.toLowerCase().includes(n.toLowerCase())));
  // Only offer to CREATE when the typed name isn't already a tag — otherwise the same name would
  // appear twice, once as "add existing" and once as "create new".
  const canCreate = !!n && !allNames.some(t=>tagKey(t)===tagKey(n));
  const commit = () => { if(canCreate){onToggle(n);setDraft("");} };
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:60,display:"flex",alignItems:"flex-end"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxHeight:"70vh",overflowY:"auto",background:C.surface,
        borderTop:`1px solid ${C.border}`,borderRadius:"14px 14px 0 0",padding:"14px 16px 22px"}}>
        <div style={{display:"flex",alignItems:"center",marginBottom:2}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:15,fontWeight:700,color:C.text}}>Tags</div>
            <div style={{fontSize:11,color:C.textMute,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fit?.name}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.textMid,fontSize:20,cursor:"pointer",padding:"0 4px"}}>&times;</button>
        </div>

        <div style={{display:"flex",flexWrap:"wrap",gap:6,margin:"12px 0"}}>
          {mine.length===0&&<span style={{fontSize:11,color:C.textMute}}>No tags yet</span>}
          {mine.map(t=><TagChip key={t} name={t} color={colorForTag(t,tagColors)} onRemove={()=>onToggle(t)}/>)}
        </div>

        <input value={draft} onChange={e=>setDraft(e.target.value)} maxLength={MAX_TAG_LEN}
          onKeyDown={e=>{if(e.key==="Enter")commit();if(e.key==="Escape")setDraft("");}}
          autoCapitalize="words" autoCorrect="off" spellCheck={false} enterKeyHint="done"
          placeholder="Find or create a tag..."
          style={{width:"100%",boxSizing:"border-box",background:C.surfaceAlt,border:`1px solid ${C.border}`,
                  borderRadius:8,padding:"8px 10px",color:C.text,fontSize:13}}/>

        {canCreate&&(
          <button onClick={commit} className="press" style={{marginTop:8,width:"100%",padding:"9px 0",background:C.accent,
            border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>
            Create "{n}"
          </button>
        )}

        {others.length>0&&(<>
          <div style={{fontSize:10,fontWeight:700,color:C.textMute,textTransform:"uppercase",letterSpacing:.5,margin:"14px 0 7px"}}>Add existing</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {others.map(t=><TagChip key={t} name={t} color={colorForTag(t,tagColors)} onClick={()=>onToggle(t)} dim/>)}
          </div>
        </>)}
      </div>
    </div>
  );
}

export function ShipInfoSheet({ship, onClose}) {
  const [tab, setTab] = useState('traits');
  const traits = ship?.typeID ? ((shipTraits??{})[String(ship.typeID)] ?? {}) : {};
  const tabs = ['traits','description','attributes'];

  const _fmtKm = m => m >= 1000 ? `${(m/1000).toFixed(2)} km` : `${Math.round(m)} m`;
  const attrs = {
    fitting: [
      ['CPU Output', ship?.cpu != null ? `${ship.cpu} tf` : '-'],
      ['Powergrid Output', ship?.pg != null ? `${ship.pg} MW` : '-'],
      ['Calibration', ship?.calibration != null ? `${ship.calibration} pts` : '-'],
      ['High Slots', ship?.hiSlots ?? ship?.highSlots ?? '-'],
      ['Mid Slots', ship?.medSlots ?? ship?.midSlots ?? '-'],
      ['Low Slots', ship?.lowSlots ?? '-'],
      ['Rig Slots', ship?.rigSlots ?? '-'],
      ['Turret Hardpoints', ship?.turrets ?? '-'],
      ['Launcher Hardpoints', ship?.launchers ?? '-'],
    ],
    capacitor: [
      ['Capacitor Capacity', ship?.capCapacity ? `${Math.round(ship.capCapacity)} GJ` : '-'],
      ['Recharge Time', ship?.capRechargeRate ? `${(ship.capRechargeRate/1000).toFixed(1)} s` : '-'],
    ],
    targeting: [
      ['Max Target Range', ship?.targetRange ? _fmtKm(ship.targetRange) : '-'],
      ['Scan Resolution', ship?.scanRes ? `${ship.scanRes} mm` : '-'],
      ['Max Locked Targets', ship?.maxTargets ?? '-'],
      [`${ship?.sensorType||'Sensor'} Strength`, ship?.sensorStrength ? `${ship.sensorStrength} points` : '-'],
    ],
    navigation: [
      ['Max Velocity', ship?.maxVelocity ? `${Math.round(ship.maxVelocity)} m/s` : '-'],
      ['Agility', ship?.agility != null ? `${ship.agility}` : '-'],
      ['Warp Speed', ship?.warpSpeed ? `${Number(ship.warpSpeed).toFixed(2)} AU/s` : '-'],
      ['Signature Radius', ship?.sigRadius ? `${ship.sigRadius} m` : '-'],
      ['Mass', ship?.mass ? `${(ship.mass/1e6).toFixed(2)}M kg` : '-'],
    ],
    structure: [
      ['Shield HP', ship?.shieldHP ? `${Math.round(ship.shieldHP)} HP` : '-'],
      ['Armor HP', ship?.armorHP ? `${Math.round(ship.armorHP)} HP` : '-'],
      ['Hull HP', ship?.hullHP ? `${Math.round(ship.hullHP)} HP` : '-'],
      ['Drone Bay', ship?.droneBay ? `${ship.droneBay} m³` : '-'],
      ['Drone Bandwidth', (ship?.droneBandwidth??ship?.droneBW) ? `${ship?.droneBandwidth??ship?.droneBW} Mbit/s` : '-'],
    ],
  };

  return (
    <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',flexDirection:'column'}}
         onClick={onClose}>
      <div style={{flex:1,background:'rgba(0,0,0,.5)'}}/>
      <div style={{background:C.surface,borderRadius:'16px 16px 0 0',maxHeight:'85vh',
                   display:'flex',flexDirection:'column',boxShadow:'0 -8px 32px rgba(0,0,0,.5)'}}
           onClick={e=>e.stopPropagation()}>
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
        <div style={{flex:1,overflowY:'auto',padding:'14px 16px'}}>
          {tab==='traits' && <TraitsPanel typeID={ship?.typeID}/>}
          {/* pre-wrap: CCP's descriptions are multi-paragraph, separated by blank lines; without
              it they collapse into one undifferentiated wall of text. */}
          {tab==='description' && (
            <div style={{fontSize:13,color:C.textMid,lineHeight:1.6,whiteSpace:'pre-wrap'}}>
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

export function FittingsScreen({recents,undo,undoDepth,activeFit,setActiveFit,loadFit,deleteFit,view,setView,fitsDB,setFitsDB,slots,setSlots,setDrones,setFighters,fighters,setCargoItems,setImplants,setBoosters,setProjFits,setCmdFits,skills,implants,boosters,drones,factorInReload,setFactorInReload,externalBursts,projectedReps,projectedEffects,dmgProfile,setDmgProfile,tgtProfile,setTgtProfile,priceHub,setPriceHub}){
  // The ship browser is a nested menu now (Battleships > Faction Battleships > Pirate Faction), so
  // the position in it is a PATH of node labels rather than a single class name. An empty path is
  // the top-level list. See src/lib/ship-taxonomy.js.
  const[browsePath,setBrowsePath]=useState([]);
  const[selectedShip,setSelectedShip]=useState(activeFit?.ship??null);
  // Ship name whose info sheet is open (browser rows), or null. Resolved through lookupShip at
  // render time because shipsByClass rows are only {name,typeID} — ShipInfoSheet's Attributes tab
  // needs the full record (cpu/pg/slots/hardpoints).
  const[infoShip,setInfoShip]=useState(null);
  // Persisted: leaving the fittings tab unmounts this screen, so a plain useState reset you to
  // "Fit" every time you checked Drones or Effects and came back.
  const[fitSubTab,setFitSubTab]=useState(()=>{
    try{const s=localStorage.getItem('axis_fit_subtab');if(s&&_SUBTABS.includes(s))return s;}catch{}
    return "Fit";
  });
  useEffect(()=>{try{localStorage.setItem('axis_fit_subtab',fitSubTab);}catch{}},[fitSubTab]);
  // Sub-tab swipe — see lib/use-tab-swipe.js. Shared with the Effects screen's four sections rather
  // than duplicated, so the horizontal-scroller escape and the axis lock only exist once.
  const {panelRef:_panel,slideDir:_slideDir,swipeHandlers:_swipeHandlers,goTo:_goTo}=useTabSwipe(_SUBTABS,fitSubTab,setFitSubTab);
  const[search,setSearch]=useState("");
  // Non-finite ids are FILTERED, not just defaulted. One fit with no `id` used to make this
  // `Math.max(m, undefined + 1)` -> NaN, and NaN is sticky: every fit created afterwards got
  // id NaN. That is invisible until something compares ids, because NaN === NaN is false — the
  // tab bookkeeping then failed to recognise a fit it already had open and appended a duplicate
  // tab on every single open.
  const[nextId,setNextId]=useState(()=>nextFitId(fitsDB));
  const[editingFitId,setEditingFitId]=useState(null);
  const[editName,setEditName]=useState("");
  const[renamingFit,setRenamingFit]=useState(false);
  const[newFitName,setNewFitName]=useState("");

  // Tag COLOURS only. The tags themselves live on the fits, so this registry is disposable — losing
  // it costs you your colour choices and nothing else (see lib/fit-tags.js). Keyed `pyfa-` so the
  // backup file picks it up with everything else.
  const[tagColors,setTagColors]=useState(()=>{try{return JSON.parse(localStorage.getItem("pyfa-tagcolors")||"{}")||{};}catch{return{};}});
  useEffect(()=>{try{localStorage.setItem("pyfa-tagcolors",JSON.stringify(tagColors));}catch{}},[tagColors]);
  const[tagSheet,setTagSheet]=useState(null);   // {ship, fitId} whose tag sheet is open
  // Persisted for the same reason fitSubTab is: `view` lives in App and outlives this component, so
  // leaving the fittings tab from a tag view and coming back would otherwise restore the view with
  // no tag in it. Same shape as the sub-tab: remember where you were.
  const[selectedTag,setSelectedTag]=useState(()=>{try{return localStorage.getItem('axis_selected_tag')||null;}catch{return null;}});
  useEffect(()=>{try{
    if(selectedTag)localStorage.setItem('axis_selected_tag',selectedTag);
    else localStorage.removeItem('axis_selected_tag');
  }catch{}},[selectedTag]);
  const[tagEditing,setTagEditing]=useState(false);
  const[tagRename,setTagRename]=useState("");

  const tagList=useMemo(()=>allTags(fitsDB),[fitsDB]);
  const tagNames=useMemo(()=>tagList.map(t=>t.name),[tagList]);

  const applyTagToggle=(ship,fitId,name)=>{
    setFitsDB(prev=>({...prev,[ship]:(prev[ship]||[]).map(f=>f.id===fitId?toggleTag(f,name):f)}));
    haptic("light");
  };

  // Renaming ONTO an existing tag merges the two, so the old name's colour must not follow it across
  // and repaint the survivor. Only a rename to a genuinely new name carries the colour over.
  const commitTagRename=()=>{
    const next=normalizeTag(tagRename);
    if(!next||!selectedTag||tagKey(next)===tagKey(selectedTag)){setTagEditing(false);return;}
    const merging=tagNames.some(t=>tagKey(t)===tagKey(next));
    setFitsDB(prev=>renameTag(prev,selectedTag,next));
    setTagColors(prev=>{
      const {[tagKey(selectedTag)]:old,...rest}=prev??{};
      return merging||old==null?rest:{...rest,[tagKey(next)]:old};
    });
    setSelectedTag(next);
    setTagEditing(false);
  };

  // A T3 cruiser hull carries ZERO turret/launcher hardpoints of its own — they come entirely from
  // the fitted subsystems. Without this the hardpoint dots never render on a Legion, and addMod's
  // gate reads 0 and refuses every weapon.
  const activeShip=useMemo(()=>{
    const sh=activeFit?.ship?lookupShip(activeFit.ship):null;
    if(!sh||!isT3Cruiser(sh.name))return sh;
    const layout=t3cSlotLayout((slots?.subsystems??[]).filter(s=>s?.typeID));
    return{...sh,turrets:layout.turrets,launchers:layout.launchers,
           hiSlots:layout.hiSlots,medSlots:layout.medSlots,lowSlots:layout.lowSlots,rigSlots:layout.rigSlots};
  },[activeFit?.ship,slots?.subsystems]);

  const saveRename=(ship,fitId)=>{
    const name=editName.trim()||"Unnamed Fit";
    const now=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    setFitsDB(prev=>({...prev,[ship]:prev[ship].map(f=>f.id===fitId?{...f,name,modified:now}:f)}));
    if(activeFit?.ship===ship&&activeFit?.fitName===fitsDB[ship]?.find(f=>f.id===fitId)?.name)
      setActiveFit(prev=>({...prev,fitName:name}));
    setEditingFitId(null);
  };

  // Renaming commits on blur as well as on Enter. It used to DISCARD on blur, so tapping the
  // keyboard's done/checkmark -- which blurs rather than sending Enter -- threw away the name you
  // had just typed. Escape is still the way to cancel.
  const commitRename=()=>{
    if(!renamingFit||!activeFit)return;
    const next=newFitName.trim()||activeFit.fitName;
    if(next!==activeFit.fitName){
      const now=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
      setFitsDB(prev=>({...prev,[activeFit.ship]:(prev[activeFit.ship]||[]).map(f=>f.name===activeFit.fitName?{...f,name:next,modified:now}:f)}));
      setActiveFit(prev=>({...prev,fitName:next}));
    }
    setRenamingFit(false);
  };

  // Open a COPY: branch a fit without touching the original. Names are the app's identity for a
  // fit (activeFit is {ship,fitName}), so the copy has to get a name nothing else is using.
  const openCopyOfFit=(ship,fitName)=>{
    const src=(fitsDB[ship]||[]).find(f=>f.name===fitName);
    if(!src)return;
    const taken=new Set((fitsDB[ship]||[]).map(f=>f.name));
    let name=`${fitName} copy`, n=2;
    while(taken.has(name))name=`${fitName} copy ${n++}`;
    const now=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    // Deep-cloned: a shallow copy would share slot arrays with the original, so editing the copy
    // would silently edit the fit it came from.
    const copy={...structuredClone(src),id:nextId,name,modified:now};
    setFitsDB(prev=>({...prev,[ship]:[...(prev[ship]||[]),copy]}));
    setNextId(n2=>n2+1);
    haptic();
    // Handed straight to loadFit, so the pending setFitsDB does not matter.
    loadFit(ship,name,copy);
    setView("active");
  };

  const createNewFit=ship=>{
    const now=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    // Names are the app's identity for a fit, so a second "New Fit" on the same hull would collide
    // with the first and both would resolve to whichever came back from the lookup.
    const taken=new Set((fitsDB[ship]||[]).map(f=>f.name));
    let name="New Fit", n=2;
    while(taken.has(name))name=`New Fit ${n++}`;
    const nf={id:nextId,name,modified:now,tags:[],slots:generateEmptySlots(lookupShip(ship))};
    setFitsDB(prev=>({...prev,[ship]:[...(prev[ship]||[]),nf]}));
    setNextId(x=>x+1);
    setSelectedShip(ship);
    haptic("medium");
    // Routed through loadFit rather than setting the state directly. Creating a fit used to bypass
    // it entirely, which meant none of the tab logic ran: hitting + to ask for a new tab and then
    // making a fit put it in the tab you were already in, while opening an EXISTING fit correctly
    // opened a second one. Same path now, so both behave identically.
    // Handed straight to loadFit, so the pending setFitsDB does not matter.
    loadFit(ship,name,nf);
    setView("active");
  };

  const searchResults=search.trim().length>1?(()=>{
    const q=search.toLowerCase(),results=[];
    Object.entries(shipsByClass||{}).forEach(([cls,ships])=>{
      ships.forEach(s=>{
        if(s.name.toLowerCase().includes(q))results.push({type:"ship",ship:s.name,hull:cls,race:"",color:C.rig});
        // Tag names are searched alongside fit names, so typing a doctrine finds its fits without
        // having to go via the tag list first.
        (fitsDB[s.name]||[]).forEach(fit=>{
          const tags=tagsOf(fit);
          if(fit.name.toLowerCase().includes(q)||tags.some(t=>t.toLowerCase().includes(q)))
            results.push({type:"fit",ship:s.name,hull:cls,race:"",fitName:fit.name,modified:fit.modified,tags,color:C.accent});
        });
      });
    });
    return results;
  })():null;

  // Same sheet the ship image in the fit header opens. Shared by the browse and fits views, which
  // are separate `return`s — hence one element reused rather than two copies. lookupShip resolves
  // the full record (cpu/pg/slots) that the Attributes tab needs.
  const shipInfoSheet=infoShip
    ? <ShipInfoSheet ship={lookupShip(infoShip)??{name:infoShip}} onClose={()=>setInfoShip(null)}/>
    : null;

  // Derived from the dogma bundle, so it costs one pass over ~440 hulls and never changes after.
  const shipTree=useMemo(()=>buildShipTaxonomy(),[]);
  const browseNode=browsePath.length?nodeAtPath(shipTree,browsePath):null;
  // nodeAtPath returns null if a stale path survives a bundle change; fall back to the root rather
  // than rendering nothing.
  const browseKids=browsePath.length?(browseNode?.children??null):shipTree;
  const browseShips=browseNode?.ships??null;
  const enterNode=label=>{setBrowsePath(p=>[...p,label]);haptic("light");};
  const leaveNode=()=>{setBrowsePath(p=>p.slice(0,-1));haptic("light");};

  if(view==="browse")return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    {browsePath.length>0&&(
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={leaveNode} className="press" style={{background:"none",border:"none",color:C.accent,fontSize:13,cursor:"pointer",fontWeight:600,padding:0}}>Back</button>
        <img src={(raceIcons??{})[String(browseNode?.raceID)]??shipSmallIcon} style={{width:18,height:18,flexShrink:0,objectFit:"contain"}} alt=""/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:14,fontWeight:700,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{browsePath[browsePath.length-1]}</div>
          {browsePath.length>1&&<div style={{fontSize:10,color:C.textMute,marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{browsePath.slice(0,-1).join(" / ")}</div>}
        </div>
      </div>
    )}
    <div style={{padding:"8px 10px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px"}}>
        <span style={{fontSize:14,color:C.textMute}}>&#128269;</span>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search ships or fit names..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13}}/>
        {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:16,padding:0}}>x</button>}
      </div>
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"8px 10px"}}>
      {!search&&browsePath.length===0&&<RecentFitsList fitsDB={fitsDB} activeFit={activeFit} loadFit={loadFit} recents={recents}/>}
      {/* The cross-hull axis. Chips rather than rows because a doctrine list is short and scanned by
          colour, and rows would push the ship classes below the fold the way Recent Fits used to.
          Hidden entirely until something is tagged — an empty section is just chrome. */}
      {!search&&browsePath.length===0&&tagList.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:C.textMute,textTransform:"uppercase",letterSpacing:.5,padding:"4px 0",marginBottom:6}}>Tags</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {tagList.map(t=>(
              <TagChip key={t.key} name={`${t.name} ${t.count}`} color={colorForTag(t.name,tagColors)}
                onClick={()=>{setSelectedTag(t.name);setTagEditing(false);haptic("light");setView("tag");}}/>
            ))}
          </div>
        </div>
      )}
      {!search&&browsePath.length===0&&Object.keys(fitsDB).length===0&&(
        <div style={{textAlign:"center",padding:"28px 16px 20px"}}>
          <img src={shipSmallIcon} style={{width:44,height:44,opacity:0.25,marginBottom:14}} alt=""/>
          <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:8}}>Welcome to Axis</div>
          <div style={{fontSize:13,color:C.textMid,lineHeight:1.6}}>Select a ship class below, choose a hull, then tap <strong style={{color:C.accent}}>+ New Fit</strong> to get started</div>
        </div>
      )}
      {searchResults&&(<>
        <div style={{fontSize:11,color:C.textMute,marginBottom:8}}>{searchResults.length} result{searchResults.length!==1?"s":""} for "{search}"</div>
        {searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0"}}>No ships or fits found</div>}
        {searchResults.map((rr,i)=>(<div key={i} onClick={()=>{setSelectedShip(rr.ship);setView(rr.type==="fit"?"active":"fits");if(rr.type==="fit")loadFit(rr.ship,rr.fitName);}} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:4,cursor:"pointer"}}>
          <img src={eveIcon((Object.values(shipsByClass||{}).flat().find(s=>s.name===rr.ship)||{}).typeID,32)} style={{width:28,height:28,borderRadius:4,objectFit:'contain',background:'#1a1a2e',flexShrink:0}} onError={e=>{e.target.style.background=rr.color;e.target.style.display='block';}} alt=""/>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{rr.type==="fit"?rr.fitName:rr.ship}</div><div style={{fontSize:10,color:C.textMute,marginTop:1}}>{rr.ship} / {rr.hull} / {rr.race}</div>
            {rr.tags?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:3}}>{rr.tags.map(t=><TagChip key={t} name={t} color={colorForTag(t,tagColors)}/>)}</div>}
          </div>
          <span style={{fontSize:10,color:rr.type==="fit"?C.accent:C.textMute,background:rr.type==="fit"?C.accentLight:C.border,borderRadius:99,padding:"1px 7px",fontWeight:600,flexShrink:0}}>{rr.type==="fit"?"fit":"ship"}</span>
          {rr.type!=="fit"&&<InfoButton title={`${rr.ship} info`} onClick={e=>{e.stopPropagation();setInfoShip(rr.ship);}}/>}
        </div>))}
      </>)}
      {!searchResults&&browseKids&&browseKids.map(n=>{
        const ships=shipsUnder(n);
        const fitCount=ships.reduce((s,sh)=>s+(fitsDB[sh.name]||[]).length,0);
        // Race nodes get the racial icon; every other level gets the generic ship glyph.
        const icon=(raceIcons??{})[String(n.raceID)]??shipSmallIcon;
        return (
          <div key={n.key} onClick={()=>enterNode(n.label)} className="press no-select"
            style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
            <img src={icon} style={{width:18,height:18,flexShrink:0,objectFit:"contain"}} alt=""/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:C.text}}>{n.label}</div>
              <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{ships.length} ship{ships.length!==1?"s":""}{fitCount>0?` · ${fitCount} fit${fitCount!==1?"s":""}`:""}</div>
            </div>
            <span style={{color:C.textMute,fontSize:16}}>{">"}</span>
          </div>
        );
      })}
      {!searchResults&&browseShips&&browseShips.map(s=>{
        const sfits=(fitsDB[s.name]||[]);
        return(<div key={s.typeID} style={{marginBottom:4}}>
          <div onClick={()=>{setSelectedShip(s.name);setView('fits');}} className="press no-select" style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,cursor:"pointer",background:selectedShip===s.name?C.accentLight:C.surface,border:`1px solid ${selectedShip===s.name?C.accentBorder:C.border}`}}>
            <img src={eveIcon(s.typeID,64)} style={{width:40,height:40,borderRadius:4,objectFit:'contain',background:'#1a1a2e',flexShrink:0}} onError={e=>{e.target.style.display='none';}} alt=""/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:5}}>
                {(raceIcons??{})[String(s.raceID)]&&<img src={raceIcons[String(s.raceID)]} style={{width:14,height:14,objectFit:'contain',flexShrink:0}} alt=""/>}
                <span style={{fontSize:13,fontWeight:600,color:selectedShip===s.name?C.accent:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</span>
              </div>
              <div style={{fontSize:10,color:C.textMute,marginTop:2}}>{sfits.length>0?`${sfits.length} fit${sfits.length!==1?'s':''}`:'No fits'}</div>
            </div>
            <InfoButton title={`${s.name} info`} onClick={e=>{e.stopPropagation();setInfoShip(s.name);}}/>
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
    {shipInfoSheet}
  </div>);

  // The cross-hull view: every fit under one tag, whatever it's flying. Managing the tag itself
  // (rename, recolour, delete) lives HERE rather than in the per-fit sheet, so filing a fit never
  // puts a colour picker in the way.
  if(view==="tag"){
    const tagged=selectedTag?fitsWithTag(fitsDB,selectedTag):[];
    const color=colorForTag(selectedTag,tagColors);
    return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={()=>{setTagEditing(false);setView("browse");}} className="press" style={{background:"none",border:"none",color:C.accent,fontSize:13,cursor:"pointer",fontWeight:600,padding:0}}>All Fits</button>
        <span style={{width:9,height:9,borderRadius:99,background:color,flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:14,fontWeight:700,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{selectedTag}</div>
          <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{tagged.length} fit{tagged.length!==1?"s":""}</div>
        </div>
        <button onClick={()=>{setTagRename(selectedTag??"");setTagEditing(v=>!v);}} className="press"
          style={{padding:"6px 11px",background:tagEditing?C.accentLight:C.surface,border:`1px solid ${tagEditing?C.accentBorder:C.border}`,
                  borderRadius:7,color:tagEditing?C.accent:C.textMid,fontSize:12,fontWeight:700,cursor:"pointer"}}>Edit</button>
      </div>

      {tagEditing&&(
        <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
          <input value={tagRename} onChange={e=>setTagRename(e.target.value)} maxLength={MAX_TAG_LEN}
            onKeyDown={e=>{if(e.key==="Enter")commitTagRename();if(e.key==="Escape")setTagEditing(false);}}
            onBlur={commitTagRename} autoCapitalize="words" autoCorrect="off" spellCheck={false}
            style={{width:"100%",boxSizing:"border-box",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",color:C.text,fontSize:13,fontWeight:600}}/>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,margin:"12px 0 4px"}}>
            {TAG_PALETTE.map(p=>(
              <button key={p} onClick={()=>{setTagColors(prev=>setTagColor(prev,selectedTag,p));haptic("light");}} aria-label={`Colour ${p}`}
                style={{width:26,height:26,borderRadius:99,background:p,cursor:"pointer",
                        border:p.toLowerCase()===color.toLowerCase()?`2px solid ${C.text}`:"2px solid transparent"}}/>
            ))}
          </div>
          <button onClick={()=>{
              if(!window.confirm(`Remove the tag "${selectedTag}" from ${tagged.length} fit${tagged.length!==1?"s":""}? The fits themselves are kept.`))return;
              setFitsDB(prev=>removeTagEverywhere(prev,selectedTag));
              setTagColors(prev=>{const{[tagKey(selectedTag)]:_gone,...rest}=prev??{};return rest;});
              setTagEditing(false);setSelectedTag(null);setView("browse");
            }} className="press"
            style={{marginTop:10,width:"100%",padding:"9px 0",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",
                    borderRadius:8,color:C.danger,fontSize:12,fontWeight:700,cursor:"pointer"}}>Delete tag</button>
        </div>
      )}

      <div style={{flex:1,overflowY:"auto",padding:12}}>
        {tagged.length===0&&<div style={{textAlign:"center",color:C.textMute,marginTop:40,fontSize:13}}>No fits carry this tag</div>}
        {tagged.map(({ship,fit})=>{
          const active=activeFit?.fitName===fit.name&&activeFit?.ship===ship;
          const others=tagsOf(fit).filter(t=>tagKey(t)!==tagKey(selectedTag));
          return(<div key={`${ship}:${fit.id}`} onClick={()=>{loadFit(ship,fit.name);setView("active");}} className="press"
            style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:active?C.accentLight:C.surface,
                    border:`1px solid ${active?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8,cursor:"pointer"}}>
            <img src={eveIcon(Object.values(shipsByClass||{}).flat().find(s=>s.name===ship)?.typeID,64)}
              style={{width:38,height:38,borderRadius:4,objectFit:"contain",background:"#1a1a2e",flexShrink:0}}
              onError={e=>{e.target.style.display="none";}} alt=""/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:active?C.accent:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fit.name}</div>
              <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{ship}</div>
              {others.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>{others.map(t=><TagChip key={t} name={t} color={colorForTag(t,tagColors)}/>)}</div>}
            </div>
            <span style={{color:C.textMute,fontSize:16,flexShrink:0}}>{">"}</span>
          </div>);
        })}
      </div>
    </div>);
  }

  if(view==="fits"){
    const fits=fitsDB[selectedShip]||[];
    return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={()=>setView("browse")} className="press" style={{background:"none",border:"none",color:C.accent,fontSize:13,cursor:"pointer",fontWeight:600,padding:0}}>All Fits</button>
        <span style={{fontSize:14,fontWeight:700,color:C.text,flex:1}}>{selectedShip}</span>
        <button className="press" onClick={()=>{haptic("medium");createNewFit(selectedShip);}} style={{padding:"6px 12px",background:C.accent,border:"none",borderRadius:7,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ New Fit</button>
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
            {/* The tag row doubles as the control that opens the tag sheet, so tagging needs no
                button of its own. `+ Tag` is what makes it discoverable when the fit has none —
                an empty row would be invisible. */}
            <div onClick={e=>{e.stopPropagation();setTagSheet({ship:selectedShip,fitId:fit.id});}}
              style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6,cursor:"pointer"}}>
              {tagsOf(fit).map(t=><TagChip key={t} name={t} color={colorForTag(t,tagColors)}/>)}
              <TagChip name={tagsOf(fit).length?"+":"+ Tag"} color={C.textMid} dim/>
            </div>
          </div>
          <button onClick={e=>{e.stopPropagation();setEditingFitId(fit.id);setEditName(fit.name);}} style={{width:28,height:28,borderRadius:6,background:editingFitId===fit.id?C.accentLight:C.surfaceAlt,border:`1px solid ${editingFitId===fit.id?C.accentBorder:C.border}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>&#9998;</button>
          <button onClick={e=>{e.stopPropagation();openCopyOfFit(selectedShip,fit.name);}} title="Open a copy" aria-label={`Open a copy of ${fit.name}`} style={{width:28,height:28,borderRadius:6,background:C.surfaceAlt,border:`1px solid ${C.border}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:C.textMid,flexShrink:0}}>&#128203;</button>
          <button onClick={e=>{e.stopPropagation();if(window.confirm(`Delete fit "${fit.name}"?`))deleteFit(selectedShip,fit);}} style={{width:28,height:28,borderRadius:6,background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:C.danger,flexShrink:0,lineHeight:1}} title="Delete fit">&times;</button>
        </div>))}
      </div>
      {/* Re-resolved from fitsDB every render rather than captured when the sheet opened, so the
          chips update as you toggle instead of showing the state the fit was in on the first tap. */}
      {tagSheet&&(()=>{
        const f=(fitsDB[tagSheet.ship]||[]).find(x=>x.id===tagSheet.fitId);
        if(!f)return null;
        return <TagSheet fit={f} tagColors={tagColors} allNames={tagNames}
          onToggle={name=>applyTagToggle(tagSheet.ship,tagSheet.fitId,name)} onClose={()=>setTagSheet(null)}/>;
      })()}
    </div>);
  }

  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",padding:"6px 12px 0",gap:8}}>
        {/* A filled button, not bare accent-coloured text. This is the way BACK out of a fit and it
            was reading as a label rather than a control — the chevron and the solid background say
            "tap me" without needing the width of a longer word. */}
        <button onClick={()=>{haptic();setSelectedShip(activeFit?.ship??null);setView("fits");}} className="press"
          style={{background:C.accent,border:"none",borderRadius:7,color:"#fff",fontSize:12,fontWeight:700,
                  cursor:"pointer",padding:"5px 11px",flexShrink:0,display:"flex",alignItems:"center",gap:4,lineHeight:1}}>
          <span style={{fontSize:13,lineHeight:1}}>&#8249;</span>Fits
        </button>
        <div style={{flex:1,minWidth:0}}>
          {renamingFit
            ?<input autoFocus value={newFitName} onChange={e=>setNewFitName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")commitRename();if(e.key==="Escape")setRenamingFit(false);}} onBlur={commitRename} style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.accentBorder}`,borderRadius:6,padding:"3px 8px",color:C.text,fontSize:12,fontWeight:700,boxSizing:"border-box",textAlign:"center"}}/>
            :<button onClick={()=>{setNewFitName(activeFit?.fitName||"");setRenamingFit(true);}} style={{background:"none",border:"none",cursor:"pointer",textAlign:"center",padding:0,display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%"}}>
              <span style={{fontSize:12,fontWeight:700,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{activeFit?.fitName||"Unnamed Fit"}</span>
              <span style={{fontSize:15,color:"#ffffffff",flexShrink:0}}>&#9998;</span>
            </button>
          }
        </div>
        <div style={{width:70,flexShrink:0}}/>
      </div>
      <div style={{display:"flex"}}><div style={{width:60}}/>{_SUBTABS.map(t=><button key={t} onClick={()=>{const to=_SUBTABS.indexOf(t),from=_SUBTABS.indexOf(fitSubTab);if(to!==from)_goTo(to,to>from?1:-1);}} style={{flex:1,padding:"7px 0",fontSize:13,fontWeight:600,background:"none",border:"none",cursor:"pointer",color:fitSubTab===t?C.accent:C.textMute,borderBottom:fitSubTab===t?`2px solid ${C.accent}`:"2px solid transparent"}}>{t}</button>)}</div>
    </div>
    <div {..._swipeHandlers} style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
      {/* Keyed on the tab so the incoming panel remounts and replays the slide-in. That costs
          nothing here — the panels already unmount and remount on every tab change. */}
      {/* No `will-change:transform` here, however tempting as a perf hint: it establishes a
          containing block for position:fixed descendants, so every bottom sheet opened from this
          tab anchored to the panel instead of the viewport and slid off the bottom of the screen.
          The drag sets a transform on this node too, but only while a finger is down, and a sheet
          cannot be open then. */}
      <div ref={_panel} key={fitSubTab} className={slideClass(_slideDir)}
           style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
      {fitSubTab==="Fit"   &&<FitTab   undo={undo} undoDepth={undoDepth} ship={activeShip} slots={slots} setSlots={setSlots} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} externalBursts={externalBursts} projectedEffects={projectedEffects} dmgProfile={dmgProfile} tgtProfile={tgtProfile}/>}
      {fitSubTab==="Stats" &&<StatsTab ship={activeShip} slots={slots} skills={skills} implants={implants} boosters={boosters} drones={drones} fighters={fighters} factorInReload={factorInReload} setFactorInReload={setFactorInReload} externalBursts={externalBursts} projectedReps={projectedReps} projectedEffects={projectedEffects} dmgProfile={dmgProfile} setDmgProfile={setDmgProfile} tgtProfile={tgtProfile} setTgtProfile={setTgtProfile} priceHub={priceHub} setPriceHub={setPriceHub}/>}
      {fitSubTab==="Graph" &&<GraphTab ship={activeShip} slots={slots} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} externalBursts={externalBursts} projectedEffects={projectedEffects} tgtProfile={tgtProfile}/>}
      </div>
    </div>
  </div>);
}
