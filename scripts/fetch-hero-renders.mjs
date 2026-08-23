#!/usr/bin/env node
/**
 * fetch-hero-renders.mjs — download the 256px ship renders the info sheet opens with, into
 * src/assets/hero-renders/, so that sheet works OFFLINE.
 *
 *     node scripts/fetch-hero-renders.mjs             # download what is missing
 *     node scripts/fetch-hero-renders.mjs --force     # re-download everything
 *     node scripts/fetch-hero-renders.mjs --dry-run   # report the worklist and stop
 *
 * Run this ONCE, commit src/assets/hero-renders/, and it never needs running again unless CCP adds
 * new hulls.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT bundle-icons.mjs
 *
 * That script copies from a pyfa checkout, and pyfa's renders are 64px. 64px is the right size for
 * everything that uses a render as a LABEL — the fit list, the tab strip, the browser rows — and it
 * is what src/assets/renders/ is for. The ship info sheet shows the render at the full width of the
 * sheet, where 64px upscales into visible pixels. There is no higher-resolution copy in pyfa to copy
 * from, so these come from CCP's image server instead, exactly as src/assets/type-icons/ did.
 *
 * WHY 256 AND NOT 512
 *
 * The art is ~13 KB per hull at 256 and ~39 KB at 512. Across ~440 hulls that is 5.6 MB against 17 MB,
 * and the app's whole download is about 16 MB — 512 would roughly double it for a picture most
 * sessions never open. The sheet fetches 512 over the top when there is a network (eveRenderHi), so
 * the bundled copy only has to be good enough to hold the frame until then, and to be the whole
 * answer on a plane.
 *
 * The worklist is graphic-ids.json — the same one bundle-icons.mjs plans renders off, so hulls and
 * structures stay in step across the two scripts rather than being listed twice.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'assets', 'hero-renders');
const SIZE = 256;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

const gid = JSON.parse(readFileSync(join(ROOT, 'src/data/graphic-ids.json'), 'utf8'));
const shipNames = new Map(Object.values(JSON.parse(readFileSync(join(ROOT, 'src/data/ships.json'), 'utf8')))
  .map((s) => [String(s.typeID), s.name]));

mkdirSync(OUT, { recursive: true });
const have = new Set(readdirSync(OUT).filter((f) => f.endsWith('.png')).map((f) => f.replace('.png', '')));
const want = Object.keys(gid);
const todo = force ? want : want.filter((id) => !have.has(id));

console.log(`hulls + structures: ${want.length}`);
console.log(`already present   : ${have.size}`);
console.log(`to download       : ${todo.length}  (at ${SIZE}px)`);
if (dryRun) { console.log('\n--dry-run: nothing written.'); process.exit(0); }

// Serial with a small delay rather than a flood. This is a one-off against someone else's free image
// server; there is no deadline here worth being rude over.
const failed = [];
let bytes = 0;
for (let i = 0; i < todo.length; i++) {
  const id = todo[i];
  const url = `https://images.evetech.net/types/${id}/render?size=${SIZE}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // CCP answers a type it has no render for with a placeholder rather than a 404, and a placeholder
    // bundled offline is worse than no file at all — the sheet falls back to the 64px copy on a miss,
    // which is at least the right ship. Anything this small is not a render.
    if (buf.length < 2048) throw new Error(`suspiciously small (${buf.length} B)`);
    writeFileSync(join(OUT, `${id}.png`), buf);
    bytes += buf.length;
  } catch (e) {
    failed.push([id, shipNames.get(id) ?? `type ${id}`, e.message]);
  }
  if ((i + 1) % 25 === 0 || i === todo.length - 1)
    console.log(`  ${i + 1}/${todo.length}  (${(bytes / 1048576).toFixed(1)} MB)`);
  await new Promise((r) => setTimeout(r, 40));
}

const total = readdirSync(OUT).filter((f) => f.endsWith('.png'))
  .reduce((n, f) => n + statSync(join(OUT, f)).size, 0);

console.log(`\nwrote src/assets/hero-renders/ — ${readdirSync(OUT).length} files, ${(total / 1048576).toFixed(1)} MB total`);
if (failed.length) {
  console.log(`\n${failed.length} hull(s) have NO hero render (they fall back to the 64px bundled copy):`);
  for (const [, name, why] of failed) console.log(`  ${name} — ${why}`);
}
console.log('\nCommit src/assets/hero-renders/ — the shipped app needs it to work offline.');
console.log('Then: npm run verify');
