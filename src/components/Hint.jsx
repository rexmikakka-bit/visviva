// A long-press tooltip for the unlabelled numbers in the fitting rows.
//
// `title` is a desktop-only affordance — a phone has no hover — and the module rows are now full of
// deliberately bare figures ("21.5%", "55 GJ/6s"), which is only a good trade if the label is
// reachable by touch. `title` is still set as well, so the desktop hover behaviour people already
// see in the dev server is unchanged.
//
// LONG press, not tap. Every one of these values sits inside a module row whose tap opens the module
// menu; stealing that tap would cost a gesture used constantly. 400 ms is the platform convention
// for a context gesture and is comfortably longer than the contact time of a scroll fling.
//
// The bubble is a PORTAL at position:fixed, not an absolutely-positioned child. The row clips its
// own overflow and sits inside a scroller, so an in-flow bubble would either be cut off or push the
// layout around as it appeared.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C } from "../theme.js";
import { haptic } from "../lib/core.js";

const HOLD_MS  = 400;
const MOVE_TOL = 10;   // px of finger travel that reclassifies the press as a scroll
const MAX_W    = 250;

export function Hint({ text, children, style, highlight }) {
  const [rect, setRect] = useState(null);
  const anchor = useRef(null);
  const timer  = useRef(null);
  const origin = useRef(null);
  const opened = useRef(false);

  const cancel = useCallback(() => { clearTimeout(timer.current); timer.current = null; }, []);
  useEffect(() => cancel, [cancel]);

  useEffect(() => {
    if (!rect) return;
    const off = () => setRect(null);
    // capture:true on both — the dismiss has to land before whatever was tapped acts on it, and
    // `scroll` does not bubble out of the scroller it happened in, so it can only be caught going
    // down. A bubble anchored to a rect is stale the instant the list moves under it.
    window.addEventListener("pointerdown", off, true);
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => {
      window.removeEventListener("pointerdown", off, true);
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
    };
  }, [rect]);

  const onDown = e => {
    opened.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    cancel();
    timer.current = setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      opened.current = true;
      haptic("light");
      setRect({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }, HOLD_MS);
  };
  // A touch pointer is implicitly captured to its target, so these keep arriving even once the
  // finger has slid off the value — which is exactly the movement that should cancel the hold.
  const onMove = e => {
    const o = origin.current;
    if (!o || !timer.current) return;
    if (Math.abs(e.clientX - o.x) > MOVE_TOL || Math.abs(e.clientY - o.y) > MOVE_TOL) cancel();
  };
  // Swallow the click the finger-lift generates after a successful hold, or the row underneath
  // opens the module menu on top of the tooltip that was just asked for.
  const onClick = e => { if (opened.current) { e.stopPropagation(); e.preventDefault(); } };

  if (!text) return children;

  let bubble = null;
  if (rect) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(MAX_W, vw - 16);
    const left = Math.max(8, Math.min((rect.left + rect.right) / 2 - w / 2, vw - w - 8));
    // Flip below the value when there is no room above it. 90px covers the tallest bubble these
    // strings produce at this width plus the arrow gap.
    const place = rect.top < 90 ? { top: rect.bottom + 8 } : { bottom: vh - rect.top + 8 };
    bubble = createPortal(
      <div style={{ position: "fixed", left, width: w, ...place, zIndex: 400, pointerEvents: "none",
                    background: C.surfaceAlt, border: `1px solid ${C.borderStrong}`, borderRadius: 8,
                    padding: "7px 9px", fontSize: 11, lineHeight: 1.35, color: C.text,
                    whiteSpace: "pre-line",
                    boxShadow: "0 6px 20px rgba(0,0,0,.55)" }}>{text}</div>,
      document.body);
  }

  return (<>
    <span ref={anchor} title={text}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={cancel}
          onPointerLeave={cancel} onPointerCancel={cancel} onClick={onClick}
          style={{ display: "inline-flex", alignItems: "center", cursor: "help",
                   ...(highlight && rect ? { background: C.accentLight, boxShadow: `0 0 0 1px ${C.accentBorder}`,
                                             borderRadius: 4 } : null),
                   ...style }}>{children}</span>
    {bubble}
  </>);
}
