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
import { computeProjectedReps, computeCommandBursts, calcRangeFactor, stackingPenalty } from '../../src/calc.js';

// A NULL projection range means "no attenuation", not "30 km". eos is explicit about this —
// calculateRangeFactor() opens with `if distance is None: return 1` — and most saved links have no
// explicit range. App.jsx defaults to 30 km because there a human is choosing a distance, but
// applying that here silently weakened every unranged projection: a Paladin being webbed by a
// projected Vindicator read 689 m/s against eos's 15.
const NO_ATTENUATION = null;

export function buildProjectedEffects(projectedFits, skills = null, resist = null) {
  // Target EWAR resistances (see projectionResistances in calc.js). Applied PER SOURCE MODULE,
  // before stacking — stack(b*r) != stack(b)*r, and eos does the former.
  const R = { damp: 1, web: 1, neut: 1, painter: 1, disrupt: 1, ...(resist ?? {}) };
  const reps = { shield: 0, armor: 0, hull: 0 };
  const webMults = [];
  let neutGJs = 0;
  const col = { sig: [], lock: [], scan: [], trk: [], topt: [], tfall: [], mrng: [], edly: [], avel: [], acld: [] };
  const boosts = { lock: [], scan: [] };   // projected Remote Sensor Boosters (fed to the attribute pool)

  for (const pf of (projectedFits ?? [])) {
    let eff;
    try {
      // The SOURCE's own command boosts change what it projects — a Shield Command Burst cuts a
      // remote shield booster's cycle time, so a boosted logi reps ~20% harder.
      const srcBursts = [];
      for (const b of (pf.commandFits ?? [])) {
        try {
          for (const x of computeCommandBursts(b.ship, b.slots, skills,
                { implants: b.implants, boosters: b.boosters })) srcBursts.push(x);
        } catch { /* a booster fit we cannot build just contributes nothing */ }
      }
      eff = computeProjectedReps(pf.ship, pf.slots, skills,
        { implants: pf.implants, boosters: pf.boosters, drones: pf.drones,
          externalBursts: srcBursts });
    } catch { continue; }
    const rangeKm = pf.projectionRangeKm ?? NO_ATTENUATION;
    const rf = rangeKm == null
      ? () => 1                                   // matches eos: distance None -> factor 1
      : (o, fo) => calcRangeFactor(o, fo, rangeKm * 1000, true);
    // `amount` is how many copies of that source are projecting (eos ProjectionInfo.amount).
    const n = Math.max(1, pf.amount ?? 1);
    for (let i = 0; i < n; i++) {
      for (const r of eff.reps)  reps[r.kind] += r.rawPS * rf(r.optimal, r.falloff);
      for (const w of eff.webs)  webMults.push(1 + (w.speedFactor * R.web * rf(w.optimal, w.falloff)) / 100);
      for (const q of eff.neuts) neutGJs += q.gjPerSec * R.neut * rf(q.optimal, q.falloff);
      for (const p of (eff.painters ?? [])) col.sig.push(p.sigBonus * R.painter * rf(p.optimal, p.falloff));
      for (const d of (eff.damps ?? [])) {
        col.lock.push(d.lockBonus * R.damp * rf(d.optimal, d.falloff));
        col.scan.push(d.scanResBonus * R.damp * rf(d.optimal, d.falloff));
      }
      // Remote Sensor Boosters are ASSISTANCE — no EWAR resistance. They are NOT folded into the
      // debuff stack: being bonuses, they have to compete with the target's own signal amps and
      // Sensor Optimization burst inside one penalized group, which only the attribute pool can do.
      for (const b of (eff.sensorBoosts ?? [])) {
        if (b.lockBonus) boosts.lock.push(b.lockBonus * rf(b.optimal, b.falloff));
        if (b.scanResBonus) boosts.scan.push(b.scanResBonus * rf(b.optimal, b.falloff));
      }
      for (const t of (eff.trackDisr ?? [])) {
        const f = rf(t.optimal, t.falloff);
        col.trk.push(t.tracking * R.disrupt * f); col.topt.push(t.optimalBonus * R.disrupt * f);
        col.tfall.push(t.falloffBonus * R.disrupt * f);
      }
      for (const g of (eff.guideDisr ?? [])) {
        const f = rf(g.optimal, g.falloff);
        col.mrng.push(g.missileRange * R.disrupt * f); col.edly.push(g.explosionDelay * R.disrupt * f);
        col.avel.push(g.aoeVel * R.disrupt * f);       col.acld.push(g.aoeCloud * R.disrupt * f);
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
  return { reps, webMult, neutGJs, debuffs: hasDebuff ? debuffs : null, boosts };
}
