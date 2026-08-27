// Swipe between sibling tabs, with the panel following your finger and sliding in from the correct
// side on commit rather than cutting.
//
// Extracted from FittingsScreen's Fit/Stats/Graph swipe so the Effects screen could have the same
// gesture without a second copy of it. A copy would have been ~55 lines of touch bookkeeping kept
// in sync by hand, and the horizontal-scroller escape below is exactly the kind of subtlety that
// gets fixed in one copy and not the other.
//
// Only ONE panel is ever mounted: the callers' panels each run real work (Stats and Graph both call
// calcFitStats), so keeping them all alive to slide a track would multiply that on every render.
// During the drag the transform is written straight to the node through the ref rather than through
// state, so dragging never re-renders the panel underneath it.
import { useRef, useState } from "react";
import { haptic } from "./core.js";

const COMMIT_PX = 60;   // past this, the swipe changes tab; short of it, it springs back
const AXIS_LOCK_PX = 8; // movement before the gesture decides whether it is horizontal or vertical

/**
 * @param tabs    ordered array of tab ids
 * @param current the active tab id
 * @param onChange(nextTabId) — called on commit
 * @returns {panelRef, slideDir, swipeHandlers, goTo}
 *   Spread `swipeHandlers` onto the element WRAPPING the panel, put `panelRef` on the panel itself,
 *   and key the panel on the tab so the incoming one remounts and replays the slide-in class
 *   (`slideDir` > 0 = came from the right).
 */
export function useTabSwipe(tabs, current, onChange) {
  const swipe = useRef({ x: 0, y: 0, axis: null, skip: false, claimed: null });
  const panelRef = useRef(null);
  const [slideDir, setSlideDir] = useState(0);   // -1 = came from the left, +1 = from the right

  const setX = (px, animate) => {
    const el = panelRef.current; if (!el) return;
    el.style.transition = animate ? "transform .18s cubic-bezier(.22,.61,.36,1)" : "none";
    el.style.transform = px ? `translateX(${px}px)` : "";
  };
  const goTo = (i, dir) => { setSlideDir(dir); onChange(tabs[i]); haptic(); };

  // A touch that begins inside a horizontally scrollable strip belongs to that strip, not to the
  // tab swipe. Without this the graph-type selector could not be scrolled at all: its touchmove
  // bubbled up here, the axis locked to "x", and the whole panel slid sideways instead. Detected
  // structurally (overflow-x + actual overflow) rather than by tagging specific components, so
  // every horizontal scroller in the app is covered by the same rule.
  //
  // A native <input type="range"> is the same problem in a different shape: dragging its thumb is
  // itself a horizontal gesture, but the element has no overflow to detect (it isn't a scroller at
  // all). Without this a range slider anywhere in a swiped panel — the Projected tab's rep-range
  // slider, the Fit tab's pilot-security slider — dragged the whole tab sideways instead of moving
  // the thumb, because the browser only starts suppressing the touchmove for its own drag AFTER the
  // slider has already lost the axis race to this handler.
  //
  // A swipe-to-delete row (useRowSwipe, tagged data-rowswipe) is the third shape, and it is only a
  // PARTIAL claim: the row owns the direction it can actually reveal something in, and the tab swipe
  // keeps the other one. So this returns which directions to stand down for rather than a boolean,
  // and the decision is deferred to the moment the axis locks and the direction is known.
  // The row's own stopPropagation cannot cover the first few pixels, because it fires only once that
  // gesture's axis has locked — by which point this handler has locked too and the panel has already
  // started moving.
  //
  // "all"   — not ours under any circumstances (a horizontal scroller, a range slider)
  // "both"  — an OPEN row: rightward reveals further, leftward closes it
  // "right" — a CLOSED row: nothing to its left to reveal, so leftward is still "go to Stats"
  const standDownFor = (node) => {
    for (let el = node; el instanceof Element; el = el.parentElement) {
      if (el === panelRef.current?.parentElement) break;
      const row = el.getAttribute("data-rowswipe");
      if (row) return row === "open" ? "both" : "right";
      if (el.tagName === "INPUT" && el.type === "range") return "all";
      if (el.scrollWidth > el.clientWidth + 2) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === "auto" || ox === "scroll") return "all";
      }
    }
    return null;
  };

  const onTouchStart = e => {
    const t = e.touches[0];
    const claimed = standDownFor(e.target);
    if (t) swipe.current = { x: t.clientX, y: t.clientY, axis: null, skip: claimed === "all", claimed };
  };
  const onTouchMove = e => {
    if (swipe.current.skip) return;
    const t = e.touches[0]; if (!t) return;
    const dx = t.clientX - swipe.current.x, dy = t.clientY - swipe.current.y;
    // Lock the axis once, so a vertical scroll never turns into a horizontal drag halfway down.
    if (!swipe.current.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      swipe.current.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
      // Latched with the axis, for the same reason useRowSwipe latches its own side: a drag that
      // wanders back across its start must not take the panel with it halfway through.
      const c = swipe.current.claimed;
      if (swipe.current.axis === "x" && (c === "both" || (c === "right" && dx > 0))) swipe.current.skip = true;
    }
    if (swipe.current.skip || swipe.current.axis !== "x") return;
    const i = tabs.indexOf(current);
    // Rubber-band at the ends: there is nothing to swipe to, so resist rather than lie.
    const atEdge = (dx > 0 && i === 0) || (dx < 0 && i === tabs.length - 1);
    setX(dx * (atEdge ? 0.18 : 0.55), false);
  };
  const onTouchEnd = e => {
    const t = e.changedTouches[0];
    const wasX = swipe.current.axis === "x" && !swipe.current.skip;
    swipe.current.axis = null; swipe.current.skip = false; swipe.current.claimed = null;
    if (!t || !wasX) { setX(0, true); return; }
    const dx = t.clientX - swipe.current.x;
    const i = tabs.indexOf(current);
    if (dx < -COMMIT_PX && i < tabs.length - 1) { setX(0, false); goTo(i + 1, 1); }
    else if (dx > COMMIT_PX && i > 0) { setX(0, false); goTo(i - 1, -1); }
    else setX(0, true);   // not far enough — spring back
  };

  return { panelRef, slideDir, swipeHandlers: { onTouchStart, onTouchMove, onTouchEnd }, goTo };
}

/** The slide-in class for a panel that just arrived from `dir` (see GLOBAL_CSS). */
export function slideClass(dir) {
  return dir > 0 ? "vv-from-right" : dir < 0 ? "vv-from-left" : undefined;
}
