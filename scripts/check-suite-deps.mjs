#!/usr/bin/env node
// The regression suite must run with NO npm install.
//
// CI's `test` job is deliberately dependency-free — it needs only Node built-ins and the committed
// data bundles, which is what makes it fast and what stops a broken lockfile from taking the
// baselines down with it. That constraint is invisible locally, where node_modules always exists:
// `src/lib/core.js` carried an unused `import { useState, ... } from "react"` for months, and the
// moment the suite imported that file for the charge-browser checks, CI died on
// ERR_MODULE_NOT_FOUND before running a single check while every local run stayed green.
//
// So: walk the suite's import graph and fail on any bare (node_modules) specifier. `node:` builtins
// are fine. Run from CI alongside the suite itself.
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const ENTRY = 'src/regression.test.mjs';
// Builtins are always resolvable, with or without the `node:` prefix.
const BUILTIN = new Set(builtinModules);
const seen = new Set();
const bare = new Map();   // specifier -> importing files

function walk(file) {
  const resolved = [file, `${file}.js`, `${file}.mjs`, path.join(file, 'index.js')].find(
    p => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!resolved || seen.has(resolved)) return;
  seen.add(resolved);
  const src = fs.readFileSync(resolved, 'utf8');
  // STATIC imports only. A dynamic `import('@capacitor/browser')` inside a function body is
  // resolved lazily, so it cannot break a run that never calls it — esi.js has exactly that, and
  // failing on it would be a false alarm. Static imports are the ones evaluated at load time,
  // which is what actually killed the job.
  for (const m of src.matchAll(/^\s*(?:import|export)[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    if (spec.startsWith('.')) { walk(path.resolve(path.dirname(resolved), spec)); continue; }
    const bareName = spec.replace(/^node:/, '');
    if (BUILTIN.has(bareName)) continue;
    if (!bare.has(spec)) bare.set(spec, new Set());
    bare.get(spec).add(path.relative('.', resolved).replace(/\\/g, '/'));
  }
}

walk(ENTRY);

if (bare.size === 0) {
  console.log(`regression suite imports ${seen.size} files, no node_modules packages — runs without npm install`);
  process.exit(0);
}
console.error(`\n${ENTRY} reaches ${bare.size} node_modules package(s). CI runs it WITHOUT npm install, so this fails there while passing locally:\n`);
for (const [spec, files] of bare) console.error(`  ${spec}\n    imported by ${[...files].join('\n                 ')}`);
console.error('\nFix the importing file (an unused import is the usual cause), or move the code the');
console.error('suite needs into a dependency-free module. Do NOT add npm ci to the test job — the');
console.error('point of that job is that the baselines cannot be broken by the dependency tree.\n');
process.exit(1);
