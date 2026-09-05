import { useState } from "react";
import { C, THEMES, THEME_LABELS } from "../theme.js";
import { BackupPanel } from "./backup.jsx";
import { SKILL_CATALOG, ALPHA_SKILLS } from "../calc.js";
import { EsiSettingsPanel, EsiSkillAlignPanel } from "./esi-ui.jsx";
import { useSheetDrag, sheetTransform, SheetGrabber, SHEET_EXIT_MS } from "../lib/use-sheet-drag.jsx";

// Skill groups are DERIVED from SKILL_CATALOG rather than hand-listed. The old hardcoded table
// covered 28 skills; the catalog has 388 — every skill the engine reads PLUS every skill any
// fittable item requires. Most were unreachable from the UI before, so you could not lower a
// missile specialization below V, and nothing could tell you a rig needed Jury Rigging.
// Deriving it means the list can never drift from the engine again.
// Grouping uses CCP's own skill group (`TYPES[tid].gn` for category 16), so the sections match the
// in-game character sheet instead of an invented taxonomy.
// Proxy, not a plain object: read live off C (itself a live Proxy) at each access so a theme
// switch is picked up. SKILL_GROUPS below is a module-level (import-time) structure and must NOT
// bake a resolved color into it — group color is looked up from here at render time instead.
const GROUP_COLORS=new Proxy({},{ get(_,label){ return {
  Gunnery:C.danger, Missiles:C.high, Drones:C.rig, Shields:C.mid, Armor:C.warning,
  Engineering:C.warning, Navigation:C.rig, Targeting:C.accent, "Spaceship Command":C.high,
  Subsystems:C.low, Rigging:C.rig, "Fleet Support":C.accent, "Electronic Systems":C.accent,
  "Neural Enhancement":C.success, "Structure Management":C.low,
}[label]; } });
const SKILL_GROUPS=(()=>{
  const byGroup=new Map();
  for(const e of SKILL_CATALOG){
    if(!byGroup.has(e.group))byGroup.set(e.group,[]);
    byGroup.get(e.group).push({key:e.key,label:e.name});
  }
  return[...byGroup.entries()]
    .map(([label,skills])=>({label,
                             skills:skills.sort((a,b)=>a.label.localeCompare(b.label))}))
    .sort((a,b)=>a.label.localeCompare(b.label));
})();

// Alpha is a LEVEL MAP, not a single level, so the presets are expressed as maps throughout and the
// "lit" test is the same for all three. CCP's own ceiling: mostly III/IV, a few at V, and everything
// it does not train explicitly at 0.
const PRESETS=[
  {id:"omega",label:"All V (Max)",map:Object.fromEntries(SKILL_CATALOG.map(e=>[e.key,5]))},
  {id:"alpha",label:"Alpha",map:ALPHA_SKILLS},
  {id:"none", label:"Clear All", map:Object.fromEntries(SKILL_CATALOG.map(e=>[e.key,0]))},
];
// Same live-lookup reasoning as GROUP_COLORS above.
const PRESET_COLORS=new Proxy({},{ get(_,id){ return {omega:C.accent,alpha:C.warning,none:C.danger}[id]; } });

// A named copy of the skill sheet. The sheet in this panel is app-wide and singular, so aligning it
// to one character is destructive to whatever was there before — this is the "keep that one too"
// escape hatch, and it is what makes the per-fit Pilot selector able to offer anything beyond All V,
// Alpha and a linked ESI character.
//
// Saved as a SNAPSHOT, not a live link: loading a profile copies it into the sheet, and editing the
// sheet afterwards does not write back. That is the same contract as the implant loadouts next door,
// and it is the one that makes "load, tweak, compare" safe.
function SkillProfilesPanel({skills,setSkills,profiles,setProfiles}){
  const[naming,setNaming]=useState(false);
  const[newName,setNewName]=useState('');
  const[editing,setEditing]=useState(null);
  const[editName,setEditName]=useState('');
  const save=()=>{
    const n=newName.trim(); if(!n)return;
    setProfiles(prev=>[...prev,{id:String(Date.now()),name:n,skills:{...skills}}]);
    setNewName('');setNaming(false);
  };
  const rename=id=>{
    const n=editName.trim();
    if(n)setProfiles(prev=>prev.map(p=>p.id===id?{...p,name:n}:p));
    setEditing(null);setEditName('');
  };
  const inp={padding:'6px 10px',background:C.surfaceAlt,border:`1px solid ${C.accentBorder}`,borderRadius:7,color:C.text,fontSize:12,outline:'none'};
  return(
    <div style={{marginBottom:14}}>
      {naming
        ?<div style={{display:'flex',gap:6}}>
           <input autoFocus value={newName} onChange={e=>setNewName(e.target.value)}
             onKeyDown={e=>{if(e.key==='Enter')save();if(e.key==='Escape')setNaming(false);}}
             placeholder="Profile name..." style={{...inp,flex:1,minWidth:0}}/>
           <button onClick={save} style={{padding:'6px 12px',background:C.accent,border:'none',borderRadius:7,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>Save</button>
           <button onClick={()=>setNaming(false)} style={{padding:'6px 10px',background:'none',border:`1px solid ${C.border}`,borderRadius:7,color:C.textMid,fontSize:12,cursor:'pointer'}}>Cancel</button>
         </div>
        :<button onClick={()=>setNaming(true)} style={{width:'100%',padding:'9px 0',background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:12,fontWeight:700,cursor:'pointer'}}>
           Save As Skill Profile…
         </button>}
      {profiles.map(p=>(
        <div key={p.id} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,marginTop:6}}>
          {editing===p.id
            ?<input autoFocus value={editName} onChange={e=>setEditName(e.target.value)}
               onKeyDown={e=>{if(e.key==='Enter')rename(p.id);if(e.key==='Escape')setEditing(null);}}
               onBlur={()=>rename(p.id)} style={{...inp,flex:1,minWidth:0}}/>
            :<div style={{flex:1,minWidth:0}}>
               <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
               <div style={{fontSize:10,color:C.textMute,marginTop:1}}>
                 {SKILL_CATALOG.filter(e=>(p.skills?.[e.key]??5)>0).length} trained skills
               </div>
             </div>}
          <button onClick={()=>setSkills({...p.skills})} style={{padding:'5px 11px',background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:6,color:C.accent,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0}}>Load</button>
          <button onClick={()=>{setEditing(p.id);setEditName(p.name);}} aria-label={`Rename ${p.name}`} style={{width:26,height:26,background:'none',border:'none',cursor:'pointer',fontSize:14,color:C.textMute,flexShrink:0}}>&#9998;</button>
          <button onClick={()=>setProfiles(prev=>prev.filter(x=>x.id!==p.id))} aria-label={`Delete ${p.name}`} style={{width:26,height:26,background:'none',border:'none',cursor:'pointer',fontSize:16,color:C.danger,flexShrink:0}}>&#10005;</button>
        </div>
      ))}
    </div>
  );
}

