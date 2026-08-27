// useState for a toggle that has to survive its own panel unmounting.
//
// Same problem as use-scroll-memory.js and the same shape of answer: the Fit/Stats/Graph panels
// unmount on every tab change (lib/use-tab-swipe.js keeps only one alive, because Stats and Graph
// each run a full calcFitStats), so ordinary component state is thrown away by a glance at another
// tab. Everything you had opened, expanded or switched to on the Stats page came back closed.
//
// The store is module-level because the panel's PARENT is not reliably mounted either — leaving the
// Fits tab entirely unmounts FittingsScreen. It is deliberately NOT persisted and NOT cleared by
// resetScrollMemory: these are how you are looking at a fit, not a property of the fit, so they
// should carry across to the next one you open and start fresh on the next launch.
import { useState, useRef, useCallback } from "react";

const store = new Map();

/**
 * @param key     app-wide unique id for this toggle (two panels must not share one)
 * @param initial as useState — a function is called lazily, and only when nothing is remembered
 * @returns [value, setValue] with useState's signature, functional updates included
 */
export function useViewMemory(key, initial) {
  const [value, setValue] = useState(() =>
    store.has(key) ? store.get(key) : (typeof initial === "function" ? initial() : initial));
  // The updater form has to read the LATEST value, and doing that inside setValue's own callback
  // would make writing to the store a side effect of a render-phase function — which React is free
  // to run twice.
  const latest = useRef(value);
  latest.current = value;
  const set = useCallback(next => {
    const v = typeof next === "function" ? next(latest.current) : next;
    latest.current = v;
    store.set(key, v);
    setValue(v);
  }, [key]);
  return [value, set];
}
