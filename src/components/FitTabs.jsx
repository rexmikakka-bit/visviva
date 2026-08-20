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

export function FitTabs({ tabs, activeFit, open, onSelect, onClose, onToggle, onOpenLibrary, onReorder }) {
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
        <div role="button" aria-label="Open a fit in a new tab" onClick={onOpenLibrary}
             style={{ flexShrink: 0, width: 34, height: "100%", display: "flex", alignItems: "center",
                      justifyContent: "center", color: C.textMute, fontSize: 16, lineHeight: 1,
                      cursor: "pointer", borderLeft: `1px solid ${C.border}` }}>+</div>
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
