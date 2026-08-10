#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run223-editor-delete-history');

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

  const readObjects = () => page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.map((object) => ({
    assetId: object.userData?.editorAssetId,
    editorId: object.userData?.editorId,
    name: object.name,
    position: object.position.toArray(),
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: object.scale.toArray()
  })));

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

    const original = await readObjects();
    assert(original.length === 1, `Expected one object before delete: ${JSON.stringify(original)}`);
    assert(original[0].assetId === 'marker-tree', `Unexpected asset before delete: ${JSON.stringify(original[0])}`);
    assert(original[0].editorId, `Object missing deterministic editor id: ${JSON.stringify(original[0])}`);

    await page.click('#we-delete');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0, null, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());
    const afterDelete = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(afterDelete.historyDepth >= 3, `Delete was not captured in history: ${JSON.stringify(afterDelete)}`);
    assert(afterDelete.redoDepth === 0, `Delete unexpectedly populated redo stack: ${JSON.stringify(afterDelete)}`);

    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
    const afterUndoObjects = await readObjects();
    const afterUndoHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(JSON.stringify(afterUndoObjects) === JSON.stringify(original), `Undo did not restore deleted object exactly: ${JSON.stringify({ original, afterUndoObjects })}`);
    assert(afterUndoHistory.redoDepth === 1, `Undo after delete did not create redo entry: ${JSON.stringify(afterUndoHistory)}`);

    await page.click('#we-redo');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
    const afterRedo = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(afterRedo.redoDepth === 0, `Redo after delete did not consume redo entry: ${JSON.stringify(afterRedo)}`);

    await page.click('#we-undo');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
    const finalObjects = await readObjects();
    assert(JSON.stringify(finalObjects) === JSON.stringify(original), `Second undo did not restore exact object state: ${JSON.stringify({ original, finalObjects })}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'delete-undo-restored.png'), fullPage: true });
    const finalHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    console.log(`[checkRun223EditorDeleteHistory] PASS ${JSON.stringify({ original, afterDelete, afterUndoHistory, afterRedo, finalHistory })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun223EditorDeleteHistory] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
