import { useState } from "react";
import { C } from "../theme.js";
import { BackupPanel } from "./backup.jsx";
import { SKILL_CATALOG } from "../calc.js";
import { ImplantLoadoutsManager } from "./implants.jsx";
import { EsiSettingsPanel, EsiSkillAlignPanel } from "./esi-ui.jsx";

// Skill groups are DERIVED from SKILL_CATALOG rather than hand-listed. The old hardcoded table
// covered 28 skills; the catalog has 357 — every skill the engine reads PLUS every skill any
// fittable item requires. Most were unreachable from the UI before, so you could not lower a
// missile specialization below V, and nothing could tell you a rig needed Jury Rigging.
// Deriving it means the list can never drift from the engine again.
// Grouping uses CCP's own skill group (`TYPES[tid].gn` for category 16), so the sections match the
// in-game character sheet instead of an invented taxonomy.
const GROUP_COLORS={
  Gunnery:C.danger, Missiles:C.high, Drones:C.rig, Shields:C.mid, Armor:C.warning,
  Engineering:C.warning, Navigation:C.rig, Targeting:C.accent, "Spaceship Command":C.high,
  Subsystems:C.low, Rigging:C.rig, "Fleet Support":C.accent, "Electronic Systems":C.accent,
  "Neural Enhancement":C.success, "Structure Management":C.low,
};
const SKILL_GROUPS=(()=>{
  const byGroup=new Map();
  for(const e of SKILL_CATALOG){
    if(!byGroup.has(e.group))byGroup.set(e.group,[]);
    byGroup.get(e.group).push({key:e.key,label:e.name});
  }
  return[...byGroup.entries()]
    .map(([label,skills])=>({label,color:GROUP_COLORS[label]??C.textMid,
                             skills:skills.sort((a,b)=>a.label.localeCompare(b.label))}))
    .sort((a,b)=>a.label.localeCompare(b.label));
})();

