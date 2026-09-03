import { useState } from "react";
import { C, DISPLAY } from "../theme.js";
import { eveIcon, eveRender } from "../lib/icons.js";
import { haptic, lookupShip, navIcons } from "../lib/core.js";
import { fitToEFT } from "../lib/eft-export.js";
import { PILOT_ALL_V, PILOT_ALPHA, esiPilot, profilePilot, describeSkillSheet } from "../lib/pilot.js";
import { SKILL_CATALOG } from "../calc.js";
import { useSheetDrag, sheetTransform, SheetGrabber, SHEET_EXIT_MS } from "../lib/use-sheet-drag.jsx";
import { MenuGlyph, IconPlus, IconImport, IconExport, IconSnapshot, IconPrice, IconFeedback, IconSettings } from "./glyphs.jsx";
import * as esi from "../lib/esi.js";
// The one copy of the app mark. Generated from assets/icon-only.png by scripts/build-icons.mjs, as
// is the favicon, so the header, the browser tab and the installed app icon cannot drift apart.
import appMark from "../assets/app-mark.png";

const EXPORT_PREFS_KEY = 'pyfa_export_prefs';

// Drawer menu labels. Uppercase via textTransform rather than in the strings, so the accessible name
// a screen reader announces stays "Import Fit" and not "IMPORT FIT". Caps need the letter-spacing to
// stay readable and they run wider, hence 12px against the 13px they were set at in sentence case.
const MENU_LABEL={...DISPLAY,fontSize:12,letterSpacing:"1px",textTransform:"uppercase"};

