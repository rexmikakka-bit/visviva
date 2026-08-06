// Generates every app icon / splash SVG from one description of the mark.
//
//   node scripts/build-icons.mjs
//
// Writes public/favicon.svg, assets/icon-only.svg, assets/logo.svg, assets/splash.svg and
// assets/splash-dark.svg. Then run `npx capacitor-assets generate` to expand those into the
// Android mipmap/drawable sets and the iOS AppIcon set.
//
// The mark: a "VV" monogram riding a tapered orbit. A stroke cannot vary in width, so the orbit is
// a FILLED ribbon — walk the ellipse once offsetting outward by +w(t)/2, walk back offsetting by
// -w(t)/2, close. w(t) peaks at the head (where the body dot sits) and thins around the back, and
// the opacity gradient runs along the same axis so thickness and opacity taper together.
//
// These are checked in, but regenerate rather than hand-editing: the path is ~120 line segments.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CX = 512, CY = 512, RX = 372, RY = 228, ROT = -24;
const BLUE = "#4f8ef7", LIGHT = "#a8c8ff", BG = "#0f0f10";

// A3 + 64: the boldest taper, with the two Vs pulled together so the pair reads as an overlapping
// monogram rather than a single W.
const MARK = {
  wMax: 58, wMin: 4, headDeg: -8, power: 2.0,
  tailOpacity: 0, headOpacity: 1.0, dotR: 34, tighten: 64,
};

const rad = d => (d * Math.PI) / 180;
const rot = (dx, dy, a) => {
  const c = Math.cos(rad(a)), s = Math.sin(rad(a));
  return [dx * c - dy * s, dx * s + dy * c];
};

// 120 steps = a 3° arc; at rx=372 the sagitta is 0.13px, so the polyline reads as a smooth curve
// while the path data stays small enough to ship as a favicon.
function ribbon({ wMax, wMin, headDeg, power, steps = 120 }) {
  const pt = t => [RX * Math.cos(t), RY * Math.sin(t)];
  const nrm = t => {                       // outward unit normal of the ellipse
    const nx = Math.cos(t) / RX, ny = Math.sin(t) / RY;
    const m = Math.hypot(nx, ny);
    return [nx / m, ny / m];
  };
  const halfW = t => (wMin + (wMax - wMin) * ((1 + Math.cos(t - rad(headDeg))) / 2) ** power) / 2;
  const outer = [], inner = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const [px, py] = pt(t), [nx, ny] = nrm(t), h = halfW(t);
    outer.push([px + nx * h, py + ny * h]);
    inner.push([px - nx * h, py - ny * h]);
  }
  const f = ([x, y]) => `${(x + CX).toFixed(1)} ${(y + CY).toFixed(1)}`;
  return `M ${f(outer[0])} ` + outer.slice(1).map(p => `L ${f(p)}`).join(" ")
    + ` L ${f(inner.at(-1))} ` + inner.slice().reverse().slice(1).map(p => `L ${f(p)}`).join(" ")
    + " Z";
}

const headPos = deg => {
  const [dx, dy] = rot(RX * Math.cos(rad(deg)), RY * Math.sin(rad(deg)), ROT);
  return [CX + dx, CY + dy];
};

// The two Vs, each 344 wide with its apex at the midpoint. `tighten` slides them toward each other
// by that many units; both move equally, so the glyph stays centred on 512.
const monogram = tighten =>
  `<path d="M ${214 + tighten} 356 L ${386 + tighten} 668 L ${558 + tighten} 356" fill="none" stroke="${BLUE}" stroke-width="92" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<path d="M ${466 - tighten} 356 L ${638 - tighten} 668 L ${810 - tighten} 356" fill="none" stroke="${LIGHT}" stroke-width="92" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The artwork on a 1024 grid, without a background. `id` namespaces the gradient. */
function artwork(id = "vv") {
  const m = MARK;
  const [hx, hy] = headPos(m.headDeg);
  const [tx, ty] = headPos(m.headDeg + 180);
  const mid = ((m.tailOpacity + m.headOpacity) / 2 * 0.75).toFixed(2);
  return `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${tx.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}">`
    + `<stop offset="0" stop-color="${BLUE}" stop-opacity="${m.tailOpacity}"/>`
    + `<stop offset=".45" stop-color="${BLUE}" stop-opacity="${mid}"/>`
    + `<stop offset="1" stop-color="${BLUE}" stop-opacity="${m.headOpacity}"/>`
    + `</linearGradient></defs>`
    + `<path d="${ribbon(m)}" fill="url(#${id})" transform="rotate(${ROT} ${CX} ${CY})"/>`
    + `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${m.dotR}" fill="${BLUE}" opacity=".95"/>`
    + monogram(m.tighten);
}

/** Full-bleed square icon. */
const icon = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">`
  + `<rect width="1024" height="1024" fill="${BG}"/>${artwork()}</svg>`;

/** Splash: the mark centred small on a large field, matching the previous splash proportions. */
function splash(size = 2732, frac = 0.34) {
  const s = (size * frac) / 1024, off = (size - size * frac) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" fill="${BG}"/>`
    + `<g transform="translate(${off.toFixed(2)} ${off.toFixed(2)}) scale(${s.toFixed(4)})">${artwork("vvs")}</g></svg>`;
}

const files = {
  "public/favicon.svg":     icon(1024),
  "assets/icon-only.svg":   icon(1024),
  "assets/logo.svg":        icon(1024),
  "assets/splash.svg":      splash(),
  "assets/splash-dark.svg": splash(),
};
for (const [rel, svg] of Object.entries(files)) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, svg);
  console.log(`wrote ${rel}  (${(svg.length / 1024).toFixed(1)} KB)`);
}
console.log("\nNOW RUN:  npx capacitor-assets generate   <- expands these into android/ and ios/");
