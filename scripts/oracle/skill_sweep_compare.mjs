// Skill-sensitivity sweep, our half + the diff. See skill_sweep.py for what this answers.
//
//   /c/Python314/python scripts/oracle/skill_sweep.py > scripts/oracle/_skills.jsonl
//   node scripts/oracle/skill_sweep_compare.mjs scripts/oracle/_skills.jsonl [--verbose]
//
// Reports skills whose INFLUENCE differs between the engines, bucketed by which way it goes:
//
//   INERT HERE   — eos moves a stat, we do not. A skill that silently does nothing; the thing this
//                  sweep exists to find.
//   INERT THERE  — we move a stat, eos does not. Usually eos missing a hand-written effect class
//                  rather than a bug of ours (see CLAUDE.md, "the oracle is not infallible") — but
//                  worth a look either way, since it can also mean we apply something twice.
//   DIFFERENT    — both move it, by materially different amounts.
//
// Skills neither engine reacts to are counted, not listed: they are simply outside the reach of
// skill_fits.json, which is a coverage gap to widen rather than a result.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { calcFitStats, SKILL_CATALOG, SKILL_DEFAULTS } from '../../src/calc.js';
import { typeIDByName } from '../../src/dogma-engine-init.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? join(HERE, '_skills.jsonl');
const verbose = args.includes('--verbose');

const SPECS = JSON.parse(readFileSync(join(HERE, 'skill_fits.json'), 'utf8')).fits;

// Relative movement below this is noise (float dust, or a bonus so small the sweep cannot tell it
// from none). A skill that genuinely applies moves a stat by at least a per-mille.
const MOVED = 1e-4;
// Two engines "agree on the influence" when their relative movements are within this of each other.
const AGREE = 0.02;

const M = (e) => ({ typeID: typeIDByName(e.name), state: e.state ?? 'online', ammo: e.ammo });

function ourStats(spec, zeroKey) {
  const slots = {
    high: (spec.high ?? []).map(M), mid: (spec.mid ?? []).map(M),
    low: (spec.low ?? []).map(M), rigs: (spec.rigs ?? []).map(M),
  };
  const ent = (d) => ({ typeID: typeIDByName(d.name), name: d.name, qty: d.qty ?? 1, active: d.active !== false });
  // Fighters are NOT drones on this side: they never enter the dogma engine, and calcFitStats takes
  // them on `opts`, not in the drones argument. Passing them as drones is silently accepted and
  // yields fighter DPS 0 — which then reads as "every fighter skill is inert here".
  const drones = (spec.drones ?? []).map(ent);
  const fighters = (spec.fighters ?? []).map(ent);
  // `{...SKILL_DEFAULTS, [key]: 0}` is the whole override: calcFitStats trains every skill it was
  // not handed at V, so naming one at 0 isolates it without disturbing anything else.
  const skills = zeroKey ? { ...SKILL_DEFAULTS, [zeroKey]: 0 } : null;
  const cs = calcFitStats({ typeID: typeIDByName(spec.ship), name: spec.ship }, slots, drones, skills, { fighters });
  return {
    weaponDps: cs.weaponDps.total, weaponVolley: cs.weaponVolley.total,
    // eos folds fighters into getDroneDps(); we keep them apart, so add them back for the comparison.
    droneDps: cs.droneDps.total + cs.fighterDps.total, totalDps: cs.totalDps.total,
    totalEHP: cs.totalEHP, shieldHP: cs.shieldHP, armorHP: cs.armorHP, hullHP: cs.hullHP,
    armorRepEhpS: cs.armorRepEhpS, shieldRepEhpS: cs.shieldRepEhpS,
    capDelta: cs.capDelta, capCapacity: cs.capCapacity,
    // `cs.exact` rather than the display fields: those are rounded (scanRes to a whole unit,
    // maxVelocity to a whole m/s), and a rounded stat quantises relative movement to about the
    // MOVED threshold — a real 0.05% skill bonus would land on the same integer and read inert.
    // maxSpeed is the AB/MWD figure because eos's fit.maxSpeed is the ship's engine-computed
    // maxVelocity, and eos applies the prop mod there; we apply ours afterwards in calc.js, so
    // our unpropped `maxVelocity` is not the same quantity. maxVelocityAB falls back to the
    // unpropped speed when nothing is propping, so it is the like-for-like field on every fit.
    maxTargetRange: cs.exact.targetRange, maxSpeed: cs.exact.maxVelocityAB, scanRes: cs.exact.scanRes,
    sigRadius: cs.exact.sigRadius, agility: cs.agility,
    cpuUsed: cs.cpuUsed, pgUsed: cs.pgUsed, minerYield: cs.mining?.moduleM3S ?? 0,
  };
}

