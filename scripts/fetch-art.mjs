#!/usr/bin/env node
/**
 * fetch-art.mjs — pull the bundled item/ship art from CCP's image server at a resolution that
 * survives a modern phone screen, into src/assets/.
 *
 *     node scripts/fetch-art.mjs                  # upgrade anything below its target resolution
 *     node scripts/fetch-art.mjs --dry-run        # report the worklist and stop
 *     node scripts/fetch-art.mjs --only=icons     # icons | renders | type-icons
 *     node scripts/fetch-art.mjs --force          # re-fetch even files already at target
 *     node scripts/fetch-art.mjs --fill-gaps      # also fetch referenced icons we have no file for
 *
 * Run it, commit src/assets/, and it never needs running again unless CCP adds new art.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS — bundle-icons.mjs could not do it
 *
 * That script copies from a pyfa checkout, and pyfa's art is the ceiling: its "@2x" icons are
 * 32x32 and its renders are 64x64. There is nothing bigger in there to copy. A 32px icon drawn at
 * the 28 CSS px the module rows use is already upscaled on a 2x screen and visibly soft on the 3x
 * panels most phones now ship — which is exactly what testers reported. So the art comes from CCP's
 * image server instead, the same source src/assets/type-icons/ and hero-renders/ already came from.
 *
 * RESOLUTIONS, and why each one
 *
 *   icons       64px   Module/charge/implant icons, drawn at 26-30 CSS px. 64 covers 2x exactly and
 *                      3x acceptably. 128 was measured at only ~3 MB more, but across 1,702 files it
 *                      is the single biggest line in the app's download and 64 is the honest
 *                      size/sharpness knee for a label-sized image.
 *   renders    128px   Hull art, used as a LABEL (fit list, tab strip, browser rows) and as the
 *                      icon fallback for hulls, which carry no iconID at all. This is FREE: pyfa's
 *                      64px PNGs are poorly compressed, so 128px from CCP is ~1 MB SMALLER across
 *                      440 hulls while being twice the resolution.
 *                      ⚠ CCP serves renders as JPEG, and we save those bytes under a .png NAME.
 *                      That looks like a bug and is not: src/lib/icons.js globs `renders/*.png`, and
 *                      browsers dispatch on content sniffing rather than on the extension, so the
 *                      file works. src/assets/hero-renders/ has been JPEG-under-.png since the day
 *                      it was created for exactly this reason — renaming to .jpg would fork the
 *                      glob for no gain. Nothing is lost to JPEG here: the renders pyfa shipped are
 *                      colour type 2 (RGB, NO alpha), so there was never any transparency to keep.
 *   type-icons 128px   Drones, fighters and deployables — types CCP gives no iconID, so they are
 *                      keyed by typeID. Only 283 files, so the step up costs ~0.3 MB.
 *                      ⚠ Fetched from the RENDER endpoint, not the icon endpoint. Everything in this
 *                      set is a 3D model, and for those two endpoints serve the SAME picture — except
 *                      the icon has the meta-group badge composited on and the render does not. CCP's
 *                      badging here is also wrong: Berserker I, Hornet I, Warrior I and Acolyte I are
 *                      Tech I and come back wearing the green FACTION corner. Renders are JPEG (see
 *                      the note above); these are colour type 2 with no alpha, so nothing is lost.
 *
 * The 256px hero renders stay with fetch-hero-renders.mjs: different worklist, different purpose
 * (the info sheet's full-width picture, not a label), and it already has its own size reasoning.
 *
 * ⚠ ICONS ARE KEYED BY iconID, THE IMAGE SERVER BY typeID
 *
 * 16,829 types share just 2,419 icons, so fetching per type would be 16,829 files (~97 MB) of mostly
 * identical art. We fetch ONE representative type per iconID and save it as <iconID>.png, which is
 * what src/lib/icons.js already looks up. Verified before relying on it: three iconIDs shared by
 * 540/533/413 types each return byte-identical PNGs across their members. If a representative type
 * has no art, the next type sharing that iconID is tried before giving up.
 *
 * WHICH representative is not arbitrary — the image server burns the meta-group badge into the
 * picture, so the members are NOT interchangeable. See the metaRank note by the worklist.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync,
         openSync, readSync, closeSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'src', 'assets');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const fillGaps = args.includes('--fill-gaps');
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7);

// Politely parallel. The hero-render script goes strictly serial, which is right for 440 files but
// would take well over ten minutes across the ~2,400 here. Six at a time against a CDN is not a
// flood, and the whole run is a one-off.
const CONCURRENCY = 6;

// ── image width, from the bytes ─────────────────────────────────────────────
// Reading the real width out of the file is what makes this script idempotent: anything already at
// its target size is skipped, so a re-run after CCP adds art costs only the new files, and an
// interrupted run resumes where it stopped. Both formats have to be understood because the icon
// endpoint answers PNG and the render endpoint answers JPEG (see the header).
//
// PNG: width is bytes 16-19, big-endian, straight after the IHDR length+type.
// JPEG: there is no fixed offset — walk the marker chain to the start-of-frame, which is the only
// segment carrying the dimensions. Markers are FF <code>; anything outside the SOF set is skipped
// by its own 16-bit length. Inside a SOF, the layout is length(2) precision(1) height(2) width(2).
function imageWidth(buf) {
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') return buf.readUInt32BE(16);
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      // SOF0-3, 5-7, 9-11, 13-15. The gaps are DHT (c4), JPG (c8) and DAC (cc), which are not frames.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return buf.readUInt16BE(i + 7);
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return 0;
}

function fileWidth(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    // 4 KB is far more than any header needs, and a JPEG can carry a fat EXIF/ICC block ahead of its
    // frame — reading a fixed 24 bytes would find the SOF only by luck.
    const b = Buffer.alloc(4096);
    const n = readSync(fd, b, 0, 4096, 0);
    return imageWidth(b.subarray(0, n));
  } catch { return 0; } finally { if (fd !== undefined) closeSync(fd); }
}

// ── worklists ───────────────────────────────────────────────────────────────
const typeIcons = JSON.parse(readFileSync(join(ROOT, 'src/data/type-icons.json'), 'utf8'));

// iconID -> every typeID that uses it, so a failed representative can fall through to a sibling.
const typesByIcon = new Map();
for (const [tid, iid] of Object.entries(typeIcons)) {
  const k = String(iid);
  if (!typesByIcon.has(k)) typesByIcon.set(k, []);
  typesByIcon.get(k).push(tid);
}

// ⚠ THE REPRESENTATIVE MUST BE THE LOWEST META GROUP, or every type sharing the icon inherits its
// BADGE. CCP's image server bakes the meta-group corner marker into the icon it serves: ask for a
// Storyline type and the PNG comes back with the green marker burned into its top-left corner, a
// Tech II type with the T2 one. One file serves every type on that iconID, so taking whichever
// member happened to come first badged 143 of them. iconID 26547's first member is the 'Basic'
// Reactor Control Unit (Storyline), so every Reactor Control Unit in the app — Tech I included —
// wore a Storyline marker. pyfa's art carried no badges at all, which is why this only appeared
// when the art source changed.
//
// Tech I is never badged, so it is the preferred representative. A type with no metaGroupID (a
// booster, or anything not fittable and so absent from the bundle) is almost certainly unbadged
// too, but we cannot confirm that from here — it ranks behind a confirmed Tech I and ahead of
// anything known to be badged.
const TYPES = JSON.parse(readFileSync(join(ROOT, 'src/data/dogma-types.json'), 'utf8'));
const metaRank = (tid) => {
  const mg = TYPES[tid]?.mg;
  return mg === undefined ? 1 : mg === 1 ? 0 : 2 + mg;
};
// Stable, so members of equal rank keep their original order and a re-run is deterministic.
for (const list of typesByIcon.values()) list.sort((a, b) => metaRank(a) - metaRank(b));

// ⚠ THE IMAGE SERVER SERVES THE WRONG PICTURE FOR THESE — do not fetch them, ever.
//
// Every classic combat booster is manufactured from a "Pure" material of the same name, and the SDE
// gives the two DIFFERENT iconIDs (Standard Exile Booster 26613, Pure Standard Exile Booster 26426).
// The image server does not honour that: ask it for either typeID and you get one shared image, and
// which of the two renditions you get is arbitrary per pair. Synth/Standard/Improved Exile come back
// as the material — an ore pile — while Strong Exile happens to come back as the booster canister.
// The game client shows the canister for all four, so the SDE art pyfa ships is the correct one and
// what is bundled here is a hand-restored copy of it, at pyfa's 32px rather than 64.
//
// Found by sweeping the bundle for byte-identical files under DIFFERENT iconIDs — distinct iconIDs
// mean distinct SDE art, so a collision is proof one of them is wrong. That sweep is worth re-running
// after any CCP art drop; it is what turned "the Effects tab icon looks odd" into a precise list.
// The three collisions it still reports (Advanced Planetology, the Medium/Large Asteroid Ore
// Compressors, Clone Vat Bay I) are identical in pyfa's art too, so those are CCP reusing one
// picture on purpose, not this bug.
const IMAGE_SERVER_WRONG = new Set([
  26548, 26549, 26550, 26551, // Blue Pill
  26552, 26553, 26554, 26555, // Frentix
  26556, 26557, 26558, 26559, // Mindflood
  26604, 26605, 26606, 26607, // Crash
  26608, 26609, 26610, 26611, // Drop
  26612, 26613, 26614, 26615, // Exile
  26616, 26617, 26618, 26619, // Sooth Sayer
  26620, 26621, 26622, 26623, // X-Instinct
].map(String));

// iconIDs whose members are ALL drones or fighters, and which therefore belong to the render-fetched
// type-icons set rather than here. There is exactly one: CCP gave the three Acolytes (Acolyte I,
// 'Integrated', Imperial Navy) iconID 1084 and gave every other drone none at all, so those three
// were the only drones resolving through the shared-icon path — and so the only ones stuck with the
// badge the icon endpoint composites on. Skipping the iconID lets eveIcon() fall through to
// type-icons/, which also gives each Acolyte its own picture instead of one shared between them.
// Derived rather than listed so a future CCP data drop cannot quietly reintroduce the problem.
const DRONE_ICON_IDS = (() => {
  const cats = new Map();  // iconID -> Set of category IDs
  for (const [tid, iid] of Object.entries(typeIcons)) {
    const c = TYPES[tid]?.c;
    if (c == null) continue;
    if (!cats.has(String(iid))) cats.set(String(iid), new Set());
    cats.get(String(iid)).add(c);
  }
  return new Set([...cats].filter(([, s]) => [...s].every((c) => c === 18 || c === 87)).map(([i]) => i));
})();

function iconJobs() {
  const dir = join(ASSETS, 'icons');
  mkdirSync(dir, { recursive: true });
  const have = new Set(readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
  // Default worklist is what we ALREADY carry — this is an upgrade, not a coverage expansion. The
  // iconIDs pyfa never had art for stay on the image-server fallback unless --fill-gaps asks for
  // them, because that is ~717 more files and a materially bigger download.
  const want = fillGaps ? [...typesByIcon.keys()] : [...have];
  return want
    .filter((iid) => typesByIcon.has(iid) && !IMAGE_SERVER_WRONG.has(iid) && !DRONE_ICON_IDS.has(iid))
    .map((iid) => ({ dir, name: `${iid}.png`, candidates: typesByIcon.get(iid), kind: 'icon' }));
}

function renderJobs() {
  const dir = join(ASSETS, 'renders');
  mkdirSync(dir, { recursive: true });
  // graphic-ids.json is the render WORKLIST (hulls + structures) the other two scripts plan off, so
  // the three stay in step rather than each keeping its own list. Its keys are typeIDs, which is
  // what the image server wants — the graphicID mapping bundle-icons.mjs needed to rename pyfa's
  // files does not arise here at all.
  const gid = JSON.parse(readFileSync(join(ROOT, 'src/data/graphic-ids.json'), 'utf8'));
  return Object.keys(gid).map((tid) => ({ dir, name: `${tid}.png`, candidates: [tid], kind: 'render' }));
}

function typeIconJobs() {
  const dir = join(ASSETS, 'type-icons');
  mkdirSync(dir, { recursive: true });
  // No recorded worklist for these — they were downloaded once and committed. The folder's own
  // filenames are therefore the list, which is also exactly the set we want to upgrade.
  const want = new Set(readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
  // ...plus DRONE_ICON_IDS' members, which the folder is missing because a shared icons/<iconID>.png
  // used to answer for them. Each gets its own file so the three Acolytes stop sharing one picture.
  // TYPES-presence filter: type-icons.json also maps blueprints and unpublished variants onto 1084,
  // and the app can never show those.
  for (const tid of Object.keys(typeIcons)) {
    if (TYPES[tid] && DRONE_ICON_IDS.has(String(typeIcons[tid]))) want.add(tid);
  }
  return [...want].map((tid) => ({ dir, name: `${tid}.png`, candidates: [tid], kind: 'render' }));
}

const TARGETS = [
  { key: 'icons',      size: 64,  build: iconJobs },
  { key: 'renders',    size: 128, build: renderJobs },
  { key: 'type-icons', size: 128, build: typeIconJobs },
];

// ── fetch ───────────────────────────────────────────────────────────────────
// The requested size is asserted against the image that comes back. CCP answers a type it has no art
// for with a placeholder rather than a 404, and a placeholder committed offline is worse than no
// file — the app's onError hides a missing image, but it cannot tell that a real image is the wrong
// one. A width mismatch catches that without hardcoding what the placeholder looks like.
async function fetchOne(kind, typeID, size) {
  const path = kind === 'render' ? 'render' : 'icon';
  const res = await fetch(`https://images.evetech.net/types/${typeID}/${path}?size=${size}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 256) throw new Error(`suspiciously small (${buf.length} B)`);
  const w = imageWidth(buf);
  if (w === 0) throw new Error('not a PNG or JPEG');
  if (w !== size) throw new Error(`got ${w}px, wanted ${size}px`);
  return buf;
}

let totalWritten = 0;
const allFailed = [];

for (const t of TARGETS) {
  if (only && only !== t.key) continue;

  const jobs = t.build();
  const todo = force ? jobs : jobs.filter((j) => fileWidth(join(j.dir, j.name)) !== t.size);

  console.log(`\n── ${t.key} @ ${t.size}px ──`);
  console.log(`  in worklist : ${jobs.length}`);
  console.log(`  to fetch    : ${todo.length}${force ? '  (--force)' : '  (already at target are skipped)'}`);
  if (dryRun || todo.length === 0) continue;

  let done = 0, bytes = 0;
  const failed = [];
  let next = 0;

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < todo.length) {
      const job = todo[next++];
      let saved = false, lastErr = 'no candidate types';
      // Siblings sharing this iconID are tried in preference order before conceding. A single type
      // missing art on CCP's server says nothing about the icon. This was 3 while the order was
      // arbitrary; once metaRank started sorting them, an icon whose only drawn member is Officer
      // or Deadspace has that member pushed to the back, and a depth of 3 lost 11 icons that used
      // to resolve. The extra requests are only ever spent on a job already failing.
      for (const tid of job.candidates.slice(0, 8)) {
        try {
          const buf = await fetchOne(job.kind, tid, t.size);
          writeFileSync(join(job.dir, job.name), buf);
          bytes += buf.length;
          saved = true;
          break;
        } catch (e) { lastErr = `type ${tid}: ${e.message}`; }
      }
      if (!saved) failed.push([job.name, lastErr]);
      if (++done % 200 === 0 || done === todo.length)
        console.log(`  ${done}/${todo.length}  (${(bytes / 1048576).toFixed(1)} MB)`);
    }
  }));

  totalWritten += bytes;
  const total = readdirSync(join(ASSETS, t.key)).filter((f) => f.endsWith('.png'))
    .reduce((n, f) => n + statSync(join(ASSETS, t.key, f)).size, 0);
  console.log(`  src/assets/${t.key}/ is now ${readdirSync(join(ASSETS, t.key)).length} files, ${(total / 1048576).toFixed(1)} MB`);
  if (failed.length) {
    allFailed.push([t.key, failed]);
    // A failure here is not a missing file. The existing lower-resolution art is left exactly where
    // it was, so these keep their old pyfa copy and only miss the upgrade; the network fallback is
    // reached only by an entry that had no file to begin with (i.e. --fill-gaps).
    console.log(`  ${failed.length} could not be fetched (they keep the art they already had)`);
  }
}

if (dryRun) { console.log('\n--dry-run: nothing written.'); process.exit(0); }

console.log(`\ndownloaded ${(totalWritten / 1048576).toFixed(1)} MB`);
for (const [key, failed] of allFailed) {
  console.log(`\n${key}: ${failed.length} missing`);
  for (const [name, why] of failed.slice(0, 20)) console.log(`  ${name} — ${why}`);
  if (failed.length > 20) console.log(`  ... and ${failed.length - 20} more`);
}
console.log('\nCommit src/assets/ — the shipped app needs it to work offline.');
console.log('Then: npm run verify');
