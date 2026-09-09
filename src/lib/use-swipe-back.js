// "Go up one level" for a browser sheet with a drill-down path, as ONE hook: the Android Back button
// and the iOS-style left-to-right swipe together.
//
// They are bound together deliberately. The module browser grew both by hand; the cargo and drone
// browsers grew neither, so from halfway down the market tree Back closed the entire sheet and the
// swipe did nothing — the header's Back arrow was the only way up. Handing out one gesture without
// the other is the bug this exists to make impossible, so callers cannot take just one.
//
// `enabled` should be the same condition that renders the header's own Back arrow. A gesture that
// works where no Back arrow is offered moves a path the user cannot see (behind a search, or a flat
// filtered list), which reads as the sheet losing its place.
import { useRef } from "react";
import { swipeBackAxis, swipeBackCommits } from "./back-button.js";
import { useBackHandler } from "./use-back-handler.js";

export function useSwipeBack(goBack, enabled) {
  // Registered by the SHEET's component rather than the <BottomSheet> it renders, which is what puts
  // climbing the path above the sheet's own dismiss — see back-button.js on layering.
  useBackHandler(goBack, enabled);
  const nav = useRef({ x: 0, y: 0, axis: null });
  return {
    onTouchStart: e => { const pt = e.touches[0]; if (pt) nav.current = { x: pt.clientX, y: pt.clientY, axis: null }; },
    // Locked once, on the first meaningful movement, so scrolling a long list never reads as a swipe.
    onTouchMove: e => {
      const pt = e.touches[0]; if (!pt || nav.current.axis) return;
      nav.current.axis = swipeBackAxis(pt.clientX - nav.current.x, pt.clientY - nav.current.y);
    },
    onTouchEnd: e => {
      const pt = e.changedTouches[0], axis = nav.current.axis;
      nav.current.axis = null;
      if (!pt || axis !== "x" || !enabled) return;
      if (swipeBackCommits(pt.clientX - nav.current.x)) goBack();
    },
  };
}
