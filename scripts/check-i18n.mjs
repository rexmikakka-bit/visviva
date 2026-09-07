#!/usr/bin/env node
/**
 * check-i18n.mjs — keeps the translation catalogs anchored to the strings the app actually renders.
 *
 *     node scripts/check-i18n.mjs            # fail on orphaned keys (CI)
 *     node scripts/check-i18n.mjs --report    # also print per-locale coverage and what is missing
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * In src/lib/i18n.js the KEY IS THE ENGLISH STRING. That buys a lot (no invented key names, no
 * English catalog that can go missing, a missing translation degrades to English) at the cost of one
 * specific failure: EDITING AN ENGLISH STRING SILENTLY ORPHANS ITS TRANSLATIONS. Fix a typo in
 * "Auto-fill hardpoints" and every catalog still holds the old spelling as a key that nothing will
 * ever look up again — seven languages quietly revert that line to English, with no error anywhere.
 *
 * So this walks the source for literal t() keys and compares the catalogs against them. An orphan is
 * a hard failure, because it is always a bug: either the English moved and the translation needs to
 * move with it, or the string is gone and the entry is dead weight.
 *
 * Only LITERAL keys are collected. A computed key — t(someVariable) — is invisible here and will
 * make anything translating it look like an orphan, which is a good enough reason to keep keys
 * literal at the call site.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const CATALOG_DIR = join(SRC, 'i18n');
const REPORT = process.argv.includes('--report');

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'i18n' && name !== 'data') sources(p, out); }
    // The suite's own t() calls are fixtures, not app text — counting them would inflate coverage
    // and invite a catalog entry for a string no user can ever see.
    else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(p);
  }
  return out;
}

// t("...") and t('...'), plus the `other:` form of a plural t({one:"…",other:"…"}) — `other` is the
// catalog key for a plural entry, so one pattern covers the lookup either way.
const CALL = /\bt\(\s*(?:(['"])((?:\\.|(?!\1)[^\\])*)\1|\{[^}]*?other\s*:\s*(['"])((?:\\.|(?!\3)[^\\])*)\3)/g;
const unescape = s => s.replace(/\\(['"\\nt])/g, (m, c) => ({ n: '\n', t: '\t' }[c] ?? c));

const keys = new Map();   // key -> the files that ask for it
for (const file of sources(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(CALL)) {
    const key = unescape(m[2] ?? m[4]);
    if (!keys.has(key)) keys.set(key, []);
    keys.get(key).push(relative(ROOT, file));
  }
}

let catalogs = [];
try { catalogs = readdirSync(CATALOG_DIR).filter(f => /\.js$/.test(f)); } catch { /* none shipped yet */ }

let failed = 0;
for (const file of catalogs) {
  const code = file.replace(/\.js$/, '');
  const mod = await import(new URL(`../src/i18n/${file}`, import.meta.url).href);
  const cat = mod.default ?? {};
  const orphans = Object.keys(cat).filter(k => !keys.has(k));
  const missing = [...keys.keys()].filter(k => !(k in cat));
  const done = keys.size - missing.length;
  const pct = keys.size ? Math.round((done / keys.size) * 100) : 100;
  console.log(`${code}: ${done}/${keys.size} strings (${pct}%)${orphans.length ? `, ${orphans.length} ORPHANED` : ''}`);
  if (orphans.length) {
    failed += orphans.length;
    for (const k of orphans.slice(0, 20)) console.log(`   orphan: ${JSON.stringify(k)}`);
    if (orphans.length > 20) console.log(`   …and ${orphans.length - 20} more`);
  }
  if (REPORT && missing.length) for (const k of missing.slice(0, 40)) console.log(`   missing: ${JSON.stringify(k)}`);
}

if (!catalogs.length) console.log(`i18n: ${keys.size} translatable strings, no catalogs yet`);

if (failed) {
  console.error(`\ncheck-i18n FAILED: ${failed} catalog key(s) match no t() call in src/.`);
  console.error('The English text was probably edited without moving its translations. Fix the key, do not delete the translation.');
  process.exit(1);
}
