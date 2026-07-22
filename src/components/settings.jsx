import { useState } from "react";
import { C } from "../theme.js";
import { BackupPanel } from "./backup.jsx";
import { SKILL_DEFAULTS } from "../calc.js";
import { ImplantLoadoutsManager } from "./implants.jsx";

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

export function SettingsOverlay({onClose,skills,setSkills,factorInReload,setFactorInReload,implants,setImplants,loadouts,setLoadouts,priceHub,setPriceHub,priceSource,setPriceSource}){
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
        {section==="market"&&<div>
          <div style={{fontSize:11,fontWeight:700,color:C.textMute,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>Price Source</div>
          {[{key:"fuzzwork",label:"Fuzzwork Market",note:null},{key:"evetycoon",label:"EVE Tycoon",note:"coming soon"},{key:"ceve",label:"ceve-market.org",note:"coming soon"}].map(m=>{
            const active=priceSource===m.key;
            const disabled=!!m.note;
            return(<div key={m.key} onClick={disabled?undefined:()=>setPriceSource(m.key)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:C.surface,border:`1px solid ${active?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8,cursor:disabled?"default":"pointer",opacity:disabled?.45:1}}>
              <div style={{width:18,height:18,borderRadius:99,border:`2px solid ${active?C.accent:C.borderStrong}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {active&&<div style={{width:8,height:8,borderRadius:99,background:C.accent}}/>}
              </div>
              <span style={{fontSize:13,fontWeight:active?700:500,color:active?C.text:C.textMid,flex:1}}>{m.label}</span>
              {m.note&&<span style={{fontSize:10,color:C.textMute,fontStyle:"italic"}}>{m.note}</span>}
            </div>);
          })}
          <div style={{fontSize:11,fontWeight:700,color:C.textMute,letterSpacing:.5,textTransform:"uppercase",margin:"16px 0 8px"}}>Market Hub</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {["Jita","Amarr","Dodixie","Rens","Hek"].map(h=>(
              <button key={h} onClick={()=>setPriceHub(h)} style={{padding:"7px 14px",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer",background:h===priceHub?C.accentLight:"none",border:`1px solid ${h===priceHub?C.accentBorder:C.border}`,color:h===priceHub?C.accent:C.textMid}}>{h}</button>
            ))}
          </div>
          <div style={{marginTop:12,fontSize:11,color:C.textMute,lineHeight:1.5}}>Prices are sell-order percentile via Fuzzwork's aggregates API, matching pyfa's default. Cached for 1 hour per hub.</div>
        </div>}
        {section==="implants"&&<ImplantLoadoutsManager implants={implants} setImplants={setImplants} loadouts={loadouts} setLoadouts={setLoadouts}/>}
        {section==="overrides"&&<div>{[["Max Velocity","1,240 m/s"],["Signature Radius","385 m"],["Align Time","11.2 s"],["Scan Resolution","108 mm"]].map(([label,ph])=>(<div key={label} style={{marginBottom:10}}><div style={{fontSize:11,color:C.textMid,marginBottom:4}}>{label}</div><input placeholder={ph} style={{width:"100%",padding:"8px 10px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,fontSize:12,boxSizing:"border-box"}}/></div>))}<button style={{width:"100%",marginTop:8,padding:"10px 0",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:C.danger,fontSize:12,fontWeight:600,cursor:"pointer"}}>Reset All Overrides</button></div>}
      </div>
      <div style={{flexShrink:0,padding:"10px 16px calc(10px + env(safe-area-inset-bottom, 0px))",borderTop:`1px solid ${C.border}`,background:C.surfaceAlt,fontSize:10,lineHeight:1.5,color:C.textMute,textAlign:"center"}}>
        Unofficial, fan-made tool — not affiliated with, endorsed by, or sponsored by CCP Games / Fenris Creations. EVE Online and all related materials are used with limited permission; all intellectual property belongs to Fenris Creations.
      </div>
    </div>
  </div>);
}
