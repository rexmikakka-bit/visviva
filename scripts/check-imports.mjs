#!/usr/bin/env node
/**
 * check-imports.mjs — verify every relative import, dynamic import and Vite glob resolves on disk.
 *
 *     node scripts/check-imports.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * `vite build` does NOT catch every broken path, and neither does ESLint. Two real bugs shipped
 * during the App.jsx split because of exactly this gap:
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
