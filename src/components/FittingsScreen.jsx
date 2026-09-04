import { useState, useRef, useMemo, useEffect } from "react";
import { buildShipTaxonomy, shipsUnder, nodeAtPath } from "../lib/ship-taxonomy.js";
import { nextFitId } from "../lib/fit-tabs.js";
import { useTabSwipe, slideClass } from "../lib/use-tab-swipe.js";
import { C, DISPLAY } from "../theme.js";
import { eveIcon, eveHeroRender, eveRender, eveRenderHi, prefetchRenderHi } from "../lib/icons.js";
import shipSmallIcon from "../assets/ship_small.png";
import { shipTraits, shipsByClass, raceIcons, generateEmptySlots, lookupShip, haptic } from "../lib/core.js";
import { isT3Cruiser, t3cSlotLayout } from "../calc.js";
import { TAG_PALETTE, MAX_TAG_LEN, normalizeTag, tagKey, tagsOf, hasTag, toggleTag,
         allTags, fitsWithTag, colorForTag, setTagColor, renameTag, removeTagEverywhere } from "../lib/fit-tags.js";
import { nameMatchesQuery, searchScore } from "../lib/jargon.js";
import { directionOf } from "../lib/compare.js";
import { FitTab, StatsTab } from "./tabs.jsx";
import { InfoButton, ItemPrice, ModifierBreakdown, ResistBars, SheetSearchBar, TraitsPanel, useVisualViewport } from "./ui.jsx";
import { GraphTab } from "./GraphTab.jsx";
import { useSheetDrag, sheetTransform, SheetGrabber, SHEET_EXIT_MS, dismissKeyboardOnScroll } from "../lib/use-sheet-drag.jsx";
import { IconPencil, IconCopy, IconClose, IconTag } from "./glyphs.jsx";

// Module scope on purpose: FittingsScreen reads this inside a useState initializer, which runs
// BEFORE a const declared later in the component body exists — the temporal dead zone would throw
// on first render, and no-undef cannot see it.
const _SUBTABS=["Fit","Stats","Graph"];
// Display only. These strings are also the persisted value of `axis_fit_subtab` and the keys
// useScrollMemory files each tab's scroll position under, so renaming them would silently reset
// both for everyone already using the app. The label is the only part that should ever move.
const _SUBTAB_LABEL={Fit:"Modules",Stats:"Stats",Graph:"Graph"};

// Transport-control arrows for the ship browser's header, borrowed from pyfa (and every media
// player) because the shapes read as "back" and "back to the start" without a label to explain them.
// Function, not a module-level const object: reads C.surface/C.border/C.accent, which must be
// resolved at each call (render time), not once at import time, to follow a live theme switch.
const _navBtn=()=>({width:36,height:36,borderRadius:8,background:C.surface,border:`1px solid ${C.border}`,
  color:C.accent,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0});
const BackArrow=()=>(<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M15.5 4.5 8 12l7.5 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
</svg>);
// The bar sits well clear of the chevron's tip: at a 4-unit gap the two shapes fused into a capital
// K at phone size, which is not a direction.
const BackToStartArrow=()=>(<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M19 4.5 11.5 12l7.5 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M4.5 4.5v15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
</svg>);

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

export function RecentFitsList({fitsDB, activeFit, loadFit, recents, act, tagColors}) {
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
        <FitRow key={`${ship}:${fit.id}`} ship={ship} fit={fit} act={act} tagColors={tagColors} showShip
          active={activeFit?.fitName===fit.name&&activeFit?.ship===ship}
          onOpen={()=>loadFit(ship, fit.name)}/>
      ))}
    </div>
  );
}

// A tag reads as a coloured pill. The tag's colour is the BORDER and the text, over a heavily
// transparent fill of the same colour, so eight palette entries stay legible on the dark surface —
// solid pills at this size turned the fit list into confetti and buried the fit names.
// `count` is its own prop and its own shape, never appended to the name. Concatenated ("t2 nano 5")
// it read as part of the tag — a tag called "t2 nano 5" is entirely plausible — and there is nothing
// for the eye to separate on, since a tag name can end in a number too. A badge answers "how many"
// by BEING a different object: its own pill, denser fill, smaller and dimmer than the name it
// follows, so the name stays the thing you read first.
export function TagChip({name, color, count, onClick, onRemove, dim}) {
  return (
    <span onClick={onClick} className={onClick?"press":undefined}
      style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:99,
              fontSize:10,fontWeight:700,lineHeight:1.5,whiteSpace:"nowrap",cursor:onClick?"pointer":"default",
              color:dim?C.textMute:color,background:dim?"transparent":`${color}1f`,
              border:`1px solid ${dim?C.border:`${color}59`}`}}>
      {name}
      {count!=null&&<span style={{fontSize:9,fontWeight:700,lineHeight:1.4,opacity:.8,padding:"0 5px",borderRadius:99,
        // The right padding is trimmed back because the chip's own 8px already sits outside this.
        marginRight:-3,background:dim?C.border:`${color}3d`}}>{count}</span>}
      {onRemove&&<span onClick={e=>{e.stopPropagation();onRemove();}} aria-label={`Remove tag ${name}`}
        style={{fontSize:12,lineHeight:1,opacity:.7,cursor:"pointer",paddingLeft:1}}>&times;</span>}
    </span>
  );
}

// Assign/unassign tags for ONE fit. Creating is folded into the same text input as searching, so a
// new tag costs one line of typing and no colour decision — the palette assigns itself, and
// recolouring lives in the tag's own view where it isn't in the way.
function TagSheet({fit, tagColors, allNames, onToggle, onClose}) {
  const sheet = useSheetDrag(onClose);
  const [draft, setDraft] = useState("");
  const mine = tagsOf(fit);
  const n = normalizeTag(draft);
  const others = allNames.filter(t=>!hasTag(fit,t)&&(!n||t.toLowerCase().includes(n.toLowerCase())));
  // Only offer to CREATE when the typed name isn't already a tag — otherwise the same name would
  // appear twice, once as "add existing" and once as "create new".
  const canCreate = !!n && !allNames.some(t=>tagKey(t)===tagKey(n));
  const commit = () => { if(canCreate){onToggle(n);setDraft("");} };
  // Sit in the strip the keyboard leaves visible, not on the layout viewport the keyboard does not
  // shrink — otherwise this sheet's whole point (a text field) opens underneath it. maxHeight goes
  // with it: 70vh is 70% of the FULL screen, which with the keyboard up is taller than the space
  // there is, so the field would scroll out of the sheet even once the sheet itself is in view.
  const vv = useVisualViewport();
  const frame = vv ? {top:0,height:vv.height,left:0,right:0} : {inset:0};
  return (
    <div onClick={sheet.dismiss} style={{position:"fixed",...frame,background:"rgba(0,0,0,.55)",zIndex:60,display:"flex",alignItems:"flex-end",
      opacity:sheet.closing?0:1,transition:`opacity ${SHEET_EXIT_MS}ms ease`}}>
      <div ref={sheet.sheetRef} onClick={e=>e.stopPropagation()} style={{width:"100%",boxSizing:"border-box",maxHeight:"70%",overflowY:"auto",background:C.surface,
        borderTop:`1px solid ${C.border}`,borderRadius:"14px 14px 0 0",padding:"2px 16px 22px",...sheetTransform(sheet)}}>
        <SheetGrabber grabHandlers={sheet.grabHandlers} style={{margin:"0 -16px",padding:"8px 0 10px"}}/>
        <div style={{display:"flex",alignItems:"center",marginBottom:2}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:15,fontWeight:700,color:C.text}}>Tags</div>
            <div style={{fontSize:11,color:C.textMute,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fit?.name}</div>
          </div>
          <button onClick={sheet.dismiss} style={{background:"none",border:"none",color:C.textMid,fontSize:20,cursor:"pointer",padding:"0 4px"}}>&times;</button>
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

// One saved fit, one row, one set of verbs — the ship's own fit list, the cross-hull search, a tag's
// fits and Recent Fits all render THE SAME object and now all render it the same way. Only the
// ship's own list used to carry rename/copy/delete; everywhere else a fit could be opened and
// nothing else, so clearing out a pile of throwaway "New Fit"s meant walking to each hull in turn
// to do it. Four near-identical row bodies is also how they drift: this one had picked up an active
// highlight the fit list never got, and the search row was printing a dangling "/" for a hull race
// it always set to "".
//
// `act` bundles the eight handlers rather than threading them through every call site — Recent Fits
// is a separate component and would otherwise forward all of them by hand.
function FitRow({ship, fit, active, act, tagColors, showShip, hideTag, onOpen}){
  const editing=act.editingFitId===fit.id;
  const btn=(border,color,bg)=>({width:36,height:36,borderRadius:6,background:bg??C.surfaceAlt,border,color,
    cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0,lineHeight:1});
  // A tag's own list already says which tag you are in; repeating it on all 30 rows is noise.
  const tags=tagsOf(fit).filter(t=>!hideTag||tagKey(t)!==tagKey(hideTag));
  return(<div style={{display:"flex",alignItems:"center",gap:8,padding:"12px 14px",background:active?C.accentLight:C.surface,
                      border:`1px solid ${active?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8}}>
    {showShip&&<img src={eveIcon(Object.values(shipsByClass||{}).flat().find(s=>s.name===ship)?.typeID,64)}
      style={{width:32,height:32,borderRadius:4,objectFit:"contain",background:"#1a1a2e",flexShrink:0}}
      onError={e=>{e.target.style.display="none";}} alt=""/>}
    <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>{if(!editing)onOpen();}}>
      {editing
        ?<input autoFocus value={act.editName} onChange={e=>act.setEditName(e.target.value)}
           onKeyDown={e=>{if(e.key==="Enter")act.saveRename(ship,fit.id);if(e.key==="Escape")act.setEditingFitId(null);}}
           onBlur={()=>act.saveRename(ship,fit.id)} onClick={e=>e.stopPropagation()}
           style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.accentBorder}`,borderRadius:6,
                   padding:"4px 8px",color:C.text,fontSize:13,fontWeight:600,boxSizing:"border-box"}}/>
        :<div style={{fontSize:13,fontWeight:600,color:active?C.accent:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fit.name}</div>
      }
      {/* One subtitle line, not two: a cross-hull list needs to name the ship, but a fourth line on
          top of name/modified/tags turns an 18-result search into a scroll. */}
      <div style={{fontSize:11,color:C.textMute,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
        {showShip?`${ship} · Modified ${fit.modified}`:`Modified ${fit.modified}`}</div>
      {/* Only the `+`/`+ Tag` chip opens the tag sheet — the row itself used to carry that onClick,
          which (being a block-level flex container) covered the row's full width, not just the chips
          in it, and ate taps meant for opening the fit. An existing tag is not itself clickable. */}
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
        {tags.map(t=><TagChip key={t} name={t} color={colorForTag(t,tagColors)}/>)}
        <TagChip name={tags.length?"+":"+ Tag"} color={C.textMid} dim
          onClick={e=>{e.stopPropagation();act.setTagSheet({ship,fitId:fit.id});}}/>
      </div>
    </div>
    <button onClick={e=>{e.stopPropagation();act.setEditingFitId(fit.id);act.setEditName(fit.name);}}
      title="Rename fit" aria-label={`Rename ${fit.name}`}
      style={btn(`1px solid ${editing?C.accentBorder:C.border}`,editing?C.accent:C.textMid,editing?C.accentLight:C.surfaceAlt)}>
      <IconPencil size={17}/></button>
    <button onClick={e=>{e.stopPropagation();act.openCopyOfFit(ship,fit.name);}}
      title="Open a copy" aria-label={`Open a copy of ${fit.name}`}
      style={btn(`1px solid ${C.border}`,C.textMid)}>
      <IconCopy size={17}/></button>
    {/* Deleting a fit is NOT undoable — the undo stack holds a fit's CONTENTS and is dropped the
        moment the active fit changes — so the confirm is the safety, and it stays even though the
        row now sits in lists you scroll past rather than navigate to deliberately. */}
    <button onClick={e=>{e.stopPropagation();if(window.confirm(`Delete fit "${fit.name}"?`)){haptic("medium");act.deleteFit(ship,fit);}}}
      title="Delete fit" aria-label={`Delete ${fit.name}`}
      style={btn("1px solid rgba(239,68,68,.25)",C.danger,"rgba(239,68,68,.08)")}>
      <IconClose size={17}/></button>
  </div>);
}

// The hull's art as the subject of its own sheet, the way the in-game show-info window does it.
//
// Two images, deliberately. The bundled render paints immediately and is the whole answer offline; the
// hero-sized one is fetched and cross-faded in only once it has DECODED, which is why the swap is done
// from an Image() rather than by pointing src at the network and hoping. Pointing src straight at it
// would blank the frame for as long as the fetch took and leave it blank forever on a plane.
//
// The bundled copy is the 256px hero set, NOT the 64px render the rest of the app labels things with.
// At the width of a phone, 64px upscales into visible pixels — the sheet spent its whole first frame
// looking broken, which is the opposite of what a placeholder is for.
function ShipHero({typeID, height, full, children}) {
  const bundled = eveHeroRender(typeID);
  const [hi, setHi] = useState(null);
  useEffect(() => {
    setHi(null);
    const url = eveRenderHi(typeID, 512);
    if (!url) return;
    let dead = false;
    const img = new Image();
    img.onload = () => { if (!dead) setHi(url); };
    img.src = url;
    return () => { dead = true; };
  }, [typeID]);

  // CCP's renders are square with the hull centred, and this frame is a wide band, so `cover` cropped
  // the nose and the engines off. Two copies of the same image instead: `contain` shows the whole hull,
  // and a blurred, over-scaled `cover` copy fills the side bands it leaves behind. The alternative was
  // letterboxing onto flat black, which reads as a broken image rather than a deliberate frame — these
  // renders are JPEGs on a nebula backdrop, not transparent cutouts, so there is no third option.
  //
  // The blur layer is scaled past the frame because a blur samples beyond its own edges and would
  // otherwise fade to transparent in a visible band down both sides.
  // The pair fades as one — the opacity lives on the wrapper so the sharp copy cannot arrive ahead of
  // its own backdrop.
  const img = (src) => (
    <div style={{position:'absolute',inset:0,opacity:1,transition:'opacity .35s ease'}}>
      <img src={src} alt="" aria-hidden="true"
           style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',
                   transform:'scale(1.2)',filter:'blur(22px) saturate(.75)',opacity:.6}}
           onError={e=>{e.target.style.opacity='0';}}/>
      <img src={src} alt="" aria-hidden="true"
           style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain',
                   objectPosition:'center 38%'}}
           onError={e=>{e.target.style.opacity='0';}}/>
    </div>
  );
  // Positioned OVER the sheet's scroll box rather than stacked above it, so that shrinking it changes
  // no layout at all. Laid out in the flow, every pixel the hero gave up was a pixel the scroll box
  // gained, which cut the scrollable distance by the same amount the scroll had just travelled — the
  // browser then clamped scrollTop back, the hero grew again, and the two flip-flopped forever. The
  // scroll box reserves the space with a fixed-height spacer instead.
  //
  // pointerEvents:none so a swipe that starts on the art still scrolls the content underneath; the
  // close button opts back in.
  return (
    <div style={{position:'absolute',top:0,left:0,right:0,height,zIndex:3,overflow:'hidden',
                 pointerEvents:'none',borderRadius:'16px 16px 0 0',background:'#05070b'}}>
      {/* The picture keeps its full size and the FRAME closes over it, rather than the picture being
          scaled down to fit — collapsing by scaling shrank the ship away from the sides and gave back
          the side bands the square sizing exists to avoid. It closes on the centre, so the band left
          at the end is the one the hull is actually in; anchored at the top it would collapse onto
          empty backdrop, because CCP centres the hull in the square. */}
      <div style={{position:'absolute',left:0,right:0,top:-(full-height)/2,height:full}}>
        {bundled && img(bundled)}
        {hi && img(hi)}
      </div>
      {/* Two scrims doing different jobs. The vertical one dissolves the picture into the sheet so
          there is no seam between art and UI; the corner one darkens only behind the title, because
          these backdrops range from near-black to a bright nebula and white text cannot survive the
          bright ones unaided. */}
      {/* Kept low and late now that the hull is shown whole: the old stops started fading at a third
          of the way down and washed out the middle of the ship. */}
      <div style={{position:'absolute',inset:0,background:
        `linear-gradient(to bottom, rgba(26,26,29,0) 64%, rgba(26,26,29,.55) 88%, ${C.surface} 100%)`}}/>
      <div style={{position:'absolute',inset:0,background:
        'linear-gradient(to top right, rgba(0,0,0,.6), rgba(0,0,0,.18) 45%, transparent 70%)'}}/>
      {children}
    </div>
  );
}

// What the hero shrinks to once the content is scrolled. Set by what has to stay legible — the name
// and the close button — not by a fraction of the full height.
const HERO_MIN = 78;
// The full height is the sheet's own WIDTH, because CCP's renders are square: at any other height the
// hull is either cropped or floating in side bands. Capped so that a squat window cannot hand the
// whole sheet to the picture and leave the tabs with nothing — the sheet itself stops at 92vh, and
// this reserves the tab strip plus a couple of rows underneath it. A phone is nowhere near that cap
// (390 wide against 844 tall), so on the device this is simply the full width.
const heroMaxFor = (width, vh) => Math.max(HERO_MIN, Math.round(Math.min(width, vh * 0.92 - 34 - 120)));

export function ShipInfoSheet({ship, cs, onClose}) {
  const [tab, setTab] = useState('traits');
  // Which attribute rows have their modifier breakdown expanded. Deliberately the only state here:
  // the traced twin is derived below rather than stored, so it cannot go stale against a recomputed
  // `cs` the way a useState copy would.
  const [openAttrs, setOpenAttrs] = useState(() => new Set());
  // Scroll-driven, so no CSS transition on the height: the pixels are already coming one frame at a
  // time and easing them would make the art lag the finger.
  const [scrollY, setScrollY] = useState(0);
  const scrollRef = useRef(null);
  // The handle was a painted pill with nothing behind it, so the × was the only way out. The gesture
  // lives in lib/use-sheet-drag, shared with every other sheet in the app — this used to be a second
  // copy of it, which is exactly the drift that module exists to stop.
  //
  // Its ref doubles as the measuring point for the hero: the art is sized off the SHEET rather than
  // window.innerWidth, so it stays square against the box it is actually in — the two agree today and
  // would stop agreeing the moment this sheet is ever inset.
  const sheet = useSheetDrag(onClose);
  const sheetRef = sheet.sheetRef;
  const [heroMax, setHeroMax] = useState(() => heroMaxFor(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const sync = () => setHeroMax(heroMaxFor(el.clientWidth, window.innerHeight));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A short tab leaves nothing to scroll, so a hero collapsed on the previous tab would have no way
  // back up. Reset both the container and our copy of its position whenever the content changes.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; setScrollY(0); }, [tab, ship?.typeID]);
  const collapse = Math.min(1, Math.max(0, scrollY) / Math.max(1, heroMax - HERO_MIN));
  const heroH = heroMax - (heroMax - HERO_MIN) * collapse;

  const traits = ship?.typeID ? ((shipTraits??{})[String(ship.typeID)] ?? {}) : {};
  const tabs = ['traits','description','attributes'];

  // lookupShip already computes these (ships.json for a listed hull, shipFromDogma's `rz` for one
  // that isn't) — BASE resonances, matching ItemInfoPanel's ResistBars and the ask to show the hull's
  // own numbers rather than whatever cs's skills/rigs currently do to them.
  const resistLayers = ship?.resists ? ['shield','armor','hull']
    .map(k => ({label:k[0].toUpperCase()+k.slice(1), ...ship.resists[k]})) : [];

  const _fmtKm = m => m >= 1000 ? `${(m/1000).toFixed(2)} km` : `${Math.round(m)} m`;
  // Two value columns when opened from a fit: what the hull actually IS right now, beside the bare
  // hull it started as. Same shape and same reading order as ItemInfoPanel's module columns, so the
  // hull's sheet does not have to be learned separately. Opened from the ship BROWSER there is no
  // fit, `cs` is absent, and it collapses back to the single column it has always been.
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  // `cur` stays null on any row the fit cannot answer AUTHORITATIVELY, and such a row prints one
  // number spanning both columns rather than repeating the base under a "Current" heading. That is
  // not fussiness: cs carries no fitted slot layout, and a T3 cruiser's subsystems genuinely change
  // the slot and hardpoint counts, so echoing the hull's numbers there would be quietly wrong on the
  // one class of ship where the question is worth asking.
  // The trailing key is the DOGMA attribute name, handed to directionOf — the same function the
  // module info panel and the Variations tab ask, so green means the same thing on a hull row as it
  // does one sheet away on a module row. Not a local high-is-good table: that is how the two drift.
  //
  // null where there is no honest answer, which paints the row plain — the slot and hardpoint counts,
  // which never carry a current value to compare against.
  const R = (label, base, cur, fmt, attr=null) => ({label, base:num(base), cur:num(cur), fmt, attr});
  const rnd = (v,p=1) => Math.round(v*10**p)/10**p;
  const F = {
    tf:  v=>`${rnd(v,2)} tf`,       mw:  v=>`${rnd(v,2)} MW`,   pts: v=>`${Math.round(v)} pts`,
    int: v=>`${Math.round(v)}`,     gj:  v=>`${Math.round(v)} GJ`,
    sec: v=>`${(v/1000).toFixed(1)} s`,                          km:  _fmtKm,
    mm:  v=>`${Math.round(v)} mm`,  pt:  v=>`${rnd(v)} points`,  ms:  v=>`${Math.round(v)} m/s`,
    agi: v=>`${rnd(v,4)}`,          au:  v=>`${v.toFixed(2)} AU/s`,
    m:   v=>`${rnd(v)} m`,          mkg: v=>`${(v/1e6).toFixed(2)}M kg`,
    hp:  v=>`${Math.round(v).toLocaleString()} HP`,
    m3:  v=>`${rnd(v)} m³`,         mbit:v=>`${rnd(v)} Mbit/s`,
  };
  const attrs = {
    fitting: [
      R('CPU Output', ship?.cpu, cs?.cpuTotal, F.tf, 'cpuOutput'),
      R('Powergrid Output', ship?.pg, cs?.pgTotal, F.mw, 'powerOutput'),
      R('Calibration', ship?.calibration, cs?.calTotal, F.pts, 'upgradeCapacity'),
      R('High Slots', ship?.hiSlots ?? ship?.highSlots, null, F.int),
      R('Mid Slots', ship?.medSlots ?? ship?.midSlots, null, F.int),
      R('Low Slots', ship?.lowSlots, null, F.int),
      R('Rig Slots', ship?.rigSlots, null, F.int),
      R('Turret Hardpoints', ship?.turrets, null, F.int),
      R('Launcher Hardpoints', ship?.launchers, null, F.int),
    ],
    capacitor: [
      R('Capacitor Capacity', ship?.capCapacity, cs?.capCapacity, F.gj, 'capacitorCapacity'),
      R('Recharge Time', ship?.capRechargeRate, cs?.capRechargeMs, F.sec, 'rechargeRate'),
    ],
    targeting: [
      // cs.targetRange is KM and the hull record's is METRES. Feeding both to one formatter without
      // converting would have read a 68 km lock range as 68 m — wrong by a factor of a thousand, and
      // plausible enough on a row already full of small numbers to go unnoticed.
      R('Max Target Range', ship?.targetRange, cs?.targetRange!=null?cs.targetRange*1000:null, F.km, 'maxTargetRange'),
      R('Scan Resolution', ship?.scanRes, cs?.scanRes, F.mm, 'scanResolution'),
      R('Max Locked Targets', ship?.maxTargets, cs?.maxTargets, F.int, 'maxLockedTargets'),
      // CCP has four separate strength attributes, one per sensor type, so the key is the hull's own
      // sensor rather than a fixed one. They all flag the same way, but a Radar hull asking about
      // scanGravimetricStrength is the kind of thing that silently starts returning null later.
      R(`${ship?.sensorType||'Sensor'} Sensor Strength`, ship?.sensorStrength, cs?.sensorStrength, F.pt,
        ship?.sensorType ? `scan${ship.sensorType}Strength` : null),
    ],
    navigation: [
      R('Max Velocity', ship?.maxVelocity, cs?.maxVelocity, F.ms, 'maxVelocity'),
      R('Agility', ship?.agility, cs?.agility, F.agi, 'agility'),
      R('Warp Speed', ship?.warpSpeed, cs?.warpSpeed, F.au, 'warpSpeedMultiplier'),
      R('Signature Radius', ship?.sigRadius, cs?.sigRadius, F.m, 'signatureRadius'),
      R('Mass', ship?.mass, cs?.mass, F.mkg, 'mass'),
    ],
    structure: [
      R('Shield HP', ship?.shieldHP, cs?.shieldHP, F.hp, 'shieldCapacity'),
      R('Armor HP', ship?.armorHP, cs?.armorHP, F.hp, 'armorHP'),
      R('Hull HP', ship?.hullHP, cs?.hullHP, F.hp, 'hp'),
      R('Drone Bay', ship?.droneBay, cs?.droneBay, F.m3, 'droneCapacity'),
      R('Drone Bandwidth', ship?.droneBandwidth ?? ship?.droneBW, cs?.droneBandwidth, F.mbit, 'droneBandwidth'),
    ],
  };
  const twoCol = !!cs;
  const GRID = twoCol ? '1fr auto auto' : '1fr auto';

  // ── Modifier breakdowns for the hull's own attributes ─────────────────────
  //
  // Unlike a module's info panel, most rows on this tab print a stat calc.js DERIVED rather than the
  // engine attribute itself — lock range in km where the engine holds metres, an AU/s warp speed
  // where the engine holds a multiplier. Handing such a row to the engine's breakdown would explain
  // a different number than the one printed beside it.
  //
  // So the gate is: render the engine's value through the ROW'S OWN formatter and require the exact
  // string the row is already showing. If it renders identically it IS that number, whatever route
  // calc.js took to it; if the row is a different quantity the strings diverge immediately (a warp
  // speed of "3.00 AU/s" against a multiplier's "1.00 AU/s"), and no breakdown is offered. That is a
  // property each row proves about itself, rather than a hand-kept list of the safe ones — which
  // would be the thing that silently rots the next time calc.js changes how a stat is derived.
  //
  // Note this reads the UNTRACED hull, which is already computed. Deciding whether to show the ▶
  // must not itself cost the traced recompute the whole design exists to defer.
  const shipEng = cs?.fittedShip ?? null;
  const explainable = (r, changed) => {
    if (!changed || !r.attr || !shipEng?._retrace) return false;
    const eng = shipEng.attrs?.get?.(r.attr);
    if (typeof eng !== 'number' || !isFinite(eng)) return false;
    try { return r.fmt(eng) === r.fmt(r.cur); } catch { return false; }
  };
  // Pulled during render rather than held in state: calc.js memoises the traced pass per stats
  // object, so this costs one recompute however many rows are open, and it re-derives for free if a
  // new `cs` arrives while the sheet is up.
  const traced = openAttrs.size && shipEng?._retrace ? shipEng._retrace() : null;
  const toggleAttr = (k) =>
    setOpenAttrs(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',flexDirection:'column'}}
         onClick={sheet.dismiss}>
      <div style={{flex:1,background:'rgba(0,0,0,.5)',opacity:sheet.closing?0:1,transition:`opacity ${SHEET_EXIT_MS}ms ease`}}/>
      {/* Taller than the usual sheet because the art is the point of it — and the cap has to clear
          HERO_MAX plus the tab strip, or the picture is paying for the extra height without showing
          any more of the ship. */}
      <div ref={sheetRef}
           style={{position:'relative',background:C.surface,borderRadius:'16px 16px 0 0',maxHeight:'92vh',
                   display:'flex',flexDirection:'column',boxShadow:'0 -8px 32px rgba(0,0,0,.5)',
                   ...sheetTransform(sheet)}}
           onClick={e=>e.stopPropagation()}>
        <ShipHero typeID={ship?.typeID} height={heroH} full={heroMax}>
          {/* The grab handle moves onto the art rather than sitting above it — the sheet has no
              header bar left to hold it, and the picture goes all the way to the top edge. It opts
              back into the pointer events the hero as a whole declines, and reaches well below the
              pill so there is something to actually hit. */}
          <SheetGrabber grabHandlers={sheet.grabHandlers} onArt
                        style={{position:'absolute',top:0,left:0,right:0,padding:'8px 0 16px',pointerEvents:'auto'}}/>
          {/* Close sits on its own scrim: over a bright nebula a bare glyph disappears. */}
          <button onClick={sheet.dismiss} aria-label="Close"
            style={{position:'absolute',top:10,right:10,width:30,height:30,borderRadius:15,border:'none',
                    cursor:'pointer',color:'#fff',fontSize:18,lineHeight:1,pointerEvents:'auto',
                    background:'rgba(0,0,0,.42)',backdropFilter:'blur(6px)'}}>×</button>
          <div style={{position:'absolute',left:16,right:16,bottom:10}}>
            {/* Faction and class, in the eyebrow-over-name order the snapshot card already uses, so a
                hull introduces itself the same way wherever you meet it. hullClass is CCP's own group
                name via lookupShip — ships.json's is wrong on 64 hulls.
                It gives up its height as well as its opacity on collapse: fading it in place would
                leave the name floating over a blank strip. */}
            {/* lineHeight stated rather than inherited: the box is sized in pixels to collapse it, and
                the app's inherited line-height is taller than that box, so the descender row of the
                capitals was being clipped off. */}
            <div style={{fontSize:10,lineHeight:'14px',letterSpacing:'.5px',fontWeight:700,
                         textTransform:'uppercase',color:C.accent,textShadow:'0 1px 3px rgba(0,0,0,.8)',
                         opacity:1-collapse,height:(1-collapse)*14,overflow:'hidden',
                         whiteSpace:'nowrap',textOverflow:'ellipsis'}}>
              {[ship?.race, ship?.hullClass ?? ship?.groupName].filter(Boolean).join(' • ')}
            </div>
            {/* Shrinks toward a header-bar-sized title rather than scrolling away, so the collapsed
                hero still says which ship you are reading about. */}
            <div style={{...DISPLAY,fontSize:26-collapse*9,fontWeight:600,letterSpacing:'-.01em',lineHeight:1.1,
                         color:'#fff',textTransform:'uppercase',textShadow:'0 2px 10px rgba(0,0,0,.75)',
                         whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              {ship?.name}
            </div>
          </div>
        </ShipHero>
        {/* minHeight:0 because a flex child will not shrink below its content by default, which would
            let the sheet grow past its own cap instead of this box scrolling — and the hero collapse
            is driven entirely by this box's scrollTop. */}
        <div ref={scrollRef} onScroll={e=>setScrollY(e.currentTarget.scrollTop)}
             style={{flex:1,minHeight:0,overflowY:'auto'}}>
          {/* The hero's reserved space. Fixed at the hero's FULL height while the hero itself shrinks,
              which is what keeps the scrollable distance constant — see the note on ShipHero. */}
          <div style={{height:heroMax}}/>
          {/* Sticks at exactly the hero's collapsed height, so the two arrive together: the strip stops
              travelling on the same pixel the art stops shrinking. */}
          <div style={{position:'sticky',top:HERO_MIN,zIndex:2,display:'flex',background:C.surface,
                       borderBottom:`1px solid ${C.border}`}}>
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
        {/* The bottom inset is on the SCROLLED content, not the sheet: this sheet is hand-rolled and
            sits flush on the bottom edge, so without it the last line of a description ends up under
            the home indicator and inside the screen's curved corners. Padding here scrolls with the
            content, so that line can be brought clear rather than merely being given a smaller box. */}
        <div style={{padding:'14px 16px calc(28px + env(safe-area-inset-bottom, 0px))'}}>
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
              <ItemPrice typeID={ship?.typeID}/>
              {resistLayers.length>0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.textMute,textTransform:'uppercase',
                    letterSpacing:.5,marginBottom:8}}>Base Resistances</div>
                  <ResistBars layers={resistLayers}/>
                </div>
              )}
              {twoCol && (
                <div style={{display:'grid',gridTemplateColumns:GRID,gap:10,paddingBottom:6}}>
                  <span/>
                  {['Current','Base'].map(h=>(<span key={h} style={{fontSize:10,fontWeight:700,color:C.textMute,
                    textAlign:'right',textTransform:'uppercase',letterSpacing:.5}}>{h}</span>))}
                </div>
              )}
              {Object.entries(attrs).map(([section, rows]) => {
                const shown = rows.filter(r => r.base != null || r.cur != null);
                if (!shown.length) return null;
                return (
                <div key={section} style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.textMute,textTransform:'uppercase',
                    letterSpacing:.5,marginBottom:8}}>{section}</div>
                  {shown.map(r => {
                    const val = r.cur ?? r.base;
                    // Relative, for the reason ItemInfoPanel gives: the engine multiplies through
                    // several pools, so an untouched attribute can come back a few ULP off its base.
                    const changed = twoCol && r.cur != null && r.base != null
                      && Math.abs(r.cur - r.base) > Math.abs(r.base) * 1e-9 + 1e-12;
                    // The arrow says which WAY the fit moved the number; the COLOUR says whether that
                    // is an improvement, and on half these rows the two disagree — a smaller
                    // signature and a bigger shield buffer are both wins. Green/red comes from
                    // directionOf, the same function the module info panel and the Variations tab
                    // ask, so the colour cannot come to mean one thing on a hull row and another on
                    // a module row one tap away. A row with no honest direction stays plain (see R).
                    const dir = changed ? Math.sign(r.cur - r.base) : 0;
                    const better = changed && r.attr ? directionOf(r.attr, r.cur, r.base, ship?.typeID) : null;
                    const valColor = better == null ? C.text : (better ? C.rig : C.danger);
                    // Only a CHANGED row has anything to explain, so the highlight band doubles as
                    // the affordance — exactly as it does on a module's info panel one tap away.
                    const tappable = explainable(r, changed);
                    const isOpen = tappable && openAttrs.has(r.attr);
                    // A changed row widens by this panel's own 16px inset and gives it straight back
                    // as padding, so the band reaches the screen edges while the columns do not move.
                    // The scroll box above has no padding of its own, so -16 lands exactly on its
                    // edge and creates no overflow.
                    return (
                    <div key={r.label}>
                    <div onClick={tappable?()=>toggleAttr(r.attr):undefined}
                      role={tappable?'button':undefined} tabIndex={tappable?0:undefined}
                      aria-expanded={tappable?isOpen:undefined}
                      style={{display:'grid',gridTemplateColumns:GRID,gap:10,alignItems:'baseline',
                      padding:changed?'5px 16px':'5px 0',margin:changed?'0 -16px':0,
                      borderBottom:isOpen?'none':`1px solid ${C.border}`,
                      cursor:tappable?'pointer':'default',
                      background:changed?C.accentLight:'transparent'}}>
                      <span style={{fontSize:12,color:C.textMid,minWidth:0,wordBreak:'break-word'}}>
                        {r.label}
                        {tappable&&<span style={{display:'inline-block',fontSize:8,marginLeft:5,color:C.textMute,
                                                 transform:isOpen?'rotate(90deg)':'none'}}>▶</span>}
                      </span>
                      <span style={{fontSize:12,fontWeight:600,color:valColor,textAlign:'right',
                        fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',
                        ...(twoCol&&r.cur==null?{gridColumn:'2 / span 2'}:{})}}>
                        {dir!==0&&<span style={{fontSize:7,verticalAlign:1,marginRight:3}}>{dir>0?'▲':'▼'}</span>}
                        {r.fmt(val)}
                      </span>
                      {twoCol&&r.cur!=null&&<span style={{fontSize:12,textAlign:'right',fontVariantNumeric:'tabular-nums',
                        whiteSpace:'nowrap',color:changed?C.textMid:C.textMute}}>
                        {r.base!=null?r.fmt(r.base):'—'}</span>}
                    </div>
                    {/* The row's own formatter, so the breakdown states mass in the millions of kg
                        the row above it uses rather than the info panel's default rendering. */}
                    {isOpen&&<ModifierBreakdown attr={r.attr} ex={traced?.attrs?.explain(r.attr)}
                                                bleed={16} fmt={r.fmt}/>}
                    </div>);
                  })}
                </div>);
              })}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

export function FittingsScreen({recents,undo,undoDepth,activeFit,setActiveFit,loadFit,deleteFit,view,setView,fitsDB,setFitsDB,slots,setSlots,setDrones,setFighters,fighters,setCargoItems,setImplants,setBoosters,setProjFits,setCmdFits,skills,sourceSkills,openFitTabs,implants,boosters,drones,factorInReload,setFactorInReload,externalBursts,projectedReps,projectedEffects,dmgProfile,setDmgProfile,tgtProfile,setTgtProfile,priceHub,setPriceHub,newFitIntent,setNewFitIntent,autoFillHardpoints}){
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
  // Fetch the hero render for every hull you have a fit open on, so its info sheet opens sharp instead
  // of upscaling the 64px bundled copy while the network catches up. These are the hulls most likely to
  // be asked about, and openFitTabs is a handful of entries.
  // The names are remembered separately from the images: openFitTabs is rebuilt every render, and
  // lookupShip scans the whole ship list, so without this the scan would run on every keystroke.
  const _warmedHulls=useRef(new Set());
  useEffect(()=>{
    for(const t of openFitTabs??[]){
      if(!t?.ship||_warmedHulls.current.has(t.ship))continue;
      _warmedHulls.current.add(t.ship);
      prefetchRenderHi(lookupShip(t.ship)?.typeID);
    }
  },[openFitTabs]);
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

  // Hulls match on initials as well as substring, so "ONI" finds Omen Navy Issue (and Osprey Navy
  // Issue) the way a player would actually type it. Fit names and tags stay substring-only: those
  // are user-authored, and inferring an initialism from someone's own naming is a guess.
  //
  // Results are then ranked rather than left in hull-iteration order — an exact or prefix hit
  // belongs above an incidental one, and without this "raven" led with Raven Navy Issue.
  const searchResults=search.trim().length>1?(()=>{
    const q=search.toLowerCase(),results=[];
    Object.entries(shipsByClass||{}).forEach(([cls,ships])=>{
      ships.forEach(s=>{
        // `race` went with the dangling "Rifter / Frigate /" the row used to print: it was set to ""
        // at every call site and had been for as long as the field existed.
        if(nameMatchesQuery(s.name,search))results.push({type:"ship",ship:s.name,hull:cls,color:C.rig,_rank:s.name});
        // Tag names are searched alongside fit names, so typing a doctrine finds its fits without
        // having to go via the tag list first.
        (fitsDB[s.name]||[]).forEach(fit=>{
          const tags=tagsOf(fit);
          if(fit.name.toLowerCase().includes(q)||tags.some(t=>t.toLowerCase().includes(q)))
            // fitId, not just the name: a result row can rename and DELETE now, and both match on
            // id. Names are not unique — "New Fit" is the default, which is exactly the pile
            // someone opens this list to clear out — so acting by name would take the wrong one.
            // Nothing else about the fit is carried: the row re-resolves it from fitsDB and renders
            // live, so a copy here would only be a second version of the truth going stale.
            results.push({type:"fit",ship:s.name,fitId:fit.id,_rank:fit.name});
        });
      });
    });
    return results
      .map((r,i)=>({r,i,s:searchScore(r._rank,search)}))
      .sort((a,b)=>b.s-a.s||a.r._rank.length-b.r._rank.length||a.i-b.i)
      .map(x=>x.r);
  })():null;

  // Same sheet the ship image in the fit header opens. Shared by the browse and fits views, which
  // are separate `return`s — hence one element reused rather than two copies. lookupShip resolves
  // the full record (cpu/pg/slots) that the Attributes tab needs.
  const shipInfoSheet=infoShip
    ? <ShipInfoSheet ship={lookupShip(infoShip)??{name:infoShip}} onClose={()=>setInfoShip(null)}/>
    : null;

  // Everything a FitRow can do, in one object, so the four lists that render one stay identical by
  // construction rather than by four people remembering to update four copies.
  const fitRowAct={editingFitId,setEditingFitId,editName,setEditName,saveRename,openCopyOfFit,deleteFit,setTagSheet};

  // The tag sheet used to be rendered only by the ship's fit list, because that was the only list
  // whose rows could open it. Now every list can, so it is built once here and dropped into each
  // view's return. Re-resolved from fitsDB every render rather than captured when the sheet opened,
  // so the chips update as you toggle instead of showing the state the fit was in on the first tap.
  const tagSheetEl=tagSheet?(()=>{
    const f=(fitsDB[tagSheet.ship]||[]).find(x=>x.id===tagSheet.fitId);
    if(!f)return null;
    return <TagSheet fit={f} tagColors={tagColors} allNames={tagNames}
      onToggle={name=>applyTagToggle(tagSheet.ship,tagSheet.fitId,name)} onClose={()=>setTagSheet(null)}/>;
  })():null;

  // Derived from the dogma bundle, so it costs one pass over ~440 hulls and never changes after.
  const shipTree=useMemo(()=>buildShipTaxonomy(),[]);
  const browseNode=browsePath.length?nodeAtPath(shipTree,browsePath):null;
  // nodeAtPath returns null if a stale path survives a bundle change; fall back to the root rather
  // than rendering nothing.
  const browseKids=browsePath.length?(browseNode?.children??null):shipTree;
  const browseShips=browseNode?.ships??null;
  const enterNode=label=>{setBrowsePath(p=>[...p,label]);haptic("light");};
  const leaveNode=()=>{setBrowsePath(p=>p.slice(0,-1));haptic("light");};
  const resetNode=()=>{setBrowsePath([]);haptic("light");};

  if(view==="browse")return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    {browsePath.length>0&&(
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        {/* pyfa's order, back-to-start first. One level down it would do exactly what Back does,
            so it only earns its space deeper in. */}
        {browsePath.length>1&&(
          <button onClick={resetNode} className="press" aria-label="Back to all ships" title="All ships" style={_navBtn()}><BackToStartArrow/></button>
        )}
        <button onClick={leaveNode} className="press" aria-label="Back one level" title="Back one level" style={_navBtn()}><BackArrow/></button>
        <img src={(raceIcons??{})[String(browseNode?.raceID)]??shipSmallIcon} style={{width:18,height:18,flexShrink:0,objectFit:"contain"}} alt=""/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:14,fontWeight:700,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{browsePath[browsePath.length-1]}</div>
          {browsePath.length>1&&<div style={{fontSize:10,color:C.textMute,marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{browsePath.slice(0,-1).join(" / ")}</div>}
        </div>
      </div>
    )}
    <div style={{padding:"8px 10px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
      <SheetSearchBar value={search} onChange={setSearch} placeholder="Search ships or fit names..."/>
    </div>
    <div onScroll={dismissKeyboardOnScroll} style={{flex:1,overflowY:"auto",padding:"8px 10px"}}>
      {!search&&browsePath.length===0&&<RecentFitsList fitsDB={fitsDB} activeFit={activeFit} loadFit={loadFit} recents={recents} act={fitRowAct} tagColors={tagColors}/>}
      {/* The cross-hull axis. Chips rather than rows because a doctrine list is short and scanned by
          colour, and rows would push the ship classes below the fold the way Recent Fits used to.
          Hidden entirely until something is tagged — an empty section is just chrome. */}
      {!search&&browsePath.length===0&&tagList.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:C.textMute,textTransform:"uppercase",letterSpacing:.5,padding:"4px 0",marginBottom:6}}>Tags</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {tagList.map(t=>(
              <TagChip key={t.key} name={t.name} count={t.count} color={colorForTag(t.name,tagColors)}
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
        {searchResults.map((rr,i)=>{
          // A fit result IS a fit, so it gets the fit row — the whole point of searching across
          // hulls is to act on what you find without navigating to it first. Resolved from fitsDB
          // rather than rendered from the result: the result is a snapshot of a search, and by the
          // time you tap, the row above it may already have been deleted.
          if(rr.type==="fit"){
            const f=(fitsDB[rr.ship]||[]).find(x=>x.id===rr.fitId);
            if(!f)return null;
            return <FitRow key={`fit:${rr.ship}:${rr.fitId}`} ship={rr.ship} fit={f} act={fitRowAct}
              tagColors={tagColors} showShip
              active={activeFit?.ship===rr.ship&&activeFit?.fitName===f.name}
              onOpen={()=>{setSelectedShip(rr.ship);setView("active");loadFit(rr.ship,f.name);}}/>;
          }
          // A ship result navigates to a hull rather than acting on a saved thing, so it keeps its
          // own compact row.
          return(<div key={`ship:${rr.ship}:${i}`} onClick={()=>{if(newFitIntent){setNewFitIntent?.(false);createNewFit(rr.ship);return;}setSelectedShip(rr.ship);setView("fits");}} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:4,cursor:"pointer"}}>
            <img src={eveIcon((Object.values(shipsByClass||{}).flat().find(s=>s.name===rr.ship)||{}).typeID,32)} style={{width:28,height:28,borderRadius:4,objectFit:'contain',background:'#1a1a2e',flexShrink:0}} onError={e=>{e.target.style.background=rr.color;e.target.style.display='block';}} alt=""/>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{rr.ship}</div><div style={{fontSize:10,color:C.textMute,marginTop:1}}>{rr.hull}</div></div>
            <span style={{fontSize:10,color:C.textMute,background:C.border,borderRadius:99,padding:"1px 7px",fontWeight:600,flexShrink:0}}>ship</span>
            <InfoButton title={`${rr.ship} info`} onClick={e=>{e.stopPropagation();setInfoShip(rr.ship);}}/>
          </div>);
        })}
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
        return(<div key={s.typeID} onClick={()=>{if(newFitIntent){setNewFitIntent?.(false);createNewFit(s.name);return;}setSelectedShip(s.name);setView('fits');}} className="press no-select" style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,cursor:"pointer",background:selectedShip===s.name?C.accentLight:C.surface,border:`1px solid ${selectedShip===s.name?C.accentBorder:C.border}`,marginBottom:4}}>
          <img src={eveIcon(s.typeID,64)} style={{width:40,height:40,borderRadius:4,objectFit:'contain',background:'#1a1a2e',flexShrink:0}} onError={e=>{e.target.style.display='none';}} alt=""/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:5}}>
              {(raceIcons??{})[String(s.raceID)]&&<img src={raceIcons[String(s.raceID)]} style={{width:14,height:14,objectFit:'contain',flexShrink:0}} alt=""/>}
              <span style={{fontSize:13,fontWeight:600,color:selectedShip===s.name?C.accent:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</span>
            </div>
            <div style={{fontSize:10,color:C.textMute,marginTop:2}}>{sfits.length>0?`${sfits.length} fit${sfits.length!==1?'s':''}`:'No fits'}</div>
          </div>
          <InfoButton title={`${s.name} info`} onClick={e=>{e.stopPropagation();setInfoShip(s.name);}}/>
        </div>);
      })}
    </div>
    {shipInfoSheet}
    {tagSheetEl}
  </div>);

  // The cross-hull view: every fit under one tag, whatever it's flying. Managing the tag itself
  // (rename, recolour, delete) lives HERE rather than in the per-fit sheet, so filing a fit never
  // puts a colour picker in the way.
  if(view==="tag"){
    const tagged=selectedTag?fitsWithTag(fitsDB,selectedTag):[];
    const color=colorForTag(selectedTag,tagColors);
    return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        {/* A tag cuts across the hull tree rather than sitting in it, so there is no "one level up"
            to offer — only the way out. */}
        <button onClick={()=>{setTagEditing(false);setBrowsePath([]);setView("browse");haptic("light");}} className="press" aria-label="Back to all ships" title="All ships" style={_navBtn()}><BackToStartArrow/></button>
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
        {tagged.map(({ship,fit})=>(
          <FitRow key={`${ship}:${fit.id}`} ship={ship} fit={fit} act={fitRowAct} tagColors={tagColors}
            showShip hideTag={selectedTag}
            active={activeFit?.fitName===fit.name&&activeFit?.ship===ship}
            onOpen={()=>{loadFit(ship,fit.name);setView("active");}}/>
        ))}
      </div>
      {tagSheetEl}
    </div>);
  }

  if(view==="fits"){
    const fits=fitsDB[selectedShip]||[];
    return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        {/* The ship's fit list is one more level of the browse hierarchy, so it gets the same two
            arrows. Back keeps browsePath, landing you among this hull's siblings. */}
        {browsePath.length>0&&(
          <button onClick={()=>{setBrowsePath([]);setView("browse");haptic("light");}} className="press" aria-label="Back to all ships" title="All ships" style={_navBtn()}><BackToStartArrow/></button>
        )}
        <button onClick={()=>{setView("browse");haptic("light");}} className="press" aria-label="Back one level" title="Back one level" style={_navBtn()}><BackArrow/></button>
        <span style={{fontSize:14,fontWeight:700,color:C.text,flex:1,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{selectedShip}</span>
        <button className="press" onClick={()=>{haptic("medium");createNewFit(selectedShip);}} style={{padding:"6px 12px",background:C.accent,border:"none",borderRadius:7,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ New Fit</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:12}}>
        {fits.length===0&&<div style={{textAlign:"center",color:C.textMute,marginTop:40,fontSize:13}}>No saved fits - tap + New Fit to start</div>}
        {fits.map(fit=>(
          <FitRow key={fit.id} ship={selectedShip} fit={fit} act={fitRowAct} tagColors={tagColors}
            active={activeFit?.fitName===fit.name&&activeFit?.ship===selectedShip}
            onOpen={()=>{loadFit(selectedShip,fit.name);setView("active");}}/>
        ))}
      </div>
      {tagSheetEl}
    </div>);
  }

  // The saved record behind the fit that's open, matched the same way every list marks its active
  // row. A fit that isn't in the DB yet has no id to hang a tag on, so the header's tag control is
  // simply absent for it rather than opening a sheet that could not save anything.
  const activeFitRecord=activeFit?(fitsDB[activeFit.ship]||[]).find(f=>f.name===activeFit.fitName):null;
  const activeFitTags=activeFitRecord?tagsOf(activeFitRecord):[];

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
              <span style={{display:"flex",color:C.textMid,flexShrink:0}}><IconPencil size={14}/></span>
            </button>
          }
        </div>
        {/* This 70px was a bare spacer balancing the "‹ Fits" button so the name sits centred. It
            keeps that width — the name must not shift depending on whether a fit is tagged — but the
            space now carries the one verb that had no home on this screen: tagging was reachable only
            from the fit BROWSER, so filing the fit you were actually working on meant leaving it.
            Opens the same TagSheet the browser rows do, against the same fit record. */}
        <div style={{width:70,flexShrink:0,display:"flex",justifyContent:"flex-end",alignItems:"center"}}>
          {activeFitRecord&&(()=>{
            const tint=activeFitTags.length?colorForTag(activeFitTags[0],tagColors):null;
            return(<button onClick={()=>{haptic("light");setTagSheet({ship:activeFit.ship,fitId:activeFitRecord.id});}}
              className="press" title={activeFitTags.length?`Tags: ${activeFitTags.join(", ")}`:"Tag this fit"}
              aria-label={activeFitTags.length?`Edit tags (${activeFitTags.length})`:"Tag this fit"}
              style={{display:"flex",alignItems:"center",gap:3,padding:"4px 7px",lineHeight:1,cursor:"pointer",
                      borderRadius:7,background:tint?`${tint}1f`:C.surfaceAlt,
                      border:`1px solid ${tint?`${tint}66`:C.border}`,color:tint??C.textMid}}>
              <IconTag size={14}/>
              {activeFitTags.length>1&&<span style={{fontSize:10,fontWeight:800}}>{activeFitTags.length}</span>}
            </button>);
          })()}
        </div>
      </div>
      <div style={{display:"flex"}}><div style={{width:60}}/>{_SUBTABS.map(t=><button key={t} onClick={()=>{const to=_SUBTABS.indexOf(t),from=_SUBTABS.indexOf(fitSubTab);if(to!==from)_goTo(to,to>from?1:-1);}} style={{flex:1,padding:"7px 0",fontSize:12,fontWeight:fitSubTab===t?700:600,letterSpacing:"1px",textTransform:"uppercase",background:"none",border:"none",cursor:"pointer",color:fitSubTab===t?C.accent:C.textMute,borderBottom:fitSubTab===t?`2px solid ${C.accent}`:"2px solid transparent"}}>{_SUBTAB_LABEL[t]}</button>)}</div>
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
      {fitSubTab==="Fit"   &&<FitTab   undo={undo} undoDepth={undoDepth} ship={activeShip} slots={slots} setSlots={setSlots} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} externalBursts={externalBursts} projectedEffects={projectedEffects} dmgProfile={dmgProfile} tgtProfile={tgtProfile} autoFillHardpoints={autoFillHardpoints}/>}
      {fitSubTab==="Stats" &&<StatsTab ship={activeShip} slots={slots} skills={skills} implants={implants} boosters={boosters} drones={drones} fighters={fighters} factorInReload={factorInReload} setFactorInReload={setFactorInReload} externalBursts={externalBursts} projectedReps={projectedReps} projectedEffects={projectedEffects} dmgProfile={dmgProfile} setDmgProfile={setDmgProfile} tgtProfile={tgtProfile} setTgtProfile={setTgtProfile} priceHub={priceHub} setPriceHub={setPriceHub}/>}
      {fitSubTab==="Graph" &&<GraphTab ship={activeShip} slots={slots} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} externalBursts={externalBursts} projectedEffects={projectedEffects} tgtProfile={tgtProfile} fitsDB={fitsDB} sourceSkills={sourceSkills} openFitTabs={openFitTabs}/>}
      </div>
    </div>
    {tagSheetEl}
  </div>);
}