// Generic "pick a method, then we open the real sheet" bottom sheet — used by the hamburger menu's
// combined Import/Export entries so the menu itself doesn't need one row per method (EFT vs ESI).
export function ChooserSheet({title, options, onClose}) {
  const sheet=useSheetDrag(onClose);
  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'flex-end'}} onClick={sheet.dismiss}>
      <div ref={sheet.sheetRef} style={{width:'100%',boxSizing:'border-box',background:C.surface,borderRadius:'16px 16px 0 0',padding:'4px 20px 20px',boxShadow:'0 -8px 32px rgba(0,0,0,.5)',...sheetTransform(sheet)}} onClick={e=>e.stopPropagation()}>
        <SheetGrabber grabHandlers={sheet.grabHandlers} style={{margin:'0 -20px'}}/>
        <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:14}}>{title}</div>
        {options.map(opt=>(
          <button key={opt.label} onClick={opt.onSelect} style={{display:'flex',alignItems:'center',gap:12,width:'100%',textAlign:'left',padding:'14px 12px',background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,marginBottom:8,cursor:'pointer'}}>
            <MenuGlyph icon={opt.icon}/>
            <div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{opt.label}</div><div style={{fontSize:11,color:C.textMute,marginTop:1}}>{opt.sub}</div></div>
          </button>
        ))}
        <button onClick={sheet.dismiss} style={{width:'100%',marginTop:4,padding:10,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.textMute,fontSize:13,cursor:'pointer'}}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ExportFitModal({activeFit, slots, implants, boosters, drones, fighters, cargo, onClose}) {
  const sheet=useSheetDrag(onClose);
  const _lsGet=()=>{try{return JSON.parse(localStorage.getItem(EXPORT_PREFS_KEY)||'{}');}catch{return {};}};
  const _p=_lsGet();
  const [incCharges,  setIncCharges]  = useState(_p.charges  ?? true);
  const [incImplants, setIncImplants] = useState(_p.implants ?? true);
  const [incBoosters, setIncBoosters] = useState(_p.boosters ?? true);
  const [incCargo,    setIncCargo]    = useState(_p.cargo    ?? false);
  const [incMutations,setIncMutations]= useState(_p.mutations ?? true);
  // Off by default: the fences are for pasting into Discord, and anything else that takes an EFT
  // block (the in-game fitting window, pyfa, this app's own importer) would choke on them.
  const [codeBlock,   setCodeBlock]   = useState(_p.codeBlock ?? false);
  const [copied,      setCopied]      = useState(false);

  const genEFT = () => fitToEFT(
    {ship: activeFit?.ship ?? 'Unknown', name: activeFit?.fitName ?? 'Unnamed',
     slots, implants, boosters, drones, fighters, cargo},
    {charges: incCharges, implants: incImplants, boosters: incBoosters,
     cargo: incCargo, mutations: incMutations});

  const doExport = () => {
    try { localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify({charges:incCharges,implants:incImplants,boosters:incBoosters,cargo:incCargo,mutations:incMutations,codeBlock})); } catch(e) {}
    // Discord needs the fences on their own lines. fitToEFT ends without a trailing newline, so the
    // closing one goes straight on — an extra blank line here would show up inside the rendered box.
    const txt = codeBlock ? "```\n" + genEFT() + "\n```" : genEFT();
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
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'flex-end'}} onClick={sheet.dismiss}>
      <div ref={sheet.sheetRef} style={{width:'100%',boxSizing:'border-box',background:C.surface,borderRadius:'16px 16px 0 0',padding:'4px 20px 20px',boxShadow:'0 -8px 32px rgba(0,0,0,.5)',...sheetTransform(sheet)}} onClick={e=>e.stopPropagation()}>
        <SheetGrabber grabHandlers={sheet.grabHandlers} style={{margin:'0 -20px'}}/>
        <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:4}}>Export EFT Fit</div>
        <div style={{fontSize:11,color:C.textMute,marginBottom:16}}>Select what to include in the exported fit text</div>
        <CheckRow label="Loaded Charges (e.g. Hail L)" val={incCharges} setVal={setIncCharges}/>
        <CheckRow label="Implants" val={incImplants} setVal={setIncImplants}/>
        <CheckRow label="Boosters" val={incBoosters} setVal={setIncBoosters}/>
        <CheckRow label="Cargo" val={incCargo} setVal={setIncCargo}/>
        <CheckRow label="Abyssal Rolls (mutated modules)" val={incMutations} setVal={setIncMutations}/>
        {/* Separated from the five above because it is not the same kind of choice: those pick what
            goes in the fit, this changes how the text is wrapped for one destination. */}
        <div style={{fontSize:11,color:C.textMute,margin:'16px 0 0'}}>Formatting</div>
        <CheckRow label="Wrap in a code block (for Discord)" val={codeBlock} setVal={setCodeBlock}/>
        <button onClick={doExport} style={{width:'100%',marginTop:16,padding:'14px',borderRadius:10,border:'none',background:copied?C.rig:C.accent,color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer'}}>
          {copied ? '✓ Copied to clipboard!' : 'Copy EFT to Clipboard'}
        </button>
        <button onClick={sheet.dismiss} style={{width:'100%',marginTop:8,padding:'10px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.textMute,fontSize:13,cursor:'pointer'}}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Kept in step with the .22s on .vv-drawer-in / .vv-scrim-in in GLOBAL_CSS.
const DRAWER_MS=220;

// "New Fit" leads, and is the only entry that starts something rather than acting on what is
// already open — so it gets the accent treatment instead of blending into the list. It routes to
// the ship browser rather than creating a fit outright: a fit needs a hull, and the menu is
// reachable from tabs where no hull is selected.
export function HamburgerMenu({onClose,onOpenSettings,onImport,onExport,onSnapshot,onFeedback,onOptimizePrice,onNewFit}){
  // Close is DEFERRED so the drawer can slide back out — the caller unmounts us the moment onClose
  // runs. The picked item's own action is deferred with it rather than fired immediately: most of
  // these open a sheet or a full-screen overlay, and doing that first puts it on screen behind a
  // drawer that is still moving.
  const [closing,setClosing]=useState(false);
  const dismiss=(then)=>{ if(closing)return; setClosing(true); setTimeout(()=>{then?.();onClose();},DRAWER_MS); };
  return(<div style={{position:"fixed",inset:0,zIndex:90}} onClick={()=>dismiss()}>
    {/* The drawer used to slide over undimmed content, which left the app behind it looking live
        and tappable when it isn't. The scrim also gives the exit something to do besides the panel
        itself, so closing reads as one movement rather than a slide plus a cut. */}
    <div className={closing?undefined:"vv-scrim-in"}
         style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)",opacity:closing?0:1,transition:`opacity ${DRAWER_MS}ms ease`}}/>
    <div className={closing?undefined:"vv-drawer-in"}
         style={{position:"absolute",top:0,left:0,bottom:0,width:260,background:C.surface,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",boxShadow:"4px 0 24px rgba(0,0,0,.5)",overflowY:"auto",
                 transform:closing?"translateX(-100%)":"none",transition:`transform ${DRAWER_MS}ms cubic-bezier(.22,.61,.36,1)`}} onClick={e=>e.stopPropagation()}>
      {/* Same treatment as AppHeader: the drawer's surface runs to the physical top of the screen,
          but its title is inset past the status bar. Without this the wordmark sat under the iOS
          clock. env() is 0 on Android and the web, so the 20px is what those still get. */}
      <div style={{padding:"20px 16px 12px",paddingTop:"calc(20px + env(safe-area-inset-top, 0px))",borderBottom:`1px solid ${C.border}`}}><div style={{...DISPLAY,fontSize:19,fontWeight:700,letterSpacing:"1.6px",textTransform:"uppercase",color:C.text,marginBottom:2}}>Axis</div><div style={{fontSize:11,color:C.textMute}}>EVE Online Fitting Tool</div></div>
      <button onClick={()=>dismiss(onNewFit)} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:C.accentLight,border:"none",borderBottom:`1px solid ${C.border}`,cursor:"pointer",textAlign:"left",width:"100%"}}>
        <span style={{display:"flex",color:C.accent,flexShrink:0}}><IconPlus size={21}/></span>
        <div><div style={{...MENU_LABEL,fontWeight:700,color:C.accent}}>New Fit</div><div style={{fontSize:11,color:C.textMute,marginTop:1}}>Choose a hull</div></div>
      </button>
      {[{icon:IconImport,label:"Import Fit",sub:"From EFT or an EVE character",action:"import"},{icon:IconExport,label:"Export Fit",sub:"To clipboard or an EVE character",action:"export"},{icon:IconSnapshot,label:"Export Snapshot",sub:"Shareable image of the fit",action:"snapshot"},{icon:IconPrice,label:"Optimize Fit Price",sub:"Swap modules to reduce cost",action:"optimizePrice"},{icon:IconFeedback,label:"Send Feedback",sub:"Report a bug or suggest something",action:"feedback"},{icon:IconSettings,label:"Settings",sub:"ESI, market, overrides",action:"settings"}].map(item=>(<button key={item.label} onClick={()=>dismiss({import:onImport,export:onExport,snapshot:onSnapshot,optimizePrice:onOptimizePrice,feedback:onFeedback,settings:onOpenSettings}[item.action])} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:"none",border:"none",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${C.border}`}}><MenuGlyph icon={item.icon}/><div><div style={{...MENU_LABEL,fontWeight:600,color:C.text}}>{item.label}</div><div style={{fontSize:11,color:C.textMute,marginTop:1}}>{item.sub}</div></div></button>))}
    </div>
  </div>);
}

// Skill-requirement indicator: green book when the character meets every fitted item's required
// skills, red when not. Red is tappable and lists what's short. Hidden with no active fit, since
// there'd be nothing to check.
// Colour still answers "can this pilot fly it" (green/red); the button now also OPENS the pilot
// picker, which is why it is tappable even when everything is green — a fully-skilled fit is
// exactly when you might want to see it flown by an alpha instead.
function SkillBook({ok,count,onClick,custom}){
  const col=ok?C.success:C.danger;
  return(
    <button onClick={onClick}
      title={ok?"All skill requirements met — tap to change pilot":`${count} skill${count===1?"":"s"} insufficient — tap for details`}
      aria-label={ok?"Pilot: all skill requirements met":`Pilot: ${count} skills insufficient`}
      style={{position:"relative",width:34,height:34,borderRadius:9,background:`${col}1a`,
              border:`1px solid ${col}66`,display:"flex",alignItems:"center",justifyContent:"center",
              padding:0,cursor:"pointer",flexShrink:0}}>
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
      {/* A fit flown by someone other than you looks identical otherwise, and its numbers are not
          your numbers — that has to be visible without opening the sheet. Yields to the red count
          badge, which is the more urgent of the two. */}
      {ok&&custom&&<span style={{position:"absolute",top:-3,right:-3,width:8,height:8,borderRadius:99,
        background:C.accent,border:`1px solid ${C.surface}`}}/>}
    </button>
  );
}

// One control, two questions: WHO flies this fit, and what can't they use. They belong together —
// the gap list is only meaningful relative to a pilot, and picking a different one rewrites it.
// `pilot` is a string on the fit (lib/pilot.js): absent means "your skills", the app-wide sheet.
export function PilotSheet({pilot,setPilot,missing,appSkills,skillProfiles=[],onClose}){
  const sheet=useSheetDrag(onClose);
  const chars=(()=>{ try{ return esi.listCharacters(); }catch{ return []; } })();
  const cached=(()=>{ try{ return esi.getAllCharacterSkills(); }catch{ return {}; } })();
  const opts=[
    // "Your Skills" is the only option that doesn't say what you'd be flying with — the other rows
    // name a character or a ceiling. Naming the sheet here saves a trip to Settings to find out
    // whether it is still all V, still aligned to a pilot, or something you edited by hand.
    {id:null,label:`Your Skills (${describeSkillSheet(appSkills,{esiSkills:cached,characters:chars,profiles:skillProfiles})})`,
     sub:"The sheet in Settings → Skills"},
    {id:PILOT_ALL_V,label:"All V",sub:"Every skill trained to V"},
    {id:PILOT_ALPHA,label:"Alpha",sub:"CCP's alpha clone ceiling"},
    ...chars.map(c=>({
      id:esiPilot(c.characterId),
      label:c.characterName,
      // An ESI pilot that has never been synced has no sheet to fly with and falls back, so say so
      // rather than showing a character whose numbers are silently someone else's.
      sub:cached[String(c.characterId)]
        ? `${Object.values(cached[String(c.characterId)]).filter(v=>v>0).length} trained skills`
        : "Not synced — sync in Settings → ESI",
      stale:!cached[String(c.characterId)],
    })),
    // Saved sheets last: the rows above are ceilings and real characters, which are the answers most
    // fits want. A profile is a sheet the user built, so it is only meaningful once they have made one.
    ...skillProfiles.map(p=>({
      id:profilePilot(p.id),
      label:p.name,
      sub:`Saved profile — ${SKILL_CATALOG.filter(e=>(p.skills?.[e.key]??5)>0).length} trained skills`,
    })),
  ];
  const cur=pilot??null;
  return(
    <div onClick={sheet.dismiss} style={{position:"fixed",inset:0,zIndex:300,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
      <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.6)",opacity:sheet.closing?0:1,transition:`opacity ${SHEET_EXIT_MS}ms ease`}}/>
      {/* The safe-area inset is what every other sheet in the app pays (see ui.jsx's BottomSheet):
          without it the footer line sits under the home indicator on a modern iPhone. */}
      <div ref={sheet.sheetRef} onClick={e=>e.stopPropagation()} style={{position:"relative",width:"100%",maxWidth:430,margin:"0 auto",
           background:C.surface,borderRadius:"16px 16px 0 0",maxHeight:"80vh",display:"flex",flexDirection:"column",overflow:"hidden",
           paddingBottom:"env(safe-area-inset-bottom, 0px)",...sheetTransform(sheet)}}>
        <SheetGrabber grabHandlers={sheet.grabHandlers} style={{padding:"10px 0 0"}}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 16px 12px",borderBottom:`1px solid ${C.border}`}}>
          <span style={{fontSize:15,fontWeight:700,color:C.text}}>Pilot</span>
          <button onClick={sheet.dismiss} style={{background:"none",border:"none",color:C.textMid,fontSize:20,cursor:"pointer",padding:"0 4px"}}>×</button>
        </div>
        <div style={{overflowY:"auto"}}>
          {opts.map(o=>{
            const on=cur===o.id;
            return(<button key={o.id??"default"} onClick={()=>{haptic();setPilot(o.id);}}
              style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",padding:"11px 16px",
                      background:on?C.accentLight:"none",border:"none",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:on?800:600,color:on?C.accent:C.text}}>{o.label}</div>
                <div style={{fontSize:10,color:o.stale?C.warning:C.textMute,marginTop:2}}>{o.sub}</div>
              </div>
              {on&&<span style={{fontSize:13,fontWeight:800,color:C.accent,flexShrink:0}}>✓</span>}
            </button>);
          })}
          <div style={{padding:"10px 16px 4px",fontSize:11,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",
                       color:missing.length?C.danger:C.success}}>
            {missing.length?`${missing.length} skill${missing.length===1?"":"s"} insufficient`:"All skill requirements met"}
          </div>
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
          <div style={{height:10}}/>
        </div>
        <div style={{padding:"10px 16px 16px",borderTop:`1px solid ${C.border}`,fontSize:10,color:C.textMute}}>
          The pilot is saved with this fit. Skills you have never set count as level V.
        </div>
      </div>
    </div>
  );
}

export function AppHeader({onHamburger,activeFit,onShipInfo,skillCheck,onSkillGaps,pilot,collapsed}){
  const ship=activeFit?.ship?lookupShip(activeFit.ship):{};
  const shipName=activeFit?.ship??"Axis";
  const subLabel=ship.hullClass?`${ship.race??""} ${ship.hullClass}`.trim():"EVE Online Fitting Tool";
  // Restored to its original proportions -- the condensed version saved pixels but read as cramped
  // next to comparable apps. The space is reclaimed by COLLAPSING instead: `collapsed` is driven by
  // scrolling in App.jsx, and shrinks the header to a single compact line rather than shortening it
  // permanently. The background still runs to the physical top of the screen while the content is
  // inset by env(safe-area-inset-top), so the status bar sits on the header's own surface colour.
  return(<div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,
                      padding:collapsed?"0 14px 6px":"14px 14px 12px",
                      paddingTop:`calc(${collapsed?"6px":"14px"} + env(safe-area-inset-top, 0px))`,
                      transition:"padding .2s cubic-bezier(.22,.61,.36,1)"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
      <div style={{textAlign:"left",minWidth:0}}>
        {/* Uppercase by design -- it reads as a wordmark above the hull name. Hidden when collapsed:
            it is the least useful line once you are deep in a fit.
            Also hidden when NO fit is open, because the line below it falls back to "Axis" too —
            the eyebrow exists to label the hull name underneath it, and with no hull there is
            nothing to label, just the name printed twice. */}
        {activeFit?.ship&&
        <div style={{fontSize:10,fontWeight:700,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",
                     maxHeight:collapsed?0:20,opacity:collapsed?0:1,lineHeight:1.6,overflow:"hidden",marginBottom:collapsed?0:2,
                     transition:"max-height .2s ease, opacity .15s ease, margin-bottom .2s ease"}}>Axis</div>}
        {/* lineHeight 1.2 left the line box 1px shorter than the glyphs need, and `overflow:hidden`
            (there for the ellipsis) then shaved the descenders off names like Apocalypse. */}
        <div style={{...DISPLAY,fontSize:collapsed?15:19,fontWeight:600,letterSpacing:"-.1px",color:C.text,lineHeight:1.3,whiteSpace:"nowrap",
                     overflow:"hidden",textOverflow:"ellipsis",transition:"font-size .2s ease"}}>{shipName}</div>
        {/* `maxHeight` here is the COLLAPSE animation (18 -> 0), not a layout size — but with no
            explicit lineHeight this line inherited the body's 1.93, making its natural box 23.2px.
            Clamping that to 18 cut the bottom off every descender: "Caldari Battleship" lost the
            tail of its p. Pin the line height so the clamp is comfortably above it instead of
            slicing through the text. */}
        <div style={{fontSize:12,color:C.textMid,marginTop:1,lineHeight:1.4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                     maxHeight:collapsed?0:20,opacity:collapsed?0:1,
                     transition:"max-height .2s ease, opacity .15s ease"}}>{subLabel}</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {activeFit?.ship&&skillCheck&&
          <SkillBook ok={skillCheck.ok} count={skillCheck.missing.length} onClick={onSkillGaps} custom={!!pilot}/>}
        <button onClick={onShipInfo} style={{width:collapsed?34:52,height:collapsed?34:52,borderRadius:collapsed?8:11,transition:"width .2s ease, height .2s ease",background:C.surfaceAlt,border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",cursor:onShipInfo?'pointer':'default',padding:0}}>
          {ship.typeID
            ?<img src={eveRender(ship.typeID,64)} width={collapsed?34:52} height={collapsed?34:52} alt="" style={{borderRadius:collapsed?8:11}} onError={e=>{e.target.style.display="none";}}/>
            /* The app's own mark, standing in for a hull render that has not loaded (or a fit with
               no ship yet) — and it is THE SHIPPED ICON FILE, not a redrawing of it. A hand-drawn
               inline copy lived here once and silently fell out of step with the real icon; nothing
               catches that. Imported through Vite's asset pipeline (like lib/icons.js) so it is
               bundled and works offline.
               Sized to the BUTTON, not to an arbitrary 26px: a hull render fills the whole square,
               so a half-size glyph beside it read as a placeholder that had failed to load. The
               artwork is full-bleed, so the button's border-radius is what rounds it. */
            :<img src={appMark} width={collapsed?34:52} height={collapsed?34:52} alt=""
                  style={{borderRadius:collapsed?8:11,display:"block"}}/>
          }
        </button>
        {/* No surface or border: the button beside it is a hull PORTRAIT, and giving both the same
            square chrome made the menu read as a second image slot. The glyph carries itself at this
            size. The box keeps its dimensions even though nothing draws it — that is the tap target,
            and shrinking it to the glyph's ink would put a 24px control at the edge of the screen. */}
        <button onClick={onHamburger} style={{width:collapsed?32:40,height:collapsed?32:40,transition:"width .2s ease, height .2s ease, font-size .2s ease",background:"none",border:"none",padding:0,color:C.text,fontSize:collapsed?26:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>&#9776;</button>
      </div>
    </div>
  </div>);
}

// Strong Veilguard Booster (59633). This must be a real BOOSTER: the Effects tab covers boosters,
// not implants (that's its own tab), and it once pointed at typeID 3211 — an implant whose art
// merely looked the part.
//
// Veilguard rather than a better-known drug because the image server answers Exile/Drop/Crash/Blue
// Pill with the art of the "Pure" MANUFACTURING MATERIAL that builds them — a heap of loose ore, not
// the canister the client actually shows. Those 32 iconIDs are listed as IMAGE_SERVER_WRONG in
// fetch-art.mjs and bundled from pyfa instead, so Exile would render correctly today too; Veilguard
// is kept because it never depended on that workaround.
const BOOSTER_ICON=eveIcon(59633,64);

export function BottomNav({active,onChange,badges}){
  const tabs=[
    // `key` stays "fittings" — App.jsx switches on it and it is persisted as the last bottom tab.
    {key:"fittings",label:"Fitting",navKey:"fit"},
    {key:"cargo",   label:"Cargo",   navKey:"cargo"},
    {key:"drones",  label:"Drones",  navKey:"drones"},
    {key:"implants",label:"Implants",navKey:"implants"},
    {key:"effects", label:"Effects", navKey:"effects"},
  ];
  const NAV_ICON_TYPEIDS={fit:1353,cargo:1317,drones:24395,implants:10216};
  // The full inset is 34px on a notched iPhone, which left a visibly dead strip under the labels.
  // The home indicator itself only occupies the bottom ~20px, so trimming 14 still clears it;
  // max() keeps the result sane on devices whose inset is 0.
  return(<div style={{display:"flex",background:C.surface,borderTop:`1px solid ${C.border}`,paddingBottom:"max(4px, calc(env(safe-area-inset-bottom, 0px) - 14px))"}}>
    {tabs.map(t=>{const ovTid=NAV_ICON_TYPEIDS[t.navKey];const src=ovTid?eveIcon(ovTid,64):(navIcons?.[t.navKey]??'');const dim=active===t.key?1:0.5;
      const count=badges?.[t.key];
      return(<button key={t.key} onClick={()=>{haptic("selection");onChange(t.key);}} style={{flex:1,padding:"5px 0 4px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <div style={{position:"relative"}}>
        <img src={t.navKey==="effects"?BOOSTER_ICON:src} width={22} height={22} alt="" style={{objectFit:"contain",opacity:dim}} onError={e=>{e.target.style.visibility="hidden";}}/>
        {/* Pyfa-style: a count only shows for things currently switched ON (or, for cargo/implants,
            simply present — neither has an on/off state to filter by). Zero hides the badge rather
            than showing "0", so an idle tab stays visually quiet. */}
        {count>0&&<span style={{position:"absolute",top:-4,right:-8,minWidth:14,height:14,padding:"0 3px",borderRadius:99,background:C.textMute,border:"none",color:C.surface,fontSize:9,fontWeight:800,lineHeight:"14px",textAlign:"center",boxSizing:"border-box"}}>{count>99?"99+":count}</span>}
      </div>
      <span style={{fontSize:9,fontWeight:700,color:active===t.key?C.accent:C.textMute,letterSpacing:.3}}>{t.label}</span>
      {active===t.key&&<div style={{width:20,height:2,background:C.accent,borderRadius:99,marginTop:1}}/>}
    </button>);})}
  </div>);
}
