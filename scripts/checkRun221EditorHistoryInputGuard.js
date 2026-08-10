#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run221-editor-history-input-guard');

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

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__ &&
      window.__WESTEROS_EDITOR_HISTORY__ &&
      window.__WESTEROS_EDITOR_LIVE_AUTHORING__ &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0
    ), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted === true, null, { timeout: 30000 });

    const treeButton = page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first();
    await treeButton.dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());
    const beforeGuard = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(beforeGuard.historyDepth >= 2, `Creation history missing: ${JSON.stringify(beforeGuard)}`);

    const nameInput = page.locator('#we-name');
    await nameInput.focus();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    const guarded = await page.evaluate(() => ({
      count: window.__WESTEROS_WORLD_EDITOR__.editableObjects.length,
      history: window.__WESTEROS_EDITOR_HISTORY__.getSnapshot(),
      activeId: document.activeElement?.id || ''
    }));
    assert(guarded.activeId === 'we-name', `Inspector input lost focus during typing guard: ${JSON.stringify(guarded)}`);
    assert(guarded.count === 1, `Ctrl+Z inside inspector input incorrectly undid scene: ${JSON.stringify(guarded)}`);
    assert(guarded.history.redoDepth === 0, `Ctrl+Z inside inspector input mutated redo stack: ${JSON.stringify(guarded)}`);

    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
    const afterUndo = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(afterUndo.redoDepth === 1, `Scene undo did not populate redo stack: ${JSON.stringify(afterUndo)}`);

    await page.keyboard.press('Control+y');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
    const restored = await page.evaluate(() => ({
      assetId: window.__WESTEROS_WORLD_EDITOR__.editableObjects[0]?.userData?.editorAssetId,
      history: window.__WESTEROS_EDITOR_HISTORY__.getSnapshot()
    }));
    assert(restored.assetId === 'marker-tree', `Ctrl+Y restored wrong asset: ${restored.assetId}`);
    assert(restored.history.redoDepth === 0, `Ctrl+Y did not consume redo stack: ${JSON.stringify(restored.history)}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'input-guard-ctrl-y-restored.png'), fullPage: true });
    console.log(`[checkRun221EditorHistoryInputGuard] PASS ${JSON.stringify({ beforeGuard, guarded, afterUndo, restored })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun221EditorHistoryInputGuard] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
