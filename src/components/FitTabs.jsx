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
import { useEffect, useRef } from "react";
import { C } from "../theme.js";



// Resolve stored tab pointers against the live fitsDB. Returns only tabs that still exist, each
// carrying its CURRENT name. Falls back to matching by name for any fit that predates fit IDs.
// Sticky so the strip survives the page scrolling out from under it -- the whole app column is one
// document-level scroller, so without this the "collapsed" line would scroll away with the header
// and there would be nothing left to say which tab you are in.
const STICKY = { position: "sticky", top: 0, zIndex: 20 };

export function FitTabs({ tabs, activeFit, open, onSelect, onClose, onToggle, onOpenLibrary }) {
  const scroller = useRef(null);
  const activeEl = useRef(null);
  const isActive = (t) => activeFit?.ship === t.ship && activeFit?.fitName === t.name;

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
          {tabs.map((t) => (
            <span key={`${t.ship}:${t.id}`}
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
          {tabs.map((t) => {
            const on = isActive(t);
            return (
              // Condensed to a single line: ship and fit name side by side rather than stacked,
              // which halves the height the strip costs on a phone.
              <div key={`${t.ship}:${t.id}`} ref={on ? activeEl : null}
                   onClick={() => !on && onSelect(t)} title={`${t.ship} — ${t.name}`}
                   className="no-select"
                   style={{ flex: "0 0 auto", maxWidth: 150, display: "flex", alignItems: "center",
                            gap: 5, padding: "0 6px 0 9px", height: 43, cursor: "pointer",
                            background: on ? C.surface : "transparent",
                            borderRight: `1px solid ${C.border}`,
                            boxShadow: on ? `inset 0 -2px 0 ${C.accent}` : "none" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: on ? 700 : 500, lineHeight: 1.15,
                                color: on ? C.text : C.textMid, whiteSpace: "nowrap",
                                overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
                  <div style={{ fontSize: 9, color: C.textMute, lineHeight: 1.2, whiteSpace: "nowrap",
                                overflow: "hidden", textOverflow: "ellipsis" }}>{t.ship}</div>
                </div>
                <span role="button" aria-label={`Close ${t.name}`}
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
