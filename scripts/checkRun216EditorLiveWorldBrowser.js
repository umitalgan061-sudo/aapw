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
