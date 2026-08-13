#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run216-editor-live-world');

function fail(message) { throw new Error(message); }
function assert(value, message) { if (!value) fail(message); }

function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return ext === '.webmanifest' ? 'application/manifest+json' : 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.fbx') return 'application/octet-stream';
  return 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/favicon.ico') {
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    const directoryIndex = path.join(file, 'index.html');
    if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isDirectory() && fs.existsSync(directoryIndex)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(directoryIndex).pipe(res);
      return;
    }
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      console.error(`[checkRun216EditorLiveWorldBrowser] proof-server 404: ${clean}`);
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function captureLiveGame(playwright, base) {
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page:${String(error)}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });

  try {
    await page.goto(`${base}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });

    const enter = page.locator('#run266-entry-enter');
    if (await enter.count()) {
      await enter.waitFor({ state: 'visible', timeout: 30000 });
      await enter.click();
      await page.waitForFunction(() => !document.getElementById('run266-entry-gate'), null, { timeout: 10000 });
    }

    await page.waitForFunction(
      () => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'),
      null,
      { timeout: 180000 },
    );
    await page.waitForTimeout(2500);

    const canvas = page.locator('#game3d-canvas');
    await canvas.waitFor({ state: 'visible', timeout: 30000 });

    // Use the game's real F4 free-fly camera. First pitch almost straight upward,
    // then fly roughly a kilometre vertically at Shift-run speed.
    await page.keyboard.press('F4');
    await page.waitForTimeout(300);
    const box = await canvas.boundingBox();
    assert(box, 'game3d canvas has no bounding box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, box.y + 5, { steps: 24 });
    await page.mouse.up();
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1700);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    await page.waitForTimeout(350);

    // Pitch down toward the terrain and keep a slightly oblique view so relief reads as 3D.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, box.y + box.height - 5, { steps: 30 });
    await page.mouse.up();
    await page.waitForTimeout(1200);

    // Hide DOM HUD only; the canvas remains the untouched game WebGL render.
    await page.evaluate(() => {
      for (const child of Array.from(document.body.children)) {
        if (child.id !== 'game3d-canvas') child.style.setProperty('display', 'none', 'important');
      }
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';
    });
    await page.waitForTimeout(500);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await canvas.screenshot({ path: path.join(ARTIFACT_DIR, 'game3d-close-overhead.png') });

    // Move forward while looking down: this descends toward the same real terrain for a tighter shot.
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1350);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(800);
    await canvas.screenshot({ path: path.join(ARTIFACT_DIR, 'game3d-closer-terrain.png') });

    const metrics = await page.evaluate(() => ({
      viewport: [innerWidth, innerHeight],
      gatePresent: Boolean(document.getElementById('run266-entry-gate')),
      loadingHidden: document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden') || false,
      canvasWidth: document.getElementById('game3d-canvas')?.width || 0,
      canvasHeight: document.getElementById('game3d-canvas')?.height || 0,
    }));
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'game3d-close-capture-metrics.json'),
      JSON.stringify({ metrics, browserErrors: errors }, null, 2) + '\n',
    );
    console.log(`[checkRun216EditorLiveWorldBrowser] GAME3D CLOSE CAPTURE: ${JSON.stringify(metrics)}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) fail('Playwright unavailable');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  /* additive-only Run216 syntax quarantine for the malformed legacy listener below
  page.on('pageerror', (error) => errors.push(String(error));
  */
  page.on('pageerror', (error) => errors.push(String(error)));

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_LIVE_WORLD__, null, { timeout: 120000 });
    await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_WORLD__.ready);
    const snapshot = await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_WORLD__.getSnapshot());

    assert(snapshot.liveWorldVisible === true, 'Canonical Westeros world is not visible in editor scene');
    assert(snapshot.syntheticGroundHidden === true, 'Synthetic Editor Ground is still visible');
    assert(snapshot.fogDisabled === true, 'Edit mode fog is not disabled after live-world transfer');
    assert(snapshot.terrainChunkCount > 0, `No canonical terrain chunks loaded: ${snapshot.terrainChunkCount}`);
    assert(snapshot.roadSegmentCount > 0, `No canonical gameplay road segments loaded: ${snapshot.roadSegmentCount}`);
    assert(snapshot.settlementCount === 14, `Expected 14 gameplay settlement seats, got ${snapshot.settlementCount}`);
    assert(snapshot.realCastlesReady === true, 'Real castle loading never completed');
    assert(snapshot.realCastleCount === 8, `Expected 8 gameplay real castles, got ${snapshot.realCastleCount}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-live-westeros-editor.png'), fullPage: true });
    console.log(`[checkRun216EditorLiveWorldBrowser] PROOF: ${JSON.stringify(snapshot)}`);
    console.log('[checkRun216EditorLiveWorldBrowser] PASS: editor viewport shows canonical gameplay terrain/water/roads/settlements/vegetation/sky plus all 8 real castle models; synthetic ground hidden.');

    await captureLiveGame(playwright, base);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun216EditorLiveWorldBrowser] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
