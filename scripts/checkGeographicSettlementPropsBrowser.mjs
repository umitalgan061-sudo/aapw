import process from 'node:process';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4173/scripts/geographic-settlement-props-harness.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__GEOGRAPHIC_SETTLEMENT_PROPS_PROOF__), null, { timeout: 120000 });
const proof = await page.evaluate(() => window.__GEOGRAPHIC_SETTLEMENT_PROPS_PROOF__);
await browser.close();
if (!proof?.ok || consoleErrors.length || pageErrors.length) {
  console.error(JSON.stringify({ proof, consoleErrors, pageErrors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, proof }, null, 2));
