// UI primitives, module/subsystem pickers, resource strip, damage-profile sheet.

import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { C, getTheme } from "../theme.js";
import { eveIcon } from "../lib/icons.js";
import { metaOf, META_COLORS, META_ORDER } from "../lib/meta.js";
import { DAMAGE_PROFILES } from "../data/damage-profiles.js";
import { TARGET_PROFILES } from "../data/target-profiles.js";
import mutaplasmidData from "../data/mutaplasmids.json";
import { TYPES, tidByName, calcFitStats, subsystemsForHull , usesTurretHardpoint, usesLauncherHardpoint } from "../calc.js";
import { DMG, DMG_COLOR, DOUBLE_TAP_MS, MUTA_BY_NAME, MUTA_BY_TYPE, OFF_MARKET_MODULES, REAL_MODULE_BROWSER, REAL_STRUCTURE_MODULE_BROWSER, STATE_COLORS, STATE_GLOW, STATE_LABELS, getCompatibleCharges, groupChargesForBrowser, haptic, moduleByName, moduleTakesCharges, moduleVariations, shipTraits, validStatesFor, variantsOf, mutaAttrRanges, snapToBase, parseEFT, readClipboardText, fitCostRatioOf, fitCostFits } from "../lib/core.js";
import { jargonSearch } from "../lib/jargon.js";
import { fmtResource } from "../lib/fmt.js";
import { fetchPrices } from "../prices.js";
import { compareRows, sortCompareRows, directionOf } from "../lib/compare.js";
import { abyssalGrade } from "../lib/eft-export.js";
import { SkillMark } from "./skill-mark.jsx";
import { useSheetDrag, sheetTransform, SheetGrabber, SHEET_EXIT_MS, dismissKeyboardOnScroll } from "../lib/use-sheet-drag.jsx";
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
// The glyph used to be pinned to Arial to stop the "i" varying across platforms; it now inherits,
// because a bundled face is the stronger version of that guarantee than a font we hope is installed.
function InfoButton({onClick,title="Item info"}){
  return(
    <button onClick={onClick} title={title} aria-label={title}
      style={{width:19,height:19,flexShrink:0,padding:0,borderRadius:"50%",
              border:`1.5px solid ${C.accent}`,background:C.accentLight,color:C.accent,
              display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",
              fontSize:12,fontWeight:700,lineHeight:1}}>i</button>
  );
}

// Tracks the VISUAL viewport — the part of the page not covered by the soft keyboard. A
// position:fixed element is positioned against the LAYOUT viewport, which the keyboard does not
// shrink, so a bottom sheet otherwise sits underneath the keyboard: you type in the search box and
// cannot see what you are searching. Following visualViewport keeps the sheet in the visible strip.
//
// Exported because any bottom-anchored overlay with a text field needs it, not just BottomSheet.
// The tag sheet builds its own overlay and went without, so `+ Tag` opened a field behind the
// keyboard — the same bug this hook already existed to fix, one component over.
//
// Deliberately does NOT report `offsetTop`. That property means "how far the visual viewport is
// panned from the layout viewport's top-left", which only has a legitimate non-zero value under
// pinch-zoom — and the viewport meta tag sets user-scalable=no, so it should always read 0 here.
// A sheet on a short results list (e.g. a search narrowed to one hit) used to vanish entirely,
// still holding keyboard focus with nothing visibly on screen: iOS's own "scroll the focused input
// above the keyboard" behavior has nowhere to scroll once the results div is shorter than the
// available space, so it falls back to nudging the outer WKWebView content instead, and that bled
// into a large, bogus `offsetTop` — which a fixed sheet honestly trusted and followed off-screen.
// `height` alone (still correctly keyboard-aware) is all a non-zooming app ever needs.
// iOS toggles its QuickType predictive-text bar above the keyboard as the user types, which nudges
// visualViewport.height by ~40px with no real keyboard transition — and reacting to that (a React
// re-render of this sheet's position:fixed frame, on an element that also has an active `transform`
// from the drag-to-dismiss gesture) fights WebKit's compositor on every keystroke, producing a
// glitch that compounds until the sheet renders nowhere. A genuine keyboard open/close moves height
// by hundreds of pixels, so only frame updates past this are kept — below it, the height is treated
// as the same keyboard state and dropped.
const KEYBOARD_HEIGHT_THRESHOLD = 100;

export function useVisualViewport(){
  const [vv,setVv]=useState(null);
  const lastHeight=useRef(null);
  // Under Keyboard.resize:"none" (capacitor.config.json), `window.visualViewport` does not reliably
  // shrink on its own when the keyboard appears — this native `keyboardHeight` listener, not the
  // browser's own resize event, is what actually makes a sheet keyboard-aware here. (It also happens
  // to include the iPhone accessory bar App.jsx can turn on — Keyboard.setAccessoryBarVisible, the
  // "Hide keyboard" chevron — which is native chrome injected outside WebKit's own layout, so a
  // footer pinned at the very bottom of a sheet needs that included or it renders into the gap.)
  const kbHeight=useRef(0);
  useEffect(()=>{
    const v=window.visualViewport;
    if(!v)return;                                  // no support: fall back to the layout viewport
    const sync=()=>{
      // index.css's html/body overflow:hidden stops the USER from scrolling the document, but not
      // WebKit's own "scroll the focused input above the keyboard" routine — that one is native
      // code, not a wheel/touch gesture, and it can still push document.scrollingElement's scrollTop
      // off zero. A position:fixed element (this sheet's frame) is supposed to be immune to that,
      // but WebKit's compositor computes fixed position against the CURRENT scroll offset mid-scroll
      // and only re-settles on the next paint — so a sheet can render at the wrong place, or not at
      // all, until something else triggers a repaint. Stomping scroll back to (0,0) on every
      // visualViewport change (which fires exactly when that native nudge happens) denies it
      // anywhere to push the document to, the same way overscroll-behavior:none already denies it
      // rubber-band room. Unconditional — cheap, and unrelated to the height-jitter filtering below.
      window.scrollTo(0,0);
      // window.innerHeight, not vv itself, is the correction's baseline: with Keyboard.resize:
      // "none" the WKWebView's layout viewport never shrinks, so it stays a stable "nothing
      // covered" reference to subtract the native (accessory-bar-inclusive) keyboard height from.
      const h=kbHeight.current>0?Math.min(v.height,window.innerHeight-kbHeight.current):v.height;
      if(lastHeight.current!=null && Math.abs(h-lastHeight.current)<KEYBOARD_HEIGHT_THRESHOLD) return;
      lastHeight.current=h;
      // Whether the keyboard currently covers part of the screen, independent of the accessory-bar
      // correction above — used to skip reserving the home-indicator safe area (env(safe-area-
      // inset-bottom)) while the keyboard is up, since the keyboard already occupies that strip and
      // reserving it too just pads the sheet's content away from the keyboard for no reason.
      setVv({height:h,keyboardOpen:window.innerHeight-h>KEYBOARD_HEIGHT_THRESHOLD});
    };
    sync();
    v.addEventListener("resize",sync);
    v.addEventListener("scroll",sync);
    // iPhone only: Android's adjustResize already shrinks window.innerHeight itself when the
    // keyboard opens (see capacitor.config.json / AndroidManifest), so subtracting keyboardHeight
    // from it there would double-count — and setAccessoryBarVisible is a no-op off iOS anyway.
    let subs=null;
    const Cap=window.Capacitor;
    if(Cap?.isNativePlatform?.()&&Cap.getPlatform?.()==="ios"&&Cap.Plugins?.Keyboard){
      const KB=Cap.Plugins.Keyboard;
      const onShow=info=>{kbHeight.current=info?.keyboardHeight||0;sync();};
      const onHide=()=>{kbHeight.current=0;sync();};
      // willHide as well as didHide, to match willShow: didHide alone only fires once the keyboard has
      // finished animating away, so for that whole ~250ms the sheet was still sized to a screen the
      // keyboard no longer covered and the strip it vacated showed the dimmed page behind. Both are
      // wired because willHide is not guaranteed to arrive (an interactive dismiss can skip it) and
      // the second call is idempotent — sync()'s height filter drops it as the same keyboard state.
      Promise.all([KB.addListener("keyboardWillShow",onShow),KB.addListener("keyboardWillHide",onHide),
                   KB.addListener("keyboardDidHide",onHide)])
        .then(h=>{subs=h;}).catch(()=>{});
    }
    return()=>{v.removeEventListener("resize",sync);v.removeEventListener("scroll",sync);subs?.forEach(s=>s.remove?.());};
  },[]);
  return vv;
}

function BottomSheet({title,onClose,children,height="70vh",fillHeight=false,headerExtra,footerExtra,dismissRequested=false}){
  const vv=useVisualViewport();
  const frame=vv?{top:0,height:vv.height,left:0,right:0}:{inset:0};
  // Derived, not a third prop that could drift out of step with the two it would have to agree with:
  // `height="100vh"` + fillHeight is already exactly how a caller says "fill the screen", because
  // min(100vh, 100%) can only ever resolve to the frame itself. The module browser is the only one.
  const fullScreen=fillHeight&&height==="100vh";
  // Rendered into <body>. position:fixed is only relative to the viewport while no ancestor has a
  // transform, filter, perspective or will-change — any one of those silently becomes the
  // containing block instead, and the sheet anchors to a mid-page element and slides off the
  // bottom of the screen. That is not a hazard worth re-discovering every time someone animates a
  // parent, so the sheet escapes the tree entirely. React events still bubble through the
  // component tree, so nothing else changes.
  // ── Slide in, slide out, and drag the grabber ────────────────────────────────────────────
  // The sheet used to appear with a 14px nudge and vanish instantly on close, which read as a cut
  // rather than a movement. It now travels its full height both ways, and the handle is a real
  // control: drag it down to peek at what is behind, release past a third of the way (or with a
  // flick) to dismiss, otherwise it springs back. The gesture itself lives in lib/use-sheet-drag,
  // shared with every other sheet in the app.
  const sheet=useSheetDrag(onClose);
  const {sheetRef,closing,dragging,dismiss}=sheet;
  // A caller that auto-advances (e.g. the module browser retargeting itself to the next empty slot,
  // then finding none left) used to just null out the state that renders this sheet, which unmounts
  // it mid-frame with no exit transition — a cut, not a close. Routing that through the same dismiss()
  // the grabber/backdrop/x button use gives it the real slide-out, and dismiss() is already guarded
  // against firing twice.
  useEffect(()=>{ if(dismissRequested) dismiss(); },[dismissRequested]);
  return createPortal(
    // stopPropagation on the whole overlay: a sheet is a modal surface, so a drag inside it must
    // never reach the Fit/Stats/Graph swipe handler on an ancestor. React events bubble through the
    // COMPONENT tree, not the DOM tree, so the portal above does not save us from this — which is
    // how dragging an abyssal slider ended up sliding the page behind the sheet.
    // This outer div is always the full, unconditional viewport (inset:0) — NOT `frame`. `frame`'s
    // height comes from the native keyboardHeight listener, which trails the real keyboard animation
    // by however long the Capacitor bridge round trip takes, so anything sized by it directly flashed
    // the real page behind for that gap on every show/hide. The backdrop below is a sibling that
    // always spans the true full screen regardless of that lag; only the sheet itself — one layer
    // further in, already sitting on top of the backdrop — uses `frame`, so a lagging frame can at
    // worst show a moment of plain backdrop where the sheet hasn't caught up yet, never the raw page.
    <div onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}
         style={{position:"fixed",inset:0,zIndex:200}}>
      <div onClick={dismiss} style={{position:"absolute",inset:0,background:"rgba(0,0,0,.65)",
           opacity:closing?0:1,transition:`opacity ${SHEET_EXIT_MS}ms ease`}}/>
      {/* The strip the keyboard occupies, filled with the sheet's own surface colour. `frame` follows
          the keyboard across the Capacitor bridge, so it always trails the real keyboard animation by
          a few frames in both directions — and the sheet's bottom edge sits at frame's bottom, so
          those frames showed backdrop (a 65% dim of the fit page) where the sheet was about to be, or
          had just been. Painting the gap the same colour as the sheet above it makes the lag read as
          the sheet simply being taller for a moment, rather than the page flashing through. */}
      {vv?.keyboardOpen&&<div style={{position:"absolute",left:0,right:0,top:vv.height,bottom:0,background:C.surface}}/>}
      <div style={{position:"absolute",...frame,display:"flex",flexDirection:"column",justifyContent:"flex-end",alignItems:"center"}}>
      {/* min(): the sheet keeps its designed height normally, but can never exceed the space the
          keyboard leaves — otherwise its bottom (and the list you are scrolling) is off-screen.
          fillHeight additionally sets `height` (not just maxHeight) to that same min(), for a sheet
          whose content can be too short to naturally reach it — shrink-wrap left that sheet with no
          definite box for its own scroller to size against (flex distributes leftover space, and a
          content-sized parent has none to give), which could silently clip the tail of a short list
          past the keyboard rather than let it scroll. Left off elsewhere on purpose: shrink-wrap is
          the wanted look for a short utility sheet (e.g. a quantity stepper) — forcing it tall would
          just add dead space below the control. */}
      <div ref={sheetRef} className={`vv-sheet${closing||dragging?"":" vv-sheet-in"}`}
           style={{position:"relative",background:C.surface,borderRadius:"16px 16px 0 0",maxHeight:`min(${height}, 100%)`,...(fillHeight?{height:`min(${height}, 100%)`}:{}),display:"flex",flexDirection:"column",overflow:"hidden",
                   // Skip the home-indicator safe area while the keyboard is up: the keyboard already
                   // occupies that strip, so reserving it too just pads the footer away from the
                   // keyboard for no reason — the extra gap a footer search box reported feeling.
                   paddingBottom:vv?.keyboardOpen?0:"env(safe-area-inset-bottom, 0px)",
                   ...sheetTransform(sheet)}}>
        <SheetGrabber grabHandlers={sheet.grabHandlers}/>
        {/* Status-bar clearance, and ONLY for a sheet that actually reaches the status bar. A
            full-screen sheet sits with its top pinned at the physical top of the screen (see the
            min(height,100%) note above) so its title needs the same inset AppHeader and the drawer
            give theirs. Every other sheet stops well short of the top, and adding the inset there
            just opened ~60px of dead space above the title — this was applied unconditionally once,
            and it was every bottom sheet in the app that grew the gap, not the one it was written for. */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 14px 10px",borderBottom:`1px solid ${C.border}`,
                     ...(fullScreen?{paddingTop:"calc(4px + env(safe-area-inset-top, 0px))"}:{})}}>
          <span style={{fontSize:14,fontWeight:700,color:C.text}}>{title}</span>
          <button className="press" onClick={dismiss} style={{background:"none",border:"none",color:C.textMid,fontSize:20,cursor:"pointer",padding:"0 4px",lineHeight:1}}>x</button>
        </div>
        {/* Outside the scroller, not sticky inside it: a sticky element's offset is computed against
            its nearest scrolling ancestor, and this sheet's OWN transform (the drag-to-dismiss
            animation, active even at rest as translateY(0)) sits between that ancestor and here —
            WebKit has a history of losing the sticky calculation across a transformed ancestor.
            Living in the always-rendered header instead needs no scroll-relative math at all. */}
        {headerExtra}
        {/* minHeight:0 overrides a flex item's default min-height:auto, which otherwise refuses to
            shrink below its OWN content size — a flex sibling sized purely by max-height (this one
            has no explicit height) never gets a definite box for the browser to compute "leftover
            space" from, so this scroller can render at full content height and let the sheet's own
            overflow:hidden silently clip the rest, with nothing to actually scroll. Only visible
            when content is forced taller than the visible sheet, e.g. a short module-browser search
            padded out to stay scrollable past the keyboard. */}
        <div onScroll={dismissKeyboardOnScroll} style={{flex:1,minHeight:0,overflowY:"auto"}}>{children}</div>
        {/* Rendered after the scroller, not inside it — a search box living here needs no
            keyboard-aware "scroll into view" logic at all. It's the last thing in the flex
            column, so it sits right above the keyboard by construction, the same way this
            sheet's own frame already tracks the keyboard via useVisualViewport, and it never
            scrolls out of reach the way a search box living in `children` used to. */}
        {footerExtra}
      </div>
      </div>
    </div>,
    document.body
  );
}
// For sheets whose search box lives in the footer, directly above the keyboard. Cheap alternative
// to a real native inputAccessoryView (App.jsx's global accessory bar is a WebKit stock toolbar,
// not custom Capacitor UI — see the setAccessoryBarVisible source note in useVisualViewport): with
// the search box already sitting on top of the keyboard, leaving the stock bar on just stacks a
// second ~44px strip for no benefit.
//
// Lifetime-scoped, NOT focus-scoped, and that distinction is the whole reason this is a hook.
// Toggling on the input's own focus/blur is too late — the bar is attached to the keyboard as it
// appears, before the native side has even received our message across the bridge — so a
// focus-scoped version shows the stock bar for the first keystroke of every focus. Only use this
// in a sheet with no OTHER focusable field, which would then be missing its Done/chevron; the
// unmount cleanup restores the bar for the rest of the app.
export function useSuppressAccessoryBar(){
  useEffect(()=>{
    const Cap=(typeof window!=="undefined")&&window.Capacitor;
    if(!Cap?.isNativePlatform?.())return;
    try{ Cap.Plugins?.Keyboard?.setAccessoryBarVisible?.({isVisible:false}); }catch(e){}
    return ()=>{ try{ Cap.Plugins?.Keyboard?.setAccessoryBarVisible?.({isVisible:true}); }catch(e){} };
  },[]);
}

