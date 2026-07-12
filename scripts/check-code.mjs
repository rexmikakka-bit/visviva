#!/usr/bin/env node
/**
 * check-code.mjs — CI lint gate.
 *
 *     node scripts/check-code.mjs
 *
 * WHY NOT JUST `eslint src`?
 * -------------------------
 * The codebase currently has ~150 pre-existing style findings (unused vars, react-hooks patterns,
 * duplicate-but-identical object keys). Gating CI on all of them would block every PR on legacy
 * issues nobody introduced, and the usual result is that people start passing --no-verify, which
 * makes the gate worthless.
 *
 * So this fails ONLY on rules that mean "this will actually break at runtime" — chiefly no-undef,
 * which is not theoretical here: `onExportFit` and `MT_ITEMS` were both referenced but never
 * defined, sitting in App.jsx as live ReferenceErrors (clicking Export Fit in the hamburger menu
 * crashed the app). Nothing caught them because lint was never run in CI.
 *
 * Everything else is printed as a warning count so it stays visible without being a blocker.
 * Tightening this list over time (as the legacy findings get cleaned up) is a good thing.
 */

import { ESLint } from 'eslint';

// Rules that indicate a genuine runtime fault, not a style preference.
const FATAL = new Set([
  'no-undef',              // ReferenceError at runtime
  'no-const-assign',       // TypeError
  'no-func-assign',
  'no-import-assign',
  'no-obj-calls',
  'no-dupe-args',
  'no-dupe-class-members',
  'no-unsafe-negation',
  'no-unreachable',
  'use-isnan',
  'valid-typeof',
  'no-cond-assign',
  'no-self-assign',
  'no-sparse-arrays',
]);

const eslint = new ESLint();
const results = await eslint.lintFiles(['src']);

const fatal = [];
const others = new Map();

for (const r of results) {
  for (const m of r.messages) {
    if (!m.ruleId) continue;
    if (FATAL.has(m.ruleId)) {
      fatal.push(`${r.filePath.replace(process.cwd() + '/', '')}:${m.line}  ${m.message}  (${m.ruleId})`);
    } else {
      others.set(m.ruleId, (others.get(m.ruleId) ?? 0) + 1);
    }
  }
}

if (others.size) {
  console.log('non-blocking findings (pre-existing style/lint debt):');
  for (const [rule, n] of [...others].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${rule}`);
  }
  console.log('');
}

if (fatal.length) {
  console.log(`${fatal.length} RUNTIME-FATAL problem(s):\n`);
  for (const f of fatal) console.log('  ' + f);
  console.log('\nThese crash at runtime. Fix them — do not add them to the ignore list.');
  process.exit(1);
}

console.log('no runtime-fatal lint problems');
