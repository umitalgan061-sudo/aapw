#!/usr/bin/env node
/**
 * Focused shipped-runtime acceptance for regional village architecture.
 *
 * The full smoke suite intentionally waits for the document `load` event and currently exposes a
 * navigation-budget failure on this branch. This check does not replace that gate: it isolates the
 * settlement slice by booting the real game page, waiting for GAME_READY, and proving that at least
 * one of the seven configured village GLBs is actually requested successfully with no page errors.
 * It exists so a generic navigation timeout cannot hide whether the settlement runtime itself works.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const NAV_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 90_000;
const VILLAGE_ASSET_RE = /\/assets\/models\/settlements\/(?:log_cabin_et0OmFeZVkb|fantasy_house_dcPho4SUA3|cabin_shed_HTx7PZt6Zm|house_fdaqERLQCc|medium_house_4hI5fNvl6z|small_wooden_house|house_roqiHdrpgc)\.glb(?:\?|$)/;

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright unavailable');

  const server = await startStaticServer();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const requestedAssets = new Set();
  const successfulAssets = new Set();
  const failedAssets = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    if (VILLAGE_ASSET_RE.test(request.url())) requestedAssets.add(request.url());
  });
  page.on('response', (response) => {
    if (!VILLAGE_ASSET_RE.test(response.url())) return;
    if (response.ok()) successfulAssets.add(response.url());
    else failedAssets.push(`${response.status()} ${response.url()}`);
  });

  try {
    await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForFunction(() => {
      const loading = document.getElementById('game3d-loading');
      return loading && (loading.classList.contains('g3d-loading-hidden') || loading.classList.contains('g3d-loading-error'));
    }, { timeout: READY_TIMEOUT_MS, polling: 250 });

    const loadingState = await page.evaluate(() => {
      const loading = document.getElementById('game3d-loading');
      if (!loading) return 'missing';
      if (loading.classList.contains('g3d-loading-error')) return 'error';
      if (loading.classList.contains('g3d-loading-hidden')) return 'ready';
      return 'pending';
    });

    // Architecture upgrades are scheduled after the procedural village group attaches. Give the
    // asset loader a bounded window to issue at least one configured GLB request.
    const deadline = Date.now() + 30_000;
    while (requestedAssets.size === 0 && Date.now() < deadline) await page.waitForTimeout(250);
    await page.waitForTimeout(500);

    const failures = [];
    if (loadingState !== 'ready') failures.push(`GAME_READY state=${loadingState}`);
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`);
    if (requestedAssets.size === 0) failures.push('no configured village GLB request observed');
    if (successfulAssets.size === 0) failures.push('no configured village GLB response succeeded');
    if (failedAssets.length) failures.push(`failed village GLBs: ${failedAssets.join(' | ')}`);

    if (failures.length) {
      console.error(`[checkVillageArchitectureNavigationBrowser] FAIL: ${failures.join('; ')}`);
      if (consoleErrors.length) console.error(`[checkVillageArchitectureNavigationBrowser] console errors: ${consoleErrors.slice(-10).join(' | ')}`);
      process.exitCode = 1;
    } else {
      console.log(`[checkVillageArchitectureNavigationBrowser] PASS: shipped game3d GAME_READY; village GLBs requested=${requestedAssets.size}, successful=${successfulAssets.size}, pageErrors=0`);
    }
  } finally {
    await page.close();
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error('[checkVillageArchitectureNavigationBrowser] FAIL:', error);
  process.exit(1);
});
