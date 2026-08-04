// Fit tabs — a browser-style strip of the fits you currently have open.
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

export const MAX_OPEN_TABS = 8;

// Resolve stored tab pointers against the live fitsDB. Returns only tabs that still exist, each
// carrying its CURRENT name. Falls back to matching by name for any fit that predates fit IDs.
export function resolveTabs(openTabs, fitsDB) {
  const out = [];
  for (const t of (openTabs ?? [])) {
    const list = fitsDB?.[t.ship];
    if (!list) continue;
    const fit = (t.id != null && list.find(f => f.id === t.id)) || list.find(f => f.name === t.name);
    if (!fit) continue;
    out.push({ ship: t.ship, id: fit.id, name: fit.name });
  }
  return out;
}

// Sticky so the strip survives the page scrolling out from under it -- the whole app column is one
// document-level scroller, so without this the "collapsed" line would scroll away with the header
// and there would be nothing left to say which tab you are in.
const STICKY = { position: "sticky", top: 0, zIndex: 20 };

export function FitTabs({ tabs, activeFit, collapsed, onSelect, onClose, onExpand, onOpenLibrary }) {
  const scroller = useRef(null);
  const activeEl = useRef(null);
  const isActive = (t) => activeFit?.ship === t.ship && activeFit?.fitName === t.name;

  // Keep the current tab visible. With the strip narrower than the tab list, switching to a fit
  // that sits off-screen would otherwise leave you looking at a strip with no highlight in it.
  useEffect(() => {
    if (collapsed || !activeEl.current) return;
    activeEl.current.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [collapsed, activeFit?.ship, activeFit?.fitName, tabs.length]);

  if (!tabs.length) return null;

  // Collapsed: one segment per tab, the current one filled. Enough to say "you are in tab 3 of 5"
  // without spending a row on it, and tapping anywhere on it brings the strip back.
  if (collapsed) {
    return (
      <div role="button" aria-label="Show fit tabs" onClick={onExpand}
           style={{ ...STICKY, display: "flex", gap: 2, padding: "3px 8px", background: C.bg,
                    borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}>
        {tabs.map((t) => (
          <span key={`${t.ship}:${t.id}`}
                style={{ flex: 1, height: 3, borderRadius: 99,
                         background: isActive(t) ? C.accent : C.borderStrong }}/>
        ))}
      </div>
    );
  }

  return (
    <div ref={scroller} className="hs"
         style={{ ...STICKY, display: "flex", background: C.bg, borderBottom: `1px solid ${C.border}`,
                  overflowX: "auto", overflowY: "hidden", WebkitOverflowScrolling: "touch",
                  // The + is sticky at the right edge; without this, scrolling the last tab into
                  // view parks it underneath and hides its close button.
                  scrollPaddingRight: 38 }}>
      {tabs.map((t) => {
        const on = isActive(t);
        return (
          <div key={`${t.ship}:${t.id}`} ref={on ? activeEl : null}
               onClick={() => !on && onSelect(t)} title={`${t.ship} — ${t.name}`}
               style={{ flex: "0 0 auto", width: 116, padding: "6px 6px 5px 8px", cursor: "pointer",
                        background: on ? C.surface : "transparent",
                        borderRight: `1px solid ${C.border}`,
                        borderBottom: `2px solid ${on ? C.accent : "transparent"}` }}>
            <div style={{ fontSize: 9, color: C.textMute, letterSpacing: .5, textTransform: "uppercase",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.ship}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 1 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: on ? 700 : 500,
                             color: on ? C.text : C.textMid, whiteSpace: "nowrap",
                             overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
              <span role="button" aria-label={`Close ${t.name}`}
                    onClick={(e) => { e.stopPropagation(); onClose(t); }}
                    style={{ flexShrink: 0, fontSize: 13, lineHeight: 1, padding: "2px 3px",
                             color: on ? C.textMid : C.textMute }}>&times;</span>
            </div>
          </div>
        );
      })}
      <div role="button" aria-label="Open a fit in a new tab" onClick={onOpenLibrary}
           style={{ flex: "0 0 auto", width: 34, display: "flex", alignItems: "center",
                    justifyContent: "center", color: C.textMute, fontSize: 17, cursor: "pointer",
                    position: "sticky", right: 0, background: C.bg,
                    borderLeft: `1px solid ${C.border}` }}>+</div>
    </div>
  );
}
