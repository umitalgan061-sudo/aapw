import process from 'node:process';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4173/scripts/geographic-world-visual-audit-harness.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__GEOGRAPHIC_WORLD_VISUAL_AUDIT__), null, { timeout: 120000 });
const proof = await page.evaluate(() => window.__GEOGRAPHIC_WORLD_VISUAL_AUDIT__);
await browser.close();

const failures = [...(proof?.failures || [])];
if (consoleErrors.length) failures.push('browser-console-errors');
if (pageErrors.length) failures.push('browser-page-errors');
if (!proof?.ok) failures.push('harness-not-ok');

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures, proof, consoleErrors, pageErrors }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  checks: proof.checks,
  gpu: proof.gpu,
  settlement: proof.settlement,
}, null, 2));
