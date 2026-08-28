#!/usr/bin/env node
/**
 * bundle-icons.mjs — copy the icons/renders the app actually uses into src/assets/, so the shipped
 * app works OFFLINE.
 *
 *     node scripts/bundle-icons.mjs                 # auto-detect pyfa-master/
 *     node scripts/bundle-icons.mjs --pyfa <path>   # explicit path to a pyfa checkout
 *     node scripts/bundle-icons.mjs --dry-run
 *
 * ⚠ SUPERSEDED FOR RESOLUTION — use scripts/fetch-art.mjs instead, unless you specifically need this
 * one's offline/graphicID behaviour. pyfa's art is its ceiling (32px icons, 64px renders) and running
 * this over the current assets DOWNGRADES them: the bundle is now 64px icons and 128px renders,
 * fetched from CCP's image server because there is nothing bigger in pyfa to copy. Testers reported
 * the pyfa-sized art as blurry, which is what prompted the change.
 *
 * Still worth keeping for two reasons: it needs no network, and it is the only thing that knows how
 * to map pyfa's graphicID-named render files onto typeIDs (see below) — fetch-art.mjs sidesteps that
 * entirely because the image server is keyed by typeID already.
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
// (423 hulls + 18 structures, ~5 KB) rather than read from eve.db at runtime — that kept this script
// free of any Python/sqlite dependency, which matters because `python3` is not a command on Windows.
//
// It is the RENDER WORKLIST, not a ship list — everything in it gets one, which is why structures
// are in there too. CCP gives neither hulls nor structures an iconID (417 of 423 hulls and 17 of 18
// structures have none at all), so the render is the ONLY art the app can show for them offline;
// eveIcon() falls back to it. Planning renders off ships.json instead left every structure blank.
const gid = JSON.parse(readFileSync(join(ROOT, 'src/data/graphic-ids.json'), 'utf8'));

// ── icons: keyed by iconID, copied as <iconID>.png ──────────────────────────
const srcIcons = new Set(readdirSync(join(IMGS, 'icons')).filter((f) => f.endsWith('@2x.png')));
const wantIcons = new Set(Object.values(typeIcons).map(String));

// ── renders: pyfa names them by graphicID; we emit them by typeID so the app can look them up ──
const srcRenders = new Set(readdirSync(join(IMGS, 'renders')).filter((f) => f.endsWith('@2x.png')));
const renderPlan = [];   // [srcFile, destName]
for (const [typeID, g] of Object.entries(gid)) {
  if (g && srcRenders.has(`${g}@2x.png`)) renderPlan.push([`${g}@2x.png`, `${typeID}.png`]);
}

const iconPlan = [...wantIcons]
  .filter((id) => srcIcons.has(`${id}@2x.png`))
  .map((id) => [`${id}@2x.png`, `${id}.png`]);

const size = (dir, files) => files.reduce((n, [f]) => n + statSync(join(IMGS, dir, f)).size, 0);
const iMB = (size('icons', iconPlan) / 1048576).toFixed(1);
const rMB = (size('renders', renderPlan) / 1048576).toFixed(1);

console.log(`icons  : ${iconPlan.length} / ${wantIcons.size} referenced iconIDs available  (${iMB} MB)`);
console.log(`renders: ${renderPlan.length} / ${Object.keys(gid).length} hulls + structures  (${rMB} MB)`);
console.log(`total  : ${(+iMB + +rMB).toFixed(1)} MB`);

const missIcons = wantIcons.size - iconPlan.length;
if (missIcons) console.log(`\n${missIcons} referenced iconIDs are not in pyfa's set — those types fall back to the image server (online only).`);

// Name the hulls with no local render — offline they show nothing, so it's worth knowing which.
// A pyfa SOURCE checkout carries less art than the RELEASE build; if this list matters, point
// --pyfa at the imgs/ folder inside pyfa's Windows release zip instead.
const shipNames = new Map(Object.values(JSON.parse(readFileSync(join(ROOT, 'src/data/ships.json'), 'utf8')))
  .map((s) => [String(s.typeID), s.name]));
const covered = new Set(renderPlan.map(([, d]) => d.replace('.png', '')));
const noRender = Object.keys(gid)
  .filter((id) => !covered.has(id))
  .map((id) => shipNames.get(id) ?? `type ${id}`)
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
console.log('NOTE: src/assets/type-icons/ (drone/fighter/deployable icons) is NOT managed by this');
console.log('script — those were downloaded once from images.evetech.net and committed directly.');
console.log('Commit src/assets/ — the shipped app needs it to work offline.');
console.log('Then: npm run verify');
