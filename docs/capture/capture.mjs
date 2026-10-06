#!/usr/bin/env node
/**
 * Re-shoots the user-guide images in docs/img/ from the running dev server.
 *
 *     npm run dev                                  # in another terminal
 *     FFMPEG=/path/to/ffmpeg node docs/capture/capture.mjs [page ...]
 *
 * Tooling only: nothing here is imported by the app or the build. Needs Playwright (already a
 * devDependency) driving a Chromium-family browser, and ffmpeg for the GIFs (FFMPEG env var or on PATH).
 * See docs/capture/README.md for the full setup, including the demo fit.
 *
 * Pages: stats, modifiers, tags, states, import, graphs. No argument shoots all of them.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, readFileSync, statSync, renameSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMG = resolve(HERE, '..', 'img');
const WORK = process.env.CAPTURE_WORK ?? resolve(HERE, '.work');      // gitignored scratch
const BASE = process.env.BASE_URL ?? 'http://localhost:5173/';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const CHANNEL = process.env.BROWSER_CHANNEL || undefined;              // e.g. "msedge" if Playwright's Chromium isn't installed
const DEMO_FIT = 'arty standard';
mkdirSync(IMG, { recursive: true });
mkdirSync(WORK, { recursive: true });

// The spec's phone: 390x844 CSS px at 3x, touch on.
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark' };

// A visible ring wherever the pointer goes down, so a GIF shows WHERE the tap was. Injected into the
// page by the capture only; the app itself has no such thing.
const TAP_RING = () => {
  addEventListener('pointerdown', (e) => {
    const r = document.createElement('div');
    Object.assign(r.style, { position: 'fixed', left: `${e.clientX - 18}px`, top: `${e.clientY - 18}px`, width: '36px', height: '36px',
      borderRadius: '50%', border: '3px solid rgba(255,255,255,.9)', background: 'rgba(255,255,255,.25)', zIndex: 2147483647,
      pointerEvents: 'none', transition: 'opacity .5s, transform .5s' });
    document.documentElement.appendChild(r);
    setTimeout(() => { r.style.opacity = '0'; r.style.transform = 'scale(1.6)'; }, 350);
    setTimeout(() => r.remove(), 900);
  }, true);
};

async function open(profile = 'profile', { video = false } = {}) {
  const ctx = await chromium.launchPersistentContext(join(WORK, profile), {
    ...PHONE, channel: CHANNEL, headless: true, permissions: ['clipboard-read', 'clipboard-write'],
    ...(video ? { recordVideo: { dir: join(WORK, 'video'), size: PHONE.viewport } } : {}),
  });
  const t0 = Date.now();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.addInitScript(TAP_RING);
  page.on('pageerror', (e) => console.error('  [page error]', e.message));
  await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(2000);
  return { ctx, page, t0 };
}

const tab = (page, re) => page.getByRole('button', { name: re }).first().click();
const pause = (page, ms = 700) => page.waitForTimeout(ms);
// Tap the CENTRE of a locator via the touchscreen, so the tap ring lands where a finger would.
async function tap(page, loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}
async function still(page, name, clip) {
  const path = join(IMG, name);
  await page.screenshot({ path, clip });
  console.log(`  ${name}  ${(statSync(path).size / 1024).toFixed(0)} KB`);
}
// Scroll a card to the top of its scroller BEFORE measuring a crop, so no later tap has to scroll.
const toTop = async (page, loc) => { await loc.evaluate((e) => e.scrollIntoView({ block: 'start' })); await page.waitForTimeout(600); };
const boxOf = async (loc, pad = 0) => { const b = await loc.boundingBox(); return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(390, b.width + 2 * pad), height: b.height + 2 * pad }; };

// Record one interaction. `setup` runs on camera but is trimmed off; only `action` stays in the GIF.
// `crop` is in CSS px ({x,y,width,height}), which is also the video's own pixel grid.
async function gif(name, { setup, action, crop, fps = 12, tail = 0.8 }) {
  const { ctx, page, t0 } = await open('profile', { video: true });
  await setup?.(page);
  await pause(page, 400);
  const start = (Date.now() - t0) / 1000;
  const region = typeof crop === 'function' ? await crop(page) : crop;
  await action(page);
  const end = (Date.now() - t0) / 1000 + tail;
  const raw = await page.video().path();
  await ctx.close();
  const out = join(IMG, name);
  const c = region ? `crop=${Math.round(region.width)}:${Math.round(region.height)}:${Math.round(region.x)}:${Math.round(region.y)},` : '';
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, start - 0.2)), '-to', String(end), '-i', raw,
    '-vf', `${c}fps=${fps},scale=390:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop', '0', out]);
  rmSync(raw, { force: true });
  const kb = statSync(out).size / 1024;
  console.log(`  ${name}  ${kb.toFixed(0)} KB${kb > 2048 ? '  ⚠ over 2 MB' : ''}`);
}

// ── pages ───────────────────────────────────────────────────────────────────────────────────────

const PAGES = {
  async stats() {
    const toStats = async (page) => { await tab(page, /^stats$/i); await pause(page, 1500); };
    // The innermost element holding both texts is the card itself.
    const card = (page, title, inner) => page.locator('div', { has: page.getByText(title, { exact: true }) }).filter({ has: page.getByText(inner) }).last();
    const fpCard = (page) => card(page, 'Firepower', 'Weapon DPS');
    const capCard = (page) => card(page, 'Capacitor', 'Net GJ/s');
    // Firepower: pick a column to see its damage-type split, then Heat on/off.
    await gif('stats-firepower.gif', {
      setup: async (page) => { await toStats(page); await toTop(page, fpCard(page)); },
      crop: async (page) => boxOf(fpCard(page), 2),
      action: async (page) => {
        for (const l of ['Drone DPS', 'Total DPS', 'Weapon DPS']) { await tap(page, page.getByText(l, { exact: true }).first()); await pause(page, 1100); }
        await tap(page, page.getByText('Heat', { exact: true }).first()); await pause(page, 1400);
        await tap(page, page.getByText('Heat', { exact: true }).first()); await pause(page, 900);
      },
    });
    // Resistances: exact EHP, then fold the ancillary clip in.
    await gif('stats-ehp.gif', {
      setup: toStats,
      crop: async (page) => boxOf(page.locator('div', { has: page.getByText('Resistances', { exact: true }) }).filter({ has: page.getByText('Incoming damage') }).last(), 2),
      action: async (page) => {
        await tap(page, page.getByText(/^\d+(\.\d)?k$/).first()); await pause(page, 1300);
        await tap(page, page.getByText(/ancil\./).first()); await pause(page, 1300);
        await tap(page, page.getByText(/w\/ ancil\./).first()); await pause(page, 900);
      },
    });
    // Capacitor: net vs in/out, peak regen vs neut resist.
    await gif('stats-capacitor.gif', {
      setup: async (page) => { await toStats(page); await toTop(page, capCard(page)); },
      crop: async (page) => boxOf(capCard(page), 2),
      action: async (page) => {
        await tap(page, page.getByText('Net GJ/s')); await pause(page, 1300);
        await tap(page, page.getByText(/^Peak regen/)); await pause(page, 1300);
        await tap(page, page.getByText('In / Out GJ/s')); await pause(page, 600);
        await tap(page, page.getByText('Neut resist')); await pause(page, 900);
      },
    });
  },

  async modifiers() {
    const openInfo = async (page) => {
      await tab(page, /^modules$/i); await pause(page);
      await page.getByText('720mm Howitzer Artillery II').first().click(); await pause(page, 1000);
      await page.getByRole('button', { name: /^Info$/ }).click(); await pause(page, 1200);
    };
    await gif('modifiers.gif', {
      setup: openInfo,
      action: async (page) => {
        const row = page.getByText(/^Damage Modifier/).first();
        await row.scrollIntoViewIfNeeded(); await pause(page, 700);
        await tap(page, row); await pause(page, 600);
        await page.mouse.wheel(0, 300); await pause(page, 2200);
      },
    });
    const { ctx, page } = await open();
    await openInfo(page);
    const row = page.getByText(/^Damage Modifier/).first();
    await row.click(); await pause(page, 700);
    await row.scrollIntoViewIfNeeded(); await page.mouse.wheel(0, 120); await pause(page, 500);
    const top = (await row.boundingBox()).y - 10;
    await still(page, 'modifiers-expanded.png', { x: 0, y: top, width: 390, height: Math.min(470, 844 - top) });
    await ctx.close();
  },

  async tags() {
    // Start from an untagged fit so the GIF shows the tag being created, not merely toggled.
    const tagBtn = (page) => page.getByRole('button', { name: /^(Tag this fit|Edit tags)/ });
    const tagSheet = async (page) => { await tagBtn(page).click(); await pause(page, 900); };
    const clear = async (page) => {
      await tab(page, /^modules$/i); await pause(page); await tagSheet(page);
      for (let i = 0; i < 5; i++) { const x = page.getByLabel(/^Remove tag /).first(); if (!(await x.count())) break; await x.click(); await pause(page, 400); }
      await page.keyboard.press('Escape'); await pause(page, 600);
    };
    { const { ctx, page } = await open(); await clear(page); await ctx.close(); }
    await gif('tags-add.gif', {
      setup: async (page) => { await tab(page, /^modules$/i); await pause(page); },
      action: async (page) => {
        await tap(page, tagBtn(page)); await pause(page, 900);
        await page.getByPlaceholder(/Find or create a tag/).click();
        await page.keyboard.type('kiting', { delay: 120 }); await pause(page, 700);
        await tap(page, page.getByRole('button', { name: 'Create "kiting"' })); await pause(page, 1400);
      },
    });
    await gif('tags-browse.gif', {
      setup: async (page) => { await tab(page, /^modules$/i); await pause(page); },
      action: async (page) => {
        await tap(page, page.getByRole('button', { name: /Fits/ }).first()); await pause(page, 1300);
        // "Fits" opens this hull's list; one more step back is the home screen, where tags live.
        await tap(page, page.getByRole('button', { name: /^Back (to all ships|one level)$/ }).first()); await pause(page, 1300);
        // The home screen's Tags chip carries its fit count ("kiting" + "1") in one element.
        await tap(page, page.getByText(/^kiting\d+$/).first()); await pause(page, 1800);
      },
    });
  },

  async states() {
    await gif('module-states.gif', {
      setup: async (page) => { await tab(page, /^modules$/i); await pause(page); await page.getByText('Mid Slots').scrollIntoViewIfNeeded(); await pause(page); },
      crop: async (page) => boxOf(page.locator('[title*="double-tap to overheat"]').nth(3).locator('xpath=ancestor::div[contains(@style,"border")][1]'), 4),
      action: async (page) => {
        const dot = page.locator('[title*="double-tap to overheat"]').nth(3);
        const b = await dot.boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
        await page.touchscreen.tap(x, y); await pause(page, 1300);                       // active -> online
        await page.touchscreen.tap(x, y); await pause(page, 1300);                       // online -> active
        await dot.dblclick(); await pause(page, 1500);                                   // overheat
        await page.mouse.move(x, y); await page.mouse.down(); await pause(page, 900); await page.mouse.up(); await pause(page, 1300); // offline
        await page.touchscreen.tap(x, y); await pause(page, 1600);                       // back to active
      },
    });
  },

  async import() {
    // Its own throwaway profile: importing into the main one would duplicate the demo fit.
    rmSync(join(WORK, 'profile-import'), { recursive: true, force: true });
    const fit = readFileSync(join(HERE, 'demo-fit.txt'), 'utf8');
    const { ctx, page, t0 } = await (async () => {
      const r = await chromium.launchPersistentContext(join(WORK, 'profile-import'), {
        ...PHONE, channel: CHANNEL, headless: true, permissions: ['clipboard-read', 'clipboard-write'],
        recordVideo: { dir: join(WORK, 'video'), size: PHONE.viewport } });
      const p = r.pages()[0] ?? await r.newPage();
      await p.addInitScript(TAP_RING);
      const t = Date.now();
      await p.goto(BASE, { waitUntil: 'load', timeout: 120000 }); await p.waitForTimeout(2000);
      return { ctx: r, page: p, t0: t };
    })();
    await page.evaluate((t) => navigator.clipboard.writeText(t), fit);
    const start = (Date.now() - t0) / 1000;
    await tap(page, page.getByText('☰')); await pause(page, 800);
    await tap(page, page.getByText('Import Fit', { exact: true })); await pause(page, 900);
    await still(page, 'import-sheet.png', { x: 0, y: 380, width: 390, height: 464 });
    await tap(page, page.getByText('From EFT')); await pause(page, 1600);
    await still(page, 'import-done.png', { x: 0, y: 0, width: 390, height: 420 });
    const end = (Date.now() - t0) / 1000 + 0.6;
    const raw = await page.video().path(); await ctx.close();
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(start), '-to', String(end), '-i', raw, '-vf',
      'fps=12,scale=390:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
      '-loop', '0', join(IMG, 'import-eft.gif')]);
    rmSync(raw, { force: true });
    console.log(`  import-eft.gif  ${(statSync(join(IMG, 'import-eft.gif')).size / 1024).toFixed(0)} KB`);
  },

  async fleet() {
    // Needs the Damnation links fit (demo-links.txt) saved in the profile; see README. The command
    // fit is SAVED on the Hurricane, so it is removed again at the end and every other page keeps
    // its unboosted numbers.
    const toCommand = async (page) => {
      await page.getByRole('button', { name: /Effects/ }).last().click(); await pause(page, 1000);
      await page.getByRole('button', { name: /^Command/ }).first().click(); await pause(page, 800);
    };
    const removeAll = async (page) => {
      for (let i = 0; i < 5; i++) {
        const card = page.locator('div', { has: page.getByText('armor links', { exact: true }) }).filter({ has: page.getByText('Open', { exact: true }) }).last();
        if (!(await card.count())) break;
        await card.getByText('x', { exact: true }).click(); await pause(page, 600);
      }
    };
    { const { ctx, page } = await open(); await toCommand(page); await removeAll(page); await ctx.close(); }
    await gif('fleet-command.gif', {
      setup: toCommand,
      crop: { x: 0, y: 150, width: 390, height: 360 },
      action: async (page) => {
        await tap(page, page.getByText(/Add Command Fit/i)); await pause(page, 1100);
        await tap(page, page.getByText('armor links', { exact: true })); await pause(page, 2000);
      },
    });
    const { ctx, page } = await open();
    await toCommand(page);
    await still(page, 'fleet-command.png', { x: 0, y: 150, width: 390, height: 340 });
    await removeAll(page);
    await ctx.close();
  },

  async pyfa() {
    // Needs PYFA_XML pointing at a real pyfa "Backup All Fittings" file. Runs in its own profile,
    // wiped first, so the import never lands in the demo profile. Nothing below shows a fit NAME:
    // the preview is counts only, and the home screen shows per-class totals.
    const xml = process.env.PYFA_XML;
    if (!xml || !existsSync(xml)) { console.log('  skipped: set PYFA_XML to a pyfa XML backup'); return; }
    rmSync(join(WORK, 'profile-pyfa'), { recursive: true, force: true });
    const ctx = await chromium.launchPersistentContext(join(WORK, 'profile-pyfa'), {
      ...PHONE, channel: CHANNEL, headless: true, recordVideo: { dir: join(WORK, 'video'), size: PHONE.viewport } });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.addInitScript(TAP_RING);
    const t0 = Date.now();
    await page.goto(BASE, { waitUntil: 'load', timeout: 120000 }); await pause(page, 2000);
    const start = (Date.now() - t0) / 1000;
    await tap(page, page.getByText('☰')); await pause(page, 800);
    await tap(page, page.getByText('Settings', { exact: true })); await pause(page, 900);
    await tap(page, page.getByRole('button', { name: /^Backup$/ })); await pause(page, 900);
    const head = page.getByText('Import from pyfa', { exact: true });
    await toTop(page, head); await pause(page, 600);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tap(page, page.getByRole('button', { name: /Choose pyfa XML file/ }))]);
    await chooser.setFiles(xml);
    await page.getByText(/Ready to import/).waitFor({ timeout: 120000 }); await pause(page, 1800);
    const panel = page.locator('div', { has: page.getByText(/Ready to import/) }).filter({ has: page.getByRole('button', { name: /^Add [\d,]+ fits?$/ }) }).last();
    const pb = await panel.boundingBox(), hb = await head.boundingBox();
    await still(page, 'pyfa-preview.png', { x: 0, y: hb.y - 12, width: 390, height: pb.y + pb.height - hb.y + 24 });
    await tap(page, page.getByRole('button', { name: /^Add [\d,]+ fits?$/ }));
    await page.waitForTimeout(4000); await page.waitForLoadState('load'); await pause(page, 2500);
    const end = (Date.now() - t0) / 1000;
    await still(page, 'pyfa-after.png', { x: 0, y: 0, width: 390, height: 700 });
    const raw = await page.video().path(); await ctx.close();
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(start), '-to', String(end), '-i', raw, '-vf',
      'fps=10,scale=390:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
      '-loop', '0', join(IMG, 'pyfa-import.gif')]);
    rmSync(raw, { force: true });
    console.log(`  pyfa-import.gif  ${(statSync(join(IMG, 'pyfa-import.gif')).size / 1024).toFixed(0)} KB`);
  },

  async graphs() {
    const toGraphs = async (page) => { await tab(page, /^graphs$/i); await pause(page, 2500); };
    { const { ctx, page } = await open(); await toGraphs(page); await still(page, 'graphs.png', { x: 0, y: 160, width: 390, height: 540 }); await ctx.close(); }
    // Categories, not target presets: the default flight vectors give 0 m/s transversal, and with no
    // transversal a turret's damage barely depends on the target, so the presets draw near-identical curves.
    await gif('graphs-categories.gif', {
      setup: toGraphs,
      crop: { x: 0, y: 160, width: 390, height: 540 },
      action: async (page) => {
        for (const l of ['Capacitor', 'Mobility', 'Shield', 'Damage']) { await tap(page, page.getByRole('button', { name: l, exact: true })); await pause(page, 1500); }
      },
    });
  },
};

const want = process.argv.slice(2);
for (const name of want.length ? want : Object.keys(PAGES)) {
  if (!PAGES[name]) { console.error(`unknown page "${name}"; have ${Object.keys(PAGES).join(', ')}`); process.exit(1); }
  console.log(name);
  await PAGES[name]();
}