// ── read the eos half ────────────────────────────────────────────────────────
const eosBase = {};                 // fit -> stats
const eosMoved = {};                // fit -> skillName -> {stat: value}
const eosErrors = [];
for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
  if (line.startsWith('#')) continue;
  const r = JSON.parse(line);
  if (r.skill === null) { eosBase[r.fit] = r.stats; eosMoved[r.fit] = {}; continue; }
  if (r.error) { eosErrors.push(`${r.fit}/${r.skill}: ${r.error}`); continue; }
  eosMoved[r.fit][r.skill] = r.moved;
}

const rel = (now, base) => (base === 0 ? (now === 0 ? 0 : Infinity) : (now - base) / base);
const STATS = Object.keys(ourStats(SPECS[Object.keys(SPECS)[0]]));

const findings = [];
let bothInert = 0, compared = 0, ourErrors = 0;

for (const [fitId, spec] of Object.entries(SPECS)) {
  if (!eosBase[fitId]) { console.log(`  (no eos data for ${fitId} — rerun skill_sweep.py)`); continue; }
  const ourBase = ourStats(spec);
  const eBase = eosBase[fitId];

  for (const entry of SKILL_CATALOG) {
    const eMoved = eosMoved[fitId][entry.name];
    if (eMoved === undefined) continue;   // eos does not know this skill; nothing to compare
    let oStats;
    try { oStats = ourStats(spec, entry.key); } catch { ourErrors++; continue; }
    compared++;

    let anyDiff = false, anyMove = false;
    const detail = [];
    for (const stat of STATS) {
      const oursRel = rel(oStats[stat], ourBase[stat]);
      const eosRel = rel(eMoved[stat] ?? eBase[stat], eBase[stat]);
      const oursMoves = Math.abs(oursRel) > MOVED;
      const eosMoves = Math.abs(eosRel) > MOVED;
      if (!oursMoves && !eosMoves) continue;
      anyMove = true;
      if (oursMoves && eosMoves && Math.abs(oursRel - eosRel) <= AGREE * Math.max(Math.abs(eosRel), 1e-9)) continue;
      anyDiff = true;
      const kind = !oursMoves ? 'INERT HERE' : !eosMoves ? 'INERT THERE' : 'DIFFERENT';
      detail.push({ stat, kind, ours: oursRel, eos: eosRel });
    }
    if (!anyMove) bothInert++;
    if (anyDiff) findings.push({ fit: fitId, skill: entry.name, key: entry.key, detail });
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const pct = (v) => (v === Infinity ? '  +inf' : `${(v * 100).toFixed(2).padStart(7)}%`);
const buckets = { 'INERT HERE': [], 'INERT THERE': [], DIFFERENT: [] };
for (const f of findings) {
  for (const kind of new Set(f.detail.map((d) => d.kind))) buckets[kind].push(f);
}

console.log(`\n${compared} skill x fit comparisons; ${bothInert} inert on both sides (out of this sweep's reach)`);
if (eosErrors.length) console.log(`${eosErrors.length} eos errors, e.g. ${eosErrors[0]}`);
if (ourErrors) console.log(`${ourErrors} of ours threw`);

for (const [kind, list] of Object.entries(buckets)) {
  const bySkill = new Map();
  for (const f of list) {
    const d = f.detail.filter((x) => x.kind === kind);
    if (!d.length) continue;
    if (!bySkill.has(f.skill)) bySkill.set(f.skill, []);
    bySkill.get(f.skill).push({ fit: f.fit, d });
  }
  console.log(`\n${'─'.repeat(72)}\n${kind}: ${bySkill.size} skills`);
  for (const [skill, rows] of [...bySkill].sort((a, b) => a[0].localeCompare(b[0]))) {
    const stats = new Set(rows.flatMap((r) => r.d.map((x) => x.stat)));
    console.log(`  ${skill.padEnd(34)} ${[...stats].join(', ')}   [${rows.map((r) => r.fit).join(' ')}]`);
    if (verbose) for (const r of rows) for (const x of r.d) {
      console.log(`      ${r.fit.padEnd(20)} ${x.stat.padEnd(16)} ours ${pct(x.ours)}  eos ${pct(x.eos)}`);
    }
  }
}
console.log();
