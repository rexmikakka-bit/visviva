#!/usr/bin/env node
/**
 * check-imports.mjs — verify every relative import resolves, both as a PATH on disk and as a
 * SYMBOL in the module it points at.
 *
 *     node scripts/check-imports.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * `vite build` does NOT catch every broken path, and neither does ESLint. Three real bugs shipped
 * because of exactly this gap. Two during the App.jsx split:
 *
 *   1. `import(/* @vite-ignore *\/ './data-bundle.js')` — the @vite-ignore comment tells Vite not to
 *      resolve the path at build time, so `vite build` passed happily while the DEV SERVER threw
 *      "Failed to resolve import". A production build is not sufficient proof.
 *
 *   2. `import.meta.glob("../pyfa-master/imgs/icons/*.png")` — after a file moved one folder deeper,
 *      the glob silently matched NOTHING. No error anywhere: eveIcon() just fell back to CCP's image
 *      server, so the app "worked" while quietly hitting the network for every icon.
 *
 * Both are import-path bugs that only a filesystem check catches. This runs in CI.
 *
 * The third shipped as 1.8.0 and bricked the app on launch, which is why pass 2 exists:
 *
 *   3. `import * as esi from './lib/esi.js'` + `esi.getAllCharacterSkills()` — the function was
 *      added in a working tree but its file never got staged, so the commit shipped every CALLER
 *      and none of the callee. A namespace member that does not exist is plain `undefined`, not a
 *      build error, so `vite build` and the 738-check suite both stayed green; the app threw
 *      "(void 0) is not a function" from a useState initializer and died before first paint.
 *      A named import (`import { x }`) is no safer — Vite warns but does not fail the build.
 *
 * Pass 2 therefore resolves every imported SYMBOL against the exports its module actually declares.
 * It is regex-based, not a real parser: this codebase is plain ESM with conventional export forms,
 * and a checker that needs a build step to guard the build is not worth having.
 *
 * Note: globs that legitimately match nothing in a fresh clone (the pyfa icon checkout is
 * gitignored) are reported as SKIPPED, not failures — CI has no pyfa-master/.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// Paths that are intentionally absent from a fresh clone (gitignored local tooling).
const OPTIONAL = [/pyfa-master/i];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

// Any quoted relative path: static imports, multi-line dynamic imports, globs, new URL(...).
const SPEC = /["'](\.{1,2}\/[^"'\n]+)["']/g;

const files = walk(SRC);
let broken = 0, skipped = 0, checked = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(SPEC)) {
    const spec = m[1];
    const base = dirname(file);
    const rel = relative(ROOT, file);

    if (OPTIONAL.some((re) => re.test(spec))) {
      // The pyfa checkout is gitignored, so we can't check existence in CI. But we CAN check that
      // the path resolves to the REPO ROOT rather than somewhere inside src/ — which is exactly the
      // bug that shipped: a file moved into src/lib/ kept "../pyfa-master/..." and silently began
      // resolving to src/pyfa-master, matching nothing. Existence is optional; depth is not.
      const target = resolve(base, spec.includes('*') ? spec.slice(0, spec.indexOf('*')) : spec);
      const fromRoot = relative(ROOT, target);
      if (fromRoot.startsWith('src' + sep) || fromRoot.startsWith('..')) {
        console.log(`  BAD DEPTH  ${rel}\n             ${spec}\n             -> resolves to ${fromRoot}, expected repo root (silently matches nothing)`);
        broken++;
      } else {
        skipped++;
      }
      continue;
    }
    checked++;

    if (spec.includes('*')) {
      // Vite glob — verify the directory it points at exists. A glob whose folder is missing
      // silently matches nothing, which is the failure mode we are guarding against.
      const globDir = resolve(base, spec.slice(0, spec.indexOf('*')));
      if (!existsSync(globDir)) {
        console.log(`  BROKEN GLOB  ${rel}\n               ${spec}\n               -> ${relative(ROOT, globDir)} does not exist`);
        broken++;
      }
      continue;
    }

    const target = resolve(base, spec);
    const found = existsSync(target) ||
                  ['.js', '.jsx', '.mjs', '.json'].some((ext) => existsSync(target + ext));
    if (!found) {
      console.log(`  BROKEN IMPORT  ${rel}\n                 ${spec}\n                 -> ${relative(ROOT, target)} not found`);
      broken++;
    }
  }
}

console.log(`\nchecked ${checked} relative specifiers across ${files.length} files` +
            (skipped ? ` (${skipped} optional/gitignored skipped)` : ''));

if (broken) {
  console.log(`\n${broken} BROKEN import path(s).`);
  console.log('Remember: `vite build` does NOT catch @vite-ignore dynamic imports or empty globs.');
  process.exit(1);
}
console.log('all relative imports resolve');

// ─── Pass 2: do the imported SYMBOLS exist? ─────────────────────────────────────

function resolveModule(fromFile, spec) {
  const target = resolve(dirname(fromFile), spec);
  if (existsSync(target) && statSync(target).isFile()) return target;
  for (const ext of ['.js', '.jsx', '.mjs']) if (existsSync(target + ext)) return target + ext;
  return null;
}

const exportCache = new Map();

/** Every name a module exports, following `export * from` into the module it re-exports. */
function exportsOf(file, seen = new Set()) {
  if (exportCache.has(file)) return exportCache.get(file);
  if (seen.has(file)) return new Set();   // circular re-export; the outer frame collects the rest
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  if (/^export\s+default\b/m.test(src)) out.add('default');
  // `export { a, b as c }` exports `c` — the name AFTER `as`, the mirror of an import clause.
  for (const m of src.matchAll(/^export\s*\{([\s\S]*?)\}/gm))
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) out.add(name);
    }
  for (const m of src.matchAll(/^export\s*\*\s*from\s*["']([^"'\n]+)["']/gm)) {
    const t = resolveModule(file, m[1]);
    if (t) for (const n of exportsOf(t, seen)) out.add(n);
  }
  exportCache.set(file, out);
  return out;
}

