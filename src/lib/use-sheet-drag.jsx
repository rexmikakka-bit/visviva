// Drag a bottom sheet down to dismiss it, and slide it out rather than cutting.
//
// This gesture existed twice — in ui.jsx's BottomSheet and again in FittingsScreen's ship-info
// sheet, the second copy written specifically so it would not be "a second dialect" of the first.
// Every other sheet in the app then had either a painted pill with nothing behind it (which is
// worse than no pill: it advertises a gesture that does not work) or no handle at all, leaving the
// × as the only way out. One implementation, so the whole app agrees on what a sheet feels like.
//
// Release past a third of the sheet's height, or with a flick, to dismiss; otherwise spring back.
import { useRef, useState } from "react";
import { C } from "../theme.js";

// Kept in step with the caller's own transition duration — the close is DEFERRED by this long so
// the exit can play, because the caller unmounts the sheet the moment onClose runs.
export const SHEET_EXIT_MS = 200;

/**
 * @param onClose the caller's dismiss callback, invoked after the exit animation
 * @returns sheetRef      put on the sheet element (its height decides the dismiss threshold)
 *          dragY/closing drive the sheet's transform — see sheetTransform
 *          dragging      true while a finger is down, so the caller can drop its transition
 *          dismiss       close it from a button, with the same animation
 *          grabHandlers  spread onto a hit area if you are drawing your own (SheetGrabber does)
 */
export function useSheetDrag(onClose) {
  const [closing, setClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const sheetRef = useRef(null);
  const drag = useRef(null);

  const dismiss = () => { if (closing) return; setClosing(true); setTimeout(() => onClose?.(), SHEET_EXIT_MS); };

  const onGrabStart = e => { const t = e.touches?.[0] ?? e; drag.current = { y: t.clientY, t: Date.now(), moved: 0 }; };
  const onGrabMove = e => {
    if (!drag.current) return;
    e.stopPropagation();                       // never let a sheet drag reach the page's tab swipe
    const t = e.touches?.[0] ?? e;
    // Downward only: dragging up lifts the sheet off the bottom edge and exposes the backdrop
    // beneath it, which looks broken rather than elastic.
    const dy = Math.max(0, t.clientY - drag.current.y);
    drag.current.moved = dy;
    setDragY(dy);
  };
  const onGrabEnd = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    const h = sheetRef.current?.offsetHeight ?? 400;
    // Floored at one frame: two touchmoves can land in the same millisecond, and dividing by that
    // produced a velocity in the hundreds — every drag read as a flick. And a flick needs distance
    // AS WELL as speed, or a twitch throws the sheet away when you meant to peek behind it.
    const velocity = d.moved / Math.max(16, Date.now() - d.t);
    if (d.moved > h * 0.33 || (d.moved > 28 && velocity > 0.7)) dismiss(); else setDragY(0);
  };

  return {
    sheetRef, dragY, closing, dismiss,
    dragging: drag.current != null,
    grabHandlers: { onTouchStart: onGrabStart, onTouchMove: onGrabMove, onTouchEnd: onGrabEnd, onMouseDown: onGrabStart },
  };
}

/** The style a sheet wants, given the hook's output. Spread into its own `style`. */
export function sheetTransform({ dragY, closing, dragging }) {
  return {
    transform: closing ? "translateY(100%)" : `translateY(${dragY}px)`,
    // No transition while a finger is down, or the sheet lags behind the drag.
    transition: dragging ? "none" : `transform ${SHEET_EXIT_MS}ms cubic-bezier(.22,.61,.36,1)`,
  };
}

/**
 * The pill is the affordance, not the hit target — the strip around it is padded well beyond the
 * 4px, because a 4px target is unhittable. touchAction:none stops the browser claiming the drag as
 * a scroll before this ever sees it.
 * @param onArt lighter pill, for a grabber sitting over ship art rather than a surface
 */
export function SheetGrabber({ grabHandlers, onArt, style }) {
  return (
    <div {...grabHandlers} role="button" tabIndex={-1} aria-label="Drag to dismiss"
         style={{ padding: "10px 0 6px", cursor: "grab", touchAction: "none", flexShrink: 0, ...style }}>
      <div style={{ width: 36, height: 4, borderRadius: 99, margin: "0 auto",
                    background: onArt ? "rgba(255,255,255,.35)" : C.border }}/>
    </div>
  );
}

// With the keyboard plugin set to resize:"none" (iOS), nothing else dismisses the keyboard once a
// search input is focused, so a search sheet's own result list is stuck sharing the screen with it.
// Scrolling the list is the one gesture a user already makes to browse results, so piggyback the
// dismiss on it instead of adding a dedicated button. Drop onto any scrollable results container
// that sits below a text input: `onScroll={dismissKeyboardOnScroll}`.
//
// Deliberately does NOT check that the scrolled element contains the focused input. Several search
// screens (the ship browser, the implants tab) render the input as a SIBLING of the results
// scroller rather than a child of it, so a containment check silently no-ops there — only one
// screen is ever visibly interactive at a time on this app, so whatever is focused when a results
// list scrolls is this screen's own search box.
export function dismissKeyboardOnScroll() {
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) ae.blur();
}
