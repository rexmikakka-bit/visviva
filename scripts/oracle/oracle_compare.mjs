// Diff eos oracle stats (from oracle_saved.py JSONL) against calc.js.
//
//   /c/Python314/python scripts/oracle/oracle_saved.py > scripts/oracle/_saved.jsonl
//   node scripts/oracle/oracle_compare.mjs scripts/oracle/_saved.jsonl [--all] [--min-dps N]
//
// Reports, per stat, the fits where our number diverges from eos beyond tolerance,
// sorted worst-first, plus a summary. Buckets mutated/projected fits separately since
// our engine's support there is partial. Use this to surface SYSTEMATIC divergences
// (same ship/module across many fits) -- those are the real engine bugs.

import { readFileSync } from 'fs';
import { calcFitStats, computeCommandBursts } from '../../src/calc.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const showAll = args.includes('--all');
const minDps = Number((args.find((a) => a.startsWith('--min-dps=')) || '=25').split('=')[1]);
if (!file) { console.error('usage: oracle_compare.mjs <jsonl> [--all] [--min-dps=N]'); process.exit(1); }

const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);

// Relative tolerance per stat. Resists compared with absolute 0.15pp per channel.
const TOL = { weaponDps: 0.02, weaponVolley: 0.02, totalEHP: 0.02, armorRepEhpS: 0.02,
              shieldRepEhpS: 0.02, scanRes: 0.01, maxSpeed: 0.01, maxTargetRange: 0.02 };

const relDelta = (a, b) => (b === 0 ? (a === 0 ? 0 : Infinity) : (a - b) / b);

const findings = {};       // stat -> [{id,name,ship,eos,ours,delta}]
for (const k of Object.keys(TOL)) findings[k] = [];
const resistFindings = [];
let ok = 0, errored = 0, skippedFlagged = 0, total = 0;
const errorSummary = {};

for (const line of lines) {
  const r = JSON.parse(line);
  total++;
  const flagged = r.flags.mutated || r.flags.projected || r.flags.fighters || r.flags.commandBoosted;
  if (flagged && !showAll) { skippedFlagged++; continue; }

  let cs;
  try {
    // Command (gang) boosts: the harness emits each ACTIVE booster fit's own spec, so we recompute
    // its bursts with OUR code rather than importing eos's answer — that keeps computeCommandBursts
    // under test instead of assuming it. Inactive links are not emitted (eos skips them too).
    const externalBursts = [];
    for (const b of (r.spec.commandFits ?? [])) {
      try {
        for (const burst of computeCommandBursts(b.ship, b.slots, null,
              { implants: b.implants, boosters: b.boosters })) externalBursts.push(burst);
      } catch { /* a booster fit we cannot build shows up as a divergence, not a crash */ }
    }
    cs = calcFitStats(r.spec.ship, r.spec.slots, r.spec.drones, null,
                      { implants: r.spec.implants, boosters: r.spec.boosters,
                        systemSecurity: r.spec.systemSecurity, externalBursts });
  } catch (ex) {
    errored++;
    const key = String(ex.message).slice(0, 60);
    errorSummary[key] = (errorSummary[key] || 0) + 1;
    continue;
  }

  // The saved-fit oracle records eos at FULL spool. calcFitStats exposes our full-spool numbers as
  // weapon{Dps,Volley}Max, which ramp ONLY the disintegrator's own contribution (co-fitted
  // smartbombs/guns don't spool) — so compare against those directly rather than scaling the whole
  // total by the factor.
  const ours = {
    weaponDps: cs.weaponDpsMax ?? cs.weaponDps?.total ?? 0,
    weaponVolley: cs.weaponVolleyMax ?? cs.weaponVolley?.total ?? 0,
    totalEHP: cs.totalEHP ?? 0,
    armorRepEhpS: cs.armorRepEhpS ?? 0,
    shieldRepEhpS: cs.shieldRepEhpS ?? 0,
    scanRes: cs.scanRes ?? 0,
    maxSpeed: (cs.maxVelocityAB ?? cs.maxVelocity ?? 0),  // eos maxSpeed includes active MWD/AB
    maxTargetRange: cs.targetRange ?? 0,   // calc.js returns km
  };
  // eos lock range is metres; ours is km -- normalise below when comparing.

  let anyFail = false;
  for (const [k, tol] of Object.entries(TOL)) {
    let e = r.eos[k], o = ours[k];
    if (k === 'maxTargetRange') { // eos metres -> compare in km if ours looks like km
      if (o > 0 && e / o > 100) e = e / 1000;
    }
    // Skip DPS/volley noise on low-damage fits.
    if ((k === 'weaponDps' || k === 'weaponVolley') && e < minDps) continue;
    if (k === 'armorRepEhpS' || k === 'shieldRepEhpS') { if (e < 1 && o < 1) continue; }
    const d = relDelta(o, e);
    if (Math.abs(d) > tol) {
      findings[k].push({ id: r.id, name: r.name, ship: r.ship, eos: e, ours: o, delta: d });
      anyFail = true;
    }
  }
  // Resists: absolute per-channel.
  for (const layer of ['shield', 'armor', 'hull']) {
    const e = r.eos.resists[layer], o = [cs.resists?.[layer]?.em, cs.resists?.[layer]?.th,
      cs.resists?.[layer]?.kin, cs.resists?.[layer]?.exp];
    if (o.some((v) => v == null)) continue;
    const maxAbs = Math.max(...e.map((ev, i) => Math.abs(ev - o[i])));
    if (maxAbs > 0.15) {
      resistFindings.push({ id: r.id, name: r.name, ship: r.ship, layer,
        eos: e.join('/'), ours: o.map((v) => v.toFixed(1)).join('/'), maxAbs });
      anyFail = true;
    }
  }
  if (!anyFail) ok++;
}

const pct = (d) => (d * 100).toFixed(1) + '%';
console.log(`\n=== compared ${total} fits: ${ok} clean, ${errored} JS errors, ${skippedFlagged} flagged-skipped ===\n`);

for (const [k, list] of Object.entries(findings)) {
  if (!list.length) continue;
  list.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log(`--- ${k}: ${list.length} divergent (worst 15) ---`);
  for (const f of list.slice(0, 15)) {
    console.log(`  #${f.id} ${f.ship}/${f.name.slice(0, 20)}  eos=${(+f.eos).toFixed(1)} ours=${(+f.ours).toFixed(1)} (${pct(f.delta)})`);
  }
  // Ship frequency to spot systematic issues.
  const byShip = {};
  for (const f of list) byShip[f.ship] = (byShip[f.ship] || 0) + 1;
  const top = Object.entries(byShip).sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`    by ship: ${top.map(([s, n]) => `${s}×${n}`).join(', ')}\n`);
}

if (resistFindings.length) {
  resistFindings.sort((a, b) => b.maxAbs - a.maxAbs);
  console.log(`--- resists: ${resistFindings.length} divergent (worst 15) ---`);
  for (const f of resistFindings.slice(0, 15)) {
    console.log(`  #${f.id} ${f.ship}/${f.name.slice(0, 18)} ${f.layer}  eos=${f.eos} ours=${f.ours}`);
  }
  const byShip = {};
  for (const f of resistFindings) byShip[f.ship] = (byShip[f.ship] || 0) + 1;
  console.log(`    by ship: ${Object.entries(byShip).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => `${s}×${n}`).join(', ')}\n`);
}

if (errored) {
  console.log('--- JS error buckets ---');
  for (const [k, n] of Object.entries(errorSummary).sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${k}`);
}
