#!/usr/bin/env node
/**
 * bundle-icons.mjs — copy the icons/renders the app actually uses into src/assets/, so the shipped
 * app works OFFLINE.
 *
 *     node scripts/bundle-icons.mjs                 # auto-detect pyfa-master/
 *     node scripts/bundle-icons.mjs --pyfa <path>   # explicit path to a pyfa checkout
 *     node scripts/bundle-icons.mjs --dry-run
 *
 * Run this ONCE, commit src/assets/, and it never needs running again unless CCP adds new art.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * The icon globs used to point at `pyfa-master/`, which is gitignored. On any machine without a
 * pyfa checkout — including CI, and including a release build — the glob matched NOTHING and every
 * image silently fell back to CCP's image server over the network. Fine in dev; fatal for a shipped
 * offline app. Committing the assets makes the build self-contained.
 *
 * TWO THINGS THIS FIXES ALONG THE WAY
 *
 * 1. Renders are keyed by graphicID, NOT typeID. The old code did `_renderByType[typeID]`, which
 *    never matched a single hull (0/423), so ship renders ALWAYS came from the network even when a
 *    pyfa checkout was present. We emit renders named by typeID so the lookup finally works.
 *
 * 2. pyfa ships each image at @1x and @2x. The lookup regex only ever matched @2x, so the @1x half
 *    of the folder was dead weight. We copy @2x only.
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ICONS = join(ROOT, 'src', 'assets', 'icons');
const OUT_RENDERS = join(ROOT, 'src', 'assets', 'renders');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const pyfaArg = args.includes('--pyfa') ? args[args.indexOf('--pyfa') + 1] : null;

// pyfa's source checkout puts art at imgs/; the Windows release puts it at app/imgs/.
function findPyfa() {
  const bases = pyfaArg ? [pyfaArg]
    : [join(ROOT, 'pyfa-master'), join(ROOT, 'Pyfa-master'), join(ROOT, '..', 'pyfa-master')];
  for (const b of bases) {
    for (const sub of ['imgs', join('app', 'imgs')]) {
      const p = join(b, sub);
      if (existsSync(join(p, 'icons')) && existsSync(join(p, 'renders'))) return p;
    }
  }
  console.error('Could not find a pyfa checkout with imgs/icons and imgs/renders.');
  console.error('Download the pyfa SOURCE zip from https://github.com/pyfa-org/Pyfa, extract it,');
  console.error('and either put it at ./pyfa-master/ or pass --pyfa <path>.');
  process.exit(1);
}

const IMGS = findPyfa();
console.log(`pyfa art: ${IMGS}`);

const typeIcons = JSON.parse(readFileSync(join(ROOT, 'src/data/type-icons.json'), 'utf8'));
const ships = JSON.parse(readFileSync(join(ROOT, 'src/data/ships.json'), 'utf8'));

// typeID -> graphicID. Renders are named by graphicID in pyfa, but the app looks them up by
// typeID, so we need the mapping to rename on copy. It is precomputed into src/data/graphic-ids.json
// (423 hulls, ~5 KB) rather than read from eve.db at runtime — that kept this script free of any
// Python/sqlite dependency, which matters because `python3` is not a command on Windows.
const gid = JSON.parse(readFileSync(join(ROOT, 'src/data/graphic-ids.json'), 'utf8'));

// ── icons: keyed by iconID, copied as <iconID>.png ──────────────────────────
const srcIcons = new Set(readdirSync(join(IMGS, 'icons')).filter((f) => f.endsWith('@2x.png')));
const wantIcons = new Set(Object.values(typeIcons).map(String));

// ── renders: pyfa names them by graphicID; we emit them by typeID so the app can look them up ──
const srcRenders = new Set(readdirSync(join(IMGS, 'renders')).filter((f) => f.endsWith('@2x.png')));
const renderPlan = [];   // [srcFile, destName]
for (const s of Object.values(ships)) {
  const g = gid[String(s.typeID)];
  if (g && srcRenders.has(`${g}@2x.png`)) renderPlan.push([`${g}@2x.png`, `${s.typeID}.png`]);
}

const iconPlan = [...wantIcons]
  .filter((id) => srcIcons.has(`${id}@2x.png`))
  .map((id) => [`${id}@2x.png`, `${id}.png`]);

const size = (dir, files) => files.reduce((n, [f]) => n + statSync(join(IMGS, dir, f)).size, 0);
const iMB = (size('icons', iconPlan) / 1048576).toFixed(1);
const rMB = (size('renders', renderPlan) / 1048576).toFixed(1);

console.log(`icons  : ${iconPlan.length} / ${wantIcons.size} referenced iconIDs available  (${iMB} MB)`);
console.log(`renders: ${renderPlan.length} / ${Object.keys(ships).length} hulls  (${rMB} MB)`);
console.log(`total  : ${(+iMB + +rMB).toFixed(1)} MB`);

const missIcons = wantIcons.size - iconPlan.length;
if (missIcons) console.log(`\n${missIcons} referenced iconIDs are not in pyfa's set — those types fall back to the image server (online only).`);

// Name the hulls with no local render — offline they show nothing, so it's worth knowing which.
// A pyfa SOURCE checkout carries less art than the RELEASE build; if this list matters, point
// --pyfa at the imgs/ folder inside pyfa's Windows release zip instead.
const covered = new Set(renderPlan.map(([, d]) => d.replace('.png', '')));
const noRender = Object.values(ships)
  .filter((s) => !covered.has(String(s.typeID)))
  .map((s) => s.name)
  .sort();
if (noRender.length) {
  console.log(`\n${noRender.length} hull(s) have NO local render (blank offline):`);
  console.log('  ' + noRender.join(', '));
  console.log("  If these matter, use the imgs/ folder from pyfa's Windows RELEASE zip:");
  console.log('    node scripts/bundle-icons.mjs --pyfa <path-to-release>/app');
}

if (dryRun) { console.log('\n--dry-run: nothing written.'); process.exit(0); }

for (const d of [OUT_ICONS, OUT_RENDERS]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }
for (const [src, dst] of iconPlan) copyFileSync(join(IMGS, 'icons', src), join(OUT_ICONS, dst));
for (const [src, dst] of renderPlan) copyFileSync(join(IMGS, 'renders', src), join(OUT_RENDERS, dst));

console.log(`\nwrote src/assets/icons/ (${iconPlan.length} files) and src/assets/renders/ (${renderPlan.length} files)`);
console.log('Commit src/assets/ — the shipped app needs it to work offline.');
console.log('Then: npm run verify');
