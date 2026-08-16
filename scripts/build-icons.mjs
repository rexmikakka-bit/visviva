// Derives every icon/splash/favicon variant from ONE master image, then expands them into android/.
//
//   npm i --no-save sharp @capacitor/assets && node scripts/build-icons.mjs
//
// The master is `assets/icon-only.png` — designer-supplied artwork, 1024x1024, square, full-bleed,
// no transparency. It is the ONLY file here that is hand-dropped; this script never writes it, and
// refuses to run if its shape is wrong (a mask or a splash built from an off-size master fails in a
// way you only notice on a device).
//
// Everything else is generated, so the header mark, the browser tab, the launcher icon and the
// splash can never drift into being four different drawings:
//
//   assets/icon-foreground.png   Android adaptive foreground   \ capacitor-assets expands these
//   assets/icon-background.png   Android adaptive background   / into android/ and ios/
//   assets/splash.png            splash (light + dark are the same — the app is dark-only)
//   assets/splash-dark.png
//   public/favicon.png           browser tab
//   src/assets/app-mark.png      in-app header mark
//
// iOS needs none of this run locally: CI regenerates ios/ from assets/ on every release build.
// Android's res/ IS committed, so this script drives capacitor-assets itself and commits the result.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = join(ROOT, "assets/icon-only.png");

// The splash field, matching the app's own background. The mark sits at 34% of the canvas — the
// proportion the previous splash used, kept so the launch animation lands in the same place.
const SPLASH_BG = "#0f0f10", SPLASH_SIZE = 2732, SPLASH_FRAC = 0.34;

// Sampled from the master's top and bottom edges. Only ever visible if a launcher parallaxes the
// adaptive foreground far enough to expose the layer behind it, so it has to be the same gradient.
const PLATE_TOP = "#264179", PLATE_BOTTOM = "#1a2b51";

// Apple's continuous-corner radius is 22.37% of the icon's width. The launcher and the browser tab
// apply their own mask, so this is only used where WE draw the plate: the splash.
const CORNER = 0.2237;

const out = [];
const write = async (rel, buf) => {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  out.push([rel, buf.length]);
};

const master = sharp(MASTER);
const meta = await master.metadata();
if (meta.width !== 1024 || meta.height !== 1024) {
  throw new Error(`assets/icon-only.png must be 1024x1024, got ${meta.width}x${meta.height}`);
}

// ── Android adaptive icon ────────────────────────────────────────────────────
// The foreground is the WHOLE master, not a cut-out mark. capacitor-assets writes an adaptive-icon
// XML that insets both layers by 16.7% of the 108dp canvas, which places the drawable exactly over
// the 72dp region the launcher mask shows — so full-bleed artwork fills the mask edge to edge, the
// same way it does on iOS. A circular mask clips the corners; every element of the mark sits within
// r=0.42 of centre, well inside the inscribed circle, so nothing is lost.
await write("assets/icon-foreground.png", readFileSync(MASTER));

await write("assets/icon-background.png", await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: PLATE_BOTTOM },
}).composite([{
  input: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${PLATE_TOP}"/><stop offset="1" stop-color="${PLATE_BOTTOM}"/>`
    + `</linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/></svg>`),
}]).png().toBuffer());

// ── Splash ───────────────────────────────────────────────────────────────────
// The master carries its own plate, so on the near-black field it needs rounded corners or it reads
// as a stray navy rectangle rather than the app's mark.
const markSize = Math.round(SPLASH_SIZE * SPLASH_FRAC);
const r = Math.round(markSize * CORNER);
const roundedMark = await sharp(MASTER)
  .resize(markSize, markSize)
  .composite([{
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${markSize}" height="${markSize}">`
      + `<rect width="${markSize}" height="${markSize}" rx="${r}" ry="${r}" fill="#fff"/></svg>`),
    blend: "dest-in",
  }])
  .png().toBuffer();

const splash = await sharp({
  create: { width: SPLASH_SIZE, height: SPLASH_SIZE, channels: 3, background: SPLASH_BG },
}).composite([{ input: roundedMark, gravity: "centre" }]).png().toBuffer();

await write("assets/splash.png", splash);
await write("assets/splash-dark.png", splash);

// ── Web ──────────────────────────────────────────────────────────────────────
// Square and unrounded on purpose: the browser rounds the tab icon itself, and the in-app header
// applies its own border-radius in CSS, so a pre-rounded source would double up.
const web = await master.clone().resize(256, 256).png().toBuffer();
await write("public/favicon.png", web);
await write("src/assets/app-mark.png", web);

const w = Math.max(...out.map(([rel]) => rel.length));
for (const [rel, bytes] of out) console.log(`wrote ${rel.padEnd(w)}  ${(bytes / 1024).toFixed(1)} KB`);

// ── Expand into android/app/src/main/res ─────────────────────────────────────
console.log("\n$ npx capacitor-assets generate --android");
// One string, not argv: npx needs a shell on Windows, and passing an args array alongside
// shell:true is what Node deprecated in DEP0190. Nothing here is user-supplied.
const gen = spawnSync("npx capacitor-assets generate --android",
  { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], shell: true });
if (gen.status !== 0) throw new Error("capacitor-assets failed — is it installed? (npm i --no-save @capacitor/assets)");

// ⚠️ WORKAROUND for a bug in @capacitor/assets (v3.x): when the adaptive layers come from explicit
// `icon-foreground`/`icon-background` sources, generateAdaptiveIcon{Foreground,Background} filter
// the templates by kind `icon` instead of kind `adaptive-icon` — so they write the adaptive layers
// at the LEGACY launcher sizes (192 at xxxhdpi) instead of the adaptive ones (432). An adaptive
// layer is a 108dp canvas of which the mask shows the middle 72dp, so 192px of source ends up
// stretched across a 108dp slot: the launcher icon renders soft, and nothing warns you. The
// `logo` code path uses the right templates, which is why this never showed up before the artwork
// moved to explicit sources. Rewrite the twelve files at the sizes Android actually wants.
const ADAPTIVE = { ldpi: 81, mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const RES = join(ROOT, "android/app/src/main/res");
for (const [density, size] of Object.entries(ADAPTIVE)) {
  for (const [name, src] of [["foreground", "assets/icon-foreground.png"], ["background", "assets/icon-background.png"]]) {
    const dest = join(RES, `mipmap-${density}`, `ic_launcher_${name}.png`);
    await sharp(join(ROOT, src)).resize(size, size).png().toFile(dest);
  }
}
console.log(`rewrote ${Object.keys(ADAPTIVE).length * 2} adaptive layers at 108dp sizes (capacitor-assets writes them too small)`);
