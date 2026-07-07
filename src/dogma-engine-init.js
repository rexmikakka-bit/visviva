import TYPES_DATA   from './data/dogma-types.json';
import EFFECTS_DATA from './data/dogma-effects.json';
import ATTRS_DATA   from './data/dogma-attrs.json';

import { initEngine } from './dogma-engine.js';
initEngine(TYPES_DATA, EFFECTS_DATA, ATTRS_DATA);

export * from './dogma-engine.js';
// DRONE_TYPES is now loaded lazily via data-bundle.js in App.jsx
export const DRONE_TYPES = {};