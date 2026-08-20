// Which pilot flies a fit. Stored on the fit as `slots.pilot`, so it persists and is covered by undo
// for free (same trick as `slots.environment` / `slots.systemSecurity`).
//
// Deliberately does NOT import esi.js: calc.js and the regression suite pull this in, and esi.js
// reaches for localStorage and fetch. The caller passes the per-character ESI skill cache instead.

import { SKILL_DEFAULTS, ALPHA_SKILLS } from "../calc.js";

export const PILOT_ALL_V = "allV";
export const PILOT_ALPHA = "alpha";
export const PILOT_ME = "me";
export const PILOT_ESI_PREFIX = "esi:";

/** The character id in an `esi:<id>` pilot string, or null for any other pilot. */
export function esiPilotId(pilot) {
  return (typeof pilot === "string" && pilot.startsWith(PILOT_ESI_PREFIX))
    ? pilot.slice(PILOT_ESI_PREFIX.length) : null;
}

/** Build the pilot string for an ESI character id. */
export function esiPilot(characterId) { return PILOT_ESI_PREFIX + characterId; }

/**
 * The skill map a fit should be calculated with.
 *
 * `fallback` is what an unset (or unresolvable) pilot means, and it belongs to the CALLER rather than
 * being baked in here — the app passes its own skill sheet, while the regression suite and any
 * headless caller want all V. It is deliberately NOT `appSkills`: an `esi:<id>` pilot that has never
 * been synced must land on the caller's default, not quietly borrow your own skills.
 *
 * The app resolves a projection/command SOURCE fit through this same function with the same fallback
 * as the fit being edited, so a saved fit reads identically either way — the skills it was last
 * edited under are the skills it keeps when something projects it.
 *
 * An `esi:<id>` pilot whose skills have never been synced also falls back rather than guessing — the
 * cache is populated at sync time, and a character connected on another device has no entry here.
 */
export function resolvePilotSkills(pilot, { appSkills = null, esiSkills = null, fallback = SKILL_DEFAULTS } = {}) {
  if (typeof pilot !== "string" || !pilot) return fallback;
  if (pilot === PILOT_ALL_V) return SKILL_DEFAULTS;
  if (pilot === PILOT_ALPHA) return ALPHA_SKILLS;
  if (pilot === PILOT_ME) return appSkills ?? fallback;
  const id = esiPilotId(pilot);
  if (id) {
    const m = esiSkills?.[id];
    if (m && typeof m === "object") return m;
  }
  return fallback;
}
