// The React binding for the Back stack. Kept apart from lib/back-button.js because the regression
// suite imports that stack directly and CI runs the suite with no npm install — a static `react`
// import anywhere in its graph kills the job. See scripts/check-suite-deps.mjs.
import { useEffect, useRef } from 'react';
import { pushBackHandler } from './back-button.js';

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
