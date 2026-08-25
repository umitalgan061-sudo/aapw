import fs from 'node:fs/promises';
import path from 'node:path';
import serverHelper from './devServerHelper.js';

const { startStaticServer, loadPlaywright } = serverHelper;
const playwright = loadPlaywright();
if (!playwright?.chromium) {
  console.error('[checkIceLandmarksVisualQa] Playwright unavailable; install playwright@1.55.0 first.');
  process.exit(2);
}

const artifactDir = path.resolve('artifacts/ice-landmarks-visual-qa');
await fs.mkdir(artifactDir, { recursive: true });
const server = await startStaticServer();
let browser;
try {
  browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${server.baseUrl}/ice-landmarks-visual-qa.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__iceQa?.ready === true, null, { timeout: 20000 });

  const stats = await page.evaluate(() => window.__iceQa.stats);
  if (!(stats.width > 2200 && stats.width < 3600)) throw new Error(`wall width outside visual contract: ${stats.width}`);
  if (!(stats.height > 120 && stats.height < 230)) throw new Error(`wall height outside visual contract: ${stats.height}`);
  if (!(stats.blockers > 40)) throw new Error(`insufficient collision blockers: ${stats.blockers}`);
  if (stats.terrainAuthority !== 'canonical-createHeightSampler+terrainBiomeShading') {
    throw new Error(`ice QA lost canonical terrain authority: ${stats.terrainAuthority}`);
  }
  if (!(stats.terrain?.vertexCount > 10000)) throw new Error(`canonical terrain patch unexpectedly coarse: ${stats.terrain?.vertexCount}`);
  if (!(stats.terrain?.reliefSpan > 1)) throw new Error(`canonical terrain relief collapsed: ${stats.terrain?.reliefSpan}`);
  if (![stats.terrain?.minHeight, stats.terrain?.maxHeight, stats.terrain?.meanSnowWeight, stats.terrain?.meanRockWeight].every(Number.isFinite)) {
    throw new Error(`canonical terrain telemetry contains non-finite values: ${JSON.stringify(stats.terrain)}`);
  }
  for (const role of ['natural-ice-wall', 'arched-wall-portal', 'walkable-ice-cave-shell', 'cave-ceiling-icicles']) {
    if (!stats.roles.includes(role)) throw new Error(`missing visual role: ${role}`);
  }

  for (const view of ['wall', 'cave', 'interior']) {
    await page.evaluate((name) => window.__iceQa.render(name), view);
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(artifactDir, `${view}.png`) });
  }
  if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);
  await fs.writeFile(path.join(artifactDir, 'stats.json'), JSON.stringify(stats, null, 2));
  console.log(
    `Ice landmarks visual QA passed: ${stats.width.toFixed(1)}m wall span, ${stats.height.toFixed(1)}m height, ` +
    `${stats.blockers} blockers, canonical terrain relief ${stats.terrain.reliefSpan.toFixed(1)}m.`,
  );
} finally {
  await browser?.close();
  await server.stop();
}