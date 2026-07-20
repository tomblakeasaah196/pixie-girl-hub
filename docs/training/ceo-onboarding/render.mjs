// Render deck.html -> Pixie-Girl-Hub-CEO-Onboarding.pdf (10 slides, 16:9).
//
//   node render.mjs
//
// Uses puppeteer-core against a local Chromium. Set CHROME to your browser
// binary, or rely on the default Playwright cache path used on CI/web sessions.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HTML = 'file://' + path.join(HERE, 'deck.html');
const PDF = path.join(HERE, 'Pixie-Girl-Hub-CEO-Onboarding.pdf');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-color-profile=srgb',
         '--font-render-hinting=none', '--disable-gpu'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
await page.goto(HTML, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(async () => { await document.fonts.ready; });

await page.pdf({
  path: PDF, preferCSSPageSize: true, printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});
console.log('PDF written ->', PDF);

await browser.close();
