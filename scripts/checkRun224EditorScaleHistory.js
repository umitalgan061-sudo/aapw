#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run224-editor-scale-history');
const PRECISE_SCALE = 0.007;

function assert(value, message) { if (!value) throw new Error(message); }
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
  if (ext === '.glb') return 'model/gltf-binary';
  return 'application/octet-stream';
}
function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    const directoryIndex = path.join(file, 'index.html');
    if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isDirectory() && fs.existsSync(directoryIndex)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(directoryIndex).pipe(res); return;
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
  assert(playwright, 'Playwright unavailable');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  const readObject = () => page.evaluate(() => {
    const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];
    return object ? {
      assetId: object.userData?.editorAssetId,
      editorId: object.userData?.editorId,
      name: object.name,
      scale: object.scale.toArray(),
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z]
    } : null;
  });

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_HISTORY__ && window.__WESTEROS_EDITOR_SCALE_INPUT__ && window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted === true, null, { timeout: 30000 });

    await page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first().dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());

    const original = await readObject();
    assert(original?.assetId === 'marker-tree', `Unexpected initial object: ${JSON.stringify(original)}`);
    assert(original.scale.every((value) => Math.abs(value - 1) < 1e-9), `Unexpected initial scale: ${JSON.stringify(original.scale)}`);

    const scaleX = page.locator('#we-scale-x');
    await scaleX.fill(String(PRECISE_SCALE));
    await scaleX.dispatchEvent('change');
    await page.waitForFunction((expected) => Math.abs(window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].scale.x - expected) < 1e-9, PRECISE_SCALE, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());

    const scaled = await readObject();
    assert(Math.abs(scaled.scale[0] - PRECISE_SCALE) < 1e-9, `Precise scale was not applied: ${JSON.stringify(scaled)}`);
    assert(scaled.scale[0] < 0.01, `Regression did not exercise sub-0.01 precision: ${scaled.scale[0]}`);
    assert(scaled.editorId === original.editorId, `Scale change altered editor id: ${JSON.stringify({ original, scaled })}`);

    await page.click('#we-undo');
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false && window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 120000 });
    const afterUndo = await readObject();
    const undoHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(JSON.stringify(afterUndo) === JSON.stringify(original), `Undo did not restore original transform exactly: ${JSON.stringify({ original, afterUndo })}`);
    assert(undoHistory.redoDepth === 1, `Undo did not create redo entry: ${JSON.stringify(undoHistory)}`);

    await page.click('#we-redo');
    await page.waitForFunction((expected) => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false && Math.abs(window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].scale.x - expected) < 1e-9, PRECISE_SCALE, { timeout: 120000 });
    const afterRedo = await readObject();
    const redoHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(JSON.stringify(afterRedo) === JSON.stringify(scaled), `Redo did not restore precise sub-0.01 scale exactly: ${JSON.stringify({ scaled, afterRedo })}`);
    assert(redoHistory.redoDepth === 0, `Redo did not consume redo entry: ${JSON.stringify(redoHistory)}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'precise-scale-redo-restored.png'), fullPage: true });
    console.log(`[checkRun224EditorScaleHistory] PASS ${JSON.stringify({ original, scaled, undoHistory, redoHistory })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun224EditorScaleHistory] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
