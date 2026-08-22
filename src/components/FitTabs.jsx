// Fit tabs — a browser-style strip of the fits you currently have open.
// Pure tab identity lives in a React-free leaf so the regression suite can test it; re-exported
// here so existing importers of FitTabs.jsx are unchanged.
export { resolveTabs, MAX_OPEN_TABS, sameTab, nextFitId } from "../lib/fit-tabs.js";
//
// Switching between whole fits, rather than diffing stats between them: in EVE a DPS number lifted
// out of its fit says very little (a HAM boat at 94 km and rapid lights at 48 km are not comparable
// on that axis alone), so the useful comparison is seeing each fit entire, one tap apart. Same model
// pyfa uses on desktop.
//
// Deliberately thin. Everything it needs already existed:
//   - loadFit(ship, fitName) swaps slots/drones/implants/boosters/projections in one call
//   - edits auto-commit to fitsDB for the active fit, so switching tabs is LOSSLESS and there is no
//     per-tab draft state to reconcile
//   - undo is keyed per fit, so it keeps working per tab unchanged
// A tab is therefore just a pointer, and this file is the strip that renders them.
//
// Tabs are keyed by fit ID, not name: renaming a fit in the Fits list rewrites the name in fitsDB,
// and a name-keyed tab would silently vanish. The label is read back out of fitsDB on every render
// so a rename shows up live. A tab whose fit no longer exists (deleted) is dropped on render, which
// keeps this file out of the delete/rename handlers entirely.
import { useEffect, useRef, useState } from "react";
import { C } from "../theme.js";
import { haptic } from "../lib/core.js";



// Resolve stored tab pointers against the live fitsDB. Returns only tabs that still exist, each
// carrying its CURRENT name. Falls back to matching by name for any fit that predates fit IDs.
// Sticky so the strip survives the page scrolling out from under it -- the whole app column is one
// document-level scroller, so without this the "collapsed" line would scroll away with the header
// and there would be nothing left to say which tab you are in.
const STICKY = { position: "sticky", top: 0, zIndex: 20 };

const keyOf = (t) => `${t.ship}:${t.id}`;
// Long enough that it cannot fire during a flick of the strip, short enough to feel like a hold.
const HOLD_MS = 350;
// A tap is never perfectly still on a phone; past this the gesture is a scroll and the hold is off.
const SLOP = 8;

// How long an armed "close all" waits before disarming itself. Long enough to read the prompt and
// decide, short enough that a rail left armed and forgotten is not a mis-tap sitting in wait.
const ARMED_MS = 4000;

