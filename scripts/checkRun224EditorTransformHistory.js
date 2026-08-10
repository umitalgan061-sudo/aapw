#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run224-editor-transform-history');

function assert(value, message) {
  if (!value) throw new Error(message);
}

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
  assert(playwright, 'Playwright unavailable');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  const readSelected = () => page.evaluate(() => {
    const object = window.__WESTEROS_WORLD_EDITOR__.getSelectedObject?.();
    return object ? {
      assetId: object.userData?.editorAssetId,
      editorId: object.userData?.editorId,
      name: object.name,
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: object.scale.toArray()
    } : null;
  });

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__ &&
      window.__WESTEROS_EDITOR_HISTORY__ &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0
    ), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted === true, null, { timeout: 30000 });

    const treeButton = page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first();
    await treeButton.dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());

    const original = await readSelected();
    assert(original, 'Expected selected object after placement');
    assert(original.assetId === 'marker-tree', `Unexpected asset before transform: ${JSON.stringify(original)}`);
    assert(original.editorId, `Object missing deterministic editor id: ${JSON.stringify(original)}`);

    const targetScale = [0.05, 0.07, 0.09];
    await page.evaluate((values) => {
      const ids = ['we-scale-x', 'we-scale-y', 'we-scale-z'];
      ids.forEach((id, index) => {
        const input = document.getElementById(id);
        input.value = String(values[index]);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }, targetScale);
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());

    const transformed = await readSelected();
    assert(transformed, 'Selection disappeared after precise scale edit');
    assert(JSON.stringify(transformed.scale) === JSON.stringify(targetScale), `Precise inspector scale was not applied exactly: ${JSON.stringify({ targetScale, transformed })}`);
    assert(JSON.stringify(transformed.position) === JSON.stringify(original.position), `Scale edit moved object position: ${JSON.stringify({ original, transformed })}`);
    assert(JSON.stringify(transformed.rotation) === JSON.stringify(original.rotation), `Scale edit changed rotation: ${JSON.stringify({ original, transformed })}`);
    const afterTransformHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(afterTransformHistory.historyDepth >= 3, `Transform was not captured in history: ${JSON.stringify(afterTransformHistory)}`);

    await page.click('#we-undo');
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
    const afterUndo = await readSelected();
    const afterUndoHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(JSON.stringify(afterUndo) === JSON.stringify(original), `Undo did not restore exact pre-transform object state: ${JSON.stringify({ original, afterUndo })}`);
    assert(afterUndoHistory.redoDepth === 1, `Undo after transform did not create redo entry: ${JSON.stringify(afterUndoHistory)}`);

    await page.click('#we-redo');
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
    const afterRedo = await readSelected();
    const afterRedoHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(JSON.stringify(afterRedo) === JSON.stringify(transformed), `Redo did not restore exact transformed object state: ${JSON.stringify({ transformed, afterRedo })}`);
    assert(afterRedoHistory.redoDepth === 0, `Redo did not consume redo entry: ${JSON.stringify(afterRedoHistory)}`);

    const inspectorValues = await page.evaluate(() => ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => Number(document.getElementById(id).value)));
    assert(JSON.stringify(inspectorValues) === JSON.stringify(targetScale), `Inspector did not reflect exact redone scale: ${JSON.stringify({ targetScale, inspectorValues })}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'precise-scale-redo.png'), fullPage: true });
    console.log(`[checkRun224EditorTransformHistory] PASS ${JSON.stringify({ original, transformed, afterUndoHistory, afterRedoHistory, inspectorValues })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun224EditorTransformHistory] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});