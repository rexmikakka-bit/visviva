/**
 * Rebuild `projectedEffects` from the projected-fit specs the oracle emits.
 *
 * This mirrors App.jsx's `projectedEffects` useMemo exactly — deliberately. The harness could have
 * imported eos's already-applied numbers instead, but then our projection maths would never be
 * tested, and testing it is the entire point. If this drifts from App.jsx, the oracle stops
 * measuring what the app actually does.
 *
 * Shared by oracle_compare.mjs and any ad-hoc analysis so there is exactly one copy.
 */
import { computeProjectedReps, calcRangeFactor, stackingPenalty } from '../../src/calc.js';

// App.jsx defaults an unset projection range to 30 km; eos stores one per link, which the harness
// passes through as projectionRangeKm.
const DEFAULT_RANGE_KM = 30;

export function buildProjectedEffects(projectedFits, skills = null) {
  const reps = { shield: 0, armor: 0, hull: 0 };
  const webMults = [];
  let neutGJs = 0;
  const col = { sig: [], lock: [], scan: [], trk: [], topt: [], tfall: [], mrng: [], edly: [], avel: [], acld: [] };

  for (const pf of (projectedFits ?? [])) {
    let eff;
    try {
      eff = computeProjectedReps(pf.ship, pf.slots, skills,
        { implants: pf.implants, boosters: pf.boosters, drones: pf.drones });
    } catch { continue; }
    const rangeM = (pf.projectionRangeKm ?? DEFAULT_RANGE_KM) * 1000;
    const rf = (o, fo) => calcRangeFactor(o, fo, rangeM, true);
    // `amount` is how many copies of that source are projecting (eos ProjectionInfo.amount).
    const n = Math.max(1, pf.amount ?? 1);
    for (let i = 0; i < n; i++) {
      for (const r of eff.reps)  reps[r.kind] += r.rawPS * rf(r.optimal, r.falloff);
      for (const w of eff.webs)  webMults.push(1 + (w.speedFactor * rf(w.optimal, w.falloff)) / 100);
      for (const q of eff.neuts) neutGJs += q.gjPerSec * rf(q.optimal, q.falloff);
      for (const p of (eff.painters ?? [])) col.sig.push(p.sigBonus * rf(p.optimal, p.falloff));
      for (const d of (eff.damps ?? [])) {
        col.lock.push(d.lockBonus * rf(d.optimal, d.falloff));
        col.scan.push(d.scanResBonus * rf(d.optimal, d.falloff));
      }
      for (const t of (eff.trackDisr ?? [])) {
        const f = rf(t.optimal, t.falloff);
        col.trk.push(t.tracking * f); col.topt.push(t.optimalBonus * f); col.tfall.push(t.falloffBonus * f);
      }
      for (const g of (eff.guideDisr ?? [])) {
        const f = rf(g.optimal, g.falloff);
        col.mrng.push(g.missileRange * f); col.edly.push(g.explosionDelay * f);
        col.avel.push(g.aoeVel * f);       col.acld.push(g.aoeCloud * f);
      }
    }
  }

  const webMult = webMults.length ? stackingPenalty(webMults) : 1;
  const stackPct = (arr) => arr.length ? (stackingPenalty(arr.map((p) => 1 + p / 100)) - 1) * 100 : 0;
  const debuffs = {
    sig: stackPct(col.sig), lockRange: stackPct(col.lock), scanRes: stackPct(col.scan),
    tracking: stackPct(col.trk), turretOptimal: stackPct(col.topt), turretFalloff: stackPct(col.tfall),
    missileRange: stackPct(col.mrng), explosionDelay: stackPct(col.edly),
    aoeVel: stackPct(col.avel), aoeCloud: stackPct(col.acld),
  };
  const hasDebuff = Object.values(debuffs).some((v) => Math.abs(v) > 0.05);
  return { reps, webMult, neutGJs, debuffs: hasDebuff ? debuffs : null };
}
