import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startDevServer } from './devServerHelper.js';

const artifactDir = path.resolve('artifacts/ice-landmarks-visual-qa');
await fs.mkdir(artifactDir, { recursive: true });
const server = await startDevServer({ port: 4187 });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:4187/ice-landmarks-visual-qa.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__iceQa?.ready === true, null, { timeout: 20000 });

  const stats = await page.evaluate(() => window.__iceQa.stats);
  if (!(stats.width > 2200 && stats.width < 3600)) throw new Error(`wall width outside visual contract: ${stats.width}`);
  if (!(stats.height > 120 && stats.height < 230)) throw new Error(`wall height outside visual contract: ${stats.height}`);
  if (!(stats.blockers > 40)) throw new Error(`insufficient collision blockers: ${stats.blockers}`);
  for (const role of ['glacial-cliff-wall', 'arched-wall-portal', 'walkable-ice-cave-shell', 'cave-ceiling-icicles']) {
    if (!stats.roles.includes(role)) throw new Error(`missing visual role: ${role}`);
  }

  for (const view of ['wall', 'cave', 'interior']) {
    await page.evaluate((name) => window.__iceQa.render(name), view);
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(artifactDir, `${view}.png`) });
  }
  if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);
  await fs.writeFile(path.join(artifactDir, 'stats.json'), JSON.stringify(stats, null, 2));
  console.log(`Ice landmarks visual QA passed: ${stats.width.toFixed(1)}m wall span, ${stats.height.toFixed(1)}m height, ${stats.blockers} blockers.`);
} finally {
  await browser?.close();
  await server.close();
}
