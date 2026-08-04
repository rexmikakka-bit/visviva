import { useState } from "react";
import { C } from "../theme.js";
import { eveIcon, eveRender } from "../lib/icons.js";
import { lookupShip, navIcons } from "../lib/core.js";
import { fitToEFT } from "../lib/eft-export.js";

const EXPORT_PREFS_KEY = 'pyfa_export_prefs';

// Generic "pick a method, then we open the real sheet" bottom sheet — used by the hamburger menu's
// combined Import/Export entries so the menu itself doesn't need one row per method (EFT vs ESI).
export function ChooserSheet({title, options, onClose}) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'flex-end'}} onClick={onClose}>
      <div style={{width:'100%',boxSizing:'border-box',background:C.surface,borderRadius:'16px 16px 0 0',padding:20,boxShadow:'0 -8px 32px rgba(0,0,0,.5)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:14}}>{title}</div>
        {options.map(opt=>(
          <button key={opt.label} onClick={opt.onSelect} style={{display:'flex',alignItems:'center',gap:12,width:'100%',textAlign:'left',padding:'14px 12px',background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,marginBottom:8,cursor:'pointer'}}>
            <span style={{fontSize:20}} dangerouslySetInnerHTML={{__html:opt.icon}}/>
            <div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{opt.label}</div><div style={{fontSize:11,color:C.textMute,marginTop:1}}>{opt.sub}</div></div>
          </button>
        ))}
        <button onClick={onClose} style={{width:'100%',marginTop:4,padding:10,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.textMute,fontSize:13,cursor:'pointer'}}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ExportFitModal({activeFit, slots, implants, boosters, drones, fighters, cargo, onClose}) {
  const _lsGet=()=>{try{return JSON.parse(localStorage.getItem(EXPORT_PREFS_KEY)||'{}');}catch{return {};}};
  const _p=_lsGet();
  const [incCharges,  setIncCharges]  = useState(_p.charges  ?? true);
  const [incImplants, setIncImplants] = useState(_p.implants ?? true);
  const [incBoosters, setIncBoosters] = useState(_p.boosters ?? true);
  const [incCargo,    setIncCargo]    = useState(_p.cargo    ?? false);
  const [incMutations,setIncMutations]= useState(_p.mutations ?? true);
  const [copied,      setCopied]      = useState(false);

  const genEFT = () => fitToEFT(
    {ship: activeFit?.ship ?? 'Unknown', name: activeFit?.fitName ?? 'Unnamed',
     slots, implants, boosters, drones, fighters, cargo},
    {charges: incCharges, implants: incImplants, boosters: incBoosters,
     cargo: incCargo, mutations: incMutations});

  const doExport = () => {
    try { localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify({charges:incCharges,implants:incImplants,boosters:incBoosters,cargo:incCargo,mutations:incMutations})); } catch(e) {}
    const txt = genEFT();
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{
        const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);setCopied(true);setTimeout(()=>setCopied(false),2000);
      });
    } else {
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
        <CheckRow label="Abyssal Rolls (mutated modules)" val={incMutations} setVal={setIncMutations}/>
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

export function HamburgerMenu({onClose,onOpenSettings,onImport,onExport,onSnapshot,onFeedback,onOptimizePrice}){
  return(<div style={{position:"fixed",inset:0,zIndex:90}} onClick={onClose}>
    <div style={{position:"absolute",top:0,left:0,bottom:0,width:260,background:C.surface,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",boxShadow:"4px 0 24px rgba(0,0,0,.5)",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"20px 16px 12px",borderBottom:`1px solid ${C.border}`}}><div style={{fontSize:18,fontWeight:800,color:C.text,marginBottom:2}}>VisViva</div><div style={{fontSize:11,color:C.textMute}}>EVE Online Fitting Tool</div></div>
      {[{icon:"&#128229;",label:"Import Fit",sub:"From EFT or an EVE character",action:"import"},{icon:"&#128228;",label:"Export Fit",sub:"To clipboard or an EVE character",action:"export"},{icon:"&#128247;",label:"Export Snapshot",sub:"Shareable image of the fit",action:"snapshot"},{icon:"&#128176;",label:"Optimize Fit Price",sub:"Swap modules to reduce cost",action:"optimizePrice"},{icon:"&#128027;",label:"Send Feedback",sub:"Report a bug or suggest something",action:"feedback"},{icon:"&#9881;",label:"Settings",sub:"ESI, market, overrides",action:"settings"}].map(item=>(<button key={item.label} onClick={()=>{if(item.action==="settings"){onOpenSettings();onClose();}else if(item.action==="import"){onImport();onClose();}else if(item.action==="export"){if(onExport)onExport();onClose();}else if(item.action==="snapshot"){if(onSnapshot)onSnapshot();onClose();}else if(item.action==="feedback"){if(onFeedback)onFeedback();onClose();}else if(item.action==="optimizePrice"){if(onOptimizePrice)onOptimizePrice();onClose();}else onClose();}} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:"none",border:"none",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:20}} dangerouslySetInnerHTML={{__html:item.icon}}/><div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{item.label}</div><div style={{fontSize:11,color:C.textMute,marginTop:1}}>{item.sub}</div></div></button>))}
    </div>
  </div>);
}

// Skill-requirement indicator: green book when the character meets every fitted item's required
// skills, red when not. Red is tappable and lists what's short. Hidden with no active fit, since
// there'd be nothing to check.
function SkillBook({ok,count,onClick}){
  const col=ok?C.success:C.danger;
  return(
    <button onClick={ok?undefined:onClick} disabled={ok}
      title={ok?"All skill requirements met":`${count} skill${count===1?"":"s"} insufficient — tap for details`}
      aria-label={ok?"All skill requirements met":`${count} skills insufficient`}
      style={{position:"relative",width:34,height:34,borderRadius:9,background:`${col}1a`,
              border:`1px solid ${col}66`,display:"flex",alignItems:"center",justifyContent:"center",
              padding:0,cursor:ok?"default":"pointer",flexShrink:0}}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* open book */}
        <path d="M12 6.5C10.4 5.2 8.3 4.6 5.8 4.6c-.7 0-1.3.05-1.8.13v13c.5-.08 1.1-.13 1.8-.13 2.5 0 4.6.6 6.2 1.9"
              stroke={col} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 6.5c1.6-1.3 3.7-1.9 6.2-1.9.7 0 1.3.05 1.8.13v13c-.5-.08-1.1-.13-1.8-.13-2.5 0-4.6.6-6.2 1.9"
              stroke={col} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 6.5v13" stroke={col} strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
      {!ok&&<span style={{position:"absolute",top:-5,right:-5,minWidth:15,height:15,borderRadius:99,
        background:C.danger,color:"#fff",fontSize:9,fontWeight:800,display:"flex",alignItems:"center",
        justifyContent:"center",padding:"0 3px",lineHeight:1}}>{count>99?"99+":count}</span>}
    </button>
  );
}

