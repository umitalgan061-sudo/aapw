#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run216-editor-live-authoring');
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
      res.writeHead(204);
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
      res.writeHead(404); res.end('Not found'); return;
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
  /*
  page.on('pageerror', (error) => errors.push(String(error));
  */
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_LIVE_WORLD__?.ready, null, { timeout: 120000 });
    await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_WORLD__.ready);
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_LIVE_AUTHORING__, null, { timeout: 120000 });
    await page.waitForTimeout(250);

    const before = await page.evaluate(() => ({
      authoring: window.__WESTEROS_EDITOR_LIVE_AUTHORING__.getSnapshot(),
      editableCount: window.__WESTEROS_WORLD_EDITOR__.editableObjects.length,
      badge: document.querySelector('.we-viewport-badge')?.textContent || '',
      target: window.__WESTEROS_EDITOR_LIVE_AUTHORING__.targetGroundPoint().toArray(),
    }));
    assert(before.authoring.liveSurfaceMeshCount > 0, 'No canonical terrain surface is exposed to authoring.');
    assert(before.authoring.syntheticGroundHidden === true, 'Synthetic ground is visible.');
    assert(before.authoring.groundRaycastPatched === true, 'Editor Ground raycast was not redirected to live terrain.');
    assert(before.authoring.editorMaxDistance >= 4000, `Editor camera range is too small: ${before.authoring.editorMaxDistance}`);
    assert(before.authoring.cameraFar > before.authoring.editorMaxDistance, 'Camera far plane does not cover editor travel range.');
    assert(before.badge.includes('LIVE WORLD'), `Viewport badge does not advertise live world: ${before.badge}`);
    assert(before.editableCount === 0, `Boot demo markers were not cleaned: ${before.editableCount}`);
    assert(Number.isFinite(before.target[1]), 'Canonical terrain target height is not finite.');

    const treeButton = page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first();
    await treeButton.dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    const placed = await page.evaluate(() => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const authoring = window.__WESTEROS_EDITOR_LIVE_AUTHORING__;
      const object = api.editableObjects[0];
      return {
        asset: object?.userData?.editorAssetId,
        position: object?.position?.toArray?.() || [],
        terrainY: object ? authoring.groundHeight(object.position.x, object.position.z) : NaN,
      };
    });
    assert(placed.asset === 'marker-tree', `Unexpected placed asset: ${placed.asset}`);
    assert(placed.position.length === 3 && placed.position.every(Number.isFinite), 'Placed asset position is not finite.');
    assert(placed.position[1] >= placed.terrainY, `Placed tree is below canonical terrain: objectY=${placed.position[1]} terrainY=${placed.terrainY}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-live-authoring.png'), fullPage: true });
    console.log(`[checkRun216EditorLiveWorldAuthoringBrowser] PROOF: before=${JSON.stringify(before)} placed=${JSON.stringify(placed)}`);
    console.log('[checkRun216EditorLiveWorldAuthoringBrowser] PASS: editor uses canonical terrain for working surface, removes synthetic demo markers, supports world-scale camera travel and places an asset on live terrain with zero browser errors.');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(`[checkRun216EditorLiveWorldAuthoringBrowser] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
