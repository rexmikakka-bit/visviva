#!/usr/bin/env node
/**
 * check-effect-coverage.mjs — CI gate that turns SILENT effect no-ops into a loud failure.
 *
 *     node scripts/check-effect-coverage.mjs            # verify against the committed baseline (CI)
 *     node scripts/check-effect-coverage.mjs --update   # regenerate the baseline (after triage)
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * CCP ships many effects with an EMPTY modifier list — they're resolved client-side, so the dogma
 * data alone can't say what they do. In our engine every one of them is a silent no-op: a fit that
 * uses such a module comes out with WRONG numbers and NO error. That is how whole sessions were lost
 * to the Angel reload bonus, the carrier command-burst bonuses, and the lance doomsday ticks — one
 * wrong number at a time.
 *
 * `pyfa-effect.mjs --gaps` finds these, but it needs a pyfa source checkout and is a manual dev tool.
 * This script is the automatable half: it snapshots the set of empty-modifier effects that appear on
 * fittable types into a committed baseline. On the next `build-bundle.py` (i.e. a new EVE patch), if
 * that set GAINS an effect, CI fails and points you at it — triage it against pyfa, then either add a
 * handler / data-patch or accept it and `--update` the baseline. Effects LEAVING the set (we
 * implemented one, or CCP removed it) never fail; they just prompt an update.
 *
 * Self-contained: reads only the committed bundle. No pyfa, no eos, no eve.db — runs anywhere.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'effect-coverage-baseline.json');

const T = JSON.parse(readFileSync(join(ROOT, 'src/data/dogma-types.json'), 'utf8'));
const E = JSON.parse(readFileSync(join(ROOT, 'src/data/dogma-effects.json'), 'utf8'));

let bundleBuild = 'unknown';
try {
  bundleBuild = JSON.parse(readFileSync(join(ROOT, 'src/data/bundle-version.json'), 'utf8')).client_build
    ?? bundleBuild;
} catch { /* optional */ }

// Every effect that appears on at least one type AND has an empty modifier list in our bundle.
function currentEmptyEffects() {
  const usage = new Map(); // eid -> { count, ex[] }
  for (const t of Object.values(T)) {
    for (const e of (t.e ?? [])) {
      const k = String(e);
      let u = usage.get(k);
      if (!u) usage.set(k, (u = { count: 0, ex: [] }));
      u.count++;
      if (u.ex.length < 3 && t.n) u.ex.push(t.n);
    }
  }
  const out = {};
  for (const [eid, u] of usage) {
    const e = E[eid];
    if (!e) continue;                       // effect not in bundle at all — different problem
    if ((e.m ?? []).length) continue;       // has modifiers — not a no-op
    out[eid] = { c: e.c ?? null, n: u.count, ex: u.ex };
  }
  return out;
}

const current = currentEmptyEffects();
const args = process.argv.slice(2);

if (args.includes('--update')) {
  const payload = {
    _comment: 'Snapshot of empty-modifier effects present on fittable types. See check-effect-coverage.mjs. ' +
              'The GATE compares only the set of effect IDs; `c`/`n`/`ex` are informational. ' +
              'Regenerate with: node scripts/check-effect-coverage.mjs --update',
    clientBuild: bundleBuild,
    generatedAt: new Date().toISOString().slice(0, 10),
    count: Object.keys(current).length,
    effects: Object.fromEntries(
      Object.keys(current).sort((a, b) => Number(a) - Number(b)).map((k) => [k, current[k]]),
    ),
  };
  writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote baseline: ${Object.keys(current).length} empty-modifier effects (build ${bundleBuild}).`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error('No baseline found. Generate it first:  node scripts/check-effect-coverage.mjs --update');
  process.exit(1);
}

const baseIds = new Set(Object.keys(baseline.effects ?? {}));
const curIds = new Set(Object.keys(current));

const added = [...curIds].filter((id) => !baseIds.has(id)).sort((a, b) => Number(a) - Number(b));
const removed = [...baseIds].filter((id) => !curIds.has(id)).sort((a, b) => Number(a) - Number(b));

const CAT = { 0: 'passive', 1: 'active', 2: 'target', 4: 'online', 5: 'overload', 6: 'overheat' };

if (removed.length) {
  console.log(`ℹ ${removed.length} baseline effect(s) no longer empty/present (implemented or removed by CCP):`);
  for (const id of removed) console.log(`    ${id}`);
  console.log('  If intentional, refresh the baseline: node scripts/check-effect-coverage.mjs --update\n');
}

if (added.length) {
  console.log(`✗ ${added.length} NEW empty-modifier effect(s) on fittable types since the baseline:\n`);
  for (const id of added) {
    const c = current[id];
    console.log(`    effect ${id.padStart(6)}  [${CAT[c.c] ?? c.c}]  ${c.n} types  e.g. ${c.ex.join(', ')}`);
  }
  console.log('\nEach is a SILENT no-op in our engine until handled. For each one:');
  console.log('  1. node scripts/pyfa-effect.mjs <id>     — does pyfa implement it? (needs pyfa clone)');
  console.log('  2. If yes and it matters: add a modifier in scripts/data-patches.json or a custom');
  console.log('     handler in src/dogma-engine.js. Many are activation markers handled in calc.js');
  console.log('     by group/attribute — those are fine.');
  console.log('  3. Once triaged, accept the new state: node scripts/check-effect-coverage.mjs --update');
  process.exit(1);
}

console.log(`✓ effect coverage: ${curIds.size} empty-modifier effects, all in baseline (build ${bundleBuild}).`);
process.exit(0);