/** The names an import clause pulls in. `{ a as b }` imports `a` — the name BEFORE `as`. */
function parseClause(clause) {
  const named = [];
  let ns = null, rest = clause;
  const braces = rest.match(/\{([\s\S]*?)\}/);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/)[0].trim();
      if (n) named.push(n);
    }
    rest = rest.replace(braces[0], '');
  }
  const nsm = rest.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (nsm) ns = nsm[1];
  return { named, ns };
}

// Comments name modules in prose ("re-reading from esi.js's storage"), which reads as a namespace
// member access. Strings are deliberately NOT stripped: this file's own targets contain regex
// literals holding quote characters, so a string lexer would desync and blank out real code.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');   // the [^:] keeps https:// in a string intact

let missing = 0, symbols = 0;

for (const file of files) {
  const src = stripComments(readFileSync(file, 'utf8'));
  const rel = relative(ROOT, file);
  for (const m of src.matchAll(/^import\s+([\s\S]*?)\s+from\s*["']([^"'\n]+)["']/gm)) {
    const spec = m[2];
    // Only relative JS: a bare specifier is node_modules' problem, and JSON/CSS have no named exports.
    if (!spec.startsWith('.') || !/\.(js|jsx|mjs)$/.test(spec)) continue;
    const target = resolveModule(file, spec);
    if (!target) continue;               // pass 1 already reported the path
    const ex = exportsOf(target);
    const { named, ns } = parseClause(m[1]);
    const want = new Set(named);
    if (ns) {
      // A namespace import is only as good as the members actually reached through it, so collect
      // `alias.member` (and `alias?.member`) across the whole file rather than trusting the import.
      // The lookbehind keeps the alias from matching inside its own specifier: `./lib/esi.js` reads
      // as `esi` `.` `js` and would otherwise report a missing export named "js" on every such file.
      for (const u of src.matchAll(new RegExp(`(?<![\\w$./'"\`-])${ns}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g'))) want.add(u[1]);
    }
    for (const n of want) {
      symbols++;
      if (!ex.has(n)) {
        console.log(`  MISSING EXPORT  ${rel}\n                  ${n}  <- ${spec}\n                  -> ${relative(ROOT, target)} does not export it`);
        missing++;
      }
    }
  }
}

console.log(`checked ${symbols} imported symbols`);

if (missing) {
  console.log(`\n${missing} import(s) name something their module does not export.`);
  console.log('Remember: a missing namespace member is `undefined`, not a build error — it throws at runtime.');
  process.exit(1);
}
console.log('all imported symbols resolve');
