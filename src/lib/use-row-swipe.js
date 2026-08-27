// Swipe-to-delete on a fitted-module row, Spotify-style: swipe RIGHT to reveal a Remove button
// behind the row, tap the row again to close it, tap the button (or swipe far enough) to commit.
//
// Deliberately the mirror of Spotify's own left-swipe: this row sits inside the Fit tab, which
// itself swipes left/right against Stats/Graph (useTabSwipe). stopPropagation already keeps a row
// drag from bubbling into that swipe technically, but a leftward reveal gesture still LOOKS like
// the tab-swipe's "go to Stats" gesture under a thumb moving fast — so the reveal direction is
// flipped to the direction the tab swipe can't go from the Fit tab (index 0's left edge rubber-
// bands), rather than relying on stopPropagation alone to make the two gestures feel distinct.
//
// One hook call for the whole list, not one per row — rows come and go as slots are added,
// removed and reordered, so per-row hook state would have to be rekeyed by hand on every change.
// Only ONE row is ever open at a time, tracked by a single `openKey` string; the live drag itself
// is written straight to the row's DOM node via `e.currentTarget`, exactly like useTabSwipe writes
// to its panel ref, so dragging never re-renders the list underneath the finger.
import { useRef, useState } from "react";
import { haptic } from "./core.js";

const REVEAL_PX = 72;   // width of the revealed Remove button
const COMMIT_PX = 40;   // past this on release, snap open instead of springing back
const AXIS_LOCK_PX = 8; // movement before the gesture decides horizontal vs vertical

/**
 * @param isBlocked optional () => boolean, asked on every touch: while it is true no row may be
 *   swiped. The caller's drag-to-reorder is the case that needs it — that runs on POINTER events
 *   and this runs on TOUCH events, two independent streams, so the reorder's own preventDefault and
 *   stopPropagation cannot reach these handlers. Without it, pulling the reorder handle sideways
 *   also slid the row open and brought Remove out from behind it.
 */
export function useRowSwipe(isBlocked) {
  const drag = useRef({ key: null, x: 0, y: 0, axis: null });
  const [openKey, setOpenKey] = useState(null);

  const setX = (el, px, animate) => {
    if (!el) return;
    el.style.transition = animate ? "transform .18s cubic-bezier(.22,.61,.36,1)" : "none";
    el.style.transform = px ? `translateX(${px}px)` : "";
  };
  const close = (el) => { setX(el, 0, true); setOpenKey(null); };

  const swipeHandlers = (key) => ({
    // Tells useTabSwipe which DIRECTION this row claims, so it can stand down for that one and keep
    // the other. A closed row owns rightward only — it has nothing to the left to reveal, so a
    // leftward drag is still "go to Stats". An open one owns both, because leftward closes it.
    //
    // It has to be an attribute rather than stopPropagation alone: stopPropagation fires only once
    // this gesture's axis has locked, so the first AXIS_LOCK_PX of travel reach the tab swipe
    // regardless and let IT lock to "x" first.
    "data-rowswipe": openKey === key ? "open" : "closed",
    onTouchStart: e => {
      if (isBlocked?.()) return;
      // Starting a gesture on a different row closes whatever was already revealed, so at most
      // one Remove button is ever showing.
      if (openKey && openKey !== key) setOpenKey(null);
      const t = e.touches[0];
      if (t) drag.current = { key, x: t.clientX, y: t.clientY, axis: null, owns: false };
    },
    onTouchMove: e => {
      if (drag.current.key !== key) return;
      // The reorder can begin AFTER this gesture armed — pointerdown and touchstart arrive in an
      // order that is not worth depending on — so hand the row back and disarm rather than trusting
      // the check in onTouchStart to have caught it.
      if (isBlocked?.()) { drag.current.key = null; close(e.currentTarget); return; }
      const t = e.touches[0]; if (!t) return;
      const dx = t.clientX - drag.current.x, dy = t.clientY - drag.current.y;
      if (!drag.current.axis) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        drag.current.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
        // Decided once, at the moment the gesture commits to an axis, and then latched: a drag that
        // wanders back across its own start must not change hands halfway through.
        drag.current.owns = drag.current.axis === "x" && (openKey === key || dx > 0);
      }
      if (drag.current.axis !== "x" || !drag.current.owns) return;
      e.stopPropagation(); // keep this out of the Fit/Stats/Graph tab swipe above it
      const base = openKey === key ? REVEAL_PX : 0;
      setX(e.currentTarget, Math.min(REVEAL_PX + 16, Math.max(0, base + dx * 0.9)), false);
    },
    onTouchEnd: e => {
      if (drag.current.key !== key) return;
      const wasX = drag.current.axis === "x" && drag.current.owns;
      drag.current = { key: null, x: 0, y: 0, axis: null, owns: false };
      if (!wasX) return;
      // Read the position back off the node rather than re-deriving it from touch coordinates —
      // it already reflects the clamping onTouchMove applied, including the "closing from open"
      // case, so there's exactly one source of truth for "how far did this row actually move."
      const m = /translateX\((-?[\d.]+)px\)/.exec(e.currentTarget.style.transform || "");
      const cur = m ? parseFloat(m[1]) : 0;
      if (cur > COMMIT_PX) { setX(e.currentTarget, REVEAL_PX, true); setOpenKey(key); haptic(); }
      else close(e.currentTarget);
    },
  });

  // Spread onto the row alongside its normal onClick: while the row is open, a tap closes it
  // instead of running the normal action (opening the module menu). Row and Remove button are
  // stacked with the row on top, so a tap that should reach the button never reaches this at all.
  const guardClick = (key, onClick) => e => {
    if (openKey === key) { e.stopPropagation(); close(e.currentTarget); return; }
    onClick(e);
  };

  return { openKey, swipeHandlers, guardClick, closeRowSwipe: () => setOpenKey(null) };
}
