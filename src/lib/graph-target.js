import { TYPES, tidByName, calcFitStats } from "../calc.js";

// A SAVED FIT standing in for the target on the damage graph, reduced to the two things the
// application maths actually asks a target for: signature radius and speed.
//
// Deliberately NOT resists. Those stay with Stats > Firepower, which is the single place the target
// resist profile is set — a DPS curve silently pre-corrected for one hull's resist spread is harder
// to read, not easier, because the arithmetic you are doing in your head no longer matches what is
// drawn. Sig and speed are different: they feed tracking and missile application, which nobody does
// in their head.
//
// Lives here rather than in GraphTab.jsx so the regression suite can reach it — the suite cannot
// import JSX, and this is the only part of the feature with real numbers in it.

const PROP_GROUPS = new Set(['Propulsion Module', 'Afterburner', 'Microwarpdrive']);

/** Is this slot entry a prop mod? Slot entries carry `typeID`, `name`, or both. */
export function isPropSlot(m) {
  const t = m?.typeID ?? tidByName(m?.name);
  return !!t && PROP_GROUPS.has(TYPES[t]?.gn);
}

/**
 * The sig/speed a saved fit presents, both running its prop mod and not.
 *
 * TWO passes with the prop mod's state forced, rather than one read of the fit as saved: which state
 * its owner happened to leave it in is not the question being asked. `calc.js` only counts an ACTIVE
 * prop mod towards `maxVelocityAB`, and an active microwarpdrive's signature bloom is already folded
 * into `sigRadius` by the engine, so forcing the state is what makes the two pairs mean what they
 * say. 'online', not 'offline', for the off pass — a fitted but idle prop is online, and offlining it
 * would drop its fitting cost and mass along with the speed, which is a different ship.
 *
 * Returns null if the fit cannot be computed at all; the caller shows the reference as stale rather
 * than silently resetting the engagement.
 *
 * @returns {{mwd:{sig:number,vel:number}, noMwd:{sig:number,vel:number}, hasProp:boolean}|null}
 */
export function targetFitProfile(shipName, fit, skills) {
  const ref = { name: shipName, typeID: tidByName(shipName) };
  if (!ref.typeID || !fit?.slots) return null;
  const forceProp = (on) => {
    const st = on ? 'active' : 'online';
    const mapSlot = (arr) => (arr || []).map(m => (m && isPropSlot(m) && m.state !== st) ? { ...m, state: st } : m);
    return { ...fit.slots, high: mapSlot(fit.slots.high), mid: mapSlot(fit.slots.mid), low: mapSlot(fit.slots.low) };
  };
  const opts = { implants: fit.implants, boosters: fit.boosters,
                 pilotSec: fit.slots.pilotSec, systemSecurity: fit.slots.systemSecurity };
  const run = (on) => { try { return calcFitStats(ref, forceProp(on), fit.drones ?? [], skills, opts) ?? null; }
                        catch { return null; } };
  const on = run(true), off = run(false);
  if (!on || !off) return null;
  const mwd   = { sig: on.sigRadius,  vel: Math.round(on.maxVelocityAB ?? on.maxVelocity ?? 0) };
  const noMwd = { sig: off.sigRadius, vel: Math.round(off.maxVelocity ?? 0) };
  // A fit with no prop mod comes back with two identical pairs, which would make the graph's MWD
  // toggle a control that visibly does nothing. The caller dims it on this flag instead.
  return { mwd, noMwd, hasProp: mwd.vel > noMwd.vel + 0.5 };
}
