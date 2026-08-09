import { useState } from "react";
import { useTabSwipe, slideClass } from "../lib/use-tab-swipe.js";
import { C } from "../theme.js";
import { eveIcon } from "../lib/icons.js";
import { BottomSheet, ItemDetailSheet, mutaLabel } from "./ui.jsx";
import { CMD_SHIP_FITS, WARFARE_BUFF_UNIT, haptic } from "../lib/core.js";
import { BOOSTER_DATA } from "../data/static-tables.js";
import { boosterSideEffectsFor, computeProjectedReps, computeCommandBursts, calcRangeFactor, stackingPenalty, SKILL_DEFAULTS, tidByName, TYPES } from "../calc.js";

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

export function BoosterSideEffects({booster, onUpdate}) {
  const stored = booster.sideEffects;
  const se = (stored?.length && stored[0].key) ? stored : boosterSideEffectsFor(booster.name).map(s => {
    const old = stored?.find(o => o.attr === s.label || o.label === s.label);
    return { ...s, enabled: old?.enabled ?? false };
  });
  if (!se.length) return null;
  const NEURO = 0.75;
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

export function buildBoosterFromName(name){
  const se=boosterSideEffectsFor(name);
  const drugBase=name.replace(/^(Synth|Improved|Standard|Strong|Nugoehuvi Synth) /,"");
  return{id:Date.now()+Math.random(),name,effect:drugBase,active:true,color:C.warning,sideEffects:se};
}

// Environment picker — every "Effect Beacon" (group 920) in the bundle, grouped so the wormhole
// class effects and the metaliminal storms are easy to find among the event/incursion beacons.
// Listed by NAME rather than typeID because that is what gets stored on the fit: it survives a
// bundle regeneration and reads sensibly in an exported fit.
// A category may split into a second level (`sub`), which is what makes the two big families
// browsable: 36 wormhole beacons and 14 storms are otherwise one flat alphabetical wall where
// "Class 4 Pulsar" sits six rows away from "Class 3 Pulsar".
//   Wormhole  → phenomenon (Black Hole, Pulsar, ...) then class 1-6.
//   Metaliminal → storm type (Electrical, Gamma Ray, ...) then Weak/Strong.
// `sub` returns the second-level name and the SHORT label the row shows there (the phenomenon and
// the word "Metaliminal" are already in the header, so repeating them in every row is noise).
const ENV_GROUPS=[
  {cat:"Wormhole", test:n=>/^Class \d/.test(n),
   sub:n=>{const m=/^Class (\d+) (.+?) Effects$/.exec(n); return m?{name:m[2],label:`Class ${m[1]}`,rank:+m[1]}:null;}},
  {cat:"Metaliminal Storm", test:n=>/Metaliminal|Volatile Ice Storm/.test(n),
   sub:n=>{
     const m=/^(Weak|Strong) (.+)$/.exec(n); if(!m) return null;
     // "Weak Lowsec Metaliminal Yoiul Festival YC122 Storm" — keep the security band, it is the
     // only thing telling the two Yoiul variants apart.
     const type=m[2].replace(/^Metaliminal /,"").replace(/ Storm$/,"").replace(/Metaliminal /,"");
     return {name:type,label:m[1],rank:m[1]==="Weak"?0:1};
   }},
  {cat:"Pochven / Triglavian", test:n=>/Liminality|Triglavian|:?\bPochven\b/i.test(n)},
  {cat:"Incursion",    test:n=>/Incursion|Sansha/i.test(n)},
  {cat:"Other",        test:()=>true},
];
function environmentList(){
  const out=ENV_GROUPS.map(g=>({cat:g.cat,items:[],subs:[]}));
  const seen=new Set();
  for(const t of Object.values(TYPES)){
    const gn=t.gn??t.groupName, n=t.n??t.name;
    if(gn!=="Effect Beacon"||!n||seen.has(n))continue;
    seen.add(n);
    const gi=ENV_GROUPS.findIndex(g=>g.test(n)), g=ENV_GROUPS[gi], grp=out[gi];
    const s=g.sub?.(n);
    if(!s){ grp.items.push({name:n,label:n}); continue; }
    let bucket=grp.subs.find(b=>b.name===s.name);
    if(!bucket){ bucket={name:s.name,items:[]}; grp.subs.push(bucket); }
    bucket.items.push({name:n,label:s.label,rank:s.rank});
  }
  for(const g of out){
    g.items.sort((a,b)=>a.label.localeCompare(b.label));
    g.subs.sort((a,b)=>a.name.localeCompare(b.name));
    // Class 1-6 and Weak-before-Strong are both meaningful orders; neither is alphabetical.
    for(const b of g.subs) b.items.sort((a,b2)=>(a.rank??0)-(b2.rank??0));
    g.count=g.items.length+g.subs.reduce((s,b)=>s+b.items.length,0);
  }
  return out.filter(g=>g.count);
}
function EnvironmentPickerSheet({current,onSelect,onClose}){
  const[search,setSearch]=useState("");
  const[openCat,setOpenCat]=useState(()=>new Set(["Wormhole"]));
  const q=search.trim().toLowerCase();
  // Search matches the FULL beacon name, not the short row label — typing "pulsar" has to find
  // rows that render as just "Class 4".
  const hit=(it)=>!q||it.name.toLowerCase().includes(q);
  const groups=environmentList().map(g=>({
    cat:g.cat,
    items:g.items.filter(hit),
    subs:g.subs.map(b=>({name:b.name,items:b.items.filter(it=>hit(it)||b.name.toLowerCase().includes(q))})).filter(b=>b.items.length),
  })).map(g=>({...g,count:g.items.length+g.subs.reduce((s,b)=>s+b.items.length,0)})).filter(g=>g.count);
  const toggle=(c)=>setOpenCat(s=>{const n=new Set(s);n.has(c)?n.delete(c):n.add(c);return n;});
  return(<BottomSheet title="System Effects" onClose={onClose} height="80vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px"}}>
        <span style={{fontSize:14,color:C.textMute}}>&#128269;</span>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search systems..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13,outline:"none"}}/>
      </div>
    </div>
    <div onClick={()=>onSelect(null)} style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:!current?C.accentLight:"transparent"}}>
      <span style={{fontSize:12,fontWeight:!current?700:500,color:!current?C.accent:C.text}}>Normal space (no effects)</span>
    </div>
    {groups.map(g=>{const open=!!q||openCat.has(g.cat);return(<div key={g.cat}>
      <div onClick={()=>toggle(g.cat)} className="press" style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
        <span style={{fontSize:10,color:C.textMute,transform:open?"rotate(90deg)":"none",display:"inline-block",width:10}}>▶</span>
        <span style={{fontSize:11,fontWeight:700,color:C.text}}>{g.cat}</span>
        <span style={{fontSize:10,color:C.textMute}}>({g.count})</span>
      </div>
      {open&&g.subs.map(b=>{
        const key=`${g.cat}/${b.name}`;
        // A search auto-expands everything; otherwise the sub-levels start closed so the category
        // opens onto six phenomena rather than 36 beacons.
        const bOpen=!!q||openCat.has(key);
        const selHere=b.items.some(it=>it.name===current);
        return(<div key={key}>
          <div onClick={()=>toggle(key)} className="press" style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px 8px 26px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
            <span style={{fontSize:9,color:C.textMute,transform:bOpen?"rotate(90deg)":"none",display:"inline-block",width:10}}>▶</span>
            <span style={{fontSize:12,fontWeight:600,color:selHere?C.accent:C.text}}>{b.name}</span>
            <span style={{fontSize:10,color:C.textMute}}>({b.items.length})</span>
          </div>
          {bOpen&&b.items.map(it=>{const sel=current===it.name;return(
            <div key={it.name} onClick={()=>onSelect(it.name)} className="press" style={{padding:"9px 14px 9px 44px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:sel?C.accentLight:"transparent"}}>
              <span style={{fontSize:12,fontWeight:sel?700:500,color:sel?C.accent:C.text}}>{it.label}</span>
            </div>);})}
        </div>);
      })}
      {open&&g.items.map(it=>{const sel=current===it.name;return(
        <div key={it.name} onClick={()=>onSelect(it.name)} className="press" style={{padding:"9px 14px 9px 26px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:sel?C.accentLight:"transparent"}}>
          <span style={{fontSize:12,fontWeight:sel?700:500,color:sel?C.accent:C.text}}>{it.label}</span>
        </div>);})}
    </div>);})}
  </BottomSheet>);
}

function BoosterPickerSheet({onAdd,onClose}){
  const[slotDrill,setSlotDrill]=useState(null);
  const[catDrill,setCatDrill]=useState(null);
  const[search,setSearch]=useState("");
  const gradeChance={Synth:0,Standard:0.15,Improved:0.20,Strong:0.30};
  const slotData=slotDrill?BOOSTER_DATA[slotDrill]??{}:{};
  const catNames=Object.keys(slotData);
  const drugs=catDrill?(slotData[catDrill]??[]):[];

  const allBoosters=Object.values(BOOSTER_DATA).flatMap(s=>Object.values(s).flat());
  const searchResults=search.trim().length>1?allBoosters.filter(n=>n.toLowerCase().includes(search.toLowerCase())):null;

  const back=()=>{if(catDrill)setCatDrill(null);else if(slotDrill)setSlotDrill(null);};
  const breadcrumb=[slotDrill?`Slot ${slotDrill}`:null,catDrill].filter(Boolean).join(' > ');

  const addDrug=(name)=>{
    const drugBase=name.replace(/^(Synth|Improved|Standard|Strong|Nugoehuvi Synth) /,'');
    onAdd({id:Date.now(),name,effect:drugBase,active:true,color:C.warning,
           sideEffects:boosterSideEffectsFor(name)});
    onClose();
  };

  return(<BottomSheet title="Add Booster Drug" onClose={onClose} height="82vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px"}}>
        <span style={{fontSize:16,color:C.textMute}}>&#128269;</span>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search boosters..."
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
    {searchResults&&<div style={{overflowY:"auto"}}>
      {searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0"}}>No boosters found</div>}
      {searchResults.map(n=>(
        <div key={n} onClick={()=>addDrug(n)}
          style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:10}}>
          <BoosterIcon name={n}/>
          <div style={{fontSize:13,fontWeight:600,color:C.text}}>{n}</div>
        </div>
      ))}
    </div>}
    {!searchResults&&!slotDrill&&[1,2,3,11,14,15,16,17].map(slot=>(
      <div key={slot} onClick={()=>setSlotDrill(slot)}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`,textAlign:"left"}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:C.text}}>Slot {slot}</div>
          <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{Object.keys(BOOSTER_DATA[slot]??{}).join(", ")}</div>
        </div>
        <span style={{color:C.textMute}}>{">"}</span>
      </div>
    ))}
    {!searchResults&&slotDrill&&!catDrill&&catNames.map(cat=>(
      <div key={cat} onClick={()=>setCatDrill(cat)}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`,textAlign:"left"}}>
        <div>
          <div style={{fontSize:14,fontWeight:600,color:C.text}}>{cat}</div>
          <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{(slotData[cat]??[]).length} variant{(slotData[cat]??[]).length!==1?"s":""}</div>
          {BOOSTER_SIDE_EFFECTS[cat]&&<div style={{fontSize:10,color:C.warning,marginTop:2}}>! {BOOSTER_SIDE_EFFECTS[cat].length} side effect{BOOSTER_SIDE_EFFECTS[cat].length>1?"s":""}</div>}
        </div>
        <span style={{color:C.textMute}}>{">"}</span>
      </div>
    ))}
    {!searchResults&&catDrill&&drugs.map(drugName=>(
      <div key={drugName} onClick={()=>addDrug(drugName)}
        style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",display:"flex",alignItems:"center",gap:10,justifyContent:"space-between",textAlign:"left"}}>
        <BoosterIcon name={drugName}/>
        <div style={{flex:1,minWidth:0}}>
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

export function FitPickerSheet({title,fitsDB,onSelect,onClose,filterFn}){
  const[search,setSearch]=useState("");
  const allFits=[];
  Object.entries(fitsDB).forEach(([ship,fits])=>fits.forEach(f=>{if(!filterFn||filterFn(ship,f))allFits.push({ship,fit:f});}));
  const filtered=search.trim()?allFits.filter(({ship,fit})=>ship.toLowerCase().includes(search.toLowerCase())||fit.name.toLowerCase().includes(search.toLowerCase())):allFits;
  return(<BottomSheet title={title} onClose={onClose} height="75vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px"}}>
        <span style={{fontSize:14,color:C.textMute}}>&#128269;</span>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search fits..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13}}/>
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

// A fit is only worth offering on the COMMAND tab if it actually runs a command burst — otherwise
// the card it creates just reads "No active command bursts on this fit". Computed from the same
// computeCommandBursts the tab itself uses, so the list and the card can never disagree.
//
// The PROJECTED picker is deliberately UNFILTERED: anything can be projected, and hiding fits there
// would take choices away rather than remove noise.
function hasCommandBursts(ship,fit){
  try{
    return computeCommandBursts({name:ship,typeID:tidByName(ship)},fit.slots,SKILL_DEFAULTS,
      {implants:fit.implants,boosters:fit.boosters}).length>0;
  }catch{ return true; }   // never hide a fit because its calc threw
}

// Item art for the booster rows, matching the module browser. 301 of 311 boosters and 837 of 838
// implants have BUNDLED icons (src/assets/icons), so this works offline; the handful without fall
// back to the image server and are hidden by onError rather than showing a broken-image box.
const BoosterIcon=({name,size=28})=>{
  const tid=tidByName(name);
  if(!tid)return null;
  return <img className="eve-icon" src={eveIcon(tid,32)} width={size} height={size} alt=""
    style={{borderRadius:5,flexShrink:0}} onError={e=>{e.target.style.visibility="hidden";}}/>;
};

// Physical/bookkeeping attributes every type carries, plus the `booster*` family (side-effect
// penalties and their chances, shown separately below). Whatever survives IS the booster's bonus.
//
// Deliberately a DENYLIST. The obvious filter — attributes ending in "Bonus" — silently drops Blue
// Pill, whose entire effect is `shieldBoostMultiplier`, with no such suffix. Naming conventions are
// not a reliable way to find the point of an item.
const BOOSTER_NOISE=/^(mass|volume|radius|capacity|metaLevel.*|techLevel|requiredSkill\d(Level)?|typeColorScheme)$/i;
function boosterBonuses(b){
  const t=TYPES[tidByName(b?.name)];
  const a=t?.attrs??t?.a??{};
  return Object.entries(a)
    .filter(([k,v])=>typeof v==="number"&&v!==0&&!BOOSTER_NOISE.test(k)&&!/^booster/i.test(k))
    .map(([k,v])=>`${mutaLabel(k)} ${v>0?"+":"−"}${Math.abs(v)}%`);
}

// A booster's slot is CCP's `boosterness` (attr 1087). Read from the type rather than the saved
// booster record, because a record restored from an older fit may predate the field entirely.
function boosterSlotOf(b){
  const t=TYPES[tidByName(b?.name)];
  const a=t?.attrs??t?.a??{};
  const n=Number(a.boosterness??a['1087']);
  return Number.isFinite(n)?n:99;
}

// Order is the SWIPE order as well as the tab order, so the two cannot drift apart.
const _SECTIONS=[{tabId:"boosters",label:"Boosters"},{tabId:"projected",label:"Projected"},{tabId:"command",label:"Command"},{tabId:"environment",label:"System"}];
const _SECTION_IDS=_SECTIONS.map(s=>s.tabId);

export function EffectsScreen({fitsDB,boosters,setBoosters,projFits,setProjFits,cmdFits,setCmdFits,environment,setEnvironment,onOpenFit}){
  const[section,setSection]=useState("boosters");
  const {panelRef:_panel,slideDir:_slideDir,swipeHandlers:_swipeHandlers,goTo:_goTo}=useTabSwipe(_SECTION_IDS,section,setSection);
  const[showBoosterPicker,setShowBoosterPicker]=useState(false);
  const[infoItem,setInfoItem]=useState(null);   // {typeID,name} for the shared Info/Variations sheet
  const[showProjPicker,setShowProjPicker]=useState(false);
  const[showCmdPicker,setShowCmdPicker]=useState(false);
  const[showEnvPicker,setShowEnvPicker]=useState(false);

  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{display:"flex",background:C.surface,borderBottom:`1px solid ${C.border}`}}>
      {/* Tapping a tab animates in the same direction a swipe to it would, so the two ways of
          moving between sections never disagree about which way the content lives. */}
      {_SECTIONS.map(t=>(<button key={t.tabId} onClick={()=>{const to=_SECTION_IDS.indexOf(t.tabId),from=_SECTION_IDS.indexOf(section);if(to!==from)_goTo(to,to>from?1:-1);}} style={{flex:1,padding:"8px 0",fontSize:12,fontWeight:600,background:"none",border:"none",cursor:"pointer",color:section===t.tabId?C.accent:C.textMute,borderBottom:section===t.tabId?`2px solid ${C.accent}`:"2px solid transparent"}}>{t.label}</button>))}
    </div>
    {/* Panel wrapper for the swipe. Keyed on the section so the incoming panel remounts and replays
        the slide-in — these panels already unmounted on every tab change, so it costs nothing. */}
    <div {..._swipeHandlers} style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
    <div ref={_panel} key={section} className={slideClass(_slideDir)} style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
    {section==="environment"&&(<div style={{flex:1,overflowY:"auto",padding:12}}>
      <div style={{fontSize:11,color:C.textMute,marginBottom:12}}>The system this fit is sitting in. Wormhole class effects and metaliminal storms change resists, reps, damage, speed and signature for everything in the system.</div>
      <div style={{background:C.surface,border:`1px solid ${environment?C.accentBorder:C.border}`,borderRadius:8,padding:"11px 12px",display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <div style={{flex:1}}>
          <div style={{fontSize:10,color:C.textMute}}>Current system</div>
          <div style={{fontSize:13,fontWeight:700,color:environment?C.accent:C.textMid,marginTop:2}}>{environment??"Normal space (no effects)"}</div>
        </div>
        {environment&&<button onClick={()=>setEnvironment(null)} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14}}>x</button>}
      </div>
      <button className="press" onClick={()=>{haptic();setShowEnvPicker(true);}} style={{width:"100%",padding:"12px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer",marginTop:4}}>{environment?"Change System":"+ Set System Effects"}</button>
      {showEnvPicker&&<EnvironmentPickerSheet current={environment} onSelect={n=>{setEnvironment(n);setShowEnvPicker(false);}} onClose={()=>setShowEnvPicker(false)}/>}
    </div>)}
    {section==="boosters"&&(<div style={{flex:1,overflowY:"auto",padding:12}}>
      <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Toggle boosters to simulate their stat effects on this fit.</div>
      {boosters.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"24px 0",fontSize:13}}>No boosters added</div>}
      {/* Slot order, not the order they happened to be ADDED — a pilot reads a booster rack the way
          the game numbers it, and adding a slot-14 booster first used to park it above slot 1.
          Sorted for DISPLAY only: every setBoosters call below still writes the underlying array by
          id, so nothing is persisted reordered and no saved fit changes shape. A booster whose slot
          cannot be resolved sorts last rather than jumping to the top. */}
      {[...boosters].sort((x,y)=>boosterSlotOf(x)-boosterSlotOf(y)).map(b=>(<div key={b.id} style={{background:C.surface,border:`1px solid ${b.active?C.accentBorder:C.border}`,borderRadius:8,marginBottom:6,overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px"}}>
          <button onClick={()=>setBoosters(boosters.map(x=>x.id===b.id?{...x,active:!x.active}:x))} style={{width:24,height:24,borderRadius:5,background:b.active?C.accentLight:"none",border:`1px solid ${b.active?C.accentBorder:C.borderStrong}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,lineHeight:1,color:b.active?C.accent:C.textMute}}>{b.active?"✓":""}</button>
          {/* The name is the tap target: boosters have real descriptions, and a grade family
              (Synth / Standard / Improved / Strong) worth comparing before committing. */}
          <BoosterIcon name={b.name} size={26}/>
          <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>setInfoItem({typeID:tidByName(b.name),name:b.name,boosterId:b.id})}>
            <div style={{fontSize:12,fontWeight:600,color:b.active?C.text:C.textMid}}>{b.name}</div>
            {/* `b.effect` was the drug name with its grade word stripped — "Exile" printed under
                "Standard Exile Booster", the same word twice. Slot and actual bonuses instead. */}
            <div style={{fontSize:10,color:C.rig,marginTop:1}}>
              <span style={{color:C.textMute}}>Slot {boosterSlotOf(b)}</span>
              {(()=>{const bo=boosterBonuses(b);return bo.length?` · ${bo.join(" · ")}`:"";})()}
            </div>
          </div>
          <button onClick={()=>setBoosters(boosters.filter(x=>x.id!==b.id))} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14}}>x</button>
        </div>
        <BoosterSideEffects booster={b} onUpdate={nb=>setBoosters(boosters.map(x=>x.id===b.id?nb:x))}/>
      </div>))}
      <button className="press" onClick={()=>{haptic();setShowBoosterPicker(true);}} style={{width:"100%",padding:"12px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer",marginTop:4}}>+ Add Booster</button>
      {showBoosterPicker&&<BoosterPickerSheet onAdd={b=>setBoosters(prev=>[...prev,b])} onClose={()=>setShowBoosterPicker(false)}/>}
      {infoItem&&<ItemDetailSheet typeID={infoItem.typeID} name={infoItem.name} onClose={()=>setInfoItem(null)}
        onSwap={v=>setBoosters(bs=>bs.map(x=>x.id===infoItem.boosterId
          ? {...buildBoosterFromName(v.name), id:x.id, active:x.active}   // keep slot identity + on/off
          : x))}/>}
    </div>)}
    {section==="projected"&&(<div style={{flex:1,overflowY:"auto",padding:12}}>
      <div style={{fontSize:11,color:C.textMute,marginBottom:12}}>Project another fit's effects onto this ship. Remote reps and EWAR scale with range. Modules use the source fit's active/overheated state.</div>
      {projFits.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"24px 0",fontSize:13}}>No projected fits applied</div>}
      {projFits.map((f,i)=>{
        const srcFit=fitsDB[f.ship]?.find(x=>x.name===f.fitName);
        const rangeKm=f.rangeKm??30;
        const eff=srcFit?computeProjectedReps({name:f.ship,typeID:tidByName(f.ship)},srcFit.slots,SKILL_DEFAULTS,{implants:srcFit.implants,boosters:srcFit.boosters,drones:srcFit.drones}):{reps:[],webs:[],neuts:[]};
        const rf=(o,fo)=>calcRangeFactor(o,fo,rangeKm*1000,true);
        const totals={shield:0,armor:0,hull:0};
        for(const r of eff.reps)totals[r.kind]+=r.rawPS*rf(r.optimal,r.falloff);
        const webMs=eff.webs.map(w=>1+(w.speedFactor*rf(w.optimal,w.falloff))/100);
        const webMult=webMs.length?stackingPenalty(webMs):1;
        const neutGJs=eff.neuts.reduce((s,n)=>s+n.gjPerSec*rf(n.optimal,n.falloff),0);
        const capGJs=(eff.caps||[]).reduce((s,c)=>s+c.gjPerSec*rf(c.optimal,c.falloff),0);
        const stk=(arr)=>arr.length?(stackingPenalty(arr.map(p=>1+p/100))-1)*100:0;
        const painterSig=stk((eff.painters||[]).map(p=>p.sigBonus*rf(p.optimal,p.falloff)));
        const dampLock=stk((eff.damps||[]).map(d=>d.lockBonus*rf(d.optimal,d.falloff)));
        const tdTrack=stk((eff.trackDisr||[]).map(t=>t.tracking*rf(t.optimal,t.falloff)));
        // A range script zeroes trackingSpeedBonus and moves the whole effect onto optimal and
        // falloff, so reading `tracking` alone made a range-scripted disruptor look inert.
        const tdOpt=stk((eff.trackDisr||[]).map(t=>(t.optimalBonus||0)*rf(t.optimal,t.falloff)));
        const tdFall=stk((eff.trackDisr||[]).map(t=>(t.falloffBonus||0)*rf(t.optimal,t.falloff)));
        const gdRange=stk((eff.guideDisr||[]).map(g=>g.missileRange*rf(g.optimal,g.falloff)));
        const hasReps=totals.shield+totals.armor+totals.hull>0.5;
        const hasWeb=webMs.length>0, hasNeut=neutGJs>0.05, hasCap=capGJs>0.05;
        const hasPaint=Math.abs(painterSig)>0.5, hasDamp=Math.abs(dampLock)>0.5, hasTD=Math.abs(tdTrack)>0.5, hasTDrng=Math.abs(tdOpt)>0.5||Math.abs(tdFall)>0.5, hasGD=Math.abs(gdRange)>0.5;
        const hasAny=hasReps||hasWeb||hasNeut||hasCap||hasPaint||hasDamp||hasTD||hasTDrng||hasGD;
        const setRange=(km)=>setProjFits(projFits.map((p,j)=>j===i?{...p,rangeKm:Math.max(0,km)}:p));
        // Opt-out, matching App.jsx's guard: a fit saved before the toggle existed has no `active`
        // and must keep applying.
        const on=f.active!==false;
        return(<div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8,opacity:on?1:0.55}}>
          <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:10}}>
            <button title={on?"Applied to this fit":"Ignored"} onClick={()=>setProjFits(projFits.map((p,j)=>j===i?{...p,active:!on}:p))}
              style={{width:24,height:24,borderRadius:5,flexShrink:0,background:on?C.accentLight:"none",border:`1px solid ${on?C.accentBorder:C.borderStrong}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,lineHeight:1,color:on?C.accent:""}}>{on?"✓":""}</button>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:on?C.text:C.textMid}}>{f.fitName}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{f.ship}</div></div>
            {onOpenFit&&<button title="Open this fit in a new tab" onClick={()=>onOpenFit(f.ship,f.fitName)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.textMid,cursor:"pointer",fontSize:10,fontWeight:700,padding:"4px 7px",flexShrink:0}}>Open</button>}
            <button onClick={()=>setProjFits(projFits.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14,flexShrink:0}}>x</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <span style={{fontSize:11,color:C.textMid,minWidth:42}}>Range</span>
            <input type="range" min={0} max={150} step={1} value={rangeKm} onChange={e=>setRange(Number(e.target.value))} style={{flex:1,accentColor:C.accent}}/>
            <input type="number" inputMode="numeric" value={rangeKm} onChange={e=>setRange(Number(e.target.value)||0)} style={{width:52,padding:"3px 5px",borderRadius:5,fontSize:12,fontWeight:700,textAlign:"center",background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text}}/>
            <span style={{fontSize:10,color:C.textMute}}>km</span>
          </div>
          {hasAny?(
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {totals.shield>0&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.mid}}>{Math.round(totals.shield)}</div><div style={{fontSize:9,color:C.textMute}}>shield HP/s in</div></div>}
              {totals.armor>0&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.warning}}>{Math.round(totals.armor)}</div><div style={{fontSize:9,color:C.textMute}}>armor HP/s in</div></div>}
              {totals.hull>0&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.danger}}>{Math.round(totals.hull)}</div><div style={{fontSize:9,color:C.textMute}}>hull HP/s in</div></div>}
              {hasWeb&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>-{Math.round((1-webMult)*100)}%</div><div style={{fontSize:9,color:C.textMute}}>your speed (web)</div></div>}
              {hasNeut&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.danger}}>{Math.round(neutGJs)}</div><div style={{fontSize:9,color:C.textMute}}>GJ/s neut</div></div>}
              {hasCap&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.rig}}>+{Math.round(capGJs)}</div><div style={{fontSize:9,color:C.textMute}}>GJ/s cap in</div></div>}
              {hasPaint&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.warning}}>+{Math.round(painterSig)}%</div><div style={{fontSize:9,color:C.textMute}}>your sig (paint)</div></div>}
              {hasDamp&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{Math.round(dampLock)}%</div><div style={{fontSize:9,color:C.textMute}}>your lock range</div></div>}
              {hasTD&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{Math.round(tdTrack)}%</div><div style={{fontSize:9,color:C.textMute}}>your tracking</div></div>}
              {hasTDrng&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{Math.round(Math.abs(tdOpt)>=Math.abs(tdFall)?tdOpt:tdFall)}%</div><div style={{fontSize:9,color:C.textMute}}>your turret range</div></div>}
              {hasGD&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{Math.round(gdRange)}%</div><div style={{fontSize:9,color:C.textMute}}>your missile range</div></div>}
            </div>
          ):<div style={{fontSize:11,color:C.textMute,paddingLeft:2}}>Nothing on this fit projects onto a target</div>}
        </div>);
      })}
      <button className="press" onClick={()=>{haptic();setShowProjPicker(true);}} style={{width:"100%",padding:"12px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer",marginTop:4}}>+ Add Projected Fit</button>
      {showProjPicker&&<FitPickerSheet title="Project a Fit" fitsDB={fitsDB} onSelect={(ship,fit)=>{
        const eff=computeProjectedReps({name:ship,typeID:tidByName(ship)},fit.slots,SKILL_DEFAULTS,{implants:fit.implants,boosters:fit.boosters,drones:fit.drones});
        const optims=[...eff.reps,...eff.webs,...eff.neuts,...(eff.painters||[]),...(eff.damps||[]),...(eff.trackDisr||[]),...(eff.guideDisr||[])].map(m=>m.optimal).filter(v=>v>0);
        const rangeKm=optims.length?Math.round(Math.min(...optims)/1000):30;
        setProjFits(prev=>[...prev,{ship,fitName:fit.name,rangeKm}]);
      }} onClose={()=>setShowProjPicker(false)}/>}
    </div>)}
    {section==="command"&&(<div style={{flex:1,overflowY:"auto",padding:12}}>
      <div style={{fontSize:11,color:C.textMute,marginBottom:12}}>Apply command burst bonuses from a fleet support ship fit. Bursts use the source fit's modules, charges, and active state.</div>
      {cmdFits.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"24px 0",fontSize:13}}>No command fits applied</div>}
      {cmdFits.map((f,i)=>{
        const srcFit=fitsDB[f.ship]?.find(x=>x.name===f.fitName);
        const bursts=srcFit?computeCommandBursts({name:f.ship,typeID:tidByName(f.ship)},srcFit.slots,SKILL_DEFAULTS,{implants:srcFit.implants,boosters:srcFit.boosters}):[];
        const on=f.active!==false;   // opt-out, see the projected tab
        return(<div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8,opacity:on?1:0.55}}>
          <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:8}}>
            <button title={on?"Applied to this fit":"Ignored"} onClick={()=>setCmdFits(cmdFits.map((p,j)=>j===i?{...p,active:!on}:p))}
              style={{width:24,height:24,borderRadius:5,flexShrink:0,background:on?C.accentLight:"none",border:`1px solid ${on?C.accentBorder:C.borderStrong}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,lineHeight:1,color:on?C.accent:""}}>{on?"✓":""}</button>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:on?C.text:C.textMid}}>{f.fitName}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{f.ship}</div></div>
            {onOpenFit&&<button title="Open this fit in a new tab" onClick={()=>onOpenFit(f.ship,f.fitName)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.textMid,cursor:"pointer",fontSize:10,fontWeight:700,padding:"4px 7px",flexShrink:0}}>Open</button>}
            <button onClick={()=>setCmdFits(cmdFits.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14,flexShrink:0}}>x</button>
          </div>
          {bursts.length===0&&<div style={{fontSize:11,color:C.textMute,paddingLeft:8}}>No active command bursts on this fit</div>}
          {bursts.map((b,j)=><div key={j} style={{fontSize:11,color:C.rig,paddingLeft:8,marginBottom:3}}>- {b.label}: {b.value>0?"+":""}{Math.round(b.value*10)/10}{WARFARE_BUFF_UNIT[b.buffID]||"%"}</div>)}
        </div>);
      })}
      <button className="press" onClick={()=>{haptic();setShowCmdPicker(true);}} style={{width:"100%",padding:"12px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer"}}>+ Add Command Fit</button>
      {showCmdPicker&&<FitPickerSheet title="Select Command Ship Fit" fitsDB={fitsDB} filterFn={hasCommandBursts} onSelect={(ship,fit)=>setCmdFits(prev=>[...prev,{ship,fitName:fit.name}])} onClose={()=>setShowCmdPicker(false)}/>}
    </div>)}
    </div>
    </div>
  </div>);
}