export function SkillGapSheet({missing,onClose}){
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:300,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
      <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.6)"}}/>
      <div onClick={e=>e.stopPropagation()} style={{position:"relative",width:"100%",maxWidth:430,margin:"0 auto",
           background:C.surface,borderRadius:"16px 16px 0 0",maxHeight:"80vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{width:36,height:4,background:C.border,borderRadius:99,margin:"10px auto 0"}}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
          <span style={{fontSize:15,fontWeight:700,color:C.text}}>Insufficient Skills</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.textMid,fontSize:20,cursor:"pointer",padding:"0 4px"}}>×</button>
        </div>
        <div style={{overflowY:"auto",padding:"6px 0 14px"}}>
          {missing.map(m=>(
            <div key={m.key} style={{padding:"9px 16px",borderBottom:`1px solid ${C.border}`}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <span style={{fontSize:13,fontWeight:600,color:C.text}}>{m.name}</span>
                <span style={{fontSize:11,fontWeight:700,flexShrink:0}}>
                  <span style={{color:C.danger}}>{m.have}</span>
                  <span style={{color:C.textMute}}> / {m.required}</span>
                </span>
              </div>
              <div style={{fontSize:10,color:C.textMute,marginTop:2}}>
                {m.group} · needed by {m.items.slice(0,3).join(", ")}{m.items.length>3?` +${m.items.length-3} more`:""}
              </div>
            </div>
          ))}
        </div>
        <div style={{padding:"10px 16px",borderTop:`1px solid ${C.border}`,fontSize:10,color:C.textMute}}>
          Set your levels in Settings → Skills. Skills you have never set count as level V.
        </div>
      </div>
    </div>
  );
}

