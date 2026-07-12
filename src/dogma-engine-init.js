// Loads the dogma data bundle and initialises the engine.
//
// The `with { type: 'json' }` import attributes are REQUIRED. Without them this module works under
// Vite but throws in plain Node ("needs an import attribute of type: json"), which means calc.js
// cannot be imported outside the browser — and therefore the regression suite can't run in CI.
// Import attributes are standard ES2025 and are understood by both Node 18.20+/20.10+/22+ and
// Vite/esbuild/Rollup, so this one file now works in both runtimes. Don't remove them.
import TYPES_DATA   from './data/dogma-types.json'   with { type: 'json' };
import EFFECTS_DATA from './data/dogma-effects.json' with { type: 'json' };
import ATTRS_DATA   from './data/dogma-attrs.json'   with { type: 'json' };

import { initEngine } from './dogma-engine.js';
initEngine(TYPES_DATA, EFFECTS_DATA, ATTRS_DATA);

export * from './dogma-engine.js';
// DRONE_TYPES is now loaded lazily via data-bundle.js in App.jsx
export const DRONE_TYPES = {};
