#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run228-editor-mixed-position-history');
const TARGET_POSITION = [-12.375, 1.25, 8.625];

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

  const readFirstObject = () => page.evaluate(() => {
    const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];
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

    const snapToggle = page.locator('#we-snap-toggle');
    if (await snapToggle.isChecked()) await snapToggle.uncheck();
    assert(!(await snapToggle.isChecked()), 'Position precision regression requires snap disabled');

    const treeButton = page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first();
    await treeButton.dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());

    const original = await readFirstObject();
    assert(original?.assetId === 'marker-tree', `Unexpected initial object: ${JSON.stringify(original)}`);
    assert(original.editorId, `Initial object missing editor id: ${JSON.stringify(original)}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-original-position.png'), fullPage: true });

    await page.evaluate((target) => {
      const ids = ['we-pos-x', 'we-pos-y', 'we-pos-z'];
      ids.forEach((id, index) => { document.getElementById(id).value = String(target[index]); });
      document.getElementById('we-pos-x').dispatchEvent(new Event('change', { bubbles: true }));
    }, TARGET_POSITION);
    await page.waitForFunction((target) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];
      return Boolean(object) && object.position.toArray().every((value, index) => Math.abs(value - target[index]) < 1e-9);
    }, TARGET_POSITION, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());

    const moved = await readFirstObject();
    assert(moved.position.every((value, index) => Math.abs(value - TARGET_POSITION[index]) < 1e-9), `Mixed-sign position was not applied exactly: ${JSON.stringify(moved.position)}`);
    assert(moved.position.some((value) => value < 0) && moved.position.some((value) => value > 0), `Regression did not exercise mixed-sign coordinates: ${JSON.stringify(moved.position)}`);
    assert(moved.editorId === original.editorId, `Position change altered editor id: ${JSON.stringify({ original, moved })}`);
    assert(JSON.stringify(moved.rotation) === JSON.stringify(original.rotation), `Position change altered rotation: ${JSON.stringify({ original, moved })}`);
    assert(JSON.stringify(moved.scale) === JSON.stringify(original.scale), `Position change altered scale: ${JSON.stringify({ original, moved })}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-mixed-position.png'), fullPage: true });

    await page.click('#we-undo');
    await page.waitForFunction((expected) => (
      window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1 &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].position.toArray().every((value, index) => Math.abs(value - expected[index]) < 1e-9)
    ), original.position, { timeout: 120000 });
    const afterUndo = await readFirstObject();
    const undoHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(JSON.stringify(afterUndo) === JSON.stringify(original), `Undo did not restore original object exactly: ${JSON.stringify({ original, afterUndo })}`);
    assert(undoHistory.redoDepth >= 1, `Undo did not create redo history: ${JSON.stringify(undoHistory)}`);

    await page.click('#we-redo');
    await page.waitForFunction((target) => (
      window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1 &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].position.toArray().every((value, index) => Math.abs(value - target[index]) < 1e-9)
    ), TARGET_POSITION, { timeout: 120000 });
    const afterRedo = await readFirstObject();
    const redoHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(JSON.stringify(afterRedo) === JSON.stringify(moved), `Redo did not restore mixed-sign position exactly: ${JSON.stringify({ moved, afterRedo })}`);

    const selectionAfterRestore = await page.locator('#we-selection-status').textContent();
    assert(selectionAfterRestore?.includes('yok'), `History restore unexpectedly retained selection contract: ${selectionAfterRestore}`);
    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    await page.waitForFunction((target) => {
      const ids = ['we-pos-x', 'we-pos-y', 'we-pos-z'];
      return ids.every((id, index) => Math.abs(Number(document.getElementById(id).value) - target[index]) < 1e-9);
    }, TARGET_POSITION, { timeout: 30000 });
    const inspectorPosition = await page.evaluate(() => [
      Number(document.getElementById('we-pos-x').value),
      Number(document.getElementById('we-pos-y').value),
      Number(document.getElementById('we-pos-z').value)
    ]);
    assert(inspectorPosition.every((value, index) => Math.abs(value - TARGET_POSITION[index]) < 1e-9), `Inspector lost mixed-sign position after re-selection: ${JSON.stringify(inspectorPosition)}`);

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (box && box.width > 240 && box.height > 180) {
      const startX = box.x + box.width * 0.58;
      const startY = box.y + box.height * 0.52;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 140, startY - 35, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(160);
    }
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-redo-reselected-orbit.png'), fullPage: true });

    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    console.log(`[checkRun228EditorMixedPositionHistory] PASS ${JSON.stringify({ originalPosition: original.position, targetPosition: TARGET_POSITION, afterUndo: afterUndo.position, afterRedo: afterRedo.position, inspectorPosition, undoHistory, redoHistory, screenshots: 3 })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun228EditorMixedPositionHistory] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
