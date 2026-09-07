// Android's hardware/gesture Back, app-wide.
//
// With NO 'backButton' listener registered, Capacitor's default is history.back() and then exitApp.
// This is a single-page app that never pushes a history entry, so Back closed the app from
// anywhere — including from on top of an open sheet, where the × was the only way out. That is the
// reported bug, and it is not specific to the ship browser: nothing in the app handled Back.
//
// Registering a listener at all suppresses that default, which cuts both ways. Once this exists the
// button is entirely ours: everything Back should close has to be in this stack, and an empty stack
// has to call exitApp() explicitly or Back does nothing at all.
import { useEffect, useRef } from 'react';

// Lower layers are reached only after everything above them declines. Overlays sit at the default 0
// and order among themselves by MOUNT TIME, which is what makes a sheet opened on top of another
// sheet pop first — and, because React runs a parent's effect after its own children's, what makes
// a drill-down level registered by a sheet component outrank the dismiss registered by the
// <BottomSheet> inside it.
//
// Screens are pinned below that rather than left to mount order, for the same reason: App's own
// handler runs its effect last of all and would otherwise sit above every sheet its children had
// already mounted.
export const BACK_SCREEN = -10;   // a screen's internal navigation (browse path, tab, view)
export const BACK_APP    = -20;   // the last stop before the app exits

const stack = [];

/**
 * @param ref   a ref whose .current is the handler, or null to sit this press out
 * @param layer see BACK_SCREEN / BACK_APP; overlays take the default
 * @returns the unregister function
 */
export function pushBackHandler(ref, layer = 0) {
  const entry = { ref, layer };
  let i = stack.length;
  while (i > 0 && stack[i - 1].layer > layer) i--;
  stack.splice(i, 0, entry);
  return () => { const j = stack.indexOf(entry); if (j >= 0) stack.splice(j, 1); };
}

/** Runs the topmost willing handler. A handler declines by being null or returning false. */
export function runBackHandler() {
  for (let i = stack.length - 1; i >= 0; i--) {
    const fn = stack[i].ref.current;
    if (fn && fn() !== false) return true;
  }
  return false;
}

/** Test seam — the suite drives the stack directly rather than through React. */
export function _backStackDepth() { return stack.length; }

/**
 * @param handler what Back should do here; return false to decline and let the layer below try
 * @param enabled false parks the entry without giving up its place in the stack
 */
export function useBackHandler(handler, enabled = true, layer = 0) {
  const ref = useRef(null);
  // Refreshed after every render, but registered exactly ONCE per mount: position in the stack IS
  // the priority, so re-registering each time the handler's identity changed would float a
  // background screen back above whatever is open on top of it.
  useEffect(() => { ref.current = enabled ? handler : null; });
  useEffect(() => pushBackHandler(ref, layer), [layer]);
}

/**
 * Installs the single listener. Native gets Capacitor's backButton; everywhere else gets Escape,
 * which is both what a desktop browser user expects and the only way to exercise any of this on the
 * dev server.
 * @returns a teardown function
 */
export function initBackButton() {
  const Cap = (typeof window !== 'undefined') && window.Capacitor;
  if (!Cap?.isNativePlatform?.()) {
    const onKey = e => { if (e.key === 'Escape' && runBackHandler()) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }
  let sub = null, dead = false;
  (async () => {
    try {
      const { App } = await import('@capacitor/app');
      const h = await App.addListener('backButton', () => { if (!runBackHandler()) App.exitApp(); });
      if (dead) h.remove(); else sub = h;
    } catch (e) { /* plugin missing: leave Capacitor's own default in place */ }
  })();
  return () => { dead = true; try { sub?.remove?.(); } catch (e) {} };
}
