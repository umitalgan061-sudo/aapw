#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run226-editor-signed-rotation-history-v2');
const PRECISE_DEGREES = -179.9;
const LIVE_RADIANS = PRECISE_DEGREES * Math.PI / 180;
const SERIALIZED_RADIANS = Number(LIVE_RADIANS.toFixed(6));

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

    const treeButton = page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first();
    await treeButton.dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());

    const original = await readFirstObject();
    assert(original?.assetId === 'marker-tree', `Unexpected initial object: ${JSON.stringify(original)}`);
    assert(original.editorId, `Initial object missing editor id: ${JSON.stringify(original)}`);
    assert(original.rotation.every((value) => Math.abs(value) < 1e-12), `Unexpected initial rotation: ${JSON.stringify(original.rotation)}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-original-rotation.png'), fullPage: true });

    const rotationY = page.locator('#we-rot-y');
    await rotationY.fill(String(PRECISE_DEGREES));
    await rotationY.dispatchEvent('change');
    await page.waitForFunction((expected) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];
      return Boolean(object) && Math.abs(object.rotation.y - expected) < 1e-12;
    }, LIVE_RADIANS, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());

    const rotated = await readFirstObject();
    assert(Math.abs(rotated.rotation[1] - LIVE_RADIANS) < 1e-12, `Signed near-boundary rotation was not applied exactly in live state: ${JSON.stringify(rotated)}`);
    assert(Math.abs(rotated.rotation[0]) < 1e-12 && Math.abs(rotated.rotation[2]) < 1e-12, `Unedited rotation axes drifted: ${JSON.stringify(rotated.rotation)}`);
    assert(rotated.editorId === original.editorId, `Rotation change altered editor id: ${JSON.stringify({ original, rotated })}`);
    assert(JSON.stringify(rotated.position) === JSON.stringify(original.position), `Rotation change altered position: ${JSON.stringify({ original, rotated })}`);
    assert(JSON.stringify(rotated.scale) === JSON.stringify(original.scale), `Rotation change altered scale: ${JSON.stringify({ original, rotated })}`);
    assert(await rotationY.inputValue() === '-179.9', `Inspector did not preserve signed decimal degree input: ${await rotationY.inputValue()}`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-signed-rotation.png'), fullPage: true });

    await page.click('#we-undo');
    await page.waitForFunction(() => (
      window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1 &&
      Math.abs(window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].rotation.y) < 1e-12
    ), null, { timeout: 120000 });
    const afterUndo = await readFirstObject();
    const undoHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(JSON.stringify(afterUndo) === JSON.stringify(original), `Undo did not restore original object exactly: ${JSON.stringify({ original, afterUndo })}`);
    assert(undoHistory.redoDepth === 1, `Undo did not create exactly one redo entry: ${JSON.stringify(undoHistory)}`);

    await page.click('#we-redo');
    await page.waitForFunction((expected) => (
      window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1 &&
      Math.abs(window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].rotation.y - expected) < 1e-12
    ), SERIALIZED_RADIANS, { timeout: 120000 });
    const afterRedo = await readFirstObject();
    const redoHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(Math.abs(afterRedo.rotation[1] - SERIALIZED_RADIANS) < 1e-12, `Redo did not restore serializer-normalized rotation: ${JSON.stringify(afterRedo)}`);
    assert(afterRedo.editorId === original.editorId, `Redo altered editor id: ${JSON.stringify({ original, afterRedo })}`);
    assert(JSON.stringify(afterRedo.position) === JSON.stringify(original.position), `Redo altered position: ${JSON.stringify({ original, afterRedo })}`);
    assert(JSON.stringify(afterRedo.scale) === JSON.stringify(original.scale), `Redo altered scale: ${JSON.stringify({ original, afterRedo })}`);
    assert(Math.abs(afterRedo.rotation[0]) < 1e-12 && Math.abs(afterRedo.rotation[2]) < 1e-12, `Redo drifted unedited rotation axes: ${JSON.stringify(afterRedo.rotation)}`);
    assert(redoHistory.redoDepth === 0, `Redo did not consume redo entry: ${JSON.stringify(redoHistory)}`);

    const restoredDegrees = afterRedo.rotation[1] * 180 / Math.PI;
    assert(Math.abs(restoredDegrees - PRECISE_DEGREES) < 0.0001, `Serializer normalization changed user-visible degree value: ${restoredDegrees}`);

    const selectionAfterRestore = await page.locator('#we-selection-status').textContent();
    assert(selectionAfterRestore?.includes('yok'), `History restore unexpectedly retained selection contract: ${selectionAfterRestore}`);
    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    await page.waitForFunction((expected) => Math.abs(Number(document.getElementById('we-rot-y').value) - expected) < 1e-9, PRECISE_DEGREES, { timeout: 30000 });
    const inspectorAfterReselect = Number(await page.locator('#we-rot-y').inputValue());
    assert(Math.abs(inspectorAfterReselect - PRECISE_DEGREES) < 1e-9, `Inspector lost signed decimal rotation after explicit re-selection: ${inspectorAfterReselect}`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-redo-reselected-rotation.png'), fullPage: true });
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    console.log(`[checkRun226EditorSignedRotationHistoryV2] PASS ${JSON.stringify({ original, rotated, afterRedo, liveRadians: LIVE_RADIANS, serializedRadians: SERIALIZED_RADIANS, restoredDegrees, undoHistory, redoHistory, selectionAfterRestore, inspectorAfterReselect, screenshots: 3 })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun226EditorSignedRotationHistoryV2] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
