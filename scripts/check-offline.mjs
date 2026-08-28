#!/usr/bin/env node
/**
 * check-offline.mjs — scan the production build for anything it would fetch over the network.
 *
 *     npm run build && node scripts/check-offline.mjs
 *
 * The shipped app runs from the local filesystem in a webview (Capacitor). Anything it requests over
 * the network is a blank image / missing font / hang when the user is offline — which, for a fitting
 * tool people use on a phone in a station queue, is most of the time.
 *
 * This is a static scan of dist/, so it needs no device and no emulator. It won't catch a request
 * built dynamically from string fragments, so it's a floor, not a ceiling — but it does catch the
 * whole class of "we forgot this was remote" bugs (CDN fonts, image servers, analytics).
 *
 * Known-and-accepted remotes are listed in ALLOWED below, with the reason. Everything else fails.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, resolve, extname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// Remotes we knowingly accept, and why. Each must degrade gracefully offline.
const ALLOWED = [
  {
    host: 'images.evetech.net',
    why: 'Fallback for the ~233 types with no bundled art. Hidden by onError when offline.',
  },
  {
    host: 'login.eveonline.com',
    why: 'ESI single sign-on. Online-only by nature; the app must not depend on it to open.',
  },
  { host: 'esi.evetech.net', why: 'ESI API. Online-only by nature.' },
  {
    host: 'market.fuzzwork.co.uk',
    why: 'Fuzzwork aggregates API for fit pricing. Online-only; prices degrade gracefully to "—" offline.',
  },
  {
    host: 'www.ceve-market.org',
    why: 'Alternative price source (Settings -> Market). Same graceful degradation as Fuzzwork: a failed '
       + 'fetch leaves the price map empty and the UI shows "—". Sends no CORS headers, so it only '
       + 'resolves in the installed app, where CapacitorHttp bypasses the browser CORS rules.',
  },
  {
    host: 'community.eveonline.com',
    why: 'NOT a fetch — appears inside an item DESCRIPTION string in data-bundle.js (a CSM link in '
       + "CCP's flavour text). Never requested. This scan can't distinguish a fetched URL from one "
       + 'embedded in data, so it is allowed explicitly.',
  },
];

if (!existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.js', '.css', '.html', '.json'].includes(extname(e))) out.push(p);
  }
  return out;
}

const URL_RE = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(\/[^\s"'`)]*)?/gi;
const found = new Map();   // host -> Set(files)

for (const f of walk(DIST)) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(URL_RE)) {
    const host = m[1].toLowerCase();
    if (!found.has(host)) found.set(host, new Set());
    found.get(host).add(f.replace(ROOT + '/', ''));
  }
}

// Schema/namespace URLs aren't fetched at runtime.
const IGNORE = /^(www\.)?(w3\.org|schema\.org|json-schema\.org|npmjs\.com|github\.com|reactjs\.org|react\.dev|rolldown\.rs|vitejs\.dev)$/;

const allowedHosts = new Set(ALLOWED.map((a) => a.host));
const unexpected = [];

console.log('external hosts referenced by the production build:\n');
for (const [host, files] of [...found].sort()) {
  if (IGNORE.test(host)) continue;
  const known = ALLOWED.find((a) => a.host === host);
  if (known) {
    console.log(`  OK   ${host}`);
    console.log(`       ${known.why}`);
  } else {
    console.log(`  ??   ${host}   (in ${[...files][0]})`);
    unexpected.push(host);
  }
}
if (![...found.keys()].some((h) => !IGNORE.test(h))) console.log('  (none)');

// The art must be bundled, not fetched. If the icon files aren't in dist, something is very wrong.
const pngs = walk(DIST).length ? readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.png')).length : 0;
console.log(`\nbundled images in dist/: ${pngs}`);
if (pngs < 100) {
  console.log('\nFEWER THAN 100 BUNDLED IMAGES — the art is NOT in the build.');
  console.log('Run `node scripts/fetch-art.mjs` and commit src/assets/.');
  process.exit(1);
}

// A dynamic import that still points OUTSIDE dist/assets was never rewritten by the bundler —
// it will 404 at runtime. This is not hypothetical: `import(/* @vite-ignore */ '../data-bundle.js')`
// shipped exactly this way, so every production build silently failed to load the ship browser,
// module variations, ship traits and implant data. Dev was fine, which is why it went unnoticed.
const escaping = [];
for (const f of walk(DIST).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\(\s*[`'"](\.\.\/[^`'"]+)[`'"]\s*\)/g)) {
    escaping.push(`${f.replace(ROOT + '/', '')}  ->  import("${m[1]}")`);
  }
}
if (escaping.length) {
  console.log(`\n${escaping.length} dynamic import(s) point OUTSIDE dist/assets and will 404 at runtime:\n`);
  for (const e of escaping) console.log('  ' + e);
  console.log('\nThe bundler did not rewrite these — almost always a stray /* @vite-ignore */.');
  console.log('Remove it so Vite resolves and code-splits the module properly.');
  process.exit(1);
}

if (unexpected.length) {
  console.log(`\n${unexpected.length} UNEXPECTED remote host(s): ${unexpected.join(', ')}`);
  console.log('Either bundle the resource locally, or add it to ALLOWED in this script with a reason');
  console.log('and make sure it degrades gracefully offline.');
  process.exit(1);
}

console.log('\nno unexpected network dependencies');