function SkillsPanel({skills,setSkills,profiles,setProfiles}){
  // Closed by default — 388 skills across 18 groups is far too much to scroll past otherwise.
  const[open,setOpen]=useState({});
  const toggle=g=>setOpen(o=>({...o,[g]:!o[g]}));
  const setGroup=(grp,lv)=>setSkills(prev=>({...prev,...Object.fromEntries(grp.skills.map(s=>[s.key,lv]))}));
  const lvlOf=k=>skills?.[k]??0;
  const matches=map=>SKILL_CATALOG.every(e=>lvlOf(e.key)===(map[e.key]??0));
  return(
    <div>
      <EsiSkillAlignPanel setSkills={setSkills}/>
      <SkillProfilesPanel skills={skills} setSkills={setSkills} profiles={profiles} setProfiles={setProfiles}/>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {/* Highlight reflects the ACTUAL state, not the last click: a preset is lit only while every
            skill still matches it, so it goes dark again the moment you adjust one. "All V"
            used to be styled lit unconditionally, which made the other two look inert by comparison.
            "All IV" was dropped: it is not a state any real pilot is in, and next to a character
            sync it is a worse answer to the same question. Alpha is the opposite case — it IS a real
            character, and the only one you can describe without logging in. */}
        {PRESETS.map(p=>{
          const active=matches(p.map);
          const col=PRESET_COLORS[p.id];
          return(<button key={p.id} onClick={()=>setSkills({...p.map})} aria-pressed={active}
            style={{flex:1,padding:"8px 0",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",
                    background:active?`${col}22`:C.surfaceAlt,
                    border:`1px solid ${active?col:C.border}`,
                    color:active?col:C.textMid,
                    boxShadow:active?`inset 0 0 0 1px ${col}55`:"none"}}>{p.label}</button>);
        })}
      </div>
      {SKILL_GROUPS.map(grp=>{
        const isOpen=!!open[grp.label];
        const trained=grp.skills.filter(s=>lvlOf(s.key)>0).length;
        const atMax=grp.skills.every(s=>lvlOf(s.key)>=5);
        const color=GROUP_COLORS[grp.label]??C.textMid;
        return(
        <div key={grp.label} style={{marginBottom:8,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
          <div onClick={()=>toggle(grp.label)}
            style={{display:"flex",alignItems:"center",gap:6,padding:"9px 10px",background:C.surfaceAlt,cursor:"pointer"}}>
            <span style={{fontSize:9,color:C.textMute,width:9,display:"inline-block",
                          transform:isOpen?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▶</span>
            <div style={{width:8,height:8,borderRadius:99,background:color,flexShrink:0}}/>
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
                        background:lvlOf(sk.key)>=lv?color:C.surfaceAlt,
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
        {SKILL_GROUPS.reduce((n,g)=>n+g.skills.length,0)} skills across {SKILL_GROUPS.length} groups — every skill the engine reads plus every skill a fittable item requires. Unset skills count as level V. Alpha is CCP's own clone ceiling, from the game data.
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

export function SettingsOverlay({onClose,skills,setSkills,skillProfiles,setSkillProfiles,openInNewTab,setOpenInNewTab,priceHub,setPriceHub,priceSource,setPriceSource,themePref,setThemePref,autoFillHardpoints,setAutoFillHardpoints}){
  const[section,setSection]=useState("skills");
  const sheet=useSheetDrag(onClose);
  // Tap the dimmed strip above the sheet to close, the way every other sheet in the app already
  // does — this was the one that had only the x. Self-targeted clicks only, so nothing inside has
  // to stop propagation to be safe.
  return(<div onClick={e=>{ if(e.target===e.currentTarget) sheet.dismiss(); }}
    style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:100,display:"flex",flexDirection:"column",justifyContent:"flex-end",alignItems:"center",opacity:sheet.closing?0:1,transition:`opacity ${SHEET_EXIT_MS}ms ease`}}>
    <div ref={sheet.sheetRef} style={{width:"100%",maxWidth:430,background:C.surface,borderRadius:"16px 16px 0 0",maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden",...sheetTransform(sheet)}}>
      <SheetGrabber grabHandlers={sheet.grabHandlers} style={{padding:"10px 0 0"}}/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 16px 12px",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:16,fontWeight:700,color:C.text}}>Settings</span><button onClick={sheet.dismiss} style={{background:"none",border:"none",color:C.textMid,fontSize:20,cursor:"pointer",padding:"0 4px"}}>x</button></div>
      <div className="hs" style={{overflowX:"auto",display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        {[{key:"skills",label:"Skills"},{key:"backup",label:"Backup"},{key:"esi",label:"ESI"},{key:"market",label:"Market"},{key:"interface",label:"Interface"}].map(n=><button key={n.key} onClick={()=>setSection(n.key)} style={{flexShrink:0,padding:"9px 14px",fontSize:12,fontWeight:600,background:"none",border:"none",cursor:"pointer",color:section===n.key?C.accent:C.textMute,borderBottom:section===n.key?`2px solid ${C.accent}`:"2px solid transparent"}}>{n.label}</button>)}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {section==="skills"&&<SkillsPanel skills={skills} setSkills={setSkills} profiles={skillProfiles} setProfiles={setSkillProfiles}/>}
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
          </div>
        </div>}
        {section==="interface"&&<div>
          <div style={{fontSize:11,fontWeight:700,color:C.textMute,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>Theme</div>
          {/* Wraps rather than squeezing: at four-plus themes a single row drives each label under
              its own width and they start truncating. Grid rather than wrapping flex because
              flex-grow stretches whatever lands on the LAST row to fill it — at six themes that
              left Intaki alone on row two at full width. auto-FILL, not auto-fit: auto-fit
              collapses the empty tracks and brings the stretching straight back. */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(70px,1fr))",gap:6,marginBottom:4}}>
            {[{key:"system",label:"System"},...THEMES.map(k=>({key:k,label:THEME_LABELS[k]??k}))].map(t=>{
              const active=(themePref??"system")===t.key;
              return(<button key={t.key} onClick={()=>setThemePref?.(t.key)} aria-pressed={active}
                style={{padding:"8px 0",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
                        background:active?C.accentLight:C.surfaceAlt,
                        border:`1px solid ${active?C.accentBorder:C.border}`,
                        color:active?C.accent:C.textMid}}>{t.label}</button>);
            })}
          </div>
          <div style={{fontSize:11,color:C.textMute,lineHeight:1.5,marginTop:4,marginBottom:18}}>System follows your device's light/dark setting; the rest pin the app regardless. Amarr, Sansha and Intaki are dark themes, in imperial gold, Nation oxblood and cold slate.</div>
          <div style={{fontSize:11,fontWeight:700,color:C.textMute,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>Fit Tabs</div>
          <ToggleRow label="Always open fits in a new tab" on={!!openInNewTab} onChange={setOpenInNewTab}
            note="Off: opening a fit replaces the tab you are in, and the + in the tab strip opens a new one. On: every fit you open gets its own tab, like pyfa."/>
          <div style={{fontSize:11,color:C.textMute,lineHeight:1.5,marginTop:4,marginBottom:18}}>The strip holds up to 8 tabs; past that the oldest drops off. Closing a tab never deletes the fit.</div>
          <div style={{fontSize:11,fontWeight:700,color:C.textMute,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>Module Browser</div>
          <ToggleRow label="Auto-fill hardpoints" on={autoFillHardpoints??true} onChange={setAutoFillHardpoints}
            note="On: picking a turret or launcher from the browser fills every free matching hardpoint, not just the slot you tapped. Off: it fills only that one slot — use Fill Hardpoints on an existing module to fill the rest by hand."/>
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
