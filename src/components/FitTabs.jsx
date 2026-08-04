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

export function FitTabs({ tabs, activeFit, onSelect, onClose, onOpenLibrary }) {
  if (!tabs.length) return null;
  const isActive = (t) => activeFit?.ship === t.ship && activeFit?.fitName === t.name;
  return (
    <div style={{ display: "flex", background: C.bg, borderBottom: `1px solid ${C.border}`,
                  overflowX: "auto", overflowY: "hidden", WebkitOverflowScrolling: "touch",
                  scrollbarWidth: "none" }}>
      {tabs.map((t) => {
        const on = isActive(t);
        return (
          <div key={`${t.ship}:${t.id}`} onClick={() => !on && onSelect(t)}
               title={`${t.ship} — ${t.name}`}
               style={{ flex: "0 0 auto", width: 122, padding: "6px 8px 5px", cursor: "pointer",
                        background: on ? C.surface : "transparent",
                        borderRight: `1px solid ${C.border}`,
                        borderBottom: `2px solid ${on ? C.accent : "transparent"}` }}>
            <div style={{ fontSize: 9, color: C.textMute, letterSpacing: .5, textTransform: "uppercase",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.ship}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: on ? 700 : 500,
                             color: on ? C.text : C.textMid, whiteSpace: "nowrap",
                             overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
              {/* Close only on the active tab: at 122px there is not room for a hit target on every
                  tab without crowding the label, and closing what you are not looking at is rare. */}
              {on && (
                <span role="button" aria-label={`Close ${t.name}`}
                      onClick={(e) => { e.stopPropagation(); onClose(t); }}
                      style={{ fontSize: 13, lineHeight: 1, color: C.textMute, padding: "0 2px" }}>&times;</span>
              )}
            </div>
          </div>
        );
      })}
      <div role="button" aria-label="Open another fit" onClick={onOpenLibrary}
           style={{ flex: "0 0 auto", width: 34, display: "flex", alignItems: "center",
                    justifyContent: "center", color: C.textMute, fontSize: 17, cursor: "pointer" }}>+</div>
    </div>
  );
}