// ═══ SHEET SEARCH BAR ════════════════════════════════════════════
// One search row for every browser sheet. Ten hand-rolled copies had drifted: three inner paddings,
// two glyph sizes, two font sizes, and only four of them had a clear-`x` at all — so whether you
// could empty the box without backspacing depended on which sheet you were in.
//
// `onDismiss` is opt-in, NOT the default. The chevron exists to replace iOS's stock accessory bar,
// and only the module browser suppresses that bar (see setAccessoryBarVisible there) — drawing our
// own chevron in a sheet that still has the stock one gives you two of them side by side.
export function SheetSearchBar({value,onChange,placeholder,onPaste,onDismiss,inputRef,inputProps}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px"}}>
      <span style={{fontSize:15,color:C.textMute,flexShrink:0}}>&#128269;</span>
      <input ref={inputRef} autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search"
        value={value} onChange={e=>onChange(e.target.value)} onPaste={onPaste}
        // enterKeyHint="search" promises the return key does something; results are already
        // live, so the only thing left for it to do is get the keyboard out of the way.
        onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();}}}
        placeholder={placeholder} style={{flex:1,minWidth:0,background:"none",border:"none",color:C.text,fontSize:14,outline:"none"}}
        {...inputProps}/>
      {/* padding+negative margin: grows the tap target well past the glyph itself without
          pushing the search bar's own height out or nudging the input over — the same trick
          SheetGrabber uses for its drag handle.

          preventDefault on mousedown for the same reason ModRow does it, but here it is load-bearing
          twice over. Blurring the input is the default action of pressing this button, and in a
          footer-placed search bar that blur drops the keyboard, which moves this button ~300px down
          the screen before mouseup — so the click landed on whatever now sat under the thumb and the
          field never actually cleared. Cancelling the blur keeps the keyboard up, keeps the button
          still, and leaves the caret in the box ready for the next query. */}
      {!!value&&<button onClick={()=>onChange("")} onMouseDown={e=>e.preventDefault()} aria-label="Clear search" style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:18,lineHeight:1,padding:10,margin:-10,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>x</button>}
      {/* Same padding/flex recipe as the x button next to it so the two share a baseline, but a
          POSITIVE left margin instead of the matching -10: the row's gap is 8, so two neighbours
          both pulling in by 10 left their 20px-wide hit areas overlapping by 12px and a thumb
          aiming here landed on "clear search" instead. 8 - 10 + 10 puts 8px of clear space
          between the two targets, and 28px between the glyphs. */}
      {onDismiss&&
        <button onClick={onDismiss} aria-label="Dismiss keyboard"
          style={{background:"none",border:"none",color:C.accent,cursor:"pointer",padding:10,margin:"-10px -10px -10px 10px",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 6.2 8 10.5l4.5-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>}
    </div>
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
function NumpadModal({label,initial,onConfirm,onClose,fillMax}){
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
        {fillMax>0&&<button onClick={()=>setVal(String(fillMax))} style={{width:"100%",padding:"10px 0",marginBottom:8,background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:10,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer"}}>Fill Cargo ({fillMax.toLocaleString()})</button>}
        <button onClick={()=>{onConfirm(Number(val)||0);onClose();}} style={{width:"100%",padding:"12px 0",background:C.accent,border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Confirm</button>
      </div>
    </BottomSheet>
  );
}

// ═══ RESOURCE STRIP ══════════════════════════════════════════════
// `children` render INSIDE the sticky box, under the meters. That is the whole point: anything
// passed here is pinned for free, with no second sticky element to fight this one for top:0 and no
// measuring of this strip's (variable) height to offset against. The Fit tab uses it for the
// Undo/Grouped toolbar, which was previously scrolled away exactly when you needed it.
// Powergrid red, CPU blue-teal, calibration grey — loosely EVE's own fitting-window colours; PG and
// CPU were nudged for contrast (PG more saturated, CPU shifted toward teal) rather than kept literal.
//
// Per THEME, because these were a single hardcoded triple for a long time and so painted dark-mode
// colours everywhere. On the other dark palettes that only looked foreign, but on LIGHT it was a real
// bug: CPU came out at 1.52:1 and calibration at 2.35:1 on a white strip, i.e. bars you cannot see.
//
// Deliberately NOT derived from C. The obvious mapping is danger/low/textMid, and `low` is the trap —
// it is the low-slot label colour, and the strip sits directly above the slot headers, so a cyan CPU
// bar would be the same cyan as the "Low Slots" heading a few rows down. Slot colours are a semantic
// the user learns once; this borrows their look, not their meaning. Same table-plus-fallback shape as
// DMG_COLORS in lib/core.js, and for the same reason: a theme that forgets to add itself here gets
// dark's readable triple rather than an undefined colour.
const RESOURCE_COLORS={
  dark:  {pg:"#e84f45",cpu:"#50cdf7",cal:"#9898a6"},
  light: {pg:"#c8352c",cpu:"#0d7ea8",cal:"#55555f"},
  amarr: {pg:"#e8564f",cpu:"#4cc6d8",cal:"#a89880"},
  sansha:{pg:"#ef5350",cpu:"#4ec8e8",cal:"#a89a99"},
  intaki:{pg:"#ef5f55",cpu:"#4fc4ec",cal:"#97a6b8"},
};
// Read at call time, not module scope: the palettes are live and a theme switch has to be picked up
// on the next render, same reasoning as C's Proxy.
const resourceColor=k=>(RESOURCE_COLORS[getTheme()]??RESOURCE_COLORS.dark)[k];

function ResourceStrip({ship,slots,skills,implants,boosters,drones,factorInReload,children}){
  // Memoised because this strip is the module browser's header: without it, every keystroke in the
  // search box and every appearance of the "+ module" toast re-ran the entire dogma engine over the
  // whole fit, which is by far the most expensive thing on that screen.
  const cs=useMemo(
    ()=>calcFitStats(ship,slots,drones??[],skills,{implants,boosters,factorInReload,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity})??{},
    [ship,slots,drones,skills,implants,boosters,factorInReload]);
  // Readout mode: tap any row to swap between "used / total" and remaining ("x left" / "x over").
  const[showRemaining,setShowRemaining]=useState(false);
  const fmtRes=v=>Number((v??0).toFixed(2)).toLocaleString();
  // Powergrid first, matching the order the game and pyfa put them in.
  const resources=[
    {key:"pg", label:"PG",    used:cs.pgUsed??0,   total:cs.pgTotal??0,   unit:"MW",  warn:95},
    {key:"cpu",label:"CPU",   used:cs.cpuUsed??0,  total:cs.cpuTotal??0,  unit:"tf",  warn:95},
    {key:"cal",label:"Cal",   used:cs.calUsed??0,  total:cs.calTotal??400, unit:"pts", warn:95},
  ];
  // Hardpoint usage, counted off CCP's own turretFitted/launcherFitted marker effects — the same
  // signal pyfa uses — rather than a group-name scan. Weapon CLASS is a different question: keying
  // this on "is a missile weapon" gave a Scan Probe Launcher a launcher hardpoint.
  const {turretsUsed,launchUsed}=(slots?.high??[]).reduce((acc,s)=>{
    if(!s||s.type==="empty")return acc;
    const t=TYPES[s.typeID]??TYPES[String(s.typeID)];
    if(usesTurretHardpoint(t?.e))acc.turretsUsed++;
    else if(usesLauncherHardpoint(t?.e))acc.launchUsed++;
    return acc;
  },{turretsUsed:0,launchUsed:0});
  const turretsTotal=ship?.turrets??0, launchTotal=ship?.launchers??0;

  // Compact numbers, because this is a single row three columns wide: a battleship's 100,000 MW of
  // structure powergrid cannot sit next to two other readouts at full length. `fmtResource` keeps a
  // constant FOUR significant digits rather than a fixed decimal count, so a value gains precision
  // exactly as it gains room — see src/lib/fmt.js.
  const fmtShort=v=>fmtResource(v);
  // Remaining headroom as a SIGNED percentage of the total: negative is a deficit to make up,
  // positive is room to spare. Precision tapers because the strip is three columns wide on a phone
  // and each step only buys detail where it is actionable — "62% left" never needs a decimal, while a
  // hair over powergrid does, since that is the difference between a 3% and a 5% implant. Two guards,
  // both from real values: an exact 0 must not print "0.00%", and anything
  // non-zero must not round down to a flat "-0.00%", which shows a minus sign against a magnitude of
  // nothing and reads as broken. Summing float module costs against an equal total lands a hair
  // either side of zero, so a fit that is exactly full genuinely can register as over by 1e-13.
  const fmtMarginPct=(rem,total)=>{
    const p=(rem/total)*100, a=Math.abs(p);
    const s=a===0?"0":a<1?Math.max(a,0.01).toFixed(2):a<10?a.toFixed(1):Math.round(a);
    return `${p<0?"-":""}${s}%`;
  };

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
        // Each bar keeps its RESOURCE's colour at all times, so the three columns are told apart at a
        // glance instead of by reading their labels — a bar that changed colour said "something is
        // wrong" without saying which of the three.
        const barColor=resourceColor(res.key);
        const rem=(res.total??0)-(res.used??0), over=rem<0;
        // The used figure carries the overload instead, and it FADES: the theme's amber the instant
        // you cross, full danger red by 110%. How far over you are is the thing you act on — a few tf
        // is one meta swap from fitting, 40% over means rethinking the fit — and a binary red could
        // not tell those apart. Endpoints are the theme's own warning/danger so this agrees with
        // every other red in the app. Same curve the bars carried before they took their own colours.
        // total<=0 can't be scaled against, so treat any usage there as fully over.
        const overFactor=res.total>0?Math.min(Math.max(rawPct-100,0)/10,1):1;  // 0 = just over, 1 = 110%+
        const overColor=`hsl(${Math.round(38*(1-overFactor))},${Math.round(92-8*overFactor)}%,${Math.round(50+10*overFactor)}%)`;
        return(
          <div key={res.key} onClick={()=>setShowRemaining(v=>!v)}
               title={`${res.label}: ${fmtRes(res.used)} / ${fmtRes(res.total)} ${res.unit} — tap to switch readout`}
               style={{flex:1,minWidth:0,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
            <div style={{display:"flex",alignItems:"baseline",gap:4,marginBottom:4,whiteSpace:"nowrap",lineHeight:1.15}}>
              <span style={{fontSize:9,fontWeight:700,color:C.textMute,letterSpacing:.4,textTransform:"uppercase",flexShrink:0}}>{res.label}</span>
              {/* Readability: the numbers were 10px with the TOTAL at textMute, which is ~2.4:1
                  against this surface — below any sensible floor for small text, and these are the
                  figures you glance at most while fitting. The used value now carries full text
                  colour at 12px, the total sits one step back at textMid rather than disappearing,
                  and tabular-nums stops the digits jittering as they change under a drag. */}
              {showRemaining
                ? <span style={{fontSize:12,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",fontVariantNumeric:"tabular-nums"}}>
                    <span style={{fontWeight:700,color:over?overColor:C.text}}>{fmtShort(Math.abs(rem))}</span>
                    <span style={{fontSize:10,color:over?overColor:C.textMid}}> {over?"over":"left"}</span>
                    {/* The margin as a PROPORTION, which is the form the fix comes in: fitting
                        implants and rigs are sold as percentages, so "10.03k over" does not tell you
                        whether a 3% or a 5% powergrid implant closes the gap, and "-4.7%" does. Same
                        quantity as the figure to its left, over the total.
                        SIGNED, so the number stands alone: negative is a deficit to make up, positive
                        is headroom. That is what lets it show under the limit as well as over without
                        reading ambiguously — the sign, not the neighbouring word, is what says which.
                        Kept out of the default used/total view, which is unchanged.
                        CALIBRATION is excluded: nothing is sold as a percentage of calibration, so
                        there is no fix the proportion points at. Rigs cost whole points off a flat
                        400, and "50 left" already answers the only question — whether the next rig
                        fits. PG and CPU keep it because implants and rigs for those ARE percentages.
                        textMid, NOT textMute, matching the "left"/"over" word beside it: textMute is
                        3.66:1 on this strip, under the 4.5:1 floor for text this size, and it was
                        reported as hard to read against exactly that neighbour. */}
                    {res.key!=="cal"&&res.total>0&&<span style={{fontSize:10,color:C.textMid}}> {fmtMarginPct(rem,res.total)}</span>}
                  </span>
                : <span style={{fontSize:12,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",fontVariantNumeric:"tabular-nums"}}>
                    <span style={{fontWeight:700,color:over?overColor:C.text}}>{fmtShort(res.used)}</span>
                    <span style={{fontSize:10,color:C.textMid}}>/{fmtShort(res.total)}</span>
                  </span>}
            </div>
            {/* The empty part of the track is the half you actually read — "how much room is left"
                is the question, and it was C.border on C.surfaceAlt, a 1.16:1 ratio you cannot see
                where the bar ends. Tinting the track with the resource's own hue instead of a
                neutral grey roughly triples the luminance gap against the strip while keeping the
                filled/empty step at ~3:1, and it reinforces the per-resource colour coding above.
                Same alpha-on-hue idiom as the hardpoint dots below. 4px because a low-contrast edge
                needs a couple of pixels to register at all. */}
            <div style={{height:4,background:`${barColor}59`,borderRadius:99,overflow:"hidden"}}><div style={{width:`${Math.min(rawPct,110)}%`,maxWidth:'100%',height:"100%",background:barColor,borderRadius:99}}/></div>
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
      {children}
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
              <SkillMark typeID={opt.typeID}/>
              {on&&<span style={{fontSize:11,color:C.accent,fontWeight:700}}>✓</span>}
            </div>);
          })}
        </div>
      </div>
    </div>
  );
}

// Module scope, NOT nested inside ModuleBrowserSheet. A component declared inside another component
// is a fresh function identity on every render, so React tears down and rebuilds every row's DOM
// whenever the browser re-renders. Tapping a row with the keyboard up blurs the search input, which
// re-renders the sheet BETWEEN touchstart and click — the row's node was replaced mid-tap, so the
// click had no surviving target and the first tap on a module only collapsed the keyboard.
function ModRow({mod,onAdd,onInfo,headroom}){
  const rowMeta=metaOf(mod.typeID,mod.meta);
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
      {/* preventDefault on mousedown keeps the keyboard up while you fill a rack. Blurring the
          focused input is the DEFAULT ACTION of pressing another element, so cancelling it holds
          focus in the search box and the click still fires normally. Without this, adding a module
          collapsed the keyboard every time and you had to tap back into the box to keep going —
          which is the whole point of a browser that stays open. The keyboard is still dismissed
          deliberately: by scrolling the list (BottomSheet's dismissKeyboardOnScroll) or by the
          chevron in the search bar. Not on the info button beside this — that opens a detail sheet
          over the whole browser, where the keyboard has nothing left to type into. */}
      <div onClick={()=>onAdd(mod)} onMouseDown={e=>e.preventDefault()} style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
        {/* Fixed-size box, not a bare img: with `display:none` on a failed icon the text jumped
            left and rows stopped lining up with each other. */}
        <div style={{width:28,height:28,flexShrink:0}}>
          {mod.typeID&&<img className="eve-icon" src={eveIcon(mod.typeID,32)} width={28} height={28} alt="" onError={e=>{e.target.style.visibility="hidden";}}/>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:14,fontWeight:500,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{mod.name}</div>
          <FitCost item={mod} headroom={headroom}/>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0,marginLeft:8}}>
        <SkillMark typeID={mod.typeID}/>
        <span style={{fontSize:11,color:META_COLORS[rowMeta]||C.textMute,background:C.border,borderRadius:99,padding:"2px 8px",fontWeight:700}}>{rowMeta}</span>
        {mod.typeID&&<InfoButton onClick={e=>{e.stopPropagation();onInfo(mod);}}/>}
      </div>
    </div>
  );
}

function ModuleBrowserSheet({slotType,isStructure,hullRigSize,onSelect,onClose,resourceHeadroom,ship,slots,skills,implants,boosters,drones,factorInReload,dismissRequested}){
  const[search,setSearch]=useState("");
  const[infoItem,setInfoItem]=useState(null);
  // clipboardData still has the real newlines here; the value that would land in a single-line
  // <input> after a default paste does not — the browser collapses them, which is exactly why an
  // abyssal dump used to need its own textarea. Try it as an abyssal module FIRST, before any of
  // that collapsing happens, and only fall through to a normal (jumbled, single-line) search paste
  // if it doesn't parse as one.
  const onSearchPaste=e=>{
    const text=e.clipboardData?.getData("text");
    if(!text)return;
    const parsed=parseAbyssal(text);
    if(!parsed)return;
    e.preventDefault();
    const n=onSelect(parsed);
    setJustAdded({name:parsed.name,count:n||1,key:Date.now(),abyssal:true});
    haptic("light");
  };
  // Tap-to-fill confirmation: the sheet stays open (see ModRow below), so without this the only
  // sign a tap landed is the resource strip's numbers moving, which is easy to miss mid-scroll.
  const[justAdded,setJustAdded]=useState(null);
  useEffect(()=>{
    if(!justAdded)return;
    const t=setTimeout(()=>setJustAdded(null),1100);
    return ()=>clearTimeout(t);
  },[justAdded]);
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
    // The prune above only ever leaves ONE size branch alive under a category ("Armor Rigs" >
    // "Small Armor Rigs" survives, Medium/Large don't) — CCP's market tree still nests that single
    // survivor a level deep, which is a tap with nothing to choose between. Splice it out: a node
    // with no mods of its own and exactly one surviving child named "<Size> <this node's name>"
    // hoists that child's contents up to sit directly under the category.
    const SIZE_PREFIX=/^(Small|Medium|Large|X-Large)\s+/;
    const collapse=n=>{
      const children=(n.children??[]).map(collapse);
      if((n.mods?.length??0)===0&&children.length===1){
        const c=children[0];
        if(SIZE_PREFIX.test(c.name)&&c.name.replace(SIZE_PREFIX,'')===n.name)
          return{...n,mods:c.mods,children:c.children,iconTid:n.iconTid??c.iconTid};
      }
      return{...n,children};
    };
    return prune(baseTree).map(collapse);
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

  // The SEARCH corpus is the tree plus the modules CCP does not sell. Those have no market group and
  // so no node to browse to, but they are ordinary fittable items and search is the only way to reach
  // them — a Civilian Light Missile Launcher was unreachable except by pasting EFT.
  const allMods=useMemo(()=>{
    const out=[];
    function collect(n){n.mods.forEach(m=>out.push(m));n.children.forEach(collect);}
    tree.forEach(collect);
    if(!isStructure)
      for(const m of OFF_MARKET_MODULES[slotType]??[])
        if(slotType!=="rigs"||hullRigSize==null||(TYPES[String(m.typeID)]?.a?.rigSize??hullRigSize)===hullRigSize)
          out.push(m);
    return out;
  },[tree,isStructure,slotType,hullRigSize]);
  // Memoised on the query alone: this sheet re-renders for reasons unrelated to the search — focusing
  // or blurring the box, and the "+ module" toast appearing and expiring — and a full corpus scan on
  // each of those made every tap on a result cost three extra searches.
  const searchResults=useMemo(
    ()=>search.trim().length>1?(jargonSearch(search,allMods)??[]).slice(0,60):null,
    [search,allMods]);

  const breadcrumb=(()=>{
    let nodes=tree,parts=[];
    for(const id of navPath){const n=nodes.find(n=>n.id===id);if(!n)break;parts.push(n.name);nodes=n.children;}
    return parts;
  })();

  const addMod=mod=>{const n=onSelect(mod);setJustAdded({name:mod.name,count:n||1,key:Date.now()});haptic("light");};

  // Filled/total for the rack being browsed, so a rapid-tap fill run doesn't need a peek at the
  // resource strip's hardpoint dots (or a tab-out to the fit) to know when to stop. +1 counts the
  // slot this sheet is open FOR as already spoken for — 4 filled and browsing for the 5th reads
  // "5/6", not "4/6" (which would look like the tap that opened the sheet hadn't landed yet).
  const slotCount=slots[slotType]?.length??0;
  const filledCount=(slots[slotType]??[]).filter(s=>s.type!=="empty").length;
  const ordinal=Math.min(filledCount+1,slotCount);
  const searchInputRef=useRef(null);
  const[searchFocused,setSearchFocused]=useState(false);
  useSuppressAccessoryBar();
  return(
    <>
    {/* height="100vh", not 88vh: with fillHeight, the sheet's box is min(height,100%) where 100% is
        the keyboard-shrunk frame — so at 88vh it sits with a resting "peek gap" below the status bar
        while frame.height>88vh, but the instant the keyboard's frame drops under 88vh (any real
        keyboard does), it snaps to filling frame exactly, and frame is bottom-anchored, so the
        sheet's TOP jumps upward by however much peek gap it had. 100vh makes min() always resolve to
        100% (frame can never exceed 100vh), so the sheet always exactly fills frame — top pinned at
        frame's own top with no keyboard-dependent snap, at rest or with the keyboard up alike. */}
    <BottomSheet title={`Add Module - ${slotType.charAt(0).toUpperCase()+slotType.slice(1)} Slot${slotCount?` ${ordinal}/${slotCount}`:""}`} onClose={onClose} height="100vh" fillHeight dismissRequested={dismissRequested}
      headerExtra={
        // Header content, not scroller content: position:sticky here used to fight WebKit's handling
        // of sticky across a transformed ancestor (the sheet itself is always under a transform, for
        // the drag-to-dismiss gesture, even at rest) and would silently stop tracking the scroll.
        // Living in the header instead needs no sticky/scroll math at all — it just never scrolls.
        <ResourceStrip ship={ship} slots={slots} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload}>
          {/* C.danger, not META_COLORS.Abyssal — that constant colors the META TIER badge (T1/T2/
              Faction/...) and Abyssal's tier color is pink, a different thing from the red used for
              mutaplasmid/grade badges everywhere else (ui.jsx's own grade badge above, the fit list's
              ▲ marker, drones.jsx) — this toast should match THAT red, not the tier pink. */}
          {justAdded&&<div key={justAdded.key} className="vv-in" style={{position:"absolute",top:8,right:10,zIndex:20,background:justAdded.abyssal?C.danger:C.accent,color:"#fff",fontSize:11,fontWeight:700,padding:"5px 10px",borderRadius:99,boxShadow:"0 2px 8px rgba(0,0,0,.35)",pointerEvents:"none",maxWidth:"65%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>+ {justAdded.abyssal?"Abyssal ":""}{justAdded.name}{justAdded.count>1?` (x${justAdded.count})`:""}</div>}
        </ResourceStrip>
      }
      footerExtra={
        // Moved down here from the top of the scroller: with the search box up top, a short
        // result list left most of a tall sheet empty above the keyboard instead of showing more
        // results — the exact space Tritanium uses well and we didn't. Down here it sits right
        // above the keyboard (see BottomSheet's footerExtra note) and results get the space back.
        <div style={{padding:"8px 14px",borderTop:`1px solid ${C.border}`}}>
          {/* The only sheet that passes onDismiss: it suppresses the stock accessory bar for its
              whole lifetime (see setAccessoryBarVisible above), so without this chevron there is no
              way to collapse the keyboard short of scrolling a long enough list. */}
          <SheetSearchBar value={search} onChange={setSearch} onPaste={onSearchPaste}
            inputRef={searchInputRef} onDismiss={searchFocused?()=>searchInputRef.current?.blur():null}
            inputProps={{onFocus:()=>setSearchFocused(true),onBlur:()=>setSearchFocused(false)}}
            placeholder="Search all modules, or paste an abyssal..."/>
        </div>
      }>
      {/* Sticky: this bar lives inside the sheet's scroller, so it used to scroll out of reach the
          moment you started looking through a long category. top:0 since ResourceStrip moved out of
          the scroller (into headerExtra) — this is now the first sticky element in here. */}
      {!searchResults&&navPath.length>0&&(
        <div style={{position:"sticky",top:0,zIndex:3,display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
          <button onClick={goBack} style={{background:"none",border:"none",color:C.accent,fontSize:14,fontWeight:700,cursor:"pointer",padding:0}}>&#8249; Back</button>
          <span style={{fontSize:12,color:C.textMute,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{breadcrumb.join(" / ")}</span>
        </div>
      )}
      {searchResults?(
        // No forced minHeight here anymore: that existed only because the search box used to live
        // in this same scroller, and a short result list left it nothing to scroll, so iOS gave up
        // scrolling the box into view and nudged the whole page instead (see useVisualViewport).
        // The search box is a footer now — outside the scroller, always visible — so a short list
        // can end wherever it ends and just show more of what's above it.
        <div>
          {searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:14}}>No modules found</div>}
          {searchResults.map(mod=><ModRow key={mod.typeID??mod.name} mod={mod} onAdd={addMod} onInfo={setInfoItem} headroom={resourceHeadroom}/>)}
        </div>
      ):(
        <div key={navPath.join(">")} onTouchStart={_navStart} onTouchMove={_navMove} onTouchEnd={_navEnd}
             className={navDir>0?"vv-from-right":navDir<0?"vv-from-left":undefined}>
          {currentLevel.mods.map(mod=><ModRow key={mod.typeID??mod.name} mod={mod} onAdd={addMod} onInfo={setInfoItem} headroom={resourceHeadroom}/>)}
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
  // "Scan X Strength" is what the generic camelCase splitter would produce (and what pyfa itself
  // calls it) — "X Sensor Strength" reads clearer next to a ship's own sensor TYPE and matches the
  // label the ship attributes tab builds for the same attribute.
  scanRadarStrength:'Radar Sensor Strength', scanLadarStrength:'Ladar Sensor Strength',
  scanMagnetometricStrength:'Magnetometric Sensor Strength', scanGravimetricStrength:'Gravimetric Sensor Strength',
};
const RESIST_ATTRS = new Set(['armorEmDamageResonance','armorThermalDamageResonance','armorKineticDamageResonance','armorExplosiveDamageResonance','shieldEmDamageResonance','shieldThermalDamageResonance','shieldKineticDamageResonance','shieldExplosiveDamageResonance','hullEmDamageResonance','hullThermalDamageResonance','hullKineticDamageResonance','hullExplosiveDamageResonance',
  'emDamageResonance','thermalDamageResonance','kineticDamageResonance','explosiveDamageResonance']);
// Grouped for the ResistBars widget — Hull has no `hull` prefix on its own resonance keys (CCP
// reuses the bare em/thermal/kinetic/explosiveDamageResonance names for it).
const RESIST_LAYER_DEFS = [
  {label:'Shield', keys:['shieldEmDamageResonance','shieldThermalDamageResonance','shieldKineticDamageResonance','shieldExplosiveDamageResonance']},
  {label:'Armor',  keys:['armorEmDamageResonance','armorThermalDamageResonance','armorKineticDamageResonance','armorExplosiveDamageResonance']},
  {label:'Hull',   keys:['emDamageResonance','thermalDamageResonance','kineticDamageResonance','explosiveDamageResonance']},
];
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

// Market price for a single item, shown under the description in the info panel.
//
// Reads the hub and source straight from the persisted settings rather than taking them as props:
// this panel is reached from six different places (module browser, variations, fitted modules,
// implants, drones, subsystems) and threading two more props through all of them to display one
// line is a lot of plumbing for no gain. The keys are the ones App.jsx initialises from.
//
// fetchPrices serves anything already cached without a network round trip, so re-opening an item —
// or opening one that was priced as part of the fit total — is instant and works offline.
const PRICE_HUB_KEY='axis_pricehub', PRICE_SOURCE_KEY='axis_pricesource';
function ItemPrice({typeID}) {
  const[state,setState]=useState({status:'loading',value:null,hub:'Jita'});
  useEffect(()=>{
    if(!typeID){setState({status:'none',value:null,hub:'Jita'});return;}
    let cancelled=false;
    let hub='Jita',source='fuzzwork';
    try{hub=localStorage.getItem(PRICE_HUB_KEY)||hub;source=localStorage.getItem(PRICE_SOURCE_KEY)||source;}catch{}
    setState({status:'loading',value:null,hub});
    fetchPrices([Number(typeID)],hub,source)
      .then(m=>{if(cancelled)return;
        const v=m.get(Number(typeID));
        setState({status:v!=null?'ok':'none',value:v??null,hub});})
      // Offline, or a hub with no order for this item. Neither is an error worth shouting about.
      .catch(()=>{if(!cancelled)setState({status:'none',value:null,hub});});
    return()=>{cancelled=true;};
  },[typeID]);
  if(state.status==='none')return null;
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,
                 marginBottom:14,padding:'8px 12px',background:C.surfaceAlt,borderRadius:8,border:`1px solid ${C.border}`}}>
      <span style={{fontSize:11,color:C.textMute}}>Price <span style={{color:C.textMute,opacity:.7}}>· {state.hub}</span></span>
      <span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>
        {state.status==='loading'?'…':`${fmtResource(state.value)} ISK`}
      </span>
    </div>
  );
}

// Compact color-coded resist grid — same visual language as the fit Stats tab's Resistances card
// (colored bar + percentage per damage type) but condensed to fit an info panel: no EHP column, no
// incoming-profile picker, just the four resonances per layer. Shared between ItemInfoPanel (a
// drone/module/ship's BASE resists) and ShipInfoSheet (a hull's base resists), so a bar means the
// same thing wherever it's tapped into.
//
// `layers` is [{label, em, th, kin, exp}], each value a 0-100 resist percentage or null/undefined
// for "this layer doesn't carry that type" (kept null-safe for a future item that only has three).
function ResistBars({layers}) {
  const present = (layers||[]).filter(l => [l.em,l.th,l.kin,l.exp].some(v => v != null));
  if (!present.length) return null;
  const COLS = '40px repeat(4,1fr)';
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:COLS,gap:4,padding:'0 0 4px'}}>
        <span/>
        {Object.values(DMG).map(d => (
          <span key={d.label} style={{fontSize:9,fontWeight:700,color:d.color,textAlign:'center'}}>{d.label}</span>
        ))}
      </div>
      {present.map(l => (
        <div key={l.label} style={{display:'grid',gridTemplateColumns:COLS,gap:4,alignItems:'center',padding:'3px 0'}}>
          <span style={{fontSize:10,fontWeight:600,color:C.textMid}}>{l.label}</span>
          {[['em',l.em],['th',l.th],['kin',l.kin],['exp',l.exp]].map(([k,v]) => (
            <div key={k} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
              {v!=null ? (<>
                <div style={{width:'80%',height:3,background:C.border,borderRadius:99,overflow:'hidden'}}>
                  <div style={{width:`${v}%`,height:'100%',background:DMG[k].color,borderRadius:99}}/>
                </div>
                <span style={{fontSize:9,fontWeight:600,color:DMG[k].color}}>{v.toFixed(0)}%</span>
              </>) : <span style={{fontSize:9,color:C.textMute}}>—</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Organized attribute panel — used in both ItemInfoSheet and ModuleInfoTab.
//
// `item` (optional) is this item's ENGINE object for the fit it is actually sitting in — a DogmaItem
// from calcFitStats' `fittedItems` / `fittedDrones`. Given one, every row gains a second value and
// the panel answers the question the type data cannot: what is this module doing HERE, with this
// ship's bonuses, these rigs, this heat and this roll on it. Without one (the module browser, the
// variations list, an implant search result) there is no fit to be current in, so the panel collapses
// back to a single column of type data — the pre-existing behaviour, unchanged.
//
// The two columns come from ONE object: `.get()` is post-modifier, `.getBase()` is pre. That split is
// also why an abyssal roll needs no special case — the engine setBase()es its mutations, so the base
// column already reads the ROLLED value rather than the stock item's, which is what "make its stats
// reflect what they truly are" asks for and what pyfa shows.
//
// `mutaplasmid` is the roll's mutaplasmid id, shown as the same grade badge the Variations tab uses.
//
// `overrides` is a plain attrName → current-value map that wins over `.get()`. It exists for missile
// charges, whose flight time, velocity, application and damage are computed in calc.js rather than by
// the engine — see `fittedChargeStats` there. Without it those rows would read current == base and
// claim nothing had modified them, which is the opposite of true.
//
// `bleed` is the host's own horizontal padding, in px. A modified row's highlight runs the full width
// of the screen rather than stopping at that padding, so the band reads as a property of the row and
// not as a box drawn inside it. It has to be passed because the four hosts do not agree (14 here and
// in DroneMenu, 16 in ItemInfoSheet, 14+2 nested in ModuleMenu) and a row cannot see its own inset.
function ItemInfoPanel({typeID, item, mutaplasmid, overrides, bleed=14}) {
  const typeDescriptions = useTypeDescriptions();
  const td = TYPES[String(typeID)] ?? TYPES[typeID];
  if (!td) return <div style={{padding:16,color:C.textMute,fontSize:12}}>No data available</div>;
  const attrs = td.attrs ?? td.a ?? {};
  const skills = getItemSkills(typeID);
  const meta = metaOf(typeID, null);
  // An `item` for a DIFFERENT type would silently print another module's numbers under this one's
  // name, which is the one failure mode here that looks like data rather than a bug.
  const eng = (item && Number(item.typeID) === Number(typeID)) ? item : null;
  // Overrides describe a fitted instance, so they are meaningless without one to describe.
  const ov = eng ? overrides : null;
  const grade = mutaplasmid ? abyssalGrade(mutaplasmid) : null;

  // Base resonances (Shield/Armor/Hull), only when a layer carries its full set of four — a
  // resistance module bonusing a single resonance stays a plain row below rather than a bar chart
  // for one value. BASE only (raw type attrs), per the ask: this reads the item's own numbers, not
  // whatever the current fit's skills/rigs have done to it.
  const resistKeys = new Set();
  const resistLayers = [];
  for (const def of RESIST_LAYER_DEFS) {
    if (def.keys.every(k => attrs[k] != null)) {
      const [em,th,kin,exp] = def.keys.map(k => Math.round((1-attrs[k])*1000)/10);
      resistLayers.push({label:def.label, em, th, kin, exp});
      def.keys.forEach(k => resistKeys.add(k));
    }
  }

  // Build section rows
  const shownKeys = new Set();
  const sections = [];
  for (const sec of INFO_SECTIONS) {
    const rows = sec.keys.filter(k => attrs[k] != null && !INFO_HIDDEN.has(k) && !resistKeys.has(k));
    if (rows.length) { sections.push({label:sec.label, rows}); rows.forEach(k=>shownKeys.add(k)); }
  }
  resistKeys.forEach(k => shownKeys.add(k));
  // Remaining attrs not in any section
  const other = Object.keys(attrs).filter(k => !shownKeys.has(k) && !INFO_HIDDEN.has(k) && typeof attrs[k] === 'number').sort((a,b)=>a.localeCompare(b));
  if (other.length) sections.push({label:'Other', rows:other});

  const GRID = eng ? '1fr auto auto' : '1fr auto';

  const Row = ({k}) => {
    const cur  = (ov && k in ov) ? ov[k] : (eng ? eng.get(k) : attrs[k]);
    const base = eng ? eng.getBase(k) : attrs[k];
    // Float dust, not a modifier: the engine multiplies through several pools, so an untouched
    // attribute can come back a few ULP off its own base. Compared relatively so the threshold means
    // the same thing for a 0.23 resonance and a 250,000 m lock range.
    const changed = eng && typeof cur === 'number' && typeof base === 'number'
      && Math.abs(cur - base) > Math.abs(base) * 1e-9 + 1e-12;
    // `better` is judged on RAW values (directionOf's contract, shared with the Variations tab), but
    // the ARROW has to describe the number printed beside it. Resonances are the one place those
    // disagree: they are stored as a multiplier and displayed as a resist percentage, so a resonance
    // going down is a resist going up.
    const better = changed ? directionOf(k, cur, base, typeID) : null;
    const dir = !changed ? 0
      : (RESIST_ATTRS.has(k) ? -Math.sign(cur - base) : Math.sign(cur - base));
    // A changed row widens by the host's padding and gives it straight back as its own padding, so
    // the band reaches the screen edges while the columns do not move. Deliberately not a pair of
    // offset box-shadows: accentLight is 10% alpha, and a left and a right shadow overlap each other
    // and the element's own background, so the middle of the row would paint three times over and
    // come out darker than the ends.
    return (
      <div style={{display:'grid',gridTemplateColumns:GRID,gap:10,alignItems:'baseline',
                   padding:changed?`5px ${bleed}px`:'5px 0',margin:changed?`0 ${-bleed}px`:0,
                   borderBottom:`1px solid ${C.border}`,
                   background:changed?`${C.accentLight}`:'transparent'}}>
        <span style={{fontSize:12,color:C.textMid,minWidth:0,wordBreak:'break-word'}}>{fmtAttrName(k)}</span>
        <span style={{fontSize:12,fontWeight:600,textAlign:'right',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',
                      color:changed?(better==null?C.text:(better?C.rig:C.danger)):C.text}}>
          {dir!==0&&<span style={{fontSize:7,verticalAlign:1,marginRight:3}}>{dir>0?'▲':'▼'}</span>}
          {fmtInfoVal(k, cur)}
        </span>
        {eng&&<span style={{fontSize:12,textAlign:'right',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',
                            color:changed?C.textMid:C.textMute}}>{fmtInfoVal(k, base)}</span>}
      </div>
    );
  };

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
          <div style={{display:'flex',gap:5,flexWrap:'wrap',alignItems:'center',marginTop:3}}>
            {meta && <span style={{fontSize:10,color:META_COLORS[meta]??C.textMute,background:`${C.border}88`,borderRadius:99,padding:'1px 7px',fontWeight:700}}>{meta}</span>}
            {/* Same badge as the Variations tab and the snapshot card, so a rolled module is
                recognisable as the same module wherever it appears. Sits beside the meta badge
                because it is the other half of "what item is this" — the name alone cannot say. */}
            {grade && <span style={{fontSize:9,lineHeight:1,fontWeight:800,letterSpacing:'.4px',textTransform:'uppercase',
                                    color:C.danger,background:'rgba(239,68,68,.12)',border:'1px solid rgba(239,68,68,.28)',
                                    borderRadius:4,padding:'3px 5px',whiteSpace:'nowrap'}}>▲ {grade}</span>}
          </div>
        </div>
      </div>
      {/* Description */}
      {desc && (
        <div style={{fontSize:12,color:C.textMid,lineHeight:1.55,marginBottom:14,padding:'10px 12px',background:C.surfaceAlt,borderRadius:8,border:`1px solid ${C.border}`}}>
          {desc}
        </div>
      )}
      {/* Under the description, above the skills — it is a fact about the item, not a stat. */}
      <ItemPrice typeID={typeID}/>
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
      {/* Base resistances — right under Required Skills, same slot on every item that has them,
          rather than wherever Shield happened to fall in the attribute section order. */}
      {resistLayers.length > 0 && (
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:C.textMute,textTransform:'uppercase',letterSpacing:.5,marginBottom:6}}>Resistances</div>
          <ResistBars layers={resistLayers}/>
        </div>
      )}
      {/* Attribute sections. The column header appears once, above all of them, rather than
          repeating per section — and only when there are two columns to name. Without it a row
          showing the same number twice reads as a rendering bug rather than "nothing changed". */}
      {eng && sections.length > 0 && (
        <div style={{display:'grid',gridTemplateColumns:GRID,gap:10,padding:'0 0 3px',
                     fontSize:9,fontWeight:700,color:C.textMute,textTransform:'uppercase',letterSpacing:.5}}>
          <span/>
          <span style={{textAlign:'right'}}>Current</span>
          <span style={{textAlign:'right'}}>Base</span>
        </div>
      )}
      {sections.map(sec => (
        <div key={sec.label} style={{marginBottom:10}}>
          <div style={{fontSize:10,fontWeight:700,color:C.textMute,textTransform:'uppercase',letterSpacing:.5,marginBottom:4,marginTop:4}}>{sec.label}</div>
          {sec.rows.map(k => <Row key={k} k={k}/>)}
        </div>
      ))}
    </div>
  );
}

// CCP writes trait text for hulls, structures AND T3 subsystems, in one three-part shape:
// per-skill-level sections, a role bonus, then anything else. Shared by the ship info sheet and the
// item detail sheet so a Legion's subsystem bonuses read exactly like its hull's.
//
// A T3 cruiser's bonuses live almost entirely on its SUBSYSTEMS — the hull's own trait text says
// little — so without this the numbers actually deciding the fit had nowhere to be shown.
function hasTraits(typeID){
  const t=(shipTraits??{})[String(typeID)];
  return !!(t&&(t.skills?.length||t.role||t.misc));
}

function TraitsPanel({typeID, empty="No trait data available."}){
  const t=(shipTraits??{})[String(typeID)]??{};
  const Section=({header,bonuses})=>(
    <div style={{marginBottom:14}}>
      {header&&<div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:6}}>{header}</div>}
      {(bonuses||[]).map((b,i)=>(
        <div key={i} style={{display:'flex',gap:6,padding:'2px 0'}}>
          {/* No minimum width. Reserving one aligned the descriptions into a column at the cost of a
              gutter after the short values that read as a missing word, and the values are all two to
              four characters anyway, so the column was nearly straight without paying for it. */}
          {b.number&&<span style={{fontSize:12,fontWeight:700,color:C.accent,flexShrink:0}}>{b.number}</span>}
          <span style={{fontSize:12,color:C.textMid}}>{b.text}</span>
        </div>
      ))}
    </div>
  );
  if(!hasTraits(typeID)) return <div style={{color:C.textMute,fontSize:13}}>{empty}</div>;
  return (
    <div>
      {t.skills?.map((s,i)=><Section key={i} header={s.header} bonuses={s.bonuses}/>)}
      {t.role&&<Section header={t.role.header||'Role Bonus:'} bonuses={t.role.bonuses}/>}
      {t.misc&&<Section header={t.misc.header||'Misc:'} bonuses={t.misc.bonuses}/>}
    </div>
  );
}

// Standalone bottom sheet for item info (triggered from browser or charge list)
function ItemInfoSheet({typeID, onClose, item, overrides}) {
  const sheet=useSheetDrag(onClose);
  return (
    <div style={{position:'fixed',inset:0,zIndex:400,display:'flex',flexDirection:'column',justifyContent:'flex-end'}} onClick={sheet.dismiss}>
      <div ref={sheet.sheetRef} style={{background:C.surface,borderRadius:'16px 16px 0 0',maxHeight:'88vh',display:'flex',flexDirection:'column',boxShadow:'0 -8px 32px rgba(0,0,0,.5)',...sheetTransform(sheet)}} onClick={e=>e.stopPropagation()}>
        <div style={{position:'relative'}}>
          <SheetGrabber grabHandlers={sheet.grabHandlers}/>
          <button onClick={sheet.dismiss} style={{position:'absolute',top:2,right:16,background:'none',border:'none',color:C.textMute,fontSize:22,cursor:'pointer',lineHeight:1}}>×</button>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'4px 16px 20px'}}>
          <ItemInfoPanel typeID={typeID} item={item} overrides={overrides} bleed={16}/>
        </div>
      </div>
    </div>
  );
}

// `engineItem` is the module's DogmaItem on the fit it is sitting in (calcFitStats' `fittedItems`,
// keyed by slot id). The abyssal roll rides in on `mod` and is only a BADGE here — the rolled numbers
// themselves are already the engine item's base values, so there is nothing to merge.
function ModuleInfoTab({typeID, mod, engineItem, bleed}) {
  return <ItemInfoPanel typeID={typeID ?? mod?.typeID} item={engineItem}
                        mutaplasmid={mod?.mutaplasmid} bleed={bleed}/>;
}

// Shared by the module browser, the structure module browser and the Variations tab, so the three
// never drift apart.
// `mutations` (optional) is an abyssal roll, keyed by ENGINE attribute name — so powergrid arrives as
// `power`, not `pg`. It wins outright: an abyssal module keeps its base typeID, so the type's own cpu
// and power are the pre-roll figures and would otherwise be the only ones this ever sees.
// Mutaplasmids don't touch calibration (they only exist for non-rig modules), so `calib` is untouched.
function fitCostParts(item, mutations) {
  const a = TYPES[item?.typeID]?.attrs ?? TYPES[item?.typeID]?.a ?? {};
  return {
    cpu:   mutations?.cpu   ?? item?.cpu   ?? a.cpu   ?? a['50'] ?? 0,
    pg:    mutations?.power ?? item?.pg    ?? a.power ?? a['30'] ?? 0,
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
// Proxy, not a plain object: `cal` reads C.rig (itself a live Proxy), so it must be resolved on
// each access rather than frozen at whatever palette was loaded when this module first imported.
const RES_INK = new Proxy({},{ get(_,key){ return { pg:"#e0a44a", cpu:"#5fb8d8", cal:C.rig }[key]; } });

// `headroom` (optional): {pg:{used,total}, cpu:{used,total}, cal:{used,total}, ratios} for the fit the
// module would be added to. Given it, a figure the fit cannot afford turns red — the same mark the
// Variations tab puts on a swap that won't fit. The browser is only ever opened on an EMPTY slot, so
// unlike the variations case there is no fitted module to back out first: the room left is just
// total - used.
//
// Only the NUMBER tints; the glyph keeps its own hue so the icon goes on meaning "this is PG/CPU/
// calibration" rather than "fits/doesn't". Exact whenever the fit already carries a module of the
// same group (a fifth launcher, a second plate) and best-effort otherwise, which is the common case
// for the first module of its kind.
function FitCost({item, size=11, headroom}) {
  const {cpu,pg,calib} = fitCostParts(item);
  const ratio = fitCostRatioOf(headroom, item?.typeID);
  const fits = (key, val) => fitCostFits(headroom?.[key], val, 0, ratio?.[key]);
  // Same glyph size FitCostDelta uses in the Variations tab (no size*0.95 shrink) — at ~10px the
  // CPU chip's corner pins were fine enough to disappear into a blob, reading as an unrelated diamond
  // rather than the same icon shown one tab over.
  const g = size;
  // The cell carries the hue, the glyphs are currentColor, and the number overrides back to a
  // neutral — so tinted icon against bright neutral digits, which is what makes the pair legible
  // rather than one small blur. Numbers sit at textMid, not textMute: the old #55555f was ~2.4:1
  // against the row background, which is under any reasonable floor for 10-11px text.
  const cell  = (key) => ({display:"inline-flex",alignItems:"center",gap:3.5,color:RES_INK[key]});
  const num   = {color:C.textMid,fontWeight:600};
  const row   = {fontSize:size,marginTop:1,display:"flex",alignItems:"center",gap:10,lineHeight:1.3};
  const part  = (key, Glyph, val, unit) => {
    const ok = fits(key, val);
    return (
      <span style={cell(key)} title={`${val}${unit}${ok === false ? " — won't fit" : ''}`}>
        <Glyph size={g}/><span style={ok===false?{...num,color:C.danger,fontWeight:700}:num}>{fmtResource(val)}</span>
      </span>
    );
  };
  if (calib > 0) return <div style={row}>{part('cal', CalGlyph, calib, ' calibration points')}</div>;
  if (!(pg > 0) && !(cpu > 0)) return null;
  return (
    <div style={row}>
      {pg  > 0 && part('pg',  PgGlyph,  pg,  ' MW powergrid')}
      {cpu > 0 && part('cpu', CpuGlyph, cpu, ' tf CPU')}
    </div>
  );
}

// Fitting cost is shown as GLYPHS on its own line above the other deltas, never as a named attribute
// row — it is the one comparison every variant swap has to clear (does it still fit?), and the same
// three icons already label it in the module browser and the resource strip. compare.js keeps cpu /
// power / upgradeCost out of the attribute list for the same reason, so nothing filters them here.
const hasDelta = st => st.delta != null && st.delta !== 0;

// A delta, as a direction and a magnitude rather than a signed number in brackets.
//
// The two halves say different things, and keeping them separate is what makes the mark readable:
// `dir` is which way the NUMBER PRINTED NEXT TO IT moved, `better` is whether that is good news.
// A variant with less CPU is ▼ and green. Collapsing the two — pointing ▲ whenever a change is
// beneficial — reads as "this variant uses more CPU" at a glance and is worse than no arrow.
//
// The one apparent exception isn't one: resonances are stored inverted but DISPLAYED as resists, so
// there the caller passes the direction the resist moved, which is still the printed number.
//
// `better === null` means no judgement (CCP has no opinion, or nothing changed — the `=` branch).
function DeltaMark({dir, text, better}) {
  const color = better == null ? C.textMute : (better ? C.rig : C.danger);
  if (!dir) return <span style={{color:C.textMid,fontSize:10,marginLeft:3}} title="same as fitted">=</span>;
  return (
    <span style={{color,marginLeft:3,whiteSpace:"nowrap"}}>
      <span style={{fontSize:7,verticalAlign:1,marginRight:2}}>{dir > 0 ? '▲' : '▼'}</span>{text}
    </span>
  );
}

// The powergrid / CPU / calibration line for one variant, measured against the fitted module.
// Deliberately shown even when a value is IDENTICAL (an "=" rather than nothing): the question being
// asked here is "will this still fit", and an absent row cannot be told apart from an attribute that
// simply did not make the six-row cut.
// `baseTypeID` null = this IS the fitted module: show the values as a reference, with nothing to
// compare them against.
//
// `resourceHeadroom` (optional): {pg:{used,total}, cpu:{used,total}, cal:{used,total}, ratios} for the
// fit this module sits in. When given (and this isn't the fitted-module reference row), each figure's
// number tints red if the SWAP wouldn't fit (stays the normal colour if it would) — the glyph is
// left alone so the icon's own colour keeps meaning "this is PG/CPU/calibration", not "fits/doesn't".
// Rest of the fit's usage is `used - base` (backing the fitted module out), so
// `val <= total - (used - base)` is "yes, room for it".
//
// Both sides of that are scaled by the fitted module's group multiplier first, because `used` is
// engine-computed while `val`/`base` are base attributes — see `costRatio`. Here it is always EXACT:
// the module being measured against is by definition fitted, so its own ratio is in the map. The
// ratio is taken from the FITTED module rather than each variant, which is also what makes a family
// that straddles two dogma groups (a Medium Ancillary Remote Shield Booster next to a plain one)
// come out right.
//
// `mutations` (optional): the FITTED module's abyssal roll. It describes the module every row is
// measured against, so it applies to `b` on every variant row, and to `v` only on the fitted module's
// own row — a variant is an unrolled item.
function FitCostDelta({typeID, baseTypeID, resourceHeadroom, mutations}) {
  const v = fitCostParts({typeID}, baseTypeID == null ? mutations : null);
  const b = baseTypeID != null ? fitCostParts({typeID: baseTypeID}, mutations) : v;
  const g = 11;
  // Inner span: glyph + number only — no DeltaMark inside the flex row so the delta gets the
  // same 3px gap (DeltaMark's own marginLeft) as it does next to the attribute list values.
  // With DeltaMark as a flex child it was getting gap(3.5) + marginLeft(3) = 6.5px, visibly wider.
  const cell = k => ({display:"inline-flex",alignItems:"center",gap:3.5,color:RES_INK[k]});
  const num  = {color:C.text,fontWeight:700};
  const ratio = fitCostRatioOf(resourceHeadroom, baseTypeID);
  const part = (key, Glyph, val, base, unit) => {
    const d = val - base;
    const fits = baseTypeID == null ? null
      : fitCostFits(resourceHeadroom?.[key], val, base, ratio?.[key]);
    return (
      <span key={key} style={{...cell(key),flexWrap:"nowrap"}} title={`${val}${unit}${baseTypeID == null ? '' : d ? ` (${d > 0 ? '+' : '−'}${Math.abs(d)} vs fitted)` : ' — same as fitted'}${fits == null ? '' : fits ? ' — fits' : " — won't fit"}`}>
        <span style={{display:"inline-flex",alignItems:"center",gap:3.5}}>
          <Glyph size={g}/><span style={fits===false?{...num,color:C.danger}:num}>{fmtResource(val)}</span>
        </span>
        {/* Fitting cost is always lower-is-better, whatever the attribute's own highIsGood says —
            but that belongs in the COLOUR. The arrow tracks the number, so cheaper is ▼ and green. */}
        {baseTypeID != null && <DeltaMark dir={Math.sign(d)} text={fmtResource(Math.abs(d))} better={d ? d < 0 : null}/>}
      </span>
    );
  };
  const cells = (v.calib > 0 || b.calib > 0)
    ? [part('cal', CalGlyph, v.calib ?? 0, b.calib ?? 0, ' calibration')]
    : [ (v.pg  > 0 || b.pg  > 0) && part('pg',  PgGlyph,  v.pg,  b.pg,  ' MW'),
        (v.cpu > 0 || b.cpu > 0) && part('cpu', CpuGlyph, v.cpu, b.cpu, ' tf') ].filter(Boolean);
  if (!cells.length) return null;
  return <div style={{display:"flex",flexWrap:"wrap",gap:'3px 12px',marginTop:5,marginLeft:35,fontSize:10,fontVariantNumeric:'tabular-nums'}}>{cells}</div>;
}

function ModuleVariationsTab({typeID, currentName, onSwap, readOnly, resourceHeadroom, baseMutations, baseMutaplasmid}) {
  const raw = typeID ? variantsOf(typeID) : [];
  const vars = raw.map(v=>({...v, meta: metaOf(v.typeID, v.meta)}));
  const [sortBy, setSortBy] = useState('price');
  // Tapping the ACTIVE sort flips direction; tapping the other one switches to it at its natural
  // default (cheapest first, lowest meta first) rather than inheriting the previous direction,
  // which would otherwise silently hand you a reversed list you did not ask for.
  const [sortDir, setSortDir] = useState('asc');
  const [prices, setPrices] = useState(null);

  // One batched request for the whole variant set — fetchPrices dedupes and serves from cache, so
  // reopening the tab (or an item already priced as part of the fit total) costs nothing.
  const ids = vars.map(v=>v.typeID).filter(Boolean);
  const idKey = ids.slice().sort((a,b)=>a-b).join(',');
  useEffect(()=>{
    if(!ids.length){setPrices(null);return;}
    let cancelled=false;
    let hub='Jita',source='fuzzwork';
    try{hub=localStorage.getItem(PRICE_HUB_KEY)||hub;source=localStorage.getItem(PRICE_SOURCE_KEY)||source;}catch{}
    fetchPrices(ids,hub,source).then(m=>{if(!cancelled)setPrices(m);}).catch(()=>{if(!cancelled)setPrices(new Map());});
    return()=>{cancelled=true;};
  },[idKey]);// eslint-disable-line react-hooks/exhaustive-deps

  if (!vars.length) return <div style={{padding:16,color:C.textMute,fontSize:12}}>No variation data available.</div>;

  // Deltas are measured against the module ACTUALLY FITTED — including its abyssal roll, since an
  // abyssal module keeps its base typeID and comparing against the unrolled item answers a question
  // nobody asked.
  const abyssal = !!baseMutations && Object.keys(baseMutations).length > 0;
  const rows = sortCompareRows(compareRows(vars.map(v=>v.typeID), typeID, {baselineMutations:baseMutations}),
                               {by:sortBy, dir:sortDir, prices});
  const byID = new Map(vars.map(v=>[String(v.typeID), v]));
  // An abyssal module has no market price — its worth is the roll, which spans orders of magnitude
  // on contracts. The base item's Jita price is not a stand-in for it, so there is nothing honest to
  // subtract and the price delta is suppressed rather than guessed at.
  const basePrice = abyssal ? null : prices?.get(Number(typeID));
  const grade = abyssalGrade(baseMutaplasmid);

  const Sort = ({k,label}) => {
    const on=sortBy===k;
    return(
    <button onClick={()=>{haptic();if(on)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortBy(k);setSortDir('asc');}}}
      title={on?`${label}, ${sortDir==='asc'?'lowest':'highest'} first — tap to reverse`:`Sort by ${label.toLowerCase()}`}
      style={{display:"flex",alignItems:"center",gap:3,padding:"3px 9px",borderRadius:6,fontSize:10,fontWeight:700,cursor:"pointer",
      background:on?C.accentLight:"none",border:`1px solid ${on?C.accentBorder:C.border}`,
      color:on?C.accent:C.textMute}}>{label}
      {/* The arrow only shows on the ACTIVE control: a direction on an inactive sort would imply
          it is doing something. */}
      {on&&<span style={{fontSize:9}}>{sortDir==='asc'?'↑':'↓'}</span>}
    </button>);
  };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:'6px 0 9px'}}>
        <span style={{fontSize:10,color:C.textMute}}>{rows.length} variants · vs fitted{abyssal&&' roll'}</span>
        <div style={{display:"flex",gap:5}}><Sort k="price" label="Price"/><Sort k="meta" label="Meta Level"/></div>
      </div>
      {rows.map(r => {
        const v = byID.get(String(r.typeID)); if(!v) return null;
        // The fitted abyssal row's own "price" would be the base item's — the one number that is
        // certainly not what this module is worth.
        const price = (abyssal&&r.isBaseline)?null:prices?.get(Number(r.typeID));
        const dPrice = (price!=null&&basePrice!=null)?price-basePrice:null;
        return (
          // The stock row shares a typeID with the fitted abyssal one, so the flag has to be in the key.
          <div key={`${r.typeID}${r.isStockBase?':stock':''}`} onClick={()=>{if(!readOnly&&!r.isBaseline)onSwap(v);}}
            style={{padding:'9px 4px',borderBottom:`1px solid ${C.border}`,
                    cursor:(readOnly||r.isBaseline)?'default':'pointer',
                    background:r.isBaseline?C.accentLight:'transparent'}}>
            <div style={{display:'flex',alignItems:'center',gap:9}}>
              {v.typeID&&<img className="eve-icon" src={eveIcon(v.typeID,32)} width={26} height={26} alt="" onError={e=>{e.target.style.display="none";}}/>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:r.isBaseline?C.accent:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                  {v.name}{r.isBaseline&&<span style={{fontSize:9,color:C.accent,marginLeft:6}}>FITTED</span>}
                  {/* Same name as the row above it, so without this the two read as a duplicate. */}
                  {r.isStockBase&&<span style={{fontSize:9,color:C.textMute,marginLeft:6}}>UNMUTATED</span>}
                </div>
                {/* Price and its delta lead, because that is the axis this view exists to serve. */}
                <div style={{fontSize:10,marginTop:2,display:'flex',gap:8,alignItems:'baseline',fontVariantNumeric:'tabular-nums'}}>
                  {/* The fitted abyssal row has no price to show, so it carries the same red grade
                      badge the snapshot card uses — which says WHY there is no number, and names the
                      mutaplasmid, rather than leaving the row to read as missing data. */}
                  {(abyssal&&r.isBaseline&&grade)
                    ? <span style={{fontSize:9,lineHeight:1,fontWeight:800,letterSpacing:'.4px',textTransform:'uppercase',
                                    color:C.danger,background:'rgba(239,68,68,.12)',border:'1px solid rgba(239,68,68,.28)',
                                    borderRadius:4,padding:'3px 5px',whiteSpace:'nowrap'}}>▲ {grade}</span>
                    : <span style={{color:C.textMid,fontWeight:600}}>{price!=null?`${fmtResource(price)} ISK`:'no price'}</span>}
                  {dPrice!=null&&dPrice!==0&&
                    <span style={{color:dPrice<0?C.rig:C.warning}}>{dPrice>0?'+':'−'}{fmtResource(Math.abs(dPrice))}</span>}
                </div>
              </div>
              <span style={{fontSize:10,color:META_COLORS[v.meta]??C.textMid,background:`${C.border}88`,borderRadius:99,padding:'1px 7px',fontWeight:700,flexShrink:0}}>{v.meta}</span>
            </div>
            {/* Fitting cost leads, on its own line: it is the constraint, not one attribute among
                several. Shown on every row including the fitted one, where it reads as a reference
                value with no delta beside it. */}
            <FitCostDelta typeID={r.typeID} baseTypeID={r.isBaseline?null:typeID} resourceHeadroom={resourceHeadroom} mutations={baseMutations}/>
            {/* Only the attributes that DIFFER across this variant set, as deltas. `better` is null
                for an unchanged value, and those stay neutral — no change is not an improvement. */}
            {!r.isBaseline&&r.stats.some(hasDelta)&&(
              <div style={{display:'flex',flexWrap:'wrap',gap:'3px 10px',marginTop:5,marginLeft:35,fontSize:10}}>
                {r.stats.filter(hasDelta).map(st=>{
                  // The delta is taken in DISPLAY space, not raw, so that the arrow always describes
                  // the number printed beside it (DeltaMark's contract). It matters wherever the two
                  // spaces disagree about direction: rate of fire is stored as a cycle-time
                  // MULTIPLIER, and a resist bonus is stored negative, so in both cases the raw
                  // difference points the opposite way from what is shown. For every other attribute
                  // the transform is the identity and this is just `st.delta`.
                  const val=fmtMutaVal(st.key,st.value);
                  const dRaw=mutaToDisplay(st.key,st.value)-mutaToDisplay(st.key,st.value-st.delta);
                  const dTxt=fmtMutaDisplay(st.key,Math.abs(dRaw));
                  return(
                  <span key={st.key} style={{color:C.textMid}}>
                    {mutaLabel(st.key)} <span style={{fontWeight:700,color:C.text}}>{val}</span>
                    <DeltaMark dir={(/[Rr]esonance/.test(st.key)&&st.better!=null)?(st.better?1:-1):Math.sign(dRaw)} text={dTxt} better={st.better}/>
                  </span>);
                })}
              </div>
            )}
          </div>
        );
      })}
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
/**
 * `actions` are caller-supplied buttons shown above the tabs — used by implants for "Fit the whole
 * set" and "Change implant", so those are reachable from the same sheet that tells you what the
 * implant does, without this component needing to know what an implant is.
 */
export function ItemDetailSheet({typeID, name, onClose, onSwap, actions, item}) {
  // Traits only appears for things CCP actually wrote trait text for — in this sheet that is the T3
  // subsystems. Showing an always-empty third tab on every drone and implant would cost more than it
  // gives, and the tab row is already tight on a phone.
  //
  // Where it does appear it leads, and opens selected: the bonuses ARE the reason you pick one
  // subsystem over another, whereas Info is the same boilerplate description on all of them. Every
  // other item type is unaffected and still opens on Info.
  const traits = hasTraits(typeID);
  const [tab, setTab] = useState(traits ? "traits" : "info");
  const title = name ?? TYPES[typeID]?.n ?? TYPES[String(typeID)]?.n ?? "Item";
  const TABS = [...(traits ? [["traits", "Traits"]] : []), ["info", "Info"], ["vars", "Variations"]];
  return (
    <BottomSheet title={title} onClose={onClose} height="82vh">
      {actions?.length>0&&(
        <div style={{display:"flex",gap:8,padding:"10px 14px",borderBottom:`1px solid ${C.border}`}}>
          {actions.map(a=>(
            <button key={a.label} onClick={()=>{haptic();a.onClick();if(a.closes!==false)onClose();}}
              title={a.title}
              style={{flex:1,padding:"8px 0",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",
                      background:a.danger?"rgba(239,68,68,.1)":a.primary?C.accentLight:C.surfaceAlt,
                      border:`1px solid ${a.danger?"rgba(239,68,68,.3)":a.primary?C.accentBorder:C.border}`,
                      color:a.danger?C.danger:a.primary?C.accent:C.textMid}}>{a.label}</button>
          ))}
        </div>
      )}
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
        {TABS.map(([k, label]) => (
          <button key={k} onClick={()=>setTab(k)}
            style={{flex:1,padding:"9px 0",fontSize:12,fontWeight:600,background:"none",border:"none",cursor:"pointer",
                    color:tab===k?C.accent:C.textMute,borderBottom:tab===k?`2px solid ${C.accent}`:"2px solid transparent"}}>{label}</button>
        ))}
      </div>
      <div style={{padding:"4px 14px 16px"}}>
        {tab==="info" && <ItemInfoPanel typeID={typeID} item={item} bleed={14}/>}
        {tab==="traits" && <div style={{paddingTop:12}}><TraitsPanel typeID={typeID}/></div>}
        {/* readOnly when the caller gave no handler, so the list stops advertising "tap to swap"
            on rows that cannot do anything — which is how this shipped for boosters. */}
        {tab==="vars" && <ModuleVariationsTab typeID={typeID} currentName={title} readOnly={!onSwap}
                            onSwap={v=>{ onSwap(v); onClose(); }}/>}
      </div>
    </BottomSheet>
  );
}

// ── Abyssal (mutaplasmid) module support ─────────────────────────────────────
const MUTA_ATTR_LABELS={boosterEffectChance1:"Side Effect Chance",armorDamageAmountBonus:"Armor Repair Bonus",boosterMissileAOECloudPenalty:"Explosion Radius Penalty",capacitorNeed:"Activation Cost",cpu:"CPU",power:"Powergrid",maxRange:"Optimal Range",falloff:"Falloff",duration:"Cycle Time",energyNeutralizerAmount:"Neut Amount",speedFactor:"Velocity Bonus",maxVelocityBonus:"Max Velocity Bonus",signatureRadiusBonus:"Sig Radius Penalty",signatureRadiusBonusPercent:"Sig Radius Bonus",armorDamageAmount:"Armor Repaired",shieldBonus:"Shield Repaired",reloadTime:"Reload Time",mass:"Mass",armorHpBonus:"Armor HP",shieldCapacityBonus:"Shield HP",massAddition:"Mass Addition",scanResolutionBonus:"Scan Res. Bonus",maxTargetRangeBonus:"Lock Range Bonus",trackingSpeedBonus:"Tracking Bonus",aoeCloudSizeBonus:"Expl. Radius Bonus",aoeVelocityBonus:"Expl. Velocity Bonus",explosionDelayBonus:"Flight Time Bonus",missileVelocityBonus:"Missile Velocity Bonus",warpScrambleRange:"Warp Disrupt Range",thermalDamage:"Thermal Dmg",kineticDamage:"Kinetic Dmg",emDamage:"EM Dmg",explosiveDamage:"Explosive Dmg",damageMultiplier:"Damage Multiplier",speedMultiplier:"Rate of Fire",speed:"Rate of Fire",armorRepairPerCapacitor:"Rep / Cap",armorRepairPerTime:"Rep / Time",
// A command burst's four buff slots all carry the same strength, and the compare view keeps
// whichever one ranks first — so all four need the label, not just slot 1. Without it the row read
// "Warfare Buff 1 Value 1.25", which names an internal attribute rather than the thing it decides.
warfareBuff1Value:"Burst Strength",warfareBuff2Value:"Burst Strength",warfareBuff3Value:"Burst Strength",warfareBuff4Value:"Burst Strength",buffDuration:"Burst Duration",
// T3 subsystem fitting deltas. The raw names camel-case into "Hi Slot Modifier" / "Cpu Output
// Bonus2", which is both ugly and vaguer than the thing itself — you are choosing a slot layout.
hiSlotModifier:"High Slots",medSlotModifier:"Mid Slots",lowSlotModifier:"Low Slots",
turretHardPointModifier:"Turret Hardpoints",launcherHardPointModifier:"Launcher Hardpoints",
cpuOutput:"CPU Output",cpuOutputBonus2:"CPU Bonus",powerOutput:"Powergrid Output",
powerEngineeringOutputBonus:"Powergrid Bonus"};
// camelCase -> words, keeping ACRONYMS intact: a naive /([A-Z])/ split turned
// `boosterArmorHPPenalty` into "Booster Armor H P Penalty". The leading "Booster " is then dropped
// as redundant — you are already looking at a booster.
const mutaLabel=(name)=>MUTA_ATTR_LABELS[name]??String(name)
  .replace(/([a-z\d])([A-Z])/g,'$1 $2')      // armorHP -> armor HP
  .replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2')  // HPPenalty -> HP Penalty
  .replace(/^booster\s+/i,'')
  .replace(/^./,c=>c.toUpperCase());
// Display scaling for a mutated attribute. Both the read-only rendering and the TYPED input go
// through this, so the units a value is shown in are exactly the units you type it back in — if the
// unit for an attribute is ever corrected, both follow automatically.
const PERCENT_ATTRS=new Set(["aoeCloudSizeBonus","armorDamageAmountBonus","trackingSpeedBonus",
  "capacitorCapacityBonus","shieldBoostMultiplier","shieldCapacityBonus","maxVelocityBonus",
  "armorHpBonus","signatureRadiusBonus","falloffBonus","maxRangeBonus","durationBonus"]);
const mutaUnit=(name)=>{
  if(MUTA_RATE_PCT.has(name)||RESIST_BONUS_RE.test(name)) return {scale:1,unit:"%",dp:2};
  // A "chance" is stored as a 0..1 fraction; 0.2000 tells you nothing at a glance, 20% does.
  if(/chance/i.test(name)) return {scale:0.01,unit:"%",dp:0};
  // Booster bonuses and penalties are all expressed as PERCENTAGES. Listed rather than matched on a
  // /Bonus$/ pattern, because that would also catch `capacityBonus` — a shield extender's flat
  // +2600 HP, which is emphatically not a percentage.
  if(PERCENT_ATTRS.has(name)||/Penalty$/.test(name)) return {scale:1,unit:"%",dp:2};
  if(/Range|maxRange|falloff/i.test(name)) return {scale:1000,unit:"km",dp:2};
  if(/duration|reloadTime|explosionDelay/i.test(name)) return {scale:1000,unit:"s",dp:2};
  if(/mass/i.test(name)) return {scale:1,unit:"kg",dp:0};
  // The generic 2dp bucket below rounds a BCS/gyro/heat sink roll (e.g. 1.137069) down to 1.14,
  // which is too coarse to tell two rolls apart — this is the one stat abyssal traders actually
  // compare rolls by. One more digit than the default.
  if(name==="damageMultiplier") return {scale:1,unit:"",dp:3};
  return {scale:1,unit:"",dp:null};   // dp null → magnitude-dependent precision
};

// Attributes whose raw value is a multiplier the cycle time is DIVIDED by, so the bare number tells
// you nothing: a Gyrostabilizer II's speedMultiplier of 0.895 actually means "+11.7% rate of fire".
// Shown — and edited — as that percentage instead. The mapping is monotonically DECREASING, so a
// smaller raw value is a bigger percentage and the min/max ends of the range swap when displayed.
const MUTA_RATE_PCT=new Set(["speedMultiplier"]);

// A resist module stores its bonus NEGATIVE (a Multispectrum Energized Membrane is
// emDamageResistanceBonus -20), because dogma multiplies it into a resonance — the fraction of
// damage that gets THROUGH. Nobody thinks of it that way: a better membrane gives you MORE resist.
// Shown as the positive resist percentage so the printed number rises with the ship's resists, which
// is what makes DeltaMark's arrow point up on a better variant without special-casing the arrow.
// Safe as a blanket rule: every fittable module in the bundle carries these negative, and the only
// positive occurrences are environment Effect Beacons, which never reach these formatters.
const RESIST_BONUS_RE=/DamageResistanceBonus$/;
const mutaToDisplay=(name,v)=>MUTA_RATE_PCT.has(name)?(1/v-1)*100:RESIST_BONUS_RE.test(name)?-v:v;
const mutaFromDisplay=(name,d)=>MUTA_RATE_PCT.has(name)?1/(1+d/100):RESIST_BONUS_RE.test(name)?-d:d;
// Does the display mapping DECREASE as the raw value rises? Both transforms above are monotonic, so
// probing two points settles it and there is no second list to keep in step with them.
const mutaDisplayInverted=(name)=>mutaToDisplay(name,2)<mutaToDisplay(name,1);

// Plain (no thousands separators) rendering in display units — what goes INTO the text box, so it
// stays parseable when the user edits it.
// Trailing zeros carry no information and cost width on a phone: a booster penalty of exactly 20
// reads "20", not "20.00". The decimals are still produced first, so a value that genuinely has
// them (1.25, 11.73) keeps every digit it needs.
const trimZeros=(t)=>t.includes('.')?t.replace(/\.?0+$/,''):t;
// The display-space half is separate so a DIFFERENCE between two display values can be formatted the
// same way a value is, without a raw number to convert that would not survive the round trip.
const mutaDisplayStr=(name,d)=>{
  const u=mutaUnit(name);
  if(u.dp!=null) return trimZeros((d/u.scale).toFixed(u.dp));
  const a=Math.abs(d); return trimZeros(a>=100?d.toFixed(1):a>=1?d.toFixed(2):d.toFixed(4));
};
const mutaValStr=(name,v)=>mutaDisplayStr(name,mutaToDisplay(name,v));
const fmtMutaDisplay=(name,d)=>{ if(d==null) return "—"; const u=mutaUnit(name); if(u.unit==="kg") return `${Math.round(d).toLocaleString()} kg`; // No space before a percent sign — "20%", not "20 %". Every other unit keeps its space ("17 km").
  return u.unit?`${mutaDisplayStr(name,d)}${u.unit==="%"?"":" "}${u.unit}`:mutaDisplayStr(name,d); };
const fmtMutaVal=(name,v)=>v==null?"—":fmtMutaDisplay(name,mutaToDisplay(name,v));

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
  // While a slider is held, its value lives HERE and not in the fit. Committing on every pixel of
  // travel ran a whole fit recalculation per input event — the engine resets and re-applies every
  // attribute pool, then the entire fit tree re-renders — so the thumb lagged the finger badly on a
  // phone. Nothing on this panel needs the fit to redraw: the value, the delta and the bar's colour
  // are all computed from the roll itself, so they stay live at full frame rate off `drag` alone.
  // The commit lands on release, which is also when the stats behind the sheet update.
  //
  // The ref shadows the state because the release handler needs the final value in the same tick,
  // before the re-render that `setDrag` schedules. Both live up here with the other hooks: the
  // component returns early when no mutaplasmid is applied, so a hook below that point changes the
  // hook count the moment one IS applied, and React throws on the next render.
  const[drag,setDrag]=useState(null);
  const dragRef=useRef(null);
  const lastPush=useRef({key:null,t:0});
  // Double-tap a slider to put that attribute back to its unmutated base. Dragging there by hand
  // means hunting a detent one step of four hundred wide, and on the 138 ranges whose base sits off
  // the track entirely it cannot be reached at any width — so the only existing route back was Undo,
  // which walks the whole editor's history rather than this one attribute.
  //
  // Both refs live up here with the other hooks for the reason the note on `drag` gives: this
  // component returns early when no mutaplasmid is applied, so a hook declared below that point
  // changes the hook count the moment one is applied.
  const tapRef=useRef({name:null,t:0});
  const downRef=useRef({x:0,y:0});
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
  const commitDrag=()=>{const d=dragRef.current;if(!d)return;dragRef.current=null;setDrag(null);setVal(d.name,d.value);};
  // A pointer release on a slider: ordinarily a commit, but two stationary releases in quick
  // succession on the SAME slider reset it to base instead.
  //
  // A range input treats a bare tap as a seek, so the first tap moves the value before the reset
  // lands. That is deliberately not suppressed: `pushHistory` merges same-slider edits inside 900ms,
  // so in the normal case the tap and the reset collapse into one history entry and Undo steps back
  // to the value from before the gesture rather than into the middle of it.
  //
  // The distance test is what separates this from a fast pair of drags, which is a real way to tune
  // a value and must not silently wipe it. Ten pixels is below a finger's own wobble on a tap and
  // well under any drag worth keeping.
  const endDrag=(e,name,base)=>{
    const still=Math.hypot(e.clientX-downRef.current.x,e.clientY-downRef.current.y)<10;
    // e.timeStamp, NOT Date.now() — see the note on DOUBLE_TAP_MS. The first tap commits a value,
    // which recalculates the whole fit; measured off the clock the second tap always looks late and
    // the reset could never fire.
    const now=e.timeStamp;
    const dbl=still&&tapRef.current.name===name&&now-tapRef.current.t<DOUBLE_TAP_MS;
    tapRef.current=dbl?{name:null,t:0}:{name:still?name:null,t:now};
    if(!dbl){commitDrag();return;}
    // Drop the second tap's seek rather than committing it — the gesture asked for base, not for
    // wherever the finger happened to land. Tested against the COMMITTED value, not the rendered one:
    // by now the seek has already been through setDrag and a re-render, so the displayed value is the
    // tap's, and comparing that would call a double-tap on the base tick a no-op while leaving the
    // first tap's seek behind.
    dragRef.current=null;setDrag(null);
    if((mod.mutations?.[name]??base)===base)return;   // already home — don't bank an undo step
    haptic("medium");
    setVal(name,base);
  };
  return(<div style={{padding:"10px 12px"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
      <span style={{fontSize:11,fontWeight:700,color:C.accent}}>{m.n}</span>
      <button onClick={()=>{pushHistory('remove');onUpdateMod({...mod,mutaplasmid:undefined,mutations:undefined});}} style={{background:"none",border:`1px solid ${C.danger}`,color:C.danger,borderRadius:6,padding:"3px 8px",fontSize:10,fontWeight:700,cursor:"pointer"}}>Remove</button>
    </div>
    {ranges.map(r=>{
      const cur=drag?.name===r.name?drag.value:(mod.mutations?.[r.name]??r.base);
      // Delta vs the unmutated base. For a percentage-displayed attribute the raw ratio has the
      // wrong SIGN (a lower speedMultiplier is a better roll), so compare in display space, where
      // "up is better" holds for everything.
      const inverted=mutaDisplayInverted(r.name);   // lower raw = better roll; see the slider below
      const pct=inverted
        ? mutaToDisplay(r.name,cur)-mutaToDisplay(r.name,r.base)
        : (cur/r.base-1)*100;
      // Green means BETTER, not BIGGER — opposite for 19 of the 49 attributes a mutaplasmid can
      // roll (CPU, powergrid, activation cost, the MWD's signature penalty, mass, reload, cycle
      // time, the hull resonances), so a plain `pct>0` painted a +25% CPU cost green.
      //
      // Asked of `directionOf` — the SAME function the Variations tab uses — rather than of CCP's
      // raw highIsGood, because this panel and that tab are answering the same question about the
      // same module, one slider-drag apart, and highIsGood alone gets a whole family wrong: it
      // describes an attribute in isolation, while a module's sign convention is a property of the
      // module. A stasis webifier rolled from -60 to -66 is a STRONGER web, and the flag (set for
      // the propulsion-module use of the same speedFactor) reads it as the worse number.
      //
      // It takes RAW values, which is also what sidesteps `inverted`: the display transform never
      // enters into it.
      const better=Math.abs(pct)<0.1?null:directionOf(r.name,cur,r.base,mod.typeID);
      const deltaColor=better==null?C.textMute:(better?C.rig:C.danger);
      // Where the base sits along the TRACK. A mutaplasmid's range is rarely symmetric about the
      // base (a Decayed rolls -30%/+20%), so this is not the midpoint, and the "base" label below
      // the slider — which is centred — does not indicate it.
      //
      // On 138 ranges it is not on the track at all: a mutaplasmid that only makes an attribute
      // WORSE starts its range past the base (Unstable rolls capacitorNeed 1.4x-1.8x, so base 5
      // sits left of a 7-9 slider). There is no base to return to, so no tick and no detent —
      // snapToBase already declines, since the gap exceeds the whole range.
      // Which way the slider is DRAWN, which is not the same question as `inverted` and had been
      // sharing its answer. Two independent reasons the raw axis runs backwards:
      //
      //  - the display transform reverses it (rate of fire: a lower speedMultiplier is a faster gun);
      //  - the base is NEGATIVE, so the attribute's MAGNITUDE is its strength. A web at -60 rolls to
      //    -66, a cap battery's energyWarfareResistanceBonus to -28, a siege module's logistics
      //    duration likewise — in raw ascending order the strong end lands on the LEFT.
      //
      // XOR, not OR: `mutaToDisplay` already negates the resist-bonus family, so a value that is both
      // negated for display AND stored negative has flipped once and must not flip twice. Tested on
      // the range's own base rather than the attribute name, which is what keeps a MICROWARPDRIVE —
      // same `speedFactor`, positive — running the normal way round.
      const mirrored=inverted!==(r.base<0);
      const baseOnSlider=mirrored?(r.min+r.max-r.base):r.base;
      const sliderFrac=r.max>r.min?(baseOnSlider-r.min)/(r.max-r.min):0.5;
      const baseOnTrack=sliderFrac>=0&&sliderFrac<=1;
      // Where a fraction of the RANGE sits along the drawn track. The thumb's centre travels between
      // half a thumb from each end, so a bare percentage drifts off by up to 7px near an extreme —
      // enough to visibly miss the base tick. The tick and the bar's two ends all go through here, so
      // they cannot disagree about where a value is.
      const trackPos=(f)=>`calc(${(f*100).toFixed(3)}% + ${((0.5-f)*14).toFixed(2)}px)`;
      const curFrac=r.max>r.min?((mirrored?(r.min+r.max-cur):cur)-r.min)/(r.max-r.min):0.5;
      // Clamped because the base is off the track entirely on 138 ranges (a mutaplasmid that only
      // makes an attribute worse starts past it), and the bar then runs from the edge it lies beyond.
      const originFrac=Math.min(1,Math.max(0,sliderFrac));
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
        {/* The tick marks the detent. Its position is the knob's, so it is measured in the same
            (possibly mirrored) space the slider is drawn in, and the ±7px term corrects for the
            thumb's own width — the knob's centre travels between half a thumb from each end, so a
            plain percentage drifts off the tick as the base approaches either extreme. */}
        <div style={{position:"relative"}}>
          {baseOnTrack&&<div style={{position:"absolute",left:trackPos(sliderFrac),
                       top:2,bottom:2,width:2,marginLeft:-1,borderRadius:1,background:C.borderStrong,pointerEvents:"none"}}/>}
          {/* The bar's colour is `deltaColor`, the same value the percentage above it is painted in —
              one judgement, shown twice. At the base it is C.textMute, which never shows: the bar has
              zero width there. */}
          <input type="range" className="vv-muta" min={r.min} max={r.max} step={(r.max-r.min)/400||0.01}
                 value={mirrored?(r.min+r.max-cur):cur}
                 onChange={e=>{
                   const v=Number(e.target.value);
                   const raw=snapToBase(mirrored?(r.min+r.max-v):v,r.base,r.min,r.max);
                   if(raw===r.base&&cur!==r.base) haptic("light");   // only on ENTERING the detent
                   dragRef.current={name:r.name,value:raw};
                   setDrag(dragRef.current);
                 }}
                 // Release, however it arrives: a finger lifted, a drag cancelled by a system
                 // gesture, an arrow key let go, or focus leaving mid-drag. Committing twice is
                 // harmless — commitDrag clears the ref first — and never committing is not, since
                 // the roll would be visible on the slider but absent from the fit.
                 //
                 // Only the finger-lifted case routes through endDrag, since it is the only one that
                 // could be half of a double-tap. The others stay plain commits; a cancelled or
                 // blurred drag is not a tap and must not arm the reset. onLostPointerCapture still
                 // follows a reset, but commitDrag no-ops once endDrag has cleared the ref.
                 title="Double-tap to reset to base"
                 onPointerDown={e=>{downRef.current={x:e.clientX,y:e.clientY};}}
                 onPointerUp={e=>endDrag(e,r.name,r.base)} onPointerCancel={commitDrag}
                 onLostPointerCapture={commitDrag} onKeyUp={commitDrag} onBlur={commitDrag}
                 style={{position:"relative","--a":trackPos(Math.min(originFrac,curFrac)),
                         "--b":trackPos(Math.max(originFrac,curFrac)),"--c":deltaColor}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:C.textMute}}>
          <span>{fmtMutaVal(r.name,mirrored?r.max:r.min)}</span><span>base {fmtMutaVal(r.name,r.base)}</span><span>{fmtMutaVal(r.name,mirrored?r.min:r.max)}</span>
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

// `chargeStats` is calc.js' effective-charge map for THIS slot — see `fittedChargeStats` there. Only
// the loaded charge gets it: the ammo list offers every compatible charge, but the others aren't on
// the fit, so type data alone is the honest answer for them.
function ModuleMenu({mod,groupCount=1,onClose,onUpdateMod,onUpdateModLive,onRemove,onDuplicate,onFillHardpoints,fillCount=0,resourceHeadroom,engineItem,chargeStats}){
  const _hasMuta=(MUTA_BY_TYPE[mod.typeID]??MUTA_BY_TYPE[String(mod.typeID)]??[]).length>0||mod.mutaplasmid;
  const[tab,setTab]=useState("state");
  const[chargeInfo,setChargeInfo]=useState(null);
  // Ammo picker is a two-step drill-down (family, e.g. "Multifrequency S" -> variant, e.g. "Imperial
  // Navy Multifrequency S") rather than one long list of every tier/faction line at once — mirrors
  // the module browser's own category drill-down. Opens straight to the loaded ammo's family, so
  // swapping T2 for a navy/pirate line of the SAME family (the common case) is still one tap.
  //
  // Only when that family actually HAS more than one variant to choose between — a lone-item family
  // (Civilian charges, and now every cap booster size/brand — see groupChargesForBrowser) equips on
  // a single tap from the main list already, so drilling in would land on a "variant list" holding
  // the one thing already loaded, with nothing to do but tap Back to see anything else.
  const[chargeFamily,setChargeFamily]=useState(()=>{
    if(!mod.ammo)return null;
    const g=groupChargesForBrowser(getCompatibleCharges(mod)).find(g=>g.items.some(i=>i.name===mod.ammo));
    return(g&&g.items.length>1)?g.family:null;
  });
  const[rahQuery,setRahQuery]=useState("");
  const[rahOpen,setRahOpen]=useState(false);
  const _modTakesCharges=moduleTakesCharges(mod.typeID,mod.name);
  // Reactive Armor Hardener: gets a "Reactive" tab to choose its adaptation pattern.
  const _isRAH=((TYPES[mod.typeID]??TYPES[String(mod.typeID)])?.gn??(TYPES[mod.typeID]??TYPES[String(mod.typeID)])?.groupName)==="Armor Resistance Shift Hardener";
  const tabs=[...((mod.type==="weapon"||mod.type==="capbooster"||_modTakesCharges)?["state","charge","info","variations"]:["state","info","variations"]),...(_hasMuta?["mutate"]:[])];
  const tabLabel={state:"State",charge:"Charge",info:"Info",variations:"Variations",mutate:"Mutate"};
  const states=validStatesFor(mod);
  const metaColor={T1:C.textMid,T2:C.accent,Deadspace:C.rig,Named:C.rig,Storyline:C.warning,Faction:C.danger,Officer:"#f0abfc"};
  const modData=moduleByName(mod.name);
  return(<>
    <BottomSheet title={mod.name} onClose={onClose} height="78vh">
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
        {tabs.map(t=><button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"8px 0",fontSize:11,fontWeight:700,background:"none",border:"none",cursor:"pointer",color:tab===t?C.accent:C.textMute,borderBottom:tab===t?`2px solid ${C.accent}`:"2px solid transparent"}}>{tabLabel[t]}</button>)}
      </div>
      <div onScroll={dismissKeyboardOnScroll} style={{padding:14,overflowY:'auto',maxHeight:'60vh'}}>
        {tab==="state"&&(<div>
          <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Module State</div>
          <div style={{display:"flex",gap:8,marginBottom:20}}>
            {states.map(s=>(<button key={s} className="press" onClick={()=>{if(mod.state!==s)haptic("medium");onUpdateMod({...mod,state:s});}} style={{flex:1,padding:"10px 0",borderRadius:8,border:`1px solid ${mod.state===s?STATE_COLORS[s]:C.border}`,background:mod.state===s?`${STATE_COLORS[s]}22`:"none",cursor:"pointer",transition:"background-color .18s ease, border-color .18s ease"}}>
              {/* Same glow as the fit list, so the picker teaches the mapping the rows use. */}
              <div style={{width:8,height:8,borderRadius:99,background:STATE_COLORS[s],margin:"0 auto 4px",boxShadow:STATE_GLOW[s]?`0 0 ${STATE_GLOW[s]}px ${STATE_COLORS[s]}`:"none",transform:mod.state===s?"scale(1.35)":"scale(1)",transition:"transform .18s cubic-bezier(.22,.61,.36,1)"}}/>
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
          {/* Only offered at 2 or more: at exactly one free hardpoint it would be Duplicate under a
              second name, and two buttons doing the same thing is worse than one. The count is in
              the label because the two limits it reconciles (free hardpoints, empty high slots)
              aren't both visible from here — an 8-high hull with 7 launchers reads "+6", not "+7". */}
          {onFillHardpoints&&fillCount>1&&<button onClick={()=>{haptic("medium");onFillHardpoints();onClose();}} style={{width:"100%",marginBottom:8,padding:"11px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer"}}>Fill Hardpoints (+{fillCount})</button>}
          {onDuplicate&&<button onClick={()=>{onDuplicate();onClose();}} style={{width:"100%",marginBottom:10,padding:"11px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer"}}>Duplicate to Next Empty Slot</button>}
          {/* A grouped rack (identical turrets/launchers, shown as one "Nx" row) removes ALL of its
              members here — matching the state dot and unload-charge button on the same row, which
              already act on the whole group. The label says so, since a "Remove Module" that quietly
              took out the whole rack would read like a bug. */}
          <button onClick={()=>{onRemove();onClose();}} style={{width:"100%",padding:"11px 0",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:C.danger,fontSize:13,fontWeight:700,cursor:"pointer"}}>{groupCount>1?`Remove Module Group (${groupCount})`:"Remove Module"}</button>
        </div>)}
        {tab==="charge"&&(mod.type==="weapon"||mod.type==="capbooster"||_modTakesCharges)&&(()=>{
          const groups=groupChargesForBrowser(getCompatibleCharges(mod));
          const equip=a=>{
            const chargeVol=a.volume??(a.typeID?(TYPES[a.typeID]?.attrs?.volume??1):1);
            const modTd=TYPES[mod.typeID]??TYPES[String(mod.typeID)];
            const modCap=modTd?.attrs?.capacity??0;
            const nc=modCap>0&&chargeVol>0?Math.floor(modCap/chargeVol):undefined;
            onUpdateMod({...mod,ammo:a.name,charges:nc,maxCharges:nc});
          };
          const activeGroup=chargeFamily!=null?groups.find(g=>g.family===chargeFamily):null;
          if(!activeGroup)return(<div>
            <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Select charge - applies to all grouped turrets</div>
            {/* Second way to clear a charge, alongside the row's own ✕ on the fit list — some users
                only ever look for it here, inside the menu they already opened to manage the charge. */}
            {mod.ammo&&<button onClick={()=>onUpdateMod({...mod,ammo:null,charges:undefined,maxCharges:undefined})} style={{width:"100%",marginBottom:10,padding:"10px 0",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:C.danger,fontSize:12,fontWeight:700,cursor:"pointer"}}>Unload Charge</button>}
            {/* Families ordered shortest-range first (see groupChargesForBrowser); a lone-item
                family (Civilian charges, most cap boosters) equips straight away instead of
                drilling into a submenu with only one thing in it. */}
            {groups.map(g=>{
              const loaded=g.items.find(a=>a.name===mod.ammo);
              const rep=g.items[0];
              // A single-item family (Void S, Gleam, ...) has one meta for the whole row; a
              // multi-item family (Antimatter Charge S) mixes T1/T2/Faction inside it, so only
              // badge the lone-item case here - the mixed case shows its badges per-variant below.
              const repMeta=g.items.length===1?metaOf(rep?.typeID,null):null;
              return(<div key={g.family} onClick={()=>{if(g.items.length===1)equip(g.items[0]);else setChargeFamily(g.family);}} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:loaded?C.accentLight:C.surface,border:`1px solid ${loaded?C.accentBorder:C.border}`,borderRadius:8,marginBottom:6,cursor:"pointer"}}>
                <div style={{width:26,height:26,flexShrink:0}}>
                  {rep?.typeID&&<img className="eve-icon" src={eveIcon(rep.typeID,32)} width={26} height={26} alt="" onError={e=>{e.target.style.visibility="hidden";}}/>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:loaded?C.accent:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{g.family}</div>
                  {loaded&&<div style={{fontSize:10,color:C.textMute,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{loaded.name}</div>}
                </div>
                {/* Only a lone-item family IS a charge; a multi-item family is a category, and its
                    members can differ in what they need (a T2 variant needs a specialization the
                    T1 next to it doesn't), so those get marked per-variant one level down. */}
                {g.items.length===1&&<SkillMark typeID={rep?.typeID}/>}
                {repMeta&&<span style={{fontSize:10,color:META_COLORS[repMeta]||C.textMute,background:C.border,borderRadius:99,padding:"2px 7px",fontWeight:700,flexShrink:0}}>{repMeta}</span>}
                {g.items.length>1
                  ?<span style={{fontSize:20,color:C.textMute,flexShrink:0}}>{">"}</span>
                  :loaded&&<span style={{color:C.accent,fontSize:12,fontWeight:700,flexShrink:0}}>✓</span>}
              </div>);
            })}
          </div>);
          return(<div>
            <div onClick={()=>setChargeFamily(null)} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,cursor:"pointer"}}>
              <span style={{color:C.accent,fontSize:14,fontWeight:700}}>&#8249; Back</span>
              <span style={{fontSize:11,color:C.textMute}}>{activeGroup.family}</span>
            </div>
            {mod.ammo&&<button onClick={()=>onUpdateMod({...mod,ammo:null,charges:undefined,maxCharges:undefined})} style={{width:"100%",marginBottom:10,padding:"10px 0",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:C.danger,fontSize:12,fontWeight:700,cursor:"pointer"}}>Unload Charge</button>}
            {activeGroup.items.map(a=>{
              const on=mod.ammo===a.name;
              const aMeta=metaOf(a.typeID,null);
              return(<div key={a.typeID??a.name} style={{display:"flex",alignItems:"center",padding:"10px 12px",background:on?C.accentLight:C.surface,border:`1px solid ${on?C.accentBorder:C.border}`,borderRadius:8,marginBottom:6}}>
                <div onClick={()=>equip(a)} style={{flex:1,minWidth:0,cursor:"pointer"}}>
                  <div style={{fontSize:13,fontWeight:600,color:on?C.accent:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name}</div>
                  {/* Cap boosters are the one charge whose headline number is worth a subtitle.
                      Everything else used to read "N dmg/shot" or, for the likes of Nanite Repair
                      Paste, the actively unhelpful "No data" — both gone. */}
                  {a.capBonus!=null&&<div style={{fontSize:10,color:C.rig,marginTop:2}}>+{a.capBonus} GJ</div>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0,marginLeft:8}}>
                  <SkillMark typeID={a.typeID}/>
                  {aMeta&&<span style={{fontSize:10,color:META_COLORS[aMeta]||C.textMute,background:C.border,borderRadius:99,padding:"2px 7px",fontWeight:700}}>{aMeta}</span>}
                  {on&&<span style={{color:C.accent,fontSize:12,fontWeight:700}}>✓</span>}
                  {a.typeID&&<InfoButton onClick={e=>{e.stopPropagation();setChargeInfo(a.typeID);}}/>}
                </div>
              </div>);
            })}
          </div>);
        })()}
        {/* No wrapper: this used to add a second overflowY:auto (redundant — the tab body above
            already scrolls) plus 2px of side padding, and a row bleeding out to the screen edge
            would have been clipped by it 14px short. */}
        {tab==="info"&&<ModuleInfoTab typeID={mod.typeID} mod={mod} engineItem={engineItem} bleed={14}/>}
        {tab==="variations"&&(<ModuleVariationsTab typeID={mod.typeID} currentName={mod.name} resourceHeadroom={resourceHeadroom}
                                baseMutations={mod.mutaplasmid?mod.mutations:null} baseMutaplasmid={mod.mutaplasmid} onSwap={v=>{
          // Recompute charge count: variants can have different bay capacities (e.g. cap boosters)
          let nc=mod.charges;
          if(mod.ammo&&v.typeID){
            const newTd=TYPES[v.typeID]??TYPES[String(v.typeID)];
            const cap=newTd?.attrs?.capacity??0;
            const cTid=tidByName((mod.ammo||"").replace(/\s*\(\d+\)$/,""));
            const vol=cTid?(TYPES[cTid]?.attrs?.volume??1):1;
            nc=cap>0&&vol>0?Math.floor(cap/vol):undefined;
          }
          // The roll is dropped, always. `updateMod` MERGES this into the existing module, so anything
          // left out here survives — and a mutaplasmid that survives lands on a module it was never
          // applicable to, silently reapplying the old module's rolled numbers to a different type.
          // It is also what makes the UNMUTATED row do anything: that row's typeID is the fitted one,
          // so clearing the roll is the entire swap.
          onUpdateMod({name:v.name,typeID:v.typeID,state:mod.state,ammo:mod.ammo,charges:nc,maxCharges:nc,
                       mutaplasmid:undefined,mutations:undefined});onClose();}} />)}
        {/* No wrapper here either, same reasoning as the info tab above: a second overflowY:auto
            nested inside this one already-scrolling tab body is redundant, and on iOS it stopped
            WebKit's native "scroll the focused input above the keyboard" from finding the right
            scroll container — typing into a mutaplasmid's value box left it under the keyboard. */}
        {tab==="mutate"&&<MutaplasmidEditor mod={mod} onUpdateMod={onUpdateModLive||onUpdateMod}/>}
      </div>
    </BottomSheet>
    {/* The ammo list offers every compatible charge, but only the LOADED one exists on the fit — so
        only that one gets the engine item and the current/base columns. Tapping any other shows its
        type data alone, which is the honest answer: it isn't loaded, so it has no current value. */}
    {chargeInfo&&(()=>{
      const loaded=engineItem?._charge&&Number(engineItem._charge.typeID)===Number(chargeInfo)?engineItem._charge:null;
      return <ItemInfoSheet typeID={chargeInfo} onClose={()=>setChargeInfo(null)}
        item={loaded} overrides={loaded?chargeStats:null}/>;
    })()}
  </>);
}

// Drone bottom sheet — mirrors ModuleMenu's Info/Variations/Mutate tabs. No State or Charge tab:
// a drone's active/qty controls already live inline in the drone row, and drones take no charges.
// No Remove button either, for the same reason — the row's own "x" already does that.
function DroneMenu({drone,onClose,onUpdateDrone,onUpdateDroneLive,engineItem}){
  const _hasMuta=(MUTA_BY_TYPE[drone.typeID]??MUTA_BY_TYPE[String(drone.typeID)]??[]).length>0||drone.mutaplasmid;
  const[tab,setTab]=useState("info");
  const tabs=["info","variations",...(_hasMuta?["mutate"]:[])];
  const tabLabel={info:"Info",variations:"Variations",mutate:"Mutate"};
  return(<BottomSheet title={drone.name} onClose={onClose} height="78vh">
    <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
      {tabs.map(t=><button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"8px 0",fontSize:11,fontWeight:700,background:"none",border:"none",cursor:"pointer",color:tab===t?C.accent:C.textMute,borderBottom:tab===t?`2px solid ${C.accent}`:"2px solid transparent"}}>{tabLabel[t]}</button>)}
    </div>
    <div onScroll={dismissKeyboardOnScroll} style={{padding:14,overflowY:'auto',maxHeight:'60vh'}}>
      {tab==="info"&&<ModuleInfoTab typeID={drone.typeID} mod={drone} engineItem={engineItem} bleed={14}/>}
      {tab==="variations"&&<ModuleVariationsTab typeID={drone.typeID} currentName={drone.name}
        baseMutations={drone.mutaplasmid?drone.mutations:null} baseMutaplasmid={drone.mutaplasmid}
        onSwap={v=>{
          // Same reasoning as ModuleMenu's swap: the roll is dropped, always. A mutaplasmid that
          // survives a base-type swap would land on a drone it was never rolled for and silently
          // reapply the old drone's numbers to a different type.
          onUpdateDrone({name:v.name,typeID:v.typeID,mutaplasmid:undefined,mutations:undefined});onClose();
        }}/>}
      {/* No wrapper here either — see the note on ModuleMenu's mutate tab. This tab body already
          scrolls (the enclosing overflowY:'auto',maxHeight:'60vh' div above), and a nested second
          scroller broke iOS's native scroll-to-focused-input, leaving a typed value under the
          keyboard. */}
      {tab==="mutate"&&<MutaplasmidEditor mod={drone} onUpdateMod={onUpdateDroneLive||onUpdateDrone}/>}
    </div>
  </BottomSheet>);
}

// `initialText`/`initialErr` seed the sheet when the "From EFT" chooser button already tried a
// direct clipboard-import and couldn't finish it (unreadable/empty clipboard, or the text didn't
// parse as EFT) — this sheet is that path's fallback, not the only way in, so it opens already
// showing what went wrong instead of asking the user to tap "Read from Clipboard" a second time.
function ImportFitSheet({onClose,onImport,initialText="",initialErr=null}){
  const[text,setText]=useState(initialText);
  const[parsed,setParsed]=useState(null);
  const[err,setErr]=useState(initialErr);
  const process=(t)=>{if(!t.trim()){setParsed(null);setErr(null);return;}const r=parseEFT(t);if(r.error){setParsed(null);setErr(r.error);}else{setParsed(r);setErr(null);}};
  // navigator.clipboard.readText() is not permitted inside the native WebView, which is why this
  // button did nothing in the installed app and the fit had to be pasted by hand. Capacitor's
  // Clipboard plugin reads through the OS instead; the web API stays as the browser fallback.
  // readClipboardText (lib/core.js) carries the native/web branching and three hard-won fixes:
  //   * the native error used to be caught and DISCARDED, so whatever Android actually said was lost;
  //   * the web fallback used to then run ON NATIVE too, where it cannot work — so the message you
  //     got described the fallback failing, not the real cause;
  //   * an empty clipboard came back as "" which is not == null, so it counted as a success and
  //     the sheet reported an EFT parse error instead of "there's nothing to paste".
  // Android asks for no clipboard permission at all (it is not a runtime permission — API 29+ just
  // requires the app to be focused, and 13+ shows its own paste toast), so a prompt never appearing
  // is expected and is not the fault. The error text names the cause.
  const readClip=async()=>{
    setErr(null);
    const{text:t,why}=await readClipboardText();
    if(t==null){setErr(`Couldn't read the clipboard${why?` — ${why}`:""}. Paste manually below.`);return;}
    if(!t.trim()){setErr("The clipboard is empty — copy a fit first, then tap this again.");return;}
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
  return(<BottomSheet title="Target Resist Profile" onClose={onClose} height="80vh" fillHeight>
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{fontSize:10,color:C.textMute,marginBottom:6}}>Weights your DPS by how resistant the target is. Does not change raw DPS.</div>
      <SheetSearchBar value={search} onChange={setSearch} placeholder="Search targets..."/>
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
  return(<BottomSheet title="Incoming Damage Profile" onClose={onClose} height="80vh" fillHeight>
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <SheetSearchBar value={search} onChange={setSearch} placeholder="Search profiles..."/>
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


export { ATTR_UNIT, AccordionSection, BottomSheet, DamageProfileSheet, TargetProfileSheet, DroneMenu, HIDDEN_ATTRS, ImportFitSheet, InfoButton, ItemInfoSheet, ItemPrice, MUTA_ATTR_LABELS, ModuleBrowserSheet, ModuleInfoTab, ModuleMenu, ModuleVariationsTab, MutaplasmidEditor, NumpadModal, RESIST_ATTRS, ResistBars, ResourceStrip, SubsystemPickerSheet, TraitsPanel, abyssalToText, fmtAttrName, fmtAttrVal, fmtMutaVal, mutaLabel, parseAbyssal };
