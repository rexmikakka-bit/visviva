// Remember where a tab was scrolled to, so swiping away and back does not throw you at the top.
//
// The Fit/Stats/Graph panels UNMOUNT on every tab change — see lib/use-tab-swipe.js, which keeps
// only one panel alive because Stats and Graph each run a full calcFitStats. A remounted div starts
// at scrollTop 0, so glancing at the fit to check a module cost you your place in a long stats list
// and you had to scroll back down to the speed rows every time.
//
// The store is module-level rather than state on purpose: it has to outlive the panel that owns the
// scroller, and the panel's PARENT is not reliably mounted either (leaving the Fits tab entirely
// unmounts FittingsScreen). It is deliberately not persisted — where you were scrolled to is a
// property of the current session, not of the fit.
import { useRef, useLayoutEffect } from "react";

const store = new Map();

/**
 * @param key stable id for the scroller (the tab name). Scrollers that should remember separate
 *            positions must not share one.
 * @returns a ref to put on the element carrying `overflowY:auto`.
 */
export function useScrollMemory(key) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A LAYOUT effect, not a plain one: this runs before the browser paints, so the panel appears
    // already scrolled instead of appearing at the top and jumping a frame later. Assigning
    // scrollTop clamps itself when the new panel is shorter than the old position.
    const want = store.get(key) ?? 0;
    if (want) {
      el.scrollTop = want;
      // Assigning scrollTop fires a scroll event, which is what re-collapses the header to match
      // where we landed. That is enough for a tab swipe, but NOT for coming back from another
      // bottom tab: App.jsx resets `headerCollapsed` to false in a plain effect keyed on bottomTab,
      // and plain effects run after layout effects — so it would undo the collapse and leave a
      // full-height header sitting over scrolled content. Re-announcing the position a frame later
      // lands after that reset. The event does not bubble, but App listens on window in the CAPTURE
      // phase, so it is seen on the way down.
      requestAnimationFrame(() => el.isConnected && el.dispatchEvent(new Event("scroll")));
    }
    const onScroll = () => store.set(key, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [key]);
  return ref;
}

/** Forget every remembered position. For a deliberate fresh start, e.g. loading another fit. */
export function resetScrollMemory() { store.clear(); }
