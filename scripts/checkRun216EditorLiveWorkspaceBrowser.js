#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { createEditorLiveServer, scanModels } = require('./editorLiveServer.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run216-editor-live-workspace');
const assert = (value, message) => { if (!value) throw new Error(message); };

function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}

async function startServer() {
  const server = createEditorLiveServer({ root: ROOT });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function openEditor(browser, base, options) {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('body[data-editor-live-workspace="ready"]', { timeout: 120000 });
  await page.waitForFunction(() => Boolean(window.__WESTEROS_WORLD_EDITOR__?.getSnapshot && window.__WESTEROS_EDITOR_LIVE_WORKSPACE__?.getSnapshot));
  return { context, page, errors };
}

async function waitForGameFrame(page) {
  await page.waitForSelector('#we-live-game-preview');
  await page.waitForFunction(() => {
    const frame = document.getElementById('we-live-game-preview');
    return Boolean(frame?.contentDocument?.getElementById('game3d-loading'));
  }, null, { timeout: 120000 });
  const frame = page.frames().find((candidate) => candidate.url().includes('/game3d.html'));
  assert(frame, 'live game iframe bulunamadı');
  await frame.waitForSelector('#game3d-loading.g3d-loading-hidden', { timeout: 180000 });
  return frame;
}

async function desktopProof(browser, base, modelCount) {
  const opened = await openEditor(browser, base, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const { context, page, errors } = opened;
  try {
    const snapshot = await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_WORKSPACE__.getSnapshot());
    assert(snapshot.currentMode === 'live', `varsayılan görünüm live değil: ${snapshot.currentMode}`);
    assert(snapshot.catalogCount === modelCount, `tam model kataloğu drift: ${snapshot.catalogCount}/${modelCount}`);
    assert(await page.locator('.we-live-asset-row').count() === modelCount, 'asset DOM sayısı dosya sistemi kataloğuyla eşleşmiyor');
    assert(await page.locator('#we-asset-search').evaluate((node) => getComputedStyle(node).display) === 'none', 'asset arama filtresi gizlenmedi');
    assert(await page.locator('#we-asset-categories').evaluate((node) => getComputedStyle(node).display) === 'none', 'asset kategori filtresi gizlenmedi');
    assert(await page.locator('#we-save').textContent() === 'Koda Kaydet', 'save düğmesi yerel repo moduna geçmedi');
    await page.waitForFunction(() => document.querySelector('.we-live-save-state')?.dataset.connected === 'true');
    assert(await page.isVisible('#we-live-game-preview'), 'birebir game3d canlı görünümü görünmüyor');

    const frame = await waitForGameFrame(page);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'desktop-live-game-near.png'), fullPage: true });

    await frame.locator('#game3d-canvas').click({ position: { x: 320, y: 220 } });
    await page.keyboard.press('F4');
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(1700);
    await page.keyboard.up('KeyS');
    await page.keyboard.up('ShiftLeft');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, 'desktop-live-game-far.png'), fullPage: true });

    await page.click('[data-mode="edit"]');
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_LIVE_WORKSPACE__.getSnapshot().currentMode === 'edit');
    assert(await page.isVisible('#we-canvas'), 'edit canvas görünmüyor');
    await page.click('#we-create-formation');
    await page.waitForFunction(() => [...document.querySelectorAll('.we-hierarchy-item')].some((node) => node.textContent.includes('×500')), null, { timeout: 30000 });
    assert((await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_WORKSPACE__.getSnapshot())).selectedAssetId === null, 'tam katalog eski varsayılan formation seçimini bozdu');

    const firstAsset = page.locator('.we-live-asset-select').first();
    await firstAsset.click();
    assert((await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_WORKSPACE__.getSnapshot())).selectedAssetId !== null, 'workspace asset seçimi kurulmadı');
    await page.click('[data-mode="split"]');
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_LIVE_WORKSPACE__.getSnapshot().currentMode === 'split');
    assert(await page.isVisible('#we-live-game-preview') && await page.isVisible('#we-canvas'), 'split görünüm iki yüzeyi birlikte göstermiyor');
    await page.screenshot({ path: path.join(OUT, 'desktop-live-game-split.png'), fullPage: true });

    assert(errors.length === 0, `desktop console/page errors: ${errors.join(' | ')}`);
    return { modelCount, exactGameReady: true, defaultLive: true, legacyFormationPreserved: true, twoGameCameraViews: true };
  } finally {
    await context.close();
  }
}

async function mobileProof(browser, base, modelCount) {
  const opened = await openEditor(browser, base, { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const { context, page, errors } = opened;
  try {
    const snapshot = await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_WORKSPACE__.getSnapshot());
    assert(snapshot.currentMode === 'live', 'mobile varsayılan live görünüm değil');
    assert(snapshot.catalogCount === modelCount, 'mobile tam katalog sayısı drift');
    assert(await page.isVisible('#we-live-game-preview'), 'mobile live game görünmüyor');
    assert(await page.locator('[data-mode="split"]').evaluate((node) => getComputedStyle(node).display) === 'none', 'mobile split kontrolü gizlenmedi');
    assert(await page.locator('.we-live-asset-row').count() === modelCount, 'mobile asset kataloğu eksik');
    await waitForGameFrame(page);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'mobile-live-game.png'), fullPage: true });
    assert(errors.length === 0, `mobile console/page errors: ${errors.join(' | ')}`);
    return { modelCount, responsive: true, exactGameReady: true };
  } finally {
    await context.close();
  }
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  const models = scanModels(ROOT);
  assert(models.length > 7, `workspace model taraması beklenenden küçük: ${models.length}`);
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const desktop = await desktopProof(browser, base, models.length);
    const mobile = await mobileProof(browser, base, models.length);
    const proof = {
      desktop,
      mobile,
      visualEvidence: ['desktop-live-game-near.png', 'desktop-live-game-far.png', 'desktop-live-game-split.png', 'mobile-live-game.png'],
      consoleErrors: 0,
    };
    fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`[checkRun216EditorLiveWorkspaceBrowser] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun216EditorLiveWorkspaceBrowser] PASS: exact live game preview + two game camera views + full unfiltered model catalog + desktop/mobile + legacy formation regression + zero errors');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun216EditorLiveWorkspaceBrowser] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
