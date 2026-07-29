import { useState } from "react";
import { C } from "../theme.js";
import { eveIcon, eveRender } from "../lib/icons.js";
import { lookupShip, navIcons } from "../lib/core.js";

const EXPORT_PREFS_KEY = 'pyfa_export_prefs';

export function ExportFitModal({activeFit, slots, implants, boosters, cargo, onClose}) {
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
    for (const sec of ['high', 'mid', 'low', 'rigs']) {
      for (const slot of (slots?.[sec] ?? [])) {
        if (!slot.typeID) { lines.push(''); continue; }
        const charge = incCharges && slot.ammo ? `, ${slot.ammo}` : '';
        lines.push(`${slot.name}${charge}`);
      }
      if (sec !== 'rigs') lines.push('');
    }
    const filledImplants = (implants ?? []).filter(i => i.name && i.name !== '[Empty]');
    if (incImplants && filledImplants.length) {
      lines.push('');
      for (const imp of filledImplants) lines.push(imp.name);
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

export function HamburgerMenu({onClose,onOpenSettings,onImportFit,onExportFit,onSnapshot,onFeedback,onOptimizePrice}){
  return(<div style={{position:"fixed",inset:0,zIndex:90}} onClick={onClose}>
    <div style={{position:"absolute",top:0,left:0,bottom:0,width:260,background:C.surface,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",boxShadow:"4px 0 24px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"20px 16px 12px",borderBottom:`1px solid ${C.border}`}}><div style={{fontSize:18,fontWeight:800,color:C.text,marginBottom:2}}>VisViva</div><div style={{fontSize:11,color:C.textMute}}>EVE Online Fitting Tool</div></div>
      {[{icon:"&#128229;",label:"Import Fit",sub:"EFT from clipboard",action:"import"},{icon:"&#128228;",label:"Export Fit",sub:"Copy EFT to clipboard",action:"export"},{icon:"&#128247;",label:"Export Snapshot",sub:"Shareable image of the fit",action:"snapshot"},{icon:"&#128176;",label:"Optimize Fit Price",sub:"Swap modules to reduce cost",action:"optimizePrice"},{icon:"&#128027;",label:"Send Feedback",sub:"Report a bug or suggest something",action:"feedback"},{icon:"&#9881;",label:"Settings",sub:"ESI, market, overrides",action:"settings"}].map(item=>(<button key={item.label} onClick={()=>{if(item.action==="settings"){onOpenSettings();onClose();}else if(item.action==="import"){onImportFit();onClose();}else if(item.action==="export"){if(onExportFit)onExportFit();onClose();}else if(item.action==="snapshot"){if(onSnapshot)onSnapshot();onClose();}else if(item.action==="feedback"){if(onFeedback)onFeedback();onClose();}else if(item.action==="optimizePrice"){if(onOptimizePrice)onOptimizePrice();onClose();}else onClose();}} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:"none",border:"none",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:20}} dangerouslySetInnerHTML={{__html:item.icon}}/><div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{item.label}</div><div style={{fontSize:11,color:C.textMute,marginTop:1}}>{item.sub}</div></div></button>))}
    </div>
  </div>);
}

export function AppHeader({onHamburger,activeFit,onShipInfo}){
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