export function AppHeader({onHamburger,activeFit,onShipInfo,skillCheck,onSkillGaps}){
  const ship=activeFit?.ship?lookupShip(activeFit.ship):{};
  const shipName=activeFit?.ship??"VisViva";
  const subLabel=ship.hullClass?`${ship.race??""} ${ship.hullClass}`.trim():"EVE Online Fitting Tool";
  return(<div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"14px 14px 12px"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{textAlign:"left"}}>
        <div style={{fontSize:10,fontWeight:600,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",marginBottom:2}}>VisViva</div>
        <div style={{fontSize:19,fontWeight:700,color:C.text,lineHeight:1.2}}>{shipName}</div>
        <div style={{fontSize:12,color:C.textMid,marginTop:1}}>{subLabel}</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {activeFit?.ship&&skillCheck&&
          <SkillBook ok={skillCheck.ok} count={skillCheck.missing.length} onClick={onSkillGaps}/>}
        <button onClick={onShipInfo} style={{width:52,height:52,borderRadius:11,background:C.surfaceAlt,border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",cursor:onShipInfo?'pointer':'default',padding:0}}>
          {ship.typeID
            ?<img src={eveRender(ship.typeID,64)} width={52} height={52} alt="" style={{borderRadius:11}} onError={e=>{e.target.style.display="none";}}/>
            :<svg width={24} height={24} viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="13" cy="13" rx="10" ry="5.5" stroke={C.accent} strokeWidth="1.4" opacity="0.55" transform="rotate(-20 13 13)"/>
                <circle cx="13" cy="13" r="2.6" fill={C.accent}/>
              </svg>
          }
        </button>
        <button onClick={onHamburger} style={{width:40,height:40,borderRadius:9,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>&#9776;</button>
      </div>
    </div>
  </div>);
}

const BOOSTER_ICON=eveIcon(3211,32);

export function BottomNav({active,onChange}){
  const tabs=[
    {key:"fittings",label:"Fittings",navKey:"fit"},
    {key:"cargo",   label:"Cargo",   navKey:"cargo"},
    {key:"drones",  label:"Drones",  navKey:"drones"},
    {key:"implants",label:"Implants",navKey:"implants"},
    {key:"effects", label:"Effects", navKey:"effects"},
  ];
  const NAV_ICON_TYPEIDS={fit:1353,cargo:1317,drones:24395,implants:10216};
  return(<div style={{display:"flex",background:C.surface,borderTop:`1px solid ${C.border}`,paddingBottom:"env(safe-area-inset-bottom, 0px)"}}>
    {tabs.map(t=>{const ovTid=NAV_ICON_TYPEIDS[t.navKey];const src=ovTid?eveIcon(ovTid,64):(navIcons?.[t.navKey]??'');const dim=active===t.key?1:0.5;return(<button key={t.key} onClick={()=>onChange(t.key)} style={{flex:1,padding:"7px 0 8px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <img src={t.navKey==="effects"?BOOSTER_ICON:src} width={22} height={22} alt="" style={{objectFit:"contain",opacity:dim}} onError={e=>{e.target.style.visibility="hidden";}}/>
      <span style={{fontSize:9,fontWeight:700,color:active===t.key?C.accent:C.textMute,letterSpacing:.3}}>{t.label}</span>
      {active===t.key&&<div style={{width:20,height:2,background:C.accent,borderRadius:99,marginTop:1}}/>}
    </button>);})}
  </div>);
}