function SkillsPanel({skills,setSkills}){
  const setAll=lv=>setSkills(Object.fromEntries(SKILL_CATALOG.map(e=>[e.key,lv])));
  // Closed by default — 357 skills across 18 groups is far too much to scroll past otherwise.
  const[open,setOpen]=useState({});
  const toggle=g=>setOpen(o=>({...o,[g]:!o[g]}));
  const setGroup=(grp,lv)=>setSkills(prev=>({...prev,...Object.fromEntries(grp.skills.map(s=>[s.key,lv]))}));
  const lvlOf=k=>skills?.[k]??0;
  const allAt=lv=>SKILL_CATALOG.every(e=>lvlOf(e.key)===lv);
  return(
    <div>
      <EsiSkillAlignPanel setSkills={setSkills}/>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {/* Highlight reflects the ACTUAL state, not the last click: a preset is lit only while every
            skill still sits at that level, so it goes dark again the moment you adjust one. "All V"
            used to be styled lit unconditionally, which made the other two look inert by comparison.
            "All IV" was dropped: it is not a state any real pilot is in, and next to a character
            sync it is a worse answer to the same question. */}
        {[[5,"All V (Max)",C.accent],[0,"Clear All",C.danger]].map(([lv,label,col])=>{
          const active=allAt(lv);
          return(<button key={lv} onClick={()=>setAll(lv)} aria-pressed={active}
            style={{flex:1,padding:"8px 0",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
                    background:active?`${col}22`:C.surfaceAlt,
                    border:`1px solid ${active?col:C.border}`,
                    color:active?col:C.textMid,
                    boxShadow:active?`inset 0 0 0 1px ${col}55`:"none"}}>{label}</button>);
        })}
      </div>
      {SKILL_GROUPS.map(grp=>{
        const isOpen=!!open[grp.label];
        const trained=grp.skills.filter(s=>lvlOf(s.key)>0).length;
        const atMax=grp.skills.every(s=>lvlOf(s.key)>=5);
        return(
        <div key={grp.label} style={{marginBottom:8,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
          <div onClick={()=>toggle(grp.label)}
            style={{display:"flex",alignItems:"center",gap:6,padding:"9px 10px",background:C.surfaceAlt,cursor:"pointer"}}>
            <span style={{fontSize:9,color:C.textMute,width:9,display:"inline-block",
                          transform:isOpen?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▶</span>
            <div style={{width:8,height:8,borderRadius:99,background:grp.color,flexShrink:0}}/>
            <span style={{fontSize:11,fontWeight:700,color:C.text,textTransform:"uppercase",letterSpacing:.5,flex:1}}>{grp.label}</span>
            <span style={{fontSize:10,color:atMax?C.success:C.textMute,fontWeight:600}}>{trained}/{grp.skills.length}</span>
          </div>
          {isOpen&&<div style={{padding:"2px 10px 8px"}}>
            <div style={{display:"flex",gap:6,padding:"6px 0 8px"}}>
              <button onClick={()=>setGroup(grp,5)} style={{flex:1,padding:"4px 0",background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.textMid,fontSize:10,fontWeight:700,cursor:"pointer"}}>All V</button>
              <button onClick={()=>setGroup(grp,0)} style={{flex:1,padding:"4px 0",background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.textMid,fontSize:10,fontWeight:700,cursor:"pointer"}}>None</button>
            </div>
            {grp.skills.map(sk=>(
              <div key={sk.key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.border}44`}}>
                <div style={{flex:1,minWidth:0,marginRight:8,fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sk.label}</div>
                <div style={{display:"flex",gap:3,flexShrink:0,alignItems:"center"}}>
                  {/* Clicking the level you're already at clears the skill — otherwise there is no
                      way back down to 0 once a level is set. */}
                  {[1,2,3,4,5].map(lv=>(
                    <button key={lv} onClick={()=>setSkills(prev=>({...prev,[sk.key]:lvlOf(sk.key)===lv?0:lv}))}
                      title={lvlOf(sk.key)===lv?"Click again to untrain":`Set to level ${lv}`}
                      style={{width:24,height:24,borderRadius:5,border:"none",cursor:"pointer",fontWeight:700,fontSize:11,
                        background:lvlOf(sk.key)>=lv?grp.color:C.surfaceAlt,
                        color:lvlOf(sk.key)>=lv?"#fff":C.textMute}}>
                      {lv}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>}
        </div>);
      })}
      <div style={{marginTop:10,padding:"10px 12px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,fontSize:10,color:C.textMute}}>
        {SKILL_GROUPS.reduce((n,g)=>n+g.skills.length,0)} skills across {SKILL_GROUPS.length} groups — every skill the engine reads plus every skill a fittable item requires. Unset skills count as level V.
      </div>
    </div>
  );
}

// A labelled on/off row: title, one line of explanation, and an iOS-style switch on the right.
function ToggleRow({label,note,on,onChange}){
  return(<div onClick={()=>onChange(!on)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:C.surface,border:`1px solid ${on?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8,cursor:"pointer"}}>
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:13,fontWeight:600,color:C.text}}>{label}</div>
      {note&&<div style={{fontSize:11,color:C.textMute,lineHeight:1.45,marginTop:3}}>{note}</div>}
    </div>
    <div role="switch" aria-checked={!!on} aria-label={label} style={{flexShrink:0,width:38,height:22,borderRadius:99,background:on?C.accent:C.surfaceAlt,border:`1px solid ${on?C.accent:C.borderStrong}`,padding:2,display:"flex",justifyContent:on?"flex-end":"flex-start",alignItems:"center",transition:"background .15s"}}>
      <div style={{width:18,height:18,borderRadius:99,background:on?"#0e0e10":C.textMute}}/>
    </div>
  </div>);
}

export function SettingsOverlay({onClose,skills,setSkills,factorInReload,setFactorInReload,openInNewTab,setOpenInNewTab,implants,setImplants,loadouts,setLoadouts,priceHub,setPriceHub,priceSource,setPriceSource}){
  const[section,setSection]=useState("skills");
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:100,display:"flex",flexDirection:"column",justifyContent:"flex-end",alignItems:"center"}}>
    <div style={{width:"100%",maxWidth:430,background:C.surface,borderRadius:"16px 16px 0 0",maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{width:36,height:4,background:C.border,borderRadius:99,margin:"10px auto 0"}}/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:16,fontWeight:700,color:C.text}}>Settings</span><button onClick={onClose} style={{background:"none",border:"none",color:C.textMid,fontSize:20,cursor:"pointer",padding:"0 4px"}}>x</button></div>
      <div className="hs" style={{overflowX:"auto",display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        {[{key:"skills",label:"Skills"},{key:"backup",label:"Backup"},{key:"esi",label:"ESI"},{key:"market",label:"Market"},{key:"implants",label:"Loadouts"},{key:"interface",label:"Interface"}].map(n=><button key={n.key} onClick={()=>setSection(n.key)} style={{flexShrink:0,padding:"9px 14px",fontSize:12,fontWeight:600,background:"none",border:"none",cursor:"pointer",color:section===n.key?C.accent:C.textMute,borderBottom:section===n.key?`2px solid ${C.accent}`:"2px solid transparent"}}>{n.label}</button>)}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {section==="skills"&&<SkillsPanel skills={skills} setSkills={setSkills}/>}
        {section==="backup"&&<BackupPanel/>}
        {section==="esi"&&<EsiSettingsPanel setSkills={setSkills}/>}
        {section==="market"&&<div>
          <div style={{fontSize:11,fontWeight:700,color:C.textMute,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>Price Source</div>
          {[{key:"fuzzwork",label:"Fuzzwork Market",note:null},{key:"ceve",label:"ceve-market.org",note:null}].map(m=>{
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
          <div style={{marginTop:12,fontSize:11,color:C.textMute,lineHeight:1.5}}>
            <div><strong style={{color:C.textMid}}>Fuzzwork</strong> — sell-order percentile, matching pyfa's default. One request for the whole fit; the fastest option.</div>
            <div style={{marginTop:6}}><strong style={{color:C.textMid}}>ceve-market</strong> — lowest sell order in the hub's region. One small request per item.</div>
            
            <div style={{marginTop:6}}>All sources cache for 1 hour per hub.</div>
            <div style={{marginTop:8,color:C.warning}}>ceve-market only works in the installed app — it sends no CORS headers, so a web browser blocks it. Fuzzwork works everywhere.</div>
          </div>
        </div>}
        {section==="implants"&&<ImplantLoadoutsManager implants={implants} setImplants={setImplants} loadouts={loadouts} setLoadouts={setLoadouts}/>}
        {section==="interface"&&<div>
          <div style={{fontSize:11,fontWeight:700,color:C.textMute,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>Fit Tabs</div>
          <ToggleRow label="Always open fits in a new tab" on={!!openInNewTab} onChange={setOpenInNewTab}
            note="Off: opening a fit replaces the tab you are in, and the + in the tab strip opens a new one. On: every fit you open gets its own tab, like pyfa."/>
          <div style={{fontSize:11,color:C.textMute,lineHeight:1.5,marginTop:4}}>The strip holds up to 8 tabs; past that the oldest drops off. Closing a tab never deletes the fit.</div>
          <div style={{fontSize:11,fontWeight:700,color:C.textMute,letterSpacing:.5,textTransform:"uppercase",margin:"18px 0 8px"}}>Damage</div>
          <ToggleRow label="Factor in reload time" on={!!factorInReload} onChange={setFactorInReload}
            note="Averages reload downtime into DPS for weapons that use charges. Same switch as the Reload button on the Stats tab."/>
        </div>}
        {section==="overrides"&&<div>{[["Max Velocity","1,240 m/s"],["Signature Radius","385 m"],["Align Time","11.2 s"],["Scan Resolution","108 mm"]].map(([label,ph])=>(<div key={label} style={{marginBottom:10}}><div style={{fontSize:11,color:C.textMid,marginBottom:4}}>{label}</div><input placeholder={ph} style={{width:"100%",padding:"8px 10px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,fontSize:12,boxSizing:"border-box"}}/></div>))}<button style={{width:"100%",marginTop:8,padding:"10px 0",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:C.danger,fontSize:12,fontWeight:600,cursor:"pointer"}}>Reset All Overrides</button></div>}
      </div>
      {/* Credit to pyfa is not decoration. Environment-effect mechanics (wormhole classes,
          metaliminal storms) are the one thing CCP publishes no modifier data for, so every engine
          that models them is standing on pyfa's hand-written handlers — ours included. Naming that
          in the shipped app, not only in the repo, is the honest place for it. */}
      <div style={{flexShrink:0,padding:"10px 16px calc(10px + env(safe-area-inset-bottom, 0px))",borderTop:`1px solid ${C.border}`,background:C.surfaceAlt,fontSize:10,lineHeight:1.5,color:C.textMute,textAlign:"center"}}>
        Unofficial, fan-made tool — not affiliated with, endorsed by, or sponsored by Fenris Creations. EVE Online and all related materials are used with limited permission; all intellectual property belongs to Fenris Creations.
        <div style={{marginTop:6}}>
          Fitting calculations are validated against <a href="https://github.com/pyfa-org/Pyfa" target="_blank" rel="noreferrer" style={{color:C.textMid}}>pyfa</a>, and its environment-effect data is used with thanks. pyfa is licensed GPLv3.
        </div>
      </div>
    </div>
  </div>);
}
