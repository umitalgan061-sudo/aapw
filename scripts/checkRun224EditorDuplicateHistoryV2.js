#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run224-editor-duplicate-history-v2');

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

async function waitHistoryIdle(page) {
  await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
}

async function selectFirstHierarchyObject(page) {
  const hierarchyItem = page.locator('#we-hierarchy .we-hierarchy-item').first();
  await hierarchyItem.waitFor({ state: 'visible', timeout: 30000 });
  await hierarchyItem.click();
  await page.waitForFunction(() => Boolean(window.__WESTEROS_WORLD_EDITOR__.getSelectedObject()), null, { timeout: 30000 });
}

async function snapshot(page) {
  return page.evaluate(() => ({
    objects: window.__WESTEROS_WORLD_EDITOR__.editableObjects.map((object) => ({
      assetId: object.userData?.editorAssetId,
      editorId: object.userData?.editorId,
      x: object.position.x,
      name: object.name
    })),
    history: window.__WESTEROS_EDITOR_HISTORY__.getSnapshot(),
    clipboard: window.__WESTEROS_EDITOR_CLIPBOARD__.getClipboard()
  }));
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
      window.__WESTEROS_EDITOR_CLIPBOARD__ &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0
    ), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted === true, null, { timeout: 30000 });

    const duplicateButton = page.locator('#we-duplicate');
    const pasteButton = page.locator('#we-paste');
    assert(await pasteButton.isDisabled(), 'Paste button should start disabled before any copy action');

    const treeButton = page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first();
    await treeButton.dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());
    assert(!(await duplicateButton.isDisabled()), 'Duplicate button is not available for an editable selected object');
    assert(await pasteButton.isDisabled(), 'Duplicate readiness should not implicitly populate clipboard');

    await duplicateButton.click();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 2, null, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());

    const afterButtonDuplicate = await snapshot(page);
    assert(afterButtonDuplicate.objects.length === 2, `Duplicate button did not create a second object: ${JSON.stringify(afterButtonDuplicate)}`);
    assert(afterButtonDuplicate.objects[1].assetId === 'marker-tree', `Duplicate changed asset identity: ${JSON.stringify(afterButtonDuplicate)}`);
    assert(/-duplicate-\d{4}$/.test(afterButtonDuplicate.objects[1].editorId || ''), `Duplicate id is not deterministic/generated: ${JSON.stringify(afterButtonDuplicate)}`);
    assert(afterButtonDuplicate.objects[1].x > afterButtonDuplicate.objects[0].x, `Duplicate did not apply positive X offset: ${JSON.stringify(afterButtonDuplicate)}`);
    assert(afterButtonDuplicate.clipboard === null, `Duplicate button unexpectedly populated clipboard: ${JSON.stringify(afterButtonDuplicate.clipboard)}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'duplicate-button-created.png'), fullPage: true });

    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 120000 });
    await waitHistoryIdle(page);
    await selectFirstHierarchyObject(page);
    assert(!(await duplicateButton.isDisabled()), 'Duplicate button stayed disabled after reselecting the surviving object post-undo');

    await page.keyboard.press('Control+d');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 2, null, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());

    const afterKeyboardDuplicate = await snapshot(page);
    assert(JSON.stringify(afterKeyboardDuplicate.objects) === JSON.stringify(afterButtonDuplicate.objects), `Ctrl+D did not reproduce button duplicate deterministically: ${JSON.stringify({ afterButtonDuplicate, afterKeyboardDuplicate })}`);
    assert(afterKeyboardDuplicate.clipboard === null, `Ctrl+D unexpectedly populated clipboard: ${JSON.stringify(afterKeyboardDuplicate.clipboard)}`);

    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 120000 });
    await waitHistoryIdle(page);
    const afterUndo = await snapshot(page);
    assert(afterUndo.history.redoDepth === 1, `Undo after Ctrl+D did not create exactly one redo entry: ${JSON.stringify(afterUndo.history)}`);

    await page.keyboard.press('Control+y');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 2, null, { timeout: 120000 });
    await waitHistoryIdle(page);
    const afterRedo = await snapshot(page);
    assert(JSON.stringify(afterRedo.objects) === JSON.stringify(afterButtonDuplicate.objects), `Redo did not restore duplicate exactly: ${JSON.stringify({ afterButtonDuplicate, afterRedo })}`);
    assert(afterRedo.history.redoDepth === 0, `Redo did not consume redo stack: ${JSON.stringify(afterRedo.history)}`);
    assert(afterRedo.clipboard === null, `Duplicate/history flow unexpectedly populated clipboard: ${JSON.stringify(afterRedo.clipboard)}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'duplicate-keyboard-redo-restored.png'), fullPage: true });
    console.log(`[checkRun224EditorDuplicateHistoryV2] PASS ${JSON.stringify({ afterButtonDuplicate, afterKeyboardDuplicate, afterUndo, afterRedo })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun224EditorDuplicateHistoryV2] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
