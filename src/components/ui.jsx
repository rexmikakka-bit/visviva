// UI primitives, module/subsystem pickers, resource strip, damage-profile sheet.

import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { C } from "../theme.js";
import { eveIcon } from "../lib/icons.js";
import { metaOf, META_COLORS, META_ORDER } from "../lib/meta.js";
import { DAMAGE_PROFILES } from "../data/damage-profiles.js";
import { TARGET_PROFILES } from "../data/target-profiles.js";
import modulesData from "../data/modules.json";
import mutaplasmidData from "../data/mutaplasmids.json";
import { TYPES, tidByName, calcFitStats, subsystemsForHull , isTurret, isLauncher, attrHighIsGood } from "../calc.js";
import { DMG, DMG_COLOR, MODULE_STATES, MUTA_BY_NAME, MUTA_BY_TYPE, REAL_MODULE_BROWSER, REAL_STRUCTURE_MODULE_BROWSER, STATE_COLORS, STATE_LABELS, getCompatibleCharges, groupChargesForBrowser, haptic, moduleTakesCharges, moduleVariations, variantsOf, mutaAttrRanges, parseEFT } from "../lib/core.js";
import { jargonSearch } from "../lib/jargon.js";
import { fmtResource } from "../lib/fmt.js";
let _typeDescsCache = null;
function useTypeDescriptions() {
  const [descs, setDescs] = useState(null);
  useEffect(() => {
    if (_typeDescsCache) { setDescs(_typeDescsCache); return; }
    import("../data/type-descriptions.json").then(m => {
      _typeDescsCache = m.default;
      setDescs(_typeDescsCache);
    });
  }, []);
  return descs;
}

// iOS-style info button: a true circle with a plain "i", in the accent blue so it reads as
// tappable. The old version set `padding:"2px 7px"` on the ⓘ glyph, which stretched the box into a
// pill AND left the glyph's own ring inside it — a small circle floating in a wide oval. Fixed
// width/height + borderRadius 50% + a bare "i" is what actually makes it round.
// Shared by the module browser, the ammo picker and the ship browser so they can't drift apart.
function InfoButton({onClick,title="Item info"}){
  return(
    <button onClick={onClick} title={title} aria-label={title}
      style={{width:19,height:19,flexShrink:0,padding:0,borderRadius:"50%",
              border:`1.5px solid ${C.accent}`,background:C.accentLight,color:C.accent,
              display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",
              fontFamily:"Arial, Helvetica, sans-serif",
              fontSize:12,fontWeight:700,lineHeight:1}}>i</button>
  );
}

// Tracks the VISUAL viewport — the part of the page not covered by the soft keyboard. A
// position:fixed element is positioned against the LAYOUT viewport, which the keyboard does not
// shrink, so a bottom sheet otherwise sits underneath the keyboard: you type in the search box and
// cannot see what you are searching. Following visualViewport keeps the sheet in the visible strip.
function useVisualViewport(){
  const [vv,setVv]=useState(null);
  useEffect(()=>{
    const v=window.visualViewport;
    if(!v)return;                                  // no support: fall back to the layout viewport
    const sync=()=>setVv({height:v.height,top:v.offsetTop});
    sync();
    v.addEventListener("resize",sync);
    v.addEventListener("scroll",sync);
    return()=>{v.removeEventListener("resize",sync);v.removeEventListener("scroll",sync);};
  },[]);
  return vv;
}

function BottomSheet({title,onClose,children,height="70vh"}){
  const vv=useVisualViewport();
  const frame=vv?{top:vv.top,height:vv.height,left:0,right:0}:{inset:0};
  // Rendered into <body>. position:fixed is only relative to the viewport while no ancestor has a
  // transform, filter, perspective or will-change — any one of those silently becomes the
  // containing block instead, and the sheet anchors to a mid-page element and slides off the
  // bottom of the screen. That is not a hazard worth re-discovering every time someone animates a
  // parent, so the sheet escapes the tree entirely. React events still bubble through the
  // component tree, so nothing else changes.
  return createPortal(
    <div style={{position:"fixed",...frame,zIndex:200,display:"flex",flexDirection:"column",justifyContent:"flex-end",alignItems:"center"}}>
      <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(0,0,0,.65)"}}/>
      {/* min(): the sheet keeps its designed height normally, but can never exceed the space the
          keyboard leaves — otherwise its bottom (and the list you are scrolling) is off-screen. */}
      <div className="vv-sheet" style={{position:"relative",background:C.surface,borderRadius:"16px 16px 0 0",maxHeight:`min(${height}, 100%)`,display:"flex",flexDirection:"column",overflow:"hidden",paddingBottom:"env(safe-area-inset-bottom, 0px)"}}>
        <div style={{width:36,height:4,background:C.border,borderRadius:99,margin:"10px auto 0"}}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:`1px solid ${C.border}`}}>
          <span style={{fontSize:14,fontWeight:700,color:C.text}}>{title}</span>
          <button className="press" onClick={onClose} style={{background:"none",border:"none",color:C.textMid,fontSize:20,cursor:"pointer",padding:"0 4px",lineHeight:1}}>x</button>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
function AccordionSection({title,color,children,defaultOpen,indent}){
  const[open,setOpen]=useState(!!defaultOpen);
  return(
    <div style={{borderBottom:`1px solid ${C.border}`}}>
      <button onClick={()=>setOpen(o=>!o)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:indent?"8px 14px 8px 22px":"11px 14px",background:indent?`${C.surfaceAlt}88`:"none",border:"none",cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {color&&<div style={{width:8,height:8,borderRadius:99,background:color}}/>}
          <span style={{fontSize:indent?12:13,fontWeight:700,color:indent?C.textMid:C.text}}>{title}</span>
        </div>
        <span style={{color:C.textMute,fontSize:12}}>{open?"^":"v"}</span>
      </button>
      {open&&<div style={{paddingBottom:indent?2:8}}>{children}</div>}
    </div>
  );
}
function NumpadModal({label,initial,onConfirm,onClose}){
  const[val,setVal]=useState(String(initial));
  const press=d=>{if(d==="<")setVal(v=>v.length>1?v.slice(0,-1):"0");else if(d==="0"&&val==="0")return;else setVal(v=>v==="0"?d:v.length<9?v+d:v);};
  return(
    <BottomSheet title={`Set quantity - ${label}`} onClose={onClose} height="62vh">
      <div style={{padding:16}}>
        <div style={{fontSize:32,fontWeight:800,color:C.text,textAlign:"center",marginBottom:16,background:C.surfaceAlt,borderRadius:10,padding:"10px 0"}}>{Number(val).toLocaleString()}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
          {["1","2","3","4","5","6","7","8","9","0","000","<"].map(d=>(
            <button key={d} onClick={()=>press(d)} style={{padding:"16px 0",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,color:C.text,fontSize:20,fontWeight:700,cursor:"pointer"}}>{d}</button>
          ))}
        </div>
        <button onClick={()=>{onConfirm(Number(val)||0);onClose();}} style={{width:"100%",padding:"12px 0",background:C.accent,border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Confirm</button>
      </div>
    </BottomSheet>
  );
}

// ═══ RESOURCE STRIP ══════════════════════════════════════════════
function ResourceStrip({ship,slots,skills,implants,boosters,drones,factorInReload}){
  const cs=calcFitStats(ship,slots,drones??[],skills,{implants,boosters,factorInReload,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity})??{};
  // Readout mode: tap any row to swap between "used / total" and remaining ("x left" / "x over").
  const[showRemaining,setShowRemaining]=useState(false);
  const fmtRes=v=>Number((v??0).toFixed(2)).toLocaleString();
  // Powergrid first, matching the order the game and pyfa put them in.
  const resources=[
    {key:"pg", label:"PG",    used:cs.pgUsed??0,   total:cs.pgTotal??0,   unit:"MW",  warn:95},
    {key:"cpu",label:"CPU",   used:cs.cpuUsed??0,  total:cs.cpuTotal??0,  unit:"tf",  warn:95},
    {key:"cal",label:"Cal",   used:cs.calUsed??0,  total:cs.calTotal??400, unit:"pts", warn:95},
  ];
  // Hardpoint usage
  // Counted through the ENGINE's own predicates, against TYPES rather than a name scan of
  // modulesData. The previous version listed three turret groups by hand and so never counted a
  // Precursor Weapon — an entropic disintegrator used no turret hardpoint on a Vedmak — and matched
  // launchers on a "Missile Launcher" name prefix, which CCP breaks for structures (those groups
  // read "Structure <kind> Missile Launcher"). It also rescanned every module in the game per slot.
  const {turretsUsed,launchUsed}=(slots?.high??[]).reduce((acc,s)=>{
    if(!s||s.type==="empty")return acc;
    const t=TYPES[s.typeID]??TYPES[String(s.typeID)];
    const gn=t?.gn??t?.groupName;
    if(!gn)return acc;
    if(isTurret(gn))acc.turretsUsed++;
    else if(isLauncher(gn,t?.e))acc.launchUsed++;
    return acc;
  },{turretsUsed:0,launchUsed:0});
  const turretsTotal=ship?.turrets??0, launchTotal=ship?.launchers??0;

  // Compact numbers, because this is a single row three columns wide: a battleship's 100,000 MW of
  // structure powergrid cannot sit next to two other readouts at full length. `fmtResource` keeps a
  // constant FOUR significant digits rather than a fixed decimal count, so a value gains precision
  // exactly as it gains room — see src/lib/fmt.js.
  const fmtShort=v=>fmtResource(v);

  return(
    // STICKY, and full-bleed rather than a floating rounded card. The three meters were stacked
    // vertically at ~150px tall, which is most of a phone's fit list — far too much to pin. Laid out
    // as three columns it costs about 40px, which is cheap enough to keep on screen permanently.
    //
    // Anchored because the number you need is usually the one you cannot see: you are at the bottom
    // of the list dropping rigs in, and calibration is off the top of the screen.
    //
    // top:0 attaches to FitTab's own scroller (this is its first child), NOT the page — so it does
    // not fight the fit-tab strip, which is sticky in a different container.
    <div style={{position:"sticky",top:0,zIndex:15,background:C.surfaceAlt,
                 borderBottom:`1px solid ${C.border}`,padding:"7px 10px 6px"}}>
      <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
      {resources.map((res,i)=>{
        const rawPct=res.total>0?(res.used/res.total)*100:0;
        const isOver=rawPct>100;
        const isCalRig=res.key==='cal';
        // Green under 100%, yellow→red when over. Cal: instantly red when over.
        const overFactor=isCalRig?1:Math.min((rawPct-100)/10,1);  // 0=just over, 1=fully red at 110%
        const barColor=isOver
          ? (isCalRig ? C.danger : `hsl(${Math.round(40*(1-overFactor))},85%,48%)`)  // 40°yellow→0°red
          : '#4ade80';  // green while under max
        const pct=Math.min(rawPct,100);
        const crit=isOver;
        const rem=(res.total??0)-(res.used??0), over=rem<0;
        return(
          <div key={res.key} onClick={()=>setShowRemaining(v=>!v)}
               title={`${res.label}: ${fmtRes(res.used)} / ${fmtRes(res.total)} ${res.unit} — tap to switch readout`}
               style={{flex:1,minWidth:0,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
            <div style={{display:"flex",alignItems:"baseline",gap:4,marginBottom:3,whiteSpace:"nowrap",lineHeight:1.1}}>
              <span style={{fontSize:9,fontWeight:700,color:C.textMute,letterSpacing:.4,textTransform:"uppercase",flexShrink:0}}>{res.label}</span>
              {showRemaining
                ? <span style={{fontSize:10,minWidth:0,overflow:"hidden",textOverflow:"ellipsis"}}>
                    <span style={{fontWeight:700,color:over?C.danger:C.textMid}}>{fmtShort(Math.abs(rem))}</span>
                    <span style={{color:over?C.danger:C.textMute}}> {over?"over":"left"}</span>
                  </span>
                : <span style={{fontSize:10,minWidth:0,overflow:"hidden",textOverflow:"ellipsis"}}>
                    <span style={{fontWeight:700,color:crit?C.danger:C.textMid}}>{fmtShort(res.used)}</span>
                    <span style={{color:C.textMute}}>/{fmtShort(res.total)}</span>
                  </span>}
            </div>
            <div style={{height:3,background:C.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${Math.min(rawPct,110)}%`,maxWidth:'100%',height:"100%",background:barColor,borderRadius:99}}/></div>
          </div>
        );
      })}
      </div>
      {/* Hardpoints keep their dots — at a glance "two launcher slots free" is faster to read than
          a fraction — but they only cost a row on hulls that actually have them. */}
      {(turretsTotal>0||launchTotal>0)&&<div style={{display:"flex",gap:10,marginTop:5,alignItems:"center",lineHeight:1}}>
        {turretsTotal>0&&<div style={{display:"flex",alignItems:"center",gap:3}}>
          <span style={{fontSize:9,color:C.high,fontWeight:700}}>T</span>
          <div style={{display:"flex",gap:2}}>{Array.from({length:turretsTotal},(_,i)=><div key={i} style={{width:6,height:6,borderRadius:2,background:(turretsUsed>i)?C.high:`${C.high}30`}}/>)}</div>
        </div>}
        {launchTotal>0&&<div style={{display:"flex",alignItems:"center",gap:3}}>
          <span style={{fontSize:9,color:C.mid,fontWeight:700}}>L</span>
          <div style={{display:"flex",gap:2}}>{Array.from({length:launchTotal},(_,i)=><div key={i} style={{width:6,height:6,borderRadius:2,background:(launchUsed>i)?C.mid:`${C.mid}30`}}/>)}</div>
        </div>}
      </div>}
    </div>
  );
}

// ═══ MODULE BROWSER - drill-down navigation ══════════════════════
function SubsystemPickerSheet({ship,slotId,current,onSelect,onClose}){
  // Determine which subsystem group this slot is for (Core/Defensive/Offensive/Propulsion).
  const order=["Core","Defensive","Offensive","Propulsion"];
  const slotIdx=Number(String(slotId).replace(/\D/g,""))||0;
  const group=current?.subGroup??order[slotIdx]??"Core";
  const byGroup=subsystemsForHull(ship?.name);
  const options=byGroup[group]??[];
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:200,display:"flex",alignItems:"flex-end"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxHeight:"70vh",background:C.bg,borderTopLeftRadius:16,borderTopRightRadius:16,overflow:"hidden",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:14,fontWeight:700,color:C.text}}>{group} Subsystem</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.textMute,fontSize:18,cursor:"pointer"}}>×</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:12}}>
          {options.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"24px 0",fontSize:13}}>No subsystems found</div>}
          {options.map(opt=>{
            const on=current?.typeID===opt.typeID;
            const shortName=opt.name.replace(`${ship?.name} ${group} - `,"");
            return(<div key={opt.typeID} onClick={()=>onSelect(opt)} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:on?C.accentLight:C.surface,border:`1px solid ${on?C.accent:C.border}`,borderRadius:8,marginBottom:6,cursor:"pointer"}}>
              <img className="eve-icon" src={eveIcon(opt.typeID,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:on?C.accent:C.text}}>{shortName}</div>
                <div style={{fontSize:10,color:C.textMute}}>{group} Subsystem</div>
              </div>
              {on&&<span style={{fontSize:11,color:C.accent,fontWeight:700}}>✓</span>}
            </div>);
          })}
        </div>
      </div>
    </div>
  );
}

function ModuleBrowserSheet({slotType,isStructure,hullRigSize,onSelect,onClose}){
  const[search,setSearch]=useState("");
  const[pasteOpen,setPasteOpen]=useState(false);
  const[pasteText,setPasteText]=useState("");
  const[pasteErr,setPasteErr]=useState(null);
  const[infoItem,setInfoItem]=useState(null);
  const doPaste=()=>{const parsed=parseAbyssal(pasteText);if(!parsed){setPasteErr("Could not parse. Expected: module name, then mutaplasmid name, then attr value pairs.");return;}onSelect(parsed);onClose();};
  const[navPath,setNavPath]=useState([]);
  // Drill-down direction, so a level slides in from the side you came from.
  const[navDir,setNavDir]=useState(0);
  const goBack=()=>{if(!navPath.length)return;setNavDir(-1);setNavPath(navPath.slice(0,-1));haptic();};
  const goInto=id=>{setNavDir(1);setNavPath([...navPath,id]);};
  // Swipe left-to-right to go up a level, the way iOS back-swipe works. Axis-locked on the first
  // meaningful movement so scrolling a long module list never triggers it.
  const _nav=useRef({x:0,y:0,axis:null});
  const _navStart=e=>{const t=e.touches[0];if(t)_nav.current={x:t.clientX,y:t.clientY,axis:null};};
  const _navMove=e=>{
    const t=e.touches[0];if(!t||_nav.current.axis)return;
    const dx=t.clientX-_nav.current.x,dy=t.clientY-_nav.current.y;
    if(Math.abs(dx)<8&&Math.abs(dy)<8)return;
    _nav.current.axis=Math.abs(dx)>Math.abs(dy)*1.2?"x":"y";
  };
  const _navEnd=e=>{
    const t=e.changedTouches[0],axis=_nav.current.axis;_nav.current.axis=null;
    if(!t||axis!=="x")return;
    if(t.clientX-_nav.current.x>70)goBack();
  };
  const metaColor={T1:C.textMid,T2:C.accent,Storyline:C.warning,Faction:C.danger,Deadspace:"#f0abfc",Officer:"#f0abfc",Abyssal:C.high};
  const baseTree=(isStructure?REAL_STRUCTURE_MODULE_BROWSER:REAL_MODULE_BROWSER)[slotType]??[];
  // A hull can only ever mount one rig size (rigSize must match exactly — checkFitRestriction
  // enforces it), so the other sizes are dead weight to scroll past. Prune them here rather than
  // greying them out, and drop any category left empty. Rigs with no rigSize at all are kept:
  // absence means "unrestricted", not "size 0". Structure rigs use the same attribute (2/3/4 for
  // M/L/XL hulls), so this needs no structure-specific branch.
  const tree=useMemo(()=>{
    if(slotType!=="rigs"||hullRigSize==null)return baseTree;
    const keep=m=>{const rs=TYPES[String(m.typeID)]?.a?.rigSize;return rs==null||rs===hullRigSize;};
    const prune=ns=>ns.map(n=>({...n,mods:(n.mods??[]).filter(keep),children:prune(n.children??[])}))
                      .filter(n=>n.mods.length||n.children.length);
    return prune(baseTree);
  },[baseTree,slotType,hullRigSize]);

  const currentLevel=(()=>{
    let nodes=tree,currentNode=null;
    for(const id of navPath){
      currentNode=nodes.find(n=>n.id===id);
      if(!currentNode)return{nodes:[],mods:[]};
      nodes=currentNode.children;
    }
    return{nodes,mods:currentNode?.mods??[]};
  })();

  const countAll=n=>n.mods.length+n.children.reduce((s,c)=>s+countAll(c),0);

  const allMods=(()=>{
    const out=[];
    function collect(n){n.mods.forEach(m=>out.push(m));n.children.forEach(collect);}
    tree.forEach(collect);
    return out;
  })();
  const searchResults=search.trim().length>1?(jargonSearch(search,allMods)??[]).slice(0,60):null;

  const breadcrumb=(()=>{
    let nodes=tree,parts=[];
    for(const id of navPath){const n=nodes.find(n=>n.id===id);if(!n)break;parts.push(n.name);nodes=n.children;}
    return parts;
  })();

  function ModRow({mod}){
    const rowMeta=metaOf(mod.typeID,mod.meta);
    return(
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
        <div onClick={()=>{onSelect(mod);onClose();}} style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
          {/* Fixed-size box, not a bare img: with `display:none` on a failed icon the text jumped
              left and rows stopped lining up with each other. */}
          <div style={{width:28,height:28,flexShrink:0}}>
            {mod.typeID&&<img className="eve-icon" src={eveIcon(mod.typeID,32)} width={28} height={28} alt="" onError={e=>{e.target.style.visibility="hidden";}}/>}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:500,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{mod.name}</div>
            <FitCost item={mod}/>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0,marginLeft:8}}>
          <span style={{fontSize:11,color:META_COLORS[rowMeta]||C.textMute,background:C.border,borderRadius:99,padding:"2px 8px",fontWeight:700}}>{rowMeta}</span>
          {mod.typeID&&<InfoButton onClick={e=>{e.stopPropagation();setInfoItem(mod);}}/>}
        </div>
      </div>
    );
  }

  return(
    <>
    <BottomSheet title={`Add Module - ${slotType.charAt(0).toUpperCase()+slotType.slice(1)} Slot`} onClose={onClose} height="88vh">
      <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px"}}>
          <span style={{fontSize:16,color:C.textMute}}>&#128269;</span>
          <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search all modules..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:14}}/>
          {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:18,padding:0}}>x</button>}
        </div>
        <button onClick={()=>{setPasteOpen(o=>!o);setPasteErr(null);}} style={{marginTop:8,width:"100%",padding:"7px 0",background:pasteOpen?C.high+"22":C.surfaceAlt,border:`1px solid ${pasteOpen?C.high:C.border}`,borderRadius:8,color:pasteOpen?C.high:C.textMid,fontSize:11,fontWeight:700,cursor:"pointer"}}>⎘ Paste Abyssal Module</button>
        {pasteOpen&&<div style={{marginTop:8}}>
          <textarea value={pasteText} onChange={e=>{setPasteText(e.target.value);setPasteErr(null);}} placeholder={"Corpum B-Type Medium Energy Neutralizer\nUnstable Medium Energy Neutralizer Mutaplasmid\ncapacitorNeed 172.68, cpu 22.93, ..."} rows={4} style={{width:"100%",boxSizing:"border-box",background:C.surface,border:`1px solid ${pasteErr?C.danger:C.border}`,borderRadius:8,color:C.text,fontSize:11,padding:"8px 10px",fontFamily:"monospace",resize:"vertical"}}/>
          {pasteErr&&<div style={{fontSize:10,color:C.danger,marginTop:4}}>{pasteErr}</div>}
          <button onClick={doPaste} disabled={!pasteText.trim()} style={{marginTop:6,width:"100%",padding:"8px 0",background:pasteText.trim()?C.accent:C.surfaceAlt,border:"none",borderRadius:8,color:pasteText.trim()?"#fff":C.textMute,fontSize:12,fontWeight:700,cursor:pasteText.trim()?"pointer":"default"}}>Add to Fit</button>
        </div>}
      </div>
      {/* Sticky: this bar lives inside the sheet's scroller, so it used to scroll out of reach the
          moment you started looking through a long category. */}
      {!searchResults&&navPath.length>0&&(
        <div style={{position:"sticky",top:0,zIndex:3,display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
          <button onClick={goBack} style={{background:"none",border:"none",color:C.accent,fontSize:14,fontWeight:700,cursor:"pointer",padding:0}}>&#8249; Back</button>
          <span style={{fontSize:12,color:C.textMute,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{breadcrumb.join(" / ")}</span>
        </div>
      )}
      {searchResults?(
        <div>
          {searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:14}}>No modules found</div>}
          {searchResults.map(mod=><ModRow key={mod.typeID??mod.name} mod={mod}/>)}
        </div>
      ):(
        <div key={navPath.join(">")} onTouchStart={_navStart} onTouchMove={_navMove} onTouchEnd={_navEnd}
             className={navDir>0?"vv-from-right":navDir<0?"vv-from-left":undefined}>
          {currentLevel.mods.map(mod=><ModRow key={mod.typeID??mod.name} mod={mod}/>)}
          {currentLevel.nodes.map(node=>(
            <div key={node.id} onClick={()=>goInto(node.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
              {/* Category icon, same idea as pyfa: a real item from the group reads faster than
                  its name alone. Reserve the space even when there is no icon, so every row's
                  text starts at the same x. */}
              <div style={{width:28,height:28,flexShrink:0}}>
                {node.iconTid&&<img className="eve-icon" src={eveIcon(node.iconTid,32)} width={28} height={28} alt="" onError={e=>{e.target.style.visibility="hidden";}}/>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{node.name}</div>
                <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{countAll(node)} modules</div>
              </div>
              <span style={{fontSize:20,color:C.textMute,flexShrink:0}}>{">"}</span>
            </div>
          ))}
          {currentLevel.nodes.length===0&&currentLevel.mods.length===0&&(
            <div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:14}}>No modules for this slot type</div>
          )}
        </div>
      )}
    </BottomSheet>
    {infoItem&&<ItemInfoSheet typeID={infoItem.typeID} onClose={()=>setInfoItem(null)}/>}
    </>
  );
}

// ═══ MODULE MENU SHEET ═══════════════════════════════════════════
// Attribute formatting for the Info tab
const ATTR_UNIT = {
  cpu:' tf', power:' MW', cpuOutput:' tf', powerOutput:' MW', upgradeCost:' pts',
  capacitorNeed:' GJ', capacitorBonus:' GJ', capacitorCapacity:' GJ',
  maxRange:' m', falloff:' m', trackingSpeed:' rad/s', overloadRangeBonus:' %',
  optimalSigRadius:' m', aoeCloudSize:' m', aoeVelocity:' m/s', missileVelocity:' m/s',
  hp:' HP', armorHP:' HP', shieldCapacity:' HP', shieldBonus:' HP', armorDamageAmount:' HP',
  speed:' ms', duration:' ms', reloadTime:' ms', explosionDelay:' ms',
  maxVelocity:' m/s', mass:' kg', massAddition:' kg', volume:' m³',
  droneBandwidthUsed:' Mbit/s', signatureRadius:' m',
  heatDamage:' HP', damageMultiplier:'×',
  maxTargetRange:' m', scanResolution:' mm', warpScrambleRange:' m', stasisWebifierRange:' m',
  speedFactor:' %', maxVelocityBonus:' %', signatureRadiusBonus:' %', signatureRadiusBonusPercent:' %',
};
// Human-readable overrides for camelCase attr names
const ATTR_LABEL = {
  cpu:'CPU', power:'Powergrid', upgradeCost:'Calibration Cost',
  speed:'Rate of Fire', duration:'Cycle Time', reloadTime:'Reload Time',
  maxRange:'Optimal Range', optimalSigRadius:'Signature Resolution',
  damageMultiplier:'Damage Modifier', shieldBonus:'Shield HP Bonus',
  armorDamageAmount:'Armor Repaired', capacitorNeed:'Activation Cost',
  speedFactor:'Velocity Bonus', maxVelocityBonus:'Max Velocity Bonus',
  signatureRadiusBonus:'Sig. Radius Bonus', massAddition:'Mass Added',
  aoeCloudSize:'Explosion Radius', aoeVelocity:'Explosion Velocity',
  explosionDelay:'Flight Time', missileVelocity:'Missile Velocity',
  heatDamage:'Heat Damage', trackingSpeed:'Tracking Speed',
  maxTargetRange:'Target Range', warpScrambleRange:'Warp Disrupt Range',
  stasisWebifierRange:'Web Range', signatureRadius:'Signature Radius',
  requiredThermoDynamicsSkill:'Required Thermodynamics Skill',
};
const RESIST_ATTRS = new Set(['armorEmDamageResonance','armorThermalDamageResonance','armorKineticDamageResonance','armorExplosiveDamageResonance','shieldEmDamageResonance','shieldThermalDamageResonance','shieldKineticDamageResonance','shieldExplosiveDamageResonance','hullEmDamageResonance','hullThermalDamageResonance','hullKineticDamageResonance','hullExplosiveDamageResonance',
  'emDamageResonance','thermalDamageResonance','kineticDamageResonance','explosiveDamageResonance']);
const HIDDEN_ATTRS = new Set(['skillPoints','skillTimeConstant','typeColorScheme','canBeJettisoned']);
// Attrs hidden in the detailed info panel (shown in dedicated sections or irrelevant for display)
const INFO_HIDDEN = new Set([...HIDDEN_ATTRS,
  ...Array.from({length:20},(_,i)=>`canFitShipGroup${String(i+1).padStart(2,'0')}`),
  ...Array.from({length:12},(_,i)=>`canFitShipType${i+1}`),
  ...Array.from({length:6},(_,i)=>[`requiredSkill${i+1}`,`requiredSkill${i+1}Level`]).flat(),
  'radius','techLevel','metaLevel','isCovert',
  ...Array.from({length:6},(_,i)=>`chargeGroup${i+1}`),
  ...Array.from({length:6},(_,i)=>`launcherGroup${i+1}`),
  'triggerGroup','weaponRangeFlag','subSystemSlot',
]);
// Attribute grouping for the organized info panel
const INFO_SECTIONS = [
  {label:'Fitting',    keys:['cpu','power','upgradeCost']},
  {label:'Capacitor',  keys:['capacitorNeed','capacitorBonus']},
  {label:'Cycle',      keys:['speed','duration','reloadTime']},
  {label:'Damage',     keys:['damageMultiplier','emDamage','thermalDamage','kineticDamage','explosiveDamage']},
  {label:'Range',      keys:['maxRange','falloff','trackingSpeed','optimalSigRadius','aoeCloudSize','aoeVelocity','explosionDelay','missileVelocity']},
  {label:'Shield',     keys:['shieldBonus','shieldCapacityBonus','shieldEmDamageResonance','shieldThermalDamageResonance','shieldKineticDamageResonance','shieldExplosiveDamageResonance']},
  {label:'Armor',      keys:['armorDamageAmount','armorHpBonus','armorEmDamageResonance','armorThermalDamageResonance','armorKineticDamageResonance','armorExplosiveDamageResonance']},
  {label:'Hull',       keys:['hullBonus','emDamageResonance','thermalDamageResonance','kineticDamageResonance','explosiveDamageResonance']},
  {label:'Propulsion', keys:['speedFactor','maxVelocityBonus','signatureRadiusBonus','signatureRadiusBonusPercent','massAddition']},
  {label:'Targeting',  keys:['maxTargetRange','scanResolution','maxLockedTargets','warpScrambleRange','stasisWebifierRange','signatureRadius']},
  {label:'ECM',        keys:['gravimetricStrengthBonus','ladarStrengthBonus','magnetometricStrengthBonus','radarStrengthBonus','scanGravimetricStrengthBonus','scanLadarStrengthBonus','scanMagnetometricStrengthBonus','scanRadarStrengthBonus']},
];

function fmtAttrVal(name, val) {
  if (RESIST_ATTRS.has(name)) return `${((1-val)*100).toFixed(1)}%`;
  const unit = ATTR_UNIT[name] ?? '';
  const num = typeof val === 'number' ? (Number.isInteger(val) ? val : parseFloat(val.toFixed(4))) : val;
  return `${num}${unit}`;
}
// Smart formatter for the item info panel: times→seconds, ranges→km
function fmtInfoVal(name, val) {
  if (val == null) return '—';
  if (RESIST_ATTRS.has(name)) return `${((1-val)*100).toFixed(1)}%`;
  if (typeof val === 'number') {
    if (/^(speed|duration|reloadTime|explosionDelay)$/.test(name))
      return val >= 1000 ? `${(val/1000).toFixed(2)} s` : `${val} ms`;
    if (/^(maxRange|falloff|maxTargetRange|warpScrambleRange|stasisWebifierRange)$/.test(name))
      return val >= 1000 ? `${(val/1000).toFixed(1)} km` : `${val} m`;
    if (/^(missileVelocity|aoeVelocity)$/.test(name)) return `${Math.round(val)} m/s`;
    if (/^(aoeCloudSize|optimalSigRadius|signatureRadius)$/.test(name)) return `${Math.round(val)} m`;
  }
  const unit = ATTR_UNIT[name] ?? '';
  const num = typeof val === 'number' ? (Number.isInteger(val) ? val : parseFloat(val.toFixed(4))) : val;
  return `${num}${unit}`;
}
function fmtAttrName(name) {
  if (ATTR_LABEL[name]) return ATTR_LABEL[name];
  return name.replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase()).trim();
}
// Extract required skills (name + level) from a type's attrs
function getItemSkills(typeID) {
  const td = TYPES[String(typeID)] ?? TYPES[typeID]; if (!td) return [];
  const a = td.attrs ?? td.a ?? {};
  const skills = [];
  for (let i = 1; i <= 6; i++) {
    const tid = a[`requiredSkill${i}`]; if (tid == null) break;
    skills.push({name: TYPES[String(tid)]?.n ?? `Skill ${tid}`, level: a[`requiredSkill${i}Level`] ?? 1});
  }
  return skills;
}

// Organized attribute panel — used in both ItemInfoSheet and ModuleInfoTab
function ItemInfoPanel({typeID}) {
  const typeDescriptions = useTypeDescriptions();
  const td = TYPES[String(typeID)] ?? TYPES[typeID];
  if (!td) return <div style={{padding:16,color:C.textMute,fontSize:12}}>No data available</div>;
  const attrs = td.attrs ?? td.a ?? {};
  const skills = getItemSkills(typeID);
  const meta = metaOf(typeID, null);

  // Build section rows
  const shownKeys = new Set();
  const sections = [];
  for (const sec of INFO_SECTIONS) {
    const rows = sec.keys.filter(k => attrs[k] != null && !INFO_HIDDEN.has(k));
    if (rows.length) { sections.push({label:sec.label, rows}); rows.forEach(k=>shownKeys.add(k)); }
  }
  // Remaining attrs not in any section
  const other = Object.keys(attrs).filter(k => !shownKeys.has(k) && !INFO_HIDDEN.has(k) && typeof attrs[k] === 'number').sort((a,b)=>a.localeCompare(b));
  if (other.length) sections.push({label:'Other', rows:other});

  const Row = ({k}) => (
    <div style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:`1px solid ${C.border}`}}>
      <span style={{fontSize:12,color:C.textMid,maxWidth:'58%'}}>{fmtAttrName(k)}</span>
      <span style={{fontSize:12,fontWeight:600,color:C.text}}>{fmtInfoVal(k, attrs[k])}</span>
    </div>
  );

  // useTypeDescriptions() returns null until the lazy import resolves — and since the effect that
  // loads it runs AFTER the first render, that null is guaranteed on every first paint, cache or
  // no cache. Indexing it directly threw on every single open of this panel.
  const desc = typeDescriptions?.[String(typeID)] ?? null;

  return (
    <div>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:12,paddingBottom:12,borderBottom:`1px solid ${C.border}`,marginBottom:12}}>
        {typeID && <img src={eveIcon(typeID,64)} width={48} height={48} style={{borderRadius:8,background:'#0d0d1a',flexShrink:0}} onError={e=>e.target.style.opacity='0'} alt=""/>}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:14,fontWeight:700,color:C.text}}>{td.n}</div>
          <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{td.gn}</div>
          {meta && <span style={{fontSize:10,color:META_COLORS[meta]??C.textMute,background:`${C.border}88`,borderRadius:99,padding:'1px 7px',fontWeight:700,display:'inline-block',marginTop:3}}>{meta}</span>}
        </div>
      </div>
      {/* Description */}
      {desc && (
        <div style={{fontSize:12,color:C.textMid,lineHeight:1.55,marginBottom:14,padding:'10px 12px',background:C.surfaceAlt,borderRadius:8,border:`1px solid ${C.border}`}}>
          {desc}
        </div>
      )}
      {/* Required skills */}
      {skills.length > 0 && (
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:C.textMute,textTransform:'uppercase',letterSpacing:.5,marginBottom:6}}>Required Skills</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
            {skills.map((s,i) => (
              <span key={i} style={{fontSize:11,color:C.text,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 8px'}}>
                {s.name} <span style={{color:C.accent,fontWeight:700}}>{'●'.repeat(s.level)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {/* Attribute sections */}
      {sections.map(sec => (
        <div key={sec.label} style={{marginBottom:10}}>
          <div style={{fontSize:10,fontWeight:700,color:C.textMute,textTransform:'uppercase',letterSpacing:.5,marginBottom:4,marginTop:4}}>{sec.label}</div>
          {sec.rows.map(k => <Row key={k} k={k}/>)}
        </div>
      ))}
    </div>
  );
}

// Standalone bottom sheet for item info (triggered from browser or charge list)
function ItemInfoSheet({typeID, onClose}) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:400,display:'flex',flexDirection:'column',justifyContent:'flex-end'}} onClick={onClose}>
      <div style={{background:C.surface,borderRadius:'16px 16px 0 0',maxHeight:'88vh',display:'flex',flexDirection:'column',boxShadow:'0 -8px 32px rgba(0,0,0,.5)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',padding:'10px 16px 0'}}>
          <button onClick={onClose} style={{background:'none',border:'none',color:C.textMute,fontSize:22,cursor:'pointer',lineHeight:1}}>×</button>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'4px 16px 20px'}}>
          <ItemInfoPanel typeID={typeID}/>
        </div>
      </div>
    </div>
  );
}

function ModuleInfoTab({typeID, mod}) {
  return <ItemInfoPanel typeID={typeID ?? mod?.typeID}/>;
}

// Shared by the module browser, the structure module browser and the Variations tab, so the three
// never drift apart.
function fitCostParts(item) {
  const a = TYPES[item?.typeID]?.attrs ?? TYPES[item?.typeID]?.a ?? {};
  return {
    cpu:   item?.cpu   ?? a.cpu   ?? a['50'] ?? 0,
    pg:    item?.pg    ?? a.power ?? a['30'] ?? 0,
    calib: item?.calib ?? a.upgradeCost ?? a['1153'] ?? null,
  };
}

// CPU and powergrid glyphs, drawn inline rather than pulled from an icon sheet. Two reasons: the app
// has to render with no network (see lib/icons.js), and CCP's attribute icons aren't in the bundle at
// all — only TYPE icons are. At 10px beside a module name a bitmap would be mush anyway, whereas
// these stay crisp and take the surrounding text colour. Shapes follow the game's own iconography
// closely enough to be read at a glance: a chip for CPU, a bolt for grid.
const CpuGlyph = ({size=10,color="currentColor"}) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{flexShrink:0}}>
    <rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1" stroke={color} strokeWidth="1.5"/>
    <path d="M6.6 1.4v3M9.4 1.4v3M6.6 11.6v3M9.4 11.6v3M1.4 6.6h3M1.4 9.4h3M11.6 6.6h3M11.6 9.4h3"
          stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);
const PgGlyph = ({size=10,color="currentColor"}) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={color} aria-hidden="true" style={{flexShrink:0}}>
    <path d="M9.5 1 3.5 9H7l-.5 6L12.5 7H9l.5-6Z"/>
  </svg>
);
// Calibration. An OPEN-END wrench rather than a closed ring or a socket: at 10px the jaws are the
// only part that still reads as a tool, so the gap has to be the biggest feature. The head is a 280°
// arc (opening up-left) and the handle a single thick diagonal — same 16px box and same stroke
// weight as the chip, so the three sit together.
const CalGlyph = ({size=10,color="currentColor"}) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} aria-hidden="true" style={{flexShrink:0}}>
    <path d="M5.14 2.41A3 3 0 1 1 2.41 5.14" strokeWidth="2.2"/>
    <path d="M7.5 7.5 13.2 13.2" strokeWidth="2.6" strokeLinecap="round"/>
  </svg>
);

// Fitting cost subtext under a module name.
//
// BASE attributes, matching the item's own show-info in game — which is the number EVE players read
// fitting costs from. Character skills reduce what a fit is actually charged (up to -25%, and which
// of CPU/powergrid moves depends on the module), so a module already in a slot can cost the resource
// strip less than the figure shown here.
//
// Rigs carry no CPU or powergrid at all — they cost calibration instead, so that is shown in its
// place rather than a meaningless "CPU 0".
//
// Powergrid leads, matching the resource strip and the game's own ordering.
// Glyph hues. Each resource gets its own so PG and CPU separate at a glance without reading the
// shape — at 10px, colour is doing more of the work than the drawing is. Deliberately NOT C.accent
// (that means "tappable" everywhere else in the app) and NOT raw C.warning (an amber bolt on every
// single row would read as a per-module alert); calibration takes rig green because rigs are already
// green throughout the UI, so it is a real association rather than decoration.
const RES_INK = { pg:"#e0a44a", cpu:"#5fb8d8", cal:C.rig };

function FitCost({item, size=11}) {
  const {cpu,pg,calib} = fitCostParts(item);
  const g = Math.round(size * 0.95);
  // The cell carries the hue, the glyphs are currentColor, and the number overrides back to a
  // neutral — so tinted icon against bright neutral digits, which is what makes the pair legible
  // rather than one small blur. Numbers sit at textMid, not textMute: the old #55555f was ~2.4:1
  // against the row background, which is under any reasonable floor for 10-11px text.
  const cell  = (key) => ({display:"inline-flex",alignItems:"center",gap:3.5,color:RES_INK[key]});
  const num   = {color:C.textMid,fontWeight:600};
  const row   = {fontSize:size,marginTop:1,display:"flex",alignItems:"center",gap:10,lineHeight:1.3};
  if (calib > 0) return (
    <div style={row}>
      <span style={cell('cal')} title={`${calib} calibration points`}><CalGlyph size={g}/><span style={num}>{fmtResource(calib)}</span></span>
    </div>
  );
  if (!(pg > 0) && !(cpu > 0)) return null;
  return (
    <div style={row}>
      {pg  > 0 && <span style={cell('pg')}  title={`${pg} MW powergrid`}><PgGlyph  size={g}/><span style={num}>{fmtResource(pg)}</span></span>}
      {cpu > 0 && <span style={cell('cpu')} title={`${cpu} tf CPU`}><CpuGlyph size={g}/><span style={num}>{fmtResource(cpu)}</span></span>}
    </div>
  );
}

function ModuleVariationsTab({typeID, currentName, onSwap, readOnly}) {
  const raw = typeID ? variantsOf(typeID) : [];
  // Resolve meta from CCP's metaGroupID rather than the bundle's (wrong) label, then re-sort:
  // the bundle had faction/storyline/deadspace/officer all coming through as "T2".
  const vars = raw.map(v=>({...v, meta: metaOf(v.typeID, v.meta)}))
                  .sort((a,b)=>(META_ORDER[a.meta]??99)-(META_ORDER[b.meta]??99)||a.name.localeCompare(b.name));
  if (!vars.length) return <div style={{padding:16,color:C.textMute,fontSize:12}}>No variation data available.</div>;
  return (
    <div>
      <div style={{fontSize:10,color:C.textMute,padding:'6px 0 8px'}}>
        {readOnly?`${vars.length} variants`:`Tap a variation to swap — ${vars.length} variants`}
      </div>
      {vars.map(v => (
        <div key={v.typeID} onClick={()=>{if(!readOnly&&v.name!==currentName)onSwap(v);}}
          style={{display:'flex',alignItems:'center',gap:9,padding:'9px 4px',borderBottom:`1px solid ${C.border}`,cursor:(readOnly||v.name===currentName)?'default':'pointer',background:v.name===currentName?C.accentLight:'transparent'}}>
          {v.typeID&&<img className="eve-icon" src={eveIcon(v.typeID,32)} width={28} height={28} alt="" onError={e=>{e.target.style.display="none";}}/>}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,color:v.name===currentName?C.accent:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{v.name}</div>
            {/* Fitting cost matters most here: comparing variants is usually "can I afford the T2
                one", and the difference between tiers is often exactly the CPU. */}
            <FitCost item={v} size={10}/>
          </div>
          <span style={{fontSize:10,color:META_COLORS[v.meta]??C.textMid,background:`${C.border}88`,borderRadius:99,padding:'1px 7px',fontWeight:700,flexShrink:0}}>{v.meta}</span>
        </div>
      ))}
    </div>
  );
}


// Info + Variations for the things you can tap in a fit that are NOT slot modules: boosters,
// drones, fighters and subsystems. Modules go through ModuleMenu, which stacks State / Charges /
// Mutations on top of these same two tabs — this is the same content without the parts that only
// make sense for something sitting in a slot.
//
// `onSwap` is optional: with no handler the Variations tab still lists the family (useful just to
// see what else exists), it simply does not act on a tap.
export function ItemDetailSheet({typeID, name, onClose, onSwap}) {
  const [tab, setTab] = useState("info");
  const title = name ?? TYPES[typeID]?.n ?? TYPES[String(typeID)]?.n ?? "Item";
  const TABS = [["info", "Info"], ["vars", "Variations"]];
  return (
    <BottomSheet title={title} onClose={onClose} height="82vh">
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
        {TABS.map(([k, label]) => (
          <button key={k} onClick={()=>setTab(k)}
            style={{flex:1,padding:"9px 0",fontSize:12,fontWeight:600,background:"none",border:"none",cursor:"pointer",
                    color:tab===k?C.accent:C.textMute,borderBottom:tab===k?`2px solid ${C.accent}`:"2px solid transparent"}}>{label}</button>
        ))}
      </div>
      <div style={{padding:"4px 14px 16px"}}>
        {tab==="info" && <ItemInfoPanel typeID={typeID}/>}
        {/* readOnly when the caller gave no handler, so the list stops advertising "tap to swap"
            on rows that cannot do anything — which is how this shipped for boosters. */}
        {tab==="vars" && <ModuleVariationsTab typeID={typeID} currentName={title} readOnly={!onSwap}
                            onSwap={v=>{ onSwap(v); onClose(); }}/>}
      </div>
    </BottomSheet>
  );
}

// ── Abyssal (mutaplasmid) module support ─────────────────────────────────────
const MUTA_ATTR_LABELS={capacitorNeed:"Activation Cost",cpu:"CPU",power:"Powergrid",maxRange:"Optimal Range",falloff:"Falloff",duration:"Cycle Time",energyNeutralizerAmount:"Neut Amount",speedFactor:"Velocity Bonus",maxVelocityBonus:"Max Velocity Bonus",signatureRadiusBonus:"Sig Radius Penalty",signatureRadiusBonusPercent:"Sig Radius Bonus",armorDamageAmount:"Armor Repaired",shieldBonus:"Shield Repaired",reloadTime:"Reload Time",mass:"Mass",armorHpBonus:"Armor HP",shieldCapacityBonus:"Shield HP",massAddition:"Mass Addition",scanResolutionBonus:"Scan Res. Bonus",maxTargetRangeBonus:"Lock Range Bonus",trackingSpeedBonus:"Tracking Bonus",aoeCloudSizeBonus:"Expl. Radius Bonus",aoeVelocityBonus:"Expl. Velocity Bonus",explosionDelayBonus:"Flight Time Bonus",missileVelocityBonus:"Missile Velocity Bonus",warpScrambleRange:"Warp Disrupt Range",thermalDamage:"Thermal Dmg",kineticDamage:"Kinetic Dmg",emDamage:"EM Dmg",explosiveDamage:"Explosive Dmg",damageMultiplier:"Damage Multiplier",speedMultiplier:"Rate of Fire",speed:"Rate of Fire",armorRepairPerCapacitor:"Rep / Cap",armorRepairPerTime:"Rep / Time"};
const mutaLabel=(name)=>MUTA_ATTR_LABELS[name]??name.replace(/([A-Z])/g," $1").replace(/^./,c=>c.toUpperCase());
// Display scaling for a mutated attribute. Both the read-only rendering and the TYPED input go
// through this, so the units a value is shown in are exactly the units you type it back in — if the
// unit for an attribute is ever corrected, both follow automatically.
const mutaUnit=(name)=>{
  if(MUTA_RATE_PCT.has(name)) return {scale:1,unit:"%",dp:2};
  if(/Range|maxRange|falloff/i.test(name)) return {scale:1000,unit:"km",dp:2};
  if(/duration|reloadTime|explosionDelay/i.test(name)) return {scale:1000,unit:"s",dp:2};
  if(/mass/i.test(name)) return {scale:1,unit:"kg",dp:0};
  return {scale:1,unit:"",dp:null};   // dp null → magnitude-dependent precision
};

// Attributes whose raw value is a multiplier the cycle time is DIVIDED by, so the bare number tells
// you nothing: a Gyrostabilizer II's speedMultiplier of 0.895 actually means "+11.7% rate of fire".
// Shown — and edited — as that percentage instead. The mapping is monotonically DECREASING, so a
// smaller raw value is a bigger percentage and the min/max ends of the range swap when displayed.
const MUTA_RATE_PCT=new Set(["speedMultiplier"]);
const mutaToDisplay=(name,v)=>MUTA_RATE_PCT.has(name)?(1/v-1)*100:v;
const mutaFromDisplay=(name,d)=>MUTA_RATE_PCT.has(name)?1/(1+d/100):d;

// Plain (no thousands separators) rendering in display units — what goes INTO the text box, so it
// stays parseable when the user edits it.
const mutaValStr=(name,v)=>{
  const u=mutaUnit(name), d=mutaToDisplay(name,v);
  if(u.dp!=null) return (d/u.scale).toFixed(u.dp);
  const a=Math.abs(d); return a>=100?d.toFixed(1):a>=1?d.toFixed(2):d.toFixed(4);
};
const fmtMutaVal=(name,v)=>{ if(v==null) return "—"; const u=mutaUnit(name); if(u.unit==="kg") return `${Math.round(v).toLocaleString()} kg`; return u.unit?`${mutaValStr(name,v)} ${u.unit}`:mutaValStr(name,v); };

// Typed entry for a mutated attribute, alongside the slider. Commits on blur/Enter rather than per
// keystroke so a half-typed "1." or "-" doesn't churn the fit through a recalculation.
function MutaValueInput({name,value,min,max,onCommit}){
  const u=mutaUnit(name);
  const[txt,setTxt]=useState(()=>mutaValStr(name,value));
  const[editing,setEditing]=useState(false);
  // Follow the slider while the box isn't focused; leave the user's keystrokes alone while it is.
  useEffect(()=>{ if(!editing) setTxt(mutaValStr(name,value)); },[name,value,editing]);
  const commit=()=>{
    setEditing(false);
    const n=Number(txt.replace(/,/g,"").trim());
    if(!Number.isFinite(n)){ setTxt(mutaValStr(name,value)); return; }   // gibberish → revert
    // A mutaplasmid cannot roll outside its own range, so a typed value must not escape it either.
    // Clamp in RAW space, after converting back out of display units — for a percentage-displayed
    // attribute the display mapping is inverted, so clamping the typed number against the raw
    // min/max would compare a percentage to a multiplier.
    const raw=Math.min(max,Math.max(min,mutaFromDisplay(name,n*u.scale)));
    onCommit(raw);
    setTxt(mutaValStr(name,raw));
  };
  return(<span style={{display:"inline-flex",alignItems:"baseline",gap:3}}>
    <input value={txt} inputMode="decimal" aria-label={`${mutaLabel(name)} value`}
      onFocus={e=>{setEditing(true);e.target.select();}}
      onChange={e=>setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={e=>{
        if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();}
        else if(e.key==="Escape"){setEditing(false);setTxt(mutaValStr(name,value));e.currentTarget.blur();}
      }}
      style={{width:64,padding:"1px 4px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:4,
              color:C.accent,fontSize:11,fontWeight:700,textAlign:"right",fontFamily:"inherit"}}/>
    {u.unit&&<span style={{fontSize:9,color:C.textMute}}>{u.unit}</span>}
  </span>);
}
// Serialize a mutated module to the standard abyssal paste format.
function abyssalToText(mod){
  const m=mutaplasmidData[mod.mutaplasmid]; if(!m) return mod.name;
  const ranges=mutaAttrRanges(mod.mutaplasmid,mod.typeID);
  const pairs=ranges.map(r=>`${r.name} ${(mod.mutations?.[r.name]??r.base)}`).join(", ");
  return `${TYPES[mod.typeID]?.n??mod.name}\n${m.n}\n${pairs}`;
}
// Parse the abyssal paste format → a module slot object (or null).
function parseAbyssal(text){
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(lines.length<3) return null;
  const baseName=lines[0], mutaName=lines[1];
  const baseTid=tidByName(baseName); if(!baseTid) return null;
  const mutaID=MUTA_BY_NAME[mutaName.toLowerCase()]; if(!mutaID) return null;
  const mutations={};
  for(const part of lines.slice(2).join(", ").split(",")){
    const mt=part.trim().match(/^([A-Za-z][A-Za-z0-9]*)\s+(-?[\d.]+)/);
    if(mt) mutations[mt[1]]=Number(mt[2]);
  }
  if(!Object.keys(mutations).length) return null;
  const td=TYPES[baseTid];
  const modType=(td?.c===7)?(/(Rig)/i.test(td?.gn||"")?"rig":"module"):"module";
  return {id:Date.now(),name:baseName,typeID:baseTid,type:modType,state:"active",mutaplasmid:mutaID,mutations};
}

function MutaplasmidEditor({mod,onUpdateMod}){
  const[copied,setCopied]=useState(false);
  // Local undo, because a roll here is easy to lose by accident: "Random" replaces every attribute
  // at once, "Remove" throws the whole roll away, and a slider can be nudged off a hand-tuned value
  // with no way back. The fit-wide undo in the header can't serve this — it snapshots per committed
  // module update, so a drag would either flood it or, once coalesced, bury the rest of the fit's
  // history under 400 abyssal steps. Scoped to this editor, it's exactly the granularity wanted.
  const[history,setHistory]=useState([]);
  const lastPush=useRef({key:null,t:0});
  const snapshot=()=>({mutaplasmid:mod.mutaplasmid,mutations:mod.mutations?{...mod.mutations}:undefined});
  // A slider drag fires on every pixel of travel, so contiguous edits to the SAME slider coalesce
  // into one step — Undo steps back a whole drag, not one four-hundredth of one. Button presses
  // (`apply`/`remove`/`random`) are discrete and never coalesce, so a re-roll spree can be walked
  // back one roll at a time.
  const pushHistory=(key)=>{
    const now=Date.now();
    if(key.startsWith('v:')&&lastPush.current.key===key&&now-lastPush.current.t<900){lastPush.current.t=now;return;}
    lastPush.current={key,t:now};
    setHistory(h=>[...h.slice(-49),snapshot()]);
  };
  const undo=()=>{
    if(!history.length)return;
    const prev=history[history.length-1];
    setHistory(h=>h.slice(0,-1));
    lastPush.current={key:null,t:0};
    haptic("light");
    onUpdateMod({...mod,mutaplasmid:prev.mutaplasmid,mutations:prev.mutations});
  };
  const UndoBtn=({style})=>(
    <button onClick={undo} disabled={!history.length}
      title={history.length?`Undo last change (${history.length})`:"Nothing to undo"}
      style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:"8px 0",borderRadius:7,
              background:C.surfaceAlt,border:`1px solid ${history.length?C.border:"transparent"}`,
              color:history.length?C.textMid:C.textMute,opacity:history.length?1:.4,fontSize:11,fontWeight:700,
              cursor:history.length?"pointer":"default",...style}}>
      <span style={{fontSize:13,lineHeight:1}}>↶</span>Undo
    </button>
  );
  const applicable=MUTA_BY_TYPE[mod.typeID]??MUTA_BY_TYPE[String(mod.typeID)]??[];
  const active=mod.mutaplasmid;
  if(!active){
    if(!applicable.length) return <div style={{padding:"16px",fontSize:12,color:C.textMute,textAlign:"center"}}>No mutaplasmids apply to this module.</div>;
    return(<div style={{padding:"10px 12px"}}>
      <div style={{fontSize:11,color:C.textMid,marginBottom:8}}>Apply a mutaplasmid to mutate this module's stats:</div>
      {applicable.map(mid=>{const m=mutaplasmidData[mid];return(
        <button key={mid} onClick={()=>{pushHistory('apply');const ranges=mutaAttrRanges(mid,mod.typeID);const mutations={};for(const r of ranges)mutations[r.name]=r.base;onUpdateMod({...mod,mutaplasmid:mid,mutations});}}
          style={{display:"block",width:"100%",textAlign:"left",padding:"9px 11px",marginBottom:6,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:12,fontWeight:600,cursor:"pointer"}}>
          {m.n}<span style={{fontSize:9,color:C.textMute,marginLeft:6}}>{Object.keys(m.a||{}).length} attrs</span>
        </button>);})}
      {/* Reachable from here too: Remove drops you back to this list, and losing a tuned roll to a
          mis-tap is exactly the case undo exists for. */}
      {history.length>0&&<UndoBtn style={{width:"100%",marginTop:4}}/>}
    </div>);
  }
  const m=mutaplasmidData[active];
  const ranges=mutaAttrRanges(active,mod.typeID);
  const setVal=(name,v)=>{pushHistory('v:'+name);onUpdateMod({...mod,mutations:{...mod.mutations,[name]:v}});};
  return(<div style={{padding:"10px 12px"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
      <span style={{fontSize:11,fontWeight:700,color:C.accent}}>{m.n}</span>
      <button onClick={()=>{pushHistory('remove');onUpdateMod({...mod,mutaplasmid:undefined,mutations:undefined});}} style={{background:"none",border:`1px solid ${C.danger}`,color:C.danger,borderRadius:6,padding:"3px 8px",fontSize:10,fontWeight:700,cursor:"pointer"}}>Remove</button>
    </div>
    {ranges.map(r=>{
      const cur=mod.mutations?.[r.name]??r.base;
      const frac=r.max>r.min?(cur-r.min)/(r.max-r.min):0.5;
      // Delta vs the unmutated base. For a percentage-displayed attribute the raw ratio has the
      // wrong SIGN (a lower speedMultiplier is a better roll), so compare in display space, where
      // "up is better" holds for everything.
      const inverted=MUTA_RATE_PCT.has(r.name);   // lower raw = better roll; see the slider below
      const pct=inverted
        ? mutaToDisplay(r.name,cur)-mutaToDisplay(r.name,r.base)
        : (cur/r.base-1)*100;
      // Green means BETTER, not BIGGER. The two are opposite for 19 of the 49 attributes a
      // mutaplasmid can roll — CPU, powergrid, activation cost, the MWD's signature penalty, mass,
      // reload, cycle time, the hull resonances — so a plain `pct>0` painted a +25% CPU cost green.
      // The direction is CCP's `highIsGood`, not a list of ours; see attrHighIsGood in calc.js.
      //
      // `inverted` wins where it applies: for rate of fire, `pct` is already computed in DISPLAY
      // space (where up = more shots/sec), so it is pre-corrected and must NOT be flipped again —
      // CCP quite correctly marks the raw speedMultiplier as lower-is-better, which would
      // double-invert it back to wrong.
      const higherIsBetter=inverted?true:attrHighIsGood(r.attrID);
      const deltaColor=Math.abs(pct)<0.1?C.textMute:((higherIsBetter?pct>0:pct<0)?C.rig:C.warning);
      return(<div key={r.name} style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3}}>
          <span style={{fontSize:11,fontWeight:600,color:C.text}}>{mutaLabel(r.name)}</span>
          <span style={{display:"inline-flex",alignItems:"baseline",gap:5}}>
            <MutaValueInput name={r.name} value={cur} min={r.min} max={r.max} onCommit={v=>setVal(r.name,v)}/>
            {/* The NUMBER keeps its literal sign — "+25%" on a CPU roll is a true statement about
                the attribute, and flipping it would misreport the module. Only the colour carries
                the good/bad judgement. */}
            <span style={{fontSize:9,color:deltaColor}}>({pct>=0?"+":""}{pct.toFixed(0)}%)</span>
          </span>
        </div>
        {/* Rate of fire is stored INVERTED: speedMultiplier is a cycle-time multiplier, so a LOWER
            raw value is a faster gun. Running the slider straight through raw space therefore put
            "more DPS" on the left, against the near-universal convention that right is more — and
            against this same panel's own percentage readout, which counts up as you go left.
            So the slider is mirrored for those attributes: the knob position is (min + max - raw),
            and the end labels swap with it. Only the DISPLAY is mirrored; `cur` and everything
            stored on the fit stay in raw space, which is what the engine reads. */}
        <input type="range" min={r.min} max={r.max} step={(r.max-r.min)/400||0.01}
               value={inverted?(r.min+r.max-cur):cur}
               onChange={e=>{const v=Number(e.target.value);setVal(r.name,inverted?(r.min+r.max-v):v);}}
               style={{width:"100%",accentColor:C.accent}}/>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:C.textMute}}>
          <span>{fmtMutaVal(r.name,inverted?r.max:r.min)}</span><span>base {fmtMutaVal(r.name,r.base)}</span><span>{fmtMutaVal(r.name,inverted?r.min:r.max)}</span>
        </div>
      </div>);
    })}
    <div style={{display:"flex",gap:8,marginTop:6}}>
      <UndoBtn style={{flex:1}}/>
      {/* Revert puts every mutated attribute back to the module's unrolled base — the same state
          applying the mutaplasmid starts you in, and the state every "(+0%)" delta is measured
          against. Scoped to THIS module only: `ranges` and `mod` are the one item under edit, so
          nothing else on the fit is touched. The mutaplasmid stays applied (Remove takes it off).
          Replaces a "Random" button, which rolled a fresh set of values — fine as a toy, but it
          could not put back a roll you had entered by hand off a real abyssal module. */}
      <button onClick={()=>{pushHistory('revert');const ms={};for(const r of ranges)ms[r.name]=r.base;onUpdateMod({...mod,mutations:ms});}}
        title="Set every attribute on this module back to its base value"
        style={{flex:1,padding:"8px 0",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,color:C.textMid,fontSize:11,fontWeight:700,cursor:"pointer"}}>Revert</button>
      <button onClick={()=>{const txt=abyssalToText(mod);try{navigator.clipboard?.writeText(txt);}catch{} setCopied(true);setTimeout(()=>setCopied(false),1500);}} style={{flex:1,padding:"8px 0",background:C.accent,border:"none",borderRadius:7,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>{copied?"Copied!":"Copy"}</button>
    </div>
  </div>);
}

function ModuleMenu({mod,onClose,onUpdateMod,onUpdateModLive,onRemove,onDuplicate}){
  const _hasMuta=(MUTA_BY_TYPE[mod.typeID]??MUTA_BY_TYPE[String(mod.typeID)]??[]).length>0||mod.mutaplasmid;
  const[tab,setTab]=useState("state");
  const[chargeInfo,setChargeInfo]=useState(null);
  const[rahQuery,setRahQuery]=useState("");
  const[rahOpen,setRahOpen]=useState(false);
  const _modTakesCharges=moduleTakesCharges(mod.typeID,mod.name);
  // Reactive Armor Hardener: gets a "Reactive" tab to choose its adaptation pattern.
  const _isRAH=((TYPES[mod.typeID]??TYPES[String(mod.typeID)])?.gn??(TYPES[mod.typeID]??TYPES[String(mod.typeID)])?.groupName)==="Armor Resistance Shift Hardener";
  const tabs=[...((mod.type==="weapon"||mod.type==="capbooster"||_modTakesCharges)?["state","charge","info","variations"]:["state","info","variations"]),...(_hasMuta?["mutate"]:[])];
  const tabLabel={state:"State",charge:"Charge",info:"Info",variations:"Variations",mutate:"Mutate"};
  // Determine valid states for this module type
  const _td=TYPES[mod.typeID];
  const _a=_td?.attrs??_td?.a??{};
  const _isCloak=(_td?.gn??_td?.groupName)==="Cloaking Device";
  const _canActivate=mod.type==="rig"?false:(_isCloak||!!(Number(_a.duration||_a['73']||0)||Number(_a.speed||_a['51']||0)||Number(_a.capacitorNeed||_a['6']||0)));
  const _canOverheat=Number((_td?.attrs??_td?.a??{})?.heatDamage??(_td?.attrs??_td?.a??{})?.['1211']??0)>0;
  const states=mod.type==="rig"?["online"]:_canActivate?(_canOverheat?MODULE_STATES:["offline","online","active"]):(["offline","online"]);
  const metaColor={T1:C.textMid,T2:C.accent,Deadspace:C.rig,Named:C.rig,Storyline:C.warning,Faction:C.danger,Officer:"#f0abfc"};
  const modData=Object.values(modulesData).find(m=>m.name===mod.name);
  return(<>
    <BottomSheet title={mod.name} onClose={onClose} height="78vh">
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
        {tabs.map(t=><button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"8px 0",fontSize:11,fontWeight:700,background:"none",border:"none",cursor:"pointer",color:tab===t?C.accent:C.textMute,borderBottom:tab===t?`2px solid ${C.accent}`:"2px solid transparent"}}>{tabLabel[t]}</button>)}
      </div>
      <div style={{padding:14,overflowY:'auto',maxHeight:'60vh'}}>
        {tab==="state"&&(<div>
          <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Module State</div>
          <div style={{display:"flex",gap:8,marginBottom:20}}>
            {states.map(s=>(<button key={s} className="press" onClick={()=>{if(mod.state!==s)haptic("medium");onUpdateMod({...mod,state:s});}} style={{flex:1,padding:"10px 0",borderRadius:8,border:`1px solid ${mod.state===s?STATE_COLORS[s]:C.border}`,background:mod.state===s?`${STATE_COLORS[s]}22`:"none",cursor:"pointer",transition:"background-color .18s ease, border-color .18s ease"}}>
              <div style={{width:8,height:8,borderRadius:99,background:STATE_COLORS[s],margin:"0 auto 4px",transform:mod.state===s?"scale(1.35)":"scale(1)",transition:"transform .18s cubic-bezier(.22,.61,.36,1)"}}/>
              <span style={{fontSize:10,fontWeight:700,color:mod.state===s?STATE_COLORS[s]:C.textMute}}>{STATE_LABELS[s]}</span>
            </button>))}
          </div>
        {_isRAH&&(()=>{
          // mod.rahPattern: undefined/'fit' → Fit Pattern (follows Resistances-tab profile);
          // 'disable' → Do Not Adapt; {name,p} → adapt to a specific ammo/NPC damage split.
          const cur=mod.rahPattern;
          const isFit=cur==null||cur==="fit";
          const isDisable=cur==="disable";
          const curName=(cur&&cur.p)?cur.name:null;
          const Opt=({active,onClick,title,sub})=>(
            <div onClick={onClick} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 12px",background:active?C.accentLight:C.surface,border:`1px solid ${active?C.accentBorder:C.border}`,borderRadius:8,marginBottom:6,cursor:"pointer"}}>
              <div><div style={{fontSize:13,fontWeight:600,color:active?C.accent:C.text}}>{title}</div>{sub&&<div style={{fontSize:10,color:C.textMute,marginTop:2}}>{sub}</div>}</div>
              {active&&<span style={{color:C.accent,fontSize:12,fontWeight:700}}>✓</span>}
            </div>);
          const Bar=({p})=>{const seg=[["em",C.em||"#6ba4ff"],["th",C.th||"#ff5b5b"],["kin",C.kin||"#b9b9b9"],["exp",C.exp||"#e0a44a"]];const v={em:p[0],th:p[1],kin:p[2],exp:p[3]};return(<div style={{display:"flex",height:5,borderRadius:3,overflow:"hidden",width:62,flexShrink:0}}>{seg.map(([k,c])=>v[k]>0?<div key={k} style={{flex:v[k],background:c}}/>:null)}</div>);};
          const q=rahQuery.trim().toLowerCase();
          return(<div>
            <div style={{height:1,background:C.border,margin:"14px 0 12px"}}/>
            <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Reactive Armor Hardener adaptation</div>
            <Opt active={isFit} onClick={()=>onUpdateMod({...mod,rahPattern:"fit"})} title="Fit Pattern" sub="Adapts to the damage profile selected in the Resistances tab"/>
            <Opt active={isDisable} onClick={()=>onUpdateMod({...mod,rahPattern:"disable"})} title="Do Not Adapt" sub="Even 15% spread across all four armor resists"/>
            {/* Collapsed by default. Fit Pattern and Do Not Adapt cover almost every use; the
                full ammo/NPC list is a long scroll that used to push them off the top. */}
            <div onClick={()=>setRahOpen(o=>!o)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",margin:"14px 0 8px"}}>
              <span style={{fontSize:11,color:C.textMute}}>Adapt to a specific damage type{curName?` — ${curName}`:""}</span>
              <span style={{fontSize:11,color:C.textMute}}>{rahOpen?"▲":"▼"}</span>
            </div>
            {rahOpen&&<>
            <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={rahQuery} onChange={e=>setRahQuery(e.target.value)} placeholder="Search ammo or NPC…" style={{width:"100%",boxSizing:"border-box",padding:"9px 10px",marginBottom:8,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:12,outline:"none"}}/>
            {DAMAGE_PROFILES.map(cat=>{
              const items=cat.items.filter(it=>!q||it.n.toLowerCase().includes(q)||cat.cat.toLowerCase().includes(q));
              if(!items.length)return null;
              return(<div key={cat.cat} style={{marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:700,color:C.textMute,textTransform:"uppercase",letterSpacing:0.5,margin:"6px 2px"}}>{cat.cat}</div>
                {items.map(it=>{
                  const active=curName===it.n;
                  return(<div key={it.n} onClick={()=>onUpdateMod({...mod,rahPattern:{name:it.n,p:it.p}})} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 12px",background:active?C.accentLight:C.surface,border:`1px solid ${active?C.accentBorder:C.border}`,borderRadius:8,marginBottom:5,cursor:"pointer"}}>
                    <span style={{fontSize:12,fontWeight:active?700:500,color:active?C.accent:C.text}}>{it.n}</span>
                    <Bar p={it.p}/>
                  </div>);
                })}
              </div>);
            })}
            </>}
          </div>);
        })()}
          {onDuplicate&&<button onClick={()=>{onDuplicate();onClose();}} style={{width:"100%",marginBottom:10,padding:"11px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer"}}>Duplicate to Next Empty Slot</button>}
          <button onClick={()=>{onRemove();onClose();}} style={{width:"100%",padding:"11px 0",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:C.danger,fontSize:13,fontWeight:700,cursor:"pointer"}}>Remove Module</button>
        </div>)}
        {tab==="charge"&&(mod.type==="weapon"||mod.type==="capbooster"||_modTakesCharges)&&(<div>
          <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Select charge - applies to all grouped turrets</div>
          {/* Grouped by ammo family, families ordered shortest-range first, and within a family
              T1 → T2 → navy faction → pirate faction. See groupChargesForBrowser. */}
          {groupChargesForBrowser(getCompatibleCharges(mod)).map(g=>(
            <div key={g.family} style={{marginBottom:10}}>
              {/* ALWAYS render the header, even for a one-item family. Skipping it to save a row
                  made those items look like members of the section above — Civilian Blaster Charge
                  and friends are their own families, but appeared to be filed under Ultraviolet.
                  A header that repeats its single item is redundant; one that lies is worse. */}
              <div style={{fontSize:10,fontWeight:700,color:C.textMute,letterSpacing:.5,textTransform:"uppercase",margin:"2px 2px 5px"}}>{g.family}</div>
              {g.items.map(a=>{
                const on=mod.ammo===a.name;
                const aMeta=metaOf(a.typeID,null);
                return(<div key={a.typeID??a.name} style={{display:"flex",alignItems:"center",padding:"10px 12px",background:on?C.accentLight:C.surface,border:`1px solid ${on?C.accentBorder:C.border}`,borderRadius:8,marginBottom:6}}>
                  <div onClick={()=>{const chargeVol=a.volume??(a.typeID?(TYPES[a.typeID]?.attrs?.volume??1):1);const modTd=TYPES[mod.typeID]??TYPES[String(mod.typeID)];const modCap=modTd?.attrs?.capacity??0;const nc=modCap>0&&chargeVol>0?Math.floor(modCap/chargeVol):undefined;onUpdateMod({...mod,ammo:a.name,charges:nc,maxCharges:nc});}} style={{flex:1,minWidth:0,cursor:"pointer"}}>
                    <div style={{fontSize:13,fontWeight:600,color:on?C.accent:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name}</div>
                    {/* Cap boosters are the one charge whose headline number is worth a subtitle.
                        Everything else used to read "N dmg/shot" or, for the likes of Nanite Repair
                        Paste, the actively unhelpful "No data" — both gone. */}
                    {a.capBonus!=null&&<div style={{fontSize:10,color:C.rig,marginTop:2}}>+{a.capBonus} GJ</div>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0,marginLeft:8}}>
                    {aMeta&&<span style={{fontSize:10,color:META_COLORS[aMeta]||C.textMute,background:C.border,borderRadius:99,padding:"2px 7px",fontWeight:700}}>{aMeta}</span>}
                    {on&&<span style={{color:C.accent,fontSize:12,fontWeight:700}}>✓</span>}
                    {a.typeID&&<InfoButton onClick={e=>{e.stopPropagation();setChargeInfo(a.typeID);}}/>}
                  </div>
                </div>);
              })}
            </div>
          ))}
        </div>)}
        {tab==="info"&&(<div style={{overflowY:'auto',flex:1,padding:'0 2px'}}><ModuleInfoTab typeID={mod.typeID} mod={mod}/></div>)}
        {tab==="variations"&&(<ModuleVariationsTab typeID={mod.typeID} currentName={mod.name} onSwap={v=>{
          // Recompute charge count: variants can have different bay capacities (e.g. cap boosters)
          let nc=mod.charges;
          if(mod.ammo&&v.typeID){
            const newTd=TYPES[v.typeID]??TYPES[String(v.typeID)];
            const cap=newTd?.attrs?.capacity??0;
            const cTid=tidByName((mod.ammo||"").replace(/\s*\(\d+\)$/,""));
            const vol=cTid?(TYPES[cTid]?.attrs?.volume??1):1;
            nc=cap>0&&vol>0?Math.floor(cap/vol):undefined;
          }
          onUpdateMod({name:v.name,typeID:v.typeID,state:mod.state,ammo:mod.ammo,charges:nc,maxCharges:nc});onClose();}} />)}
        {tab==="mutate"&&(<div style={{overflowY:"auto",flex:1}}><MutaplasmidEditor mod={mod} onUpdateMod={onUpdateModLive||onUpdateMod}/></div>)}
      </div>
    </BottomSheet>
    {chargeInfo&&<ItemInfoSheet typeID={chargeInfo} onClose={()=>setChargeInfo(null)}/>}
  </>);
}

function ImportFitSheet({onClose,onImport}){
  const[text,setText]=useState("");
  const[parsed,setParsed]=useState(null);
  const[err,setErr]=useState(null);
  const process=(t)=>{if(!t.trim()){setParsed(null);setErr(null);return;}const r=parseEFT(t);if(r.error){setParsed(null);setErr(r.error);}else{setParsed(r);setErr(null);}};
  // navigator.clipboard.readText() is not permitted inside the native WebView, which is why this
  // button did nothing in the installed app and the fit had to be pasted by hand. Capacitor's
  // Clipboard plugin reads through the OS instead; the web API stays as the browser fallback.
  const readClip=async()=>{
    setErr(null);
    let t=null;
    try{
      const Cap=(typeof window!=="undefined")&&window.Capacitor;
      if(Cap?.isNativePlatform?.()){
        const {Clipboard}=await import('@capacitor/clipboard');
        t=(await Clipboard.read())?.value ?? null;
      }
    }catch{}
    if(t==null){try{t=await navigator.clipboard.readText();}catch{}}
    if(t==null){setErr("Couldn't read the clipboard — paste manually below.");return;}
    haptic();setText(t);process(t);
  };
  return(
    <BottomSheet title="Import EFT Fit" onClose={onClose} height="88vh">
      <div style={{padding:14}}>
        <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Paste a fit copied from Pyfa or the in-game fitting window.</div>
        <button onClick={readClip} style={{width:"100%",padding:"10px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:10}}>Read from Clipboard</button>
        <textarea value={text} onChange={e=>{setText(e.target.value);process(e.target.value);}} placeholder={"[Hyperion, My Fit]\nNeutron Blaster Cannon II, Caldari Navy Antimatter Charge L\nMagnetic Field Stabilizer II\n..."} style={{width:"100%",height:110,background:C.surfaceAlt,border:`1px solid ${err?C.danger:C.border}`,borderRadius:8,color:C.text,fontSize:11,padding:"8px 10px",boxSizing:"border-box",resize:"none",fontFamily:"monospace"}}/>
        {err&&<div style={{color:C.danger,fontSize:11,marginTop:6}}>{err}</div>}
        {parsed&&(<div style={{marginTop:12,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,padding:12,maxHeight:200,overflowY:"auto"}}>
          <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:2}}>{parsed.fitName}</div>
          <div style={{fontSize:11,color:C.textMid,marginBottom:8}}>
            {parsed.shipName} &middot; {parsed.mods.length} mod{parsed.mods.length!==1?"s":""}
            {parsed.drones.length>0&&<> &middot; {parsed.drones.length} drone type{parsed.drones.length!==1?"s":""}</>}
            {parsed.fighters?.length>0&&<> &middot; {parsed.fighters.reduce((s,f)=>s+f.qty,0)} fighter squadron{parsed.fighters.reduce((s,f)=>s+f.qty,0)!==1?"s":""}</>}
            {parsed.cargo.length>0&&<> &middot; {parsed.cargo.length} cargo</>}
            {parsed.implantNames.length>0&&<> &middot; {parsed.implantNames.length} implant{parsed.implantNames.length!==1?"s":""}</>}
            {parsed.boosterNames.length>0&&<> &middot; {parsed.boosterNames.length} booster{parsed.boosterNames.length!==1?"s":""}</>}
          </div>
          {parsed.mods.map((m,i)=>(<div key={i} style={{fontSize:11,padding:"2px 0",borderBottom:`1px solid ${C.border}`}}><span style={{color:C.text}}>{m.name}</span>{m.charge&&<span style={{color:C.textMute}}> &rsaquo; {m.charge}</span>}</div>))}
        </div>)}
        {parsed&&<button onClick={()=>{onImport(parsed);onClose();}} style={{width:"100%",marginTop:14,padding:"12px 0",background:C.accent,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Import "{parsed.fitName}"</button>}
      </div>
    </BottomSheet>
  );
}

// ═══ FIT TAB ════════════════════════════════════════════════════
// Picker for the TARGET's resists — what you are shooting, weighting outgoing DPS. Deliberately the
// same shape as DamageProfileSheet (which is the incoming-damage counterpart) so the two read as a
// pair. The swatch shows resist STRENGTH per damage type, so a dark bar means "your damage of this
// type is being absorbed".
function TargetProfileSheet({current,onSelect,onClose}){
  const[search,setSearch]=useState("");
  const[openCat,setOpenCat]=useState(()=>new Set(["Generic"]));
  const q=search.trim().toLowerCase();
  const cats=TARGET_PROFILES.map(g=>({cat:g.cat,items:g.items.filter(it=>!q||it.n.toLowerCase().includes(q)||g.cat.toLowerCase().includes(q))})).filter(g=>g.items.length);
  const toggleCat=(c)=>setOpenCat(s=>{const n=new Set(s);n.has(c)?n.delete(c):n.add(c);return n;});
  const Bar=({r})=>(<span style={{display:"flex",gap:2,flexShrink:0}}>
    {[["em",r[0]],["th",r[1]],["kin",r[2]],["exp",r[3]]].map(([k,v])=>(
      <span key={k} title={`${k} ${Math.round(v*100)}%`} style={{width:11,height:11,borderRadius:2,background:DMG[k].color,opacity:0.15+v*0.85}}/>))}
  </span>);
  return(<BottomSheet title="Target Resist Profile" onClose={onClose} height="80vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{fontSize:10,color:C.textMute,marginBottom:6}}>Weights your DPS by how resistant the target is. Does not change raw DPS.</div>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px"}}>
        <span style={{fontSize:14,color:C.textMute}}>&#128269;</span>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search targets..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13,outline:"none"}}/>
      </div>
    </div>
    {cats.map(g=>{const open=!!q||openCat.has(g.cat);return(<div key={g.cat}>
      <div onClick={()=>toggleCat(g.cat)} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
        <span style={{fontSize:10,color:C.textMute,transform:open?"rotate(90deg)":"none",display:"inline-block",width:10}}>▶</span>
        <span style={{fontSize:11,fontWeight:700,color:C.text}}>{g.cat}</span>
        <span style={{fontSize:10,color:C.textMute}}>({g.items.length})</span>
      </div>
      {open&&g.items.map(it=>{const sel=current?.n===it.n;return(
        <div key={g.cat+it.n} onClick={()=>{onSelect({n:it.n,r:it.r});onClose();}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"9px 14px 9px 26px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:sel?C.accentLight:"transparent"}}>
          <span style={{fontSize:12,fontWeight:sel?700:500,color:sel?C.accent:C.text}}>{it.n}</span>
          <Bar r={it.r}/>
        </div>);})}
    </div>);})}
  </BottomSheet>);
}

function DamageProfileSheet({current,onSelect,onClose}){
  const[search,setSearch]=useState("");
  const[openCat,setOpenCat]=useState(()=>new Set(["Generic"]));
  const q=search.trim().toLowerCase();
  const cats=DAMAGE_PROFILES.map(g=>({cat:g.cat,items:g.items.filter(it=>!q||it.n.toLowerCase().includes(q)||g.cat.toLowerCase().includes(q))})).filter(g=>g.items.length);
  const toggleCat=(c)=>setOpenCat(s=>{const n=new Set(s);n.has(c)?n.delete(c):n.add(c);return n;});
  const Bar=({p})=>(<span style={{display:"flex",width:54,height:6,borderRadius:99,overflow:"hidden",border:`1px solid ${C.border}`,flexShrink:0}}>
    {[["em",p[0]],["th",p[1]],["kin",p[2]],["exp",p[3]]].map(([k,v])=><span key={k} style={{width:`${v*100}%`,background:DMG[k].color}}/>)}
  </span>);
  return(<BottomSheet title="Incoming Damage Profile" onClose={onClose} height="80vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px"}}>
        <span style={{fontSize:14,color:C.textMute}}>&#128269;</span>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search profiles..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13,outline:"none"}}/>
      </div>
    </div>
    {cats.map(g=>{const open=!!q||openCat.has(g.cat);return(<div key={g.cat}>
      <div onClick={()=>toggleCat(g.cat)} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
        <span style={{fontSize:10,color:C.textMute,transform:open?"rotate(90deg)":"none",display:"inline-block",width:10}}>▶</span>
        <span style={{fontSize:11,fontWeight:700,color:C.text}}>{g.cat}</span>
        <span style={{fontSize:10,color:C.textMute}}>({g.items.length})</span>
      </div>
      {open&&g.items.map(it=>{const sel=current?.name===it.n;return(
        <div key={it.n} onClick={()=>{onSelect({name:it.n,p:it.p});onClose();}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"9px 14px 9px 26px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:sel?C.accentLight:"transparent"}}>
          <span style={{fontSize:12,fontWeight:sel?700:500,color:sel?C.accent:C.text}}>{it.n}</span>
          <Bar p={it.p}/>
        </div>);})}
    </div>);})}
  </BottomSheet>);
}


export { ATTR_UNIT, AccordionSection, BottomSheet, DamageProfileSheet, TargetProfileSheet, HIDDEN_ATTRS, ImportFitSheet, InfoButton, ItemInfoSheet, MUTA_ATTR_LABELS, ModuleBrowserSheet, ModuleInfoTab, ModuleMenu, ModuleVariationsTab, MutaplasmidEditor, NumpadModal, RESIST_ATTRS, ResourceStrip, SubsystemPickerSheet, abyssalToText, fmtAttrName, fmtAttrVal, fmtMutaVal, mutaLabel, parseAbyssal };