export function FitTabs({ tabs, activeFit, open, onSelect, onClose, onToggle, onOpenLibrary, onReorder, onCloseAll }) {
  const scroller = useRef(null);
  const activeEl = useRef(null);
  const isActive = (t) => activeFit?.ship === t.ship && activeFit?.fitName === t.name;

  // Hold-and-drag to reorder. The visual order lives here only while a drag is in flight; on drop it
  // is handed up once and this falls back to the `tabs` prop, so there is no second copy of the tab
  // list to keep in sync.
  const [order, setOrder] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const orderRef = useRef(null);      // the same array, readable from the window listeners
  const dragKeyRef = useRef(null);
  const dragging = useRef(false);
  const press = useRef(null);         // {x, y, timer} while waiting out the hold
  const lastX = useRef(0);
  const raf = useRef(0);
  const view = order ?? tabs;

  // Close-all lives on a hold of the + rather than a control of its own: it is the only thing in the
  // rail already about tab MEMBERSHIP, and hold is free there (hold-drag belongs to the tabs). Armed
  // it turns the + red and spins it into an x, and the dashes — which mean nothing once you are
  // deciding whether to keep any tabs at all — become the confirmation.
  //
  // Closing tabs destroys nothing: a tab is a pointer into fitsDB and every fit is saved. The confirm
  // step is here because losing a session's worth of tabs to a stray press is annoying, not because
  // anything is at risk, which is why it disarms itself rather than demanding an answer.
  const [armed, setArmed] = useState(false);
  const plusHold = useRef(null);
  // Set on the RELEASE that arms, so the click that release generates is eaten however long the hold
  // ran. A timer started at arming time only covers a release inside its window — hold past it and the
  // click lands on the armed x and cancels the gesture, which is what this went wrong as.
  const ignoreClick = useRef(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(t);
  }, [armed]);
  // Nothing to close: covers closing the last tab by hand while armed, and deleting its fit.
  useEffect(() => { if (!tabs.length) setArmed(false); }, [tabs.length]);

  // `touch-action` is latched when a gesture STARTS, so switching it on mid-hold does not stop a
  // scroll that is already in flight. A non-passive touchmove that preventDefaults is the only thing
  // that reliably does, hence the manual listener rather than a style.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const block = (e) => { if (dragging.current) e.preventDefault(); };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  // Swap the dragged tab past any neighbour whose midpoint the finger has crossed. Measuring the live
  // DOM rects rather than assuming a fixed tab width, because tabs are as wide as their fit's name.
  const moveTo = (clientX) => {
    const el = scroller.current, cur = orderRef.current;
    if (!el || !cur) return;
    const kids = Array.from(el.children);
    const from = cur.findIndex((t) => keyOf(t) === dragKeyRef.current);
    if (from < 0) return;
    let to = from;
    for (let i = from + 1; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (clientX > r.left + r.width / 2) to = i; else break;
    }
    if (to === from) for (let i = from - 1; i >= 0; i--) {
      const r = kids[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) to = i; else break;
    }
    if (to === from) return;
    const next = cur.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    orderRef.current = next;
    setOrder(next);
    haptic("light");
  };

  // With eight tabs open the strip overflows, so the drop target you want is often off-screen. Nudge
  // the scroller while the finger sits near an edge, and re-run the hit test each frame so the tab
  // keeps swapping as new neighbours slide past it.
  const edgeScroll = () => {
    raf.current = 0;
    const el = scroller.current;
    if (!el || !dragging.current) return;
    const r = el.getBoundingClientRect();
    const d = lastX.current < r.left + 34 ? -8 : lastX.current > r.right - 34 ? 8 : 0;
    if (d) { el.scrollLeft += d; moveTo(lastX.current); }
    raf.current = requestAnimationFrame(edgeScroll);
  };

  const endGesture = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = null;
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    dragging.current = false;
  };

  // Eat the click the drop is about to produce, so releasing on a tab does not also switch to it.
  // A flag checked in onClick is not enough: if the finger lifts over a different element the click
  // is dispatched on their common ancestor instead, the tab's handler never runs, and the flag would
  // stay set and swallow the NEXT genuine tap. `once` clears it on the click it was meant for; the
  // timeout clears it when no click follows at all.
  const swallowNextClick = () => {
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
  };

  const startPress = (e, t) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    lastX.current = e.clientX;
    const x = e.clientX, y = e.clientY;

    const onMove = (ev) => {
      lastX.current = ev.clientX;
      if (dragging.current) { moveTo(ev.clientX); return; }
      if (Math.abs(ev.clientX - x) > SLOP || Math.abs(ev.clientY - y) > SLOP) { endGesture(); detach(); }
    };
    const onUp = () => {
      const wasDragging = dragging.current;
      const next = orderRef.current;
      endGesture(); detach();
      if (!wasDragging) return;
      swallowNextClick();
      orderRef.current = null; dragKeyRef.current = null;
      setDragKey(null); setOrder(null);
      haptic("medium");
      // Both setStates and the parent's are batched into one render, so the strip never flashes the
      // pre-drag order between dropping and the new order arriving as a prop.
      if (next && next.some((t, i) => keyOf(t) !== keyOf(tabs[i]))) onReorder?.(next);
    };
    const detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    press.current = { timer: setTimeout(() => {
      press.current = { timer: null };
      dragging.current = true;
      orderRef.current = tabs.slice();
      dragKeyRef.current = keyOf(t);
      setOrder(orderRef.current);
      setDragKey(dragKeyRef.current);
      haptic("medium");
      raf.current = requestAnimationFrame(edgeScroll);
    }, HOLD_MS) };
  };

  // Same hold as the tabs' reorder, so the two gestures feel like one idea. Releasing produces a
  // click on the + — which is now the armed x — so it has to be eaten or the gesture cancels itself
  // the moment you let go.
  //
  // That swallow is tied to the RELEASE, not to a timer started when it armed. A timer only covers a
  // release that lands inside its window: keep holding past it and the click gets through, which is
  // exactly what a deliberate "hold it until I'm sure" press does. The short timeout here runs the
  // other way, clearing the flag if the release produces no click at all rather than leaving it set
  // to swallow the next genuine tap.
  const startPlusPress = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!tabs.length || armed) return;
    const x = e.clientX, y = e.clientY;
    let fired = false;
    const detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    const onUp = () => {
      if (plusHold.current) { clearTimeout(plusHold.current); plusHold.current = null; }
      detach();
      if (!fired) return;
      ignoreClick.current = true;
      setTimeout(() => { ignoreClick.current = false; }, 400);
    };
    const onMove = (ev) => {
      if (fired) return;   // armed already; a wandering finger no longer cancels it
      if (Math.abs(ev.clientX - x) > SLOP || Math.abs(ev.clientY - y) > SLOP) onUp();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    plusHold.current = setTimeout(() => {
      plusHold.current = null;
      fired = true;
      setArmed(true);
      haptic("medium");
    }, HOLD_MS);
  };

  // Keep the current tab visible. With the strip narrower than the tab list, switching to a fit
  // that sits off-screen would otherwise leave you looking at a strip with no highlight in it.
  useEffect(() => {
    if (!open || !activeEl.current) return;
    activeEl.current.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [open, activeFit?.ship, activeFit?.fitName, tabs.length]);

  // The rail is ALWAYS present and the strip starts closed. Tabs are opt-in: someone who never
  // wants them should see one thin row with a + on it, not a permanent list of fits they did not
  // ask to keep open. The dashes double as the open/close control and as "you are in tab 3 of 5".
  return (
    <div style={{ ...STICKY, background: C.bg, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", height: 22 }}>
        {armed ? (
          <div role="button" aria-label={`Close all ${tabs.length} tabs`}
               onClick={() => { setArmed(false); haptic("medium"); onCloseAll?.(); }}
               style={{ flex: 1, display: "flex", alignItems: "center", height: "100%",
                        padding: "0 8px", cursor: "pointer" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.danger }}>
              Close all {tabs.length} tab{tabs.length === 1 ? "" : "s"}?
            </span>
          </div>
        ) : (
          <div role="button" aria-label={open ? "Hide fit tabs" : "Show fit tabs"}
               aria-expanded={open} onClick={tabs.length ? onToggle : undefined}
               style={{ flex: 1, display: "flex", gap: 2, alignItems: "center", height: "100%",
                        padding: "0 8px", cursor: tabs.length ? "pointer" : "default" }}>
            {view.map((t) => (
              <span key={keyOf(t)}
                    style={{ flex: 1, maxWidth: 60, height: 3, borderRadius: 99,
                             transition: "background .18s ease",
                             background: isActive(t) ? C.accent : C.borderStrong }}/>
            ))}
          </div>
        )}
        {/* Armed, the + spins 45 degrees into an x rather than swapping glyph — the rotation is what
            reads as "this button changed job" at 16px, and it doubles as the way back out.
            The GLYPH rotates, not the button: the button carries the rail's divider border, and
            rotating that turned the divider into a diagonal slash across the rail. */}
        <div role="button" aria-label={armed ? "Cancel closing all tabs" : "Open a fit in a new tab"}
             onPointerDown={startPlusPress}
             onClick={() => {
               if (ignoreClick.current) { ignoreClick.current = false; return; }
               if (armed) setArmed(false); else onOpenLibrary();
             }}
             style={{ flexShrink: 0, width: 34, height: "100%", display: "flex", alignItems: "center",
                      justifyContent: "center", color: armed ? C.danger : C.textMute, fontSize: 16,
                      lineHeight: 1, cursor: "pointer", borderLeft: `1px solid ${C.border}`,
                      transition: "color .18s ease" }}>
          <span style={{ display: "block", lineHeight: 1,
                         transform: armed ? "rotate(45deg)" : "none",
                         transition: "transform .18s cubic-bezier(.22,.61,.36,1)" }}>+</span>
        </div>
      </div>

      {/* Animated open/close. max-height rather than height so the strip does not need a measured
          pixel value, and overflow:hidden so the tabs clip cleanly while it moves. */}
      <div style={{ maxHeight: open && tabs.length ? 44 : 0, overflow: "hidden",
                    transition: "max-height .22s cubic-bezier(.22,.61,.36,1)" }}>
        <div ref={scroller} className="hs"
             style={{ display: "flex", overflowX: "auto", overflowY: "hidden",
                      WebkitOverflowScrolling: "touch", borderTop: `1px solid ${C.border}`,
                      // The + column is sticky at the right edge; without this, scrolling the last
                      // tab into view parks it underneath and hides its close button.
                      scrollPaddingRight: 34 }}>
          {view.map((t) => {
            const on = isActive(t);
            const lifted = dragKey === keyOf(t);
            return (
              // Condensed to a single line: ship and fit name side by side rather than stacked,
              // which halves the height the strip costs on a phone.
              <div key={keyOf(t)} ref={on ? activeEl : null}
                   onPointerDown={(e) => startPress(e, t)}
                   onClick={() => { if (!on) onSelect(t); }}
                   title={`${t.ship} — ${t.name}`}
                   className="no-select"
                   style={{ flex: "0 0 auto", maxWidth: 150, display: "flex", alignItems: "center",
                            gap: 5, padding: "0 6px 0 9px", height: 43, cursor: "pointer",
                            background: lifted ? C.surfaceAlt : on ? C.surface : "transparent",
                            borderRight: `1px solid ${C.border}`,
                            transform: lifted ? "scale(1.06)" : "none",
                            opacity: dragKey && !lifted ? 0.6 : 1,
                            transition: "transform .12s ease, opacity .12s ease",
                            boxShadow: lifted ? `0 2px 10px rgba(0,0,0,.45)`
                                              : on ? `inset 0 -2px 0 ${C.accent}` : "none" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: on ? 700 : 500, lineHeight: 1.15,
                                color: on ? C.text : C.textMid, whiteSpace: "nowrap",
                                overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
                  <div style={{ fontSize: 9, color: C.textMute, lineHeight: 1.2, whiteSpace: "nowrap",
                                overflow: "hidden", textOverflow: "ellipsis" }}>{t.ship}</div>
                </div>
                <span role="button" aria-label={`Close ${t.name}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onClose(t); }}
                      style={{ flexShrink: 0, fontSize: 13, lineHeight: 1, padding: "4px 3px",
                               color: on ? C.textMid : C.textMute }}>&times;</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
