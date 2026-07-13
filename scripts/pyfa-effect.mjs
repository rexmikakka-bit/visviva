#!/usr/bin/env node
/**
 * pyfa-effect.mjs — look up how pyfa implements an effect, and find effects we may be missing.
 *
 *     node scripts/pyfa-effect.mjs 12887          # print pyfa's implementation of one effect
 *     node scripts/pyfa-effect.mjs --gaps         # effects EMPTY in our bundle that pyfa implements
 *     node scripts/pyfa-effect.mjs --check        # verify our data-patches against pyfa
 *
 * Needs a pyfa source checkout (the SAME one bundle-icons.mjs uses):
 *     git clone --depth 1 https://github.com/pyfa-org/Pyfa.git pyfa-master
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * CCP ships many effects with an EMPTY modifier list — they're applied client-side, so the dogma
 * data alone can't tell you what they do. Every one of them is a silent no-op in our engine until
 * someone notices a fit is wrong and reverse-engineers it. That is how we found the Angel Cartel
 * reload bonus, the command-carrier burst bonuses, and the hardpoint-booster missile damage: one
 * wrong number at a time, each costing a session.
 *
 * pyfa hand-implements those effects in eos/effects.py, keyed by ID (`class Effect12887`). It is the
 * authoritative reference — and it is right there. Reading it beats guessing.
 *
 * This is a DEV tool, not part of the build. It never modifies anything.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findPyfaEffects() {
  for (const b of ['pyfa-master', 'Pyfa-master', join('..', 'pyfa-master')]) {
    const p = join(ROOT, b, 'eos', 'effects.py');
    if (existsSync(p)) return p;
  }
  console.error('Could not find pyfa\'s eos/effects.py.');
  console.error('Clone the pyfa SOURCE (not the release build) into ./pyfa-master:');
  console.error('  git clone --depth 1 https://github.com/pyfa-org/Pyfa.git pyfa-master');
  process.exit(1);
}

const SRC = readFileSync(findPyfaEffects(), 'utf8');

// pyfa declares each effect as `class Effect<ID>(BaseEffect):`
function effectBody(id) {
  const re = new RegExp(`class Effect${id}\\(BaseEffect\\):([\\s\\S]*?)(?=\\nclass |$)`);
  const m = SRC.match(re);
  return m ? m[1] : null;
}
const implemented = (body) => !!body && /def handler/.test(body) && /(ItemBoost|Boost\(|multiply|increase|forceItemAttr|boostItemAttr|ChargeBoost)/.test(body);

const args = process.argv.slice(2);

// ── single effect lookup ────────────────────────────────────────────────────
if (args[0] && /^\d+$/.test(args[0])) {
  const body = effectBody(args[0]);
  if (!body) { console.log(`pyfa does not implement effect ${args[0]}.`); process.exit(0); }
  console.log(`class Effect${args[0]}(BaseEffect):${body.replace(/\r/g, '')}`);
  const ours = JSON.parse(readFileSync(join(ROOT, 'src/data/dogma-effects.json'), 'utf8'))[args[0]];
  console.log('--- our bundle ---');
  console.log(ours ? JSON.stringify(ours) : '(effect not in our bundle)');
  process.exit(0);
}

const E = JSON.parse(readFileSync(join(ROOT, 'src/data/dogma-effects.json'), 'utf8'));
const T = JSON.parse(readFileSync(join(ROOT, 'src/data/dogma-types.json'), 'utf8'));

// ── verify our hand patches against pyfa ────────────────────────────────────
if (args.includes('--check')) {
  const patches = JSON.parse(readFileSync(join(ROOT, 'scripts/data-patches.json'), 'utf8'));
  console.log('our data-patches vs pyfa:\n');
  for (const eid of Object.keys(patches.effects ?? {})) {
    const body = effectBody(eid);
    const name = body?.match(/"""\s*(\w+)/)?.[1] ?? '?';
    console.log(`  effect ${eid}  ${name}`);
    console.log(`    pyfa implements it: ${implemented(body) ? 'YES — compare the handler with `node scripts/pyfa-effect.mjs ' + eid + '`' : 'no'}`);
  }
  process.exit(0);
}

// ── gap report ──────────────────────────────────────────────────────────────
const usedBy = new Map();
for (const t of Object.values(T)) {
  for (const e of (t.e ?? [])) {
    const k = String(e);
    if (!usedBy.has(k)) usedBy.set(k, []);
    if (usedBy.get(k).length < 3) usedBy.get(k).push(t.n);
    usedBy.get(k).count = (usedBy.get(k).count ?? 0) + 1;
  }
}
const rows = [];
for (const [eid, names] of usedBy) {
  const e = E[eid];
  if (!e || (e.m ?? []).length) continue;          // not empty in our bundle
  const body = effectBody(eid);
  if (!implemented(body)) continue;                // pyfa doesn't implement it either
  rows.push({ eid, n: names.count ?? 0, name: body.match(/"""\s*(\w+)/)?.[1] ?? '?', ex: names.slice(0, 2) });
}
rows.sort((a, b) => b.n - a.n);

console.log(`${rows.length} effects are EMPTY in our bundle but implemented by pyfa.\n`);
console.log('NOTE: many are activation markers (useMissiles, armorRepair, shieldBoosting...) that we');
console.log('handle in calc.js by group/attribute instead of by effect ID — those are NOT bugs.');
console.log('Check each against how we already handle that module class before "fixing" it.\n');
for (const r of rows.slice(0, 40)) {
  console.log(`  ${r.eid.padStart(6)}  ${String(r.n).padStart(4)} types  ${r.name.slice(0, 46).padEnd(46)} e.g. ${r.ex.join(', ').slice(0, 34)}`);
}
console.log(`\nInspect one with:  node scripts/pyfa-effect.mjs <id>`);
