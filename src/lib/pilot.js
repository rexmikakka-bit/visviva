// Which pilot flies a fit. Stored on the fit as `slots.pilot`, so it persists and is covered by undo
// for free (same trick as `slots.environment` / `slots.systemSecurity`).
//
// Deliberately does NOT import esi.js: calc.js and the regression suite pull this in, and esi.js
// reaches for localStorage and fetch. The caller passes the per-character ESI skill cache instead.

import { SKILL_DEFAULTS, ALPHA_SKILLS, SKILL_CATALOG } from "../calc.js";

export const PILOT_ALL_V = "allV";
export const PILOT_ALPHA = "alpha";
export const PILOT_ME = "me";
export const PILOT_ESI_PREFIX = "esi:";
export const PILOT_PROFILE_PREFIX = "profile:";

/** The character id in an `esi:<id>` pilot string, or null for any other pilot. */
export function esiPilotId(pilot) {
  return (typeof pilot === "string" && pilot.startsWith(PILOT_ESI_PREFIX))
    ? pilot.slice(PILOT_ESI_PREFIX.length) : null;
}

/** Build the pilot string for an ESI character id. */
export function esiPilot(characterId) { return PILOT_ESI_PREFIX + characterId; }

/** The profile id in a `profile:<id>` pilot string, or null for any other pilot. */
export function profilePilotId(pilot) {
  return (typeof pilot === "string" && pilot.startsWith(PILOT_PROFILE_PREFIX))
    ? pilot.slice(PILOT_PROFILE_PREFIX.length) : null;
}

/** Build the pilot string for a saved skill profile. */
export function profilePilot(profileId) { return PILOT_PROFILE_PREFIX + profileId; }

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
 *
 * A `profile:<id>` pilot is a sheet the user saved by hand in Settings → Skills. It falls back the
 * same way when the profile has since been deleted — a fit outliving the profile it named is normal,
 * not corrupt, and there is nothing to migrate because the answer is the same one an unset pilot gets.
 */
export function resolvePilotSkills(pilot, { appSkills = null, esiSkills = null, profiles = null, fallback = SKILL_DEFAULTS } = {}) {
  if (typeof pilot !== "string" || !pilot) return fallback;
  if (pilot === PILOT_ALL_V) return SKILL_DEFAULTS;
  if (pilot === PILOT_ALPHA) return ALPHA_SKILLS;
  if (pilot === PILOT_ME) return appSkills ?? fallback;
  const id = esiPilotId(pilot);
  if (id) {
    const m = esiSkills?.[id];
    if (m && typeof m === "object") return m;
  }
  const pid = profilePilotId(pilot);
  if (pid) {
    const p = (profiles ?? []).find(x => String(x?.id) === pid);
    if (p?.skills && typeof p.skills === "object") return p.skills;
  }
  return fallback;
}

/**
 * A short name for what a skill sheet actually IS — "All Skills V", a character's name, "Alpha", or
 * "Custom". Answers the question the app-wide sheet otherwise only answers by scrolling 388 rows:
 * a fit's numbers are qualified by skills, and "Your Skills" says nothing about which ones.
 *
 * An UNSET skill is V, not 0 (calcFitStats trains anything it isn't handed), so a fresh install —
 * where the sheet is SKILL_DEFAULTS and the ~190 requirement-only skills are simply absent — has to
 * read "All Skills V" rather than "Custom". That is why every comparison here goes through `?? 5`.
 *
 * Character names come from the per-character ESI cache, which is a full map, so a sheet aligned to
 * a pilot matches theirs exactly. Passed in rather than read here for the same reason
 * `resolvePilotSkills` takes its caches: this file must not reach for localStorage.
 */
export function describeSkillSheet(skills, { esiSkills = null, characters = null, profiles = null } = {}) {
  const lvl = (m, k) => m?.[k] ?? 5;
  const same = (a, b) => SKILL_CATALOG.every(e => lvl(a, e.key) === lvl(b, e.key));
  if (SKILL_CATALOG.every(e => lvl(skills, e.key) === 5)) return "All Skills V";
  for (const [id, map] of Object.entries(esiSkills ?? {})) {
    if (!map || typeof map !== "object" || !same(skills, map)) continue;
    const name = (characters ?? []).find(c => String(c.characterId) === String(id))?.characterName;
    if (name) return name;
  }
  // A saved profile is checked AFTER the characters, because a profile made by aligning to a pilot
  // has that pilot's exact sheet and the character's own name is the more informative of the two.
  // Before Alpha, though: a profile the user named and saved says more than the ceiling it happens
  // to sit on, and "Custom" — which is what an unnamed hand-edited sheet gets — says least of all.
  for (const p of profiles ?? []) if (p?.skills && same(skills, p.skills) && p.name) return p.name;
  if (same(skills, ALPHA_SKILLS)) return "Alpha";
  return "Custom";
}
