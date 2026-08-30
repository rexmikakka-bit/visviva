import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = process.argv[3] || '.';
const scheme = process.argv[4] || 'dark'; // 'light' | 'dark'
const outFile = process.argv[5] || `${outDir}/screenshot-${scheme}.png`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, // iPhone 12/13/14-ish
  deviceScaleFactor: 2,
  colorScheme: scheme,
});
page.on('console', msg => { if (msg.type() === 'error') console.error('[console error]', msg.text()); });
page.on('pageerror', err => console.error('[page error]', err.message));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.screenshot({ path: outFile });
await browser.close();
console.log('saved', outFile);
