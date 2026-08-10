#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run227-editor-nonuniform-scale-history');
const TARGETS = [
  [0.007, 1, 1],
  [0.007, 0.125, 1],
  [0.007, 0.125, 0.75]
];

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

function sameScale(actual, expected) {
  return actual.length === 3 && actual.every((value, index) => Math.abs(value - expected[index]) < 1e-9);
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

  const waitForScale = (expected) => page.waitForFunction((target) => {
    const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];
    return Boolean(object) && object.scale.toArray().every((value, index) => Math.abs(value - target[index]) < 1e-9);
  }, expected, { timeout: 30000 });

  async function changeAxis(inputId, value, expected) {
    const input = page.locator(inputId);
    await input.fill(String(value));
    await input.dispatchEvent('change');
    await waitForScale(expected);
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());
    const state = await readFirstObject();
    assert(sameScale(state.scale, expected), `Inspector change did not produce expected scale ${JSON.stringify(expected)}: ${JSON.stringify(state)}`);
    return state;
  }

  async function traverseHistory(buttonSelector, expected, label) {
    const visited = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const button = page.locator(buttonSelector);
      assert(!(await button.isDisabled()), `${label} became disabled before reaching ${JSON.stringify(expected)}; visited=${JSON.stringify(visited)}`);
      await button.click();
      await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
      await page.waitForTimeout(120);
      const state = await readFirstObject();
      visited.push(state.scale);
      if (sameScale(state.scale, expected)) return { state, visited };
    }
    throw new Error(`${label} did not reach ${JSON.stringify(expected)}; visited=${JSON.stringify(visited)}`);
  }

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__ &&
      window.__WESTEROS_EDITOR_HISTORY__ &&
      window.__WESTEROS_EDITOR_SCALE_INPUT__ &&
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
    assert(sameScale(original.scale, [1, 1, 1]), `Unexpected initial scale: ${JSON.stringify(original.scale)}`);

    const step1 = await changeAxis('#we-scale-x', TARGETS[0][0], TARGETS[0]);
    const step2 = await changeAxis('#we-scale-y', TARGETS[1][1], TARGETS[1]);
    const final = await changeAxis('#we-scale-z', TARGETS[2][2], TARGETS[2]);

    for (const state of [step1, step2, final]) {
      assert(state.editorId === original.editorId, `Scale history changed editor id: ${JSON.stringify({ original, state })}`);
      assert(JSON.stringify(state.position) === JSON.stringify(original.position), `Scale history changed position: ${JSON.stringify({ original, state })}`);
      assert(JSON.stringify(state.rotation) === JSON.stringify(original.rotation), `Scale history changed rotation: ${JSON.stringify({ original, state })}`);
    }
    assert(final.scale[0] < final.scale[1] && final.scale[1] < final.scale[2], `Final scale is not intentionally non-uniform: ${JSON.stringify(final.scale)}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-final-nonuniform-scale.png'), fullPage: true });

    const undoStep2 = await traverseHistory('#we-undo', TARGETS[1], 'Undo');
    assert(JSON.stringify(undoStep2.state) === JSON.stringify(step2), `Undo did not restore step2 exactly: ${JSON.stringify({ step2, actual: undoStep2.state })}`);
    const undoStep1 = await traverseHistory('#we-undo', TARGETS[0], 'Undo');
    assert(JSON.stringify(undoStep1.state) === JSON.stringify(step1), `Undo did not restore step1 exactly: ${JSON.stringify({ step1, actual: undoStep1.state })}`);
    const undoOriginal = await traverseHistory('#we-undo', [1, 1, 1], 'Undo');
    assert(JSON.stringify(undoOriginal.state) === JSON.stringify(original), `Undo did not restore original exactly: ${JSON.stringify({ original, actual: undoOriginal.state })}`);

    const redoStep1 = await traverseHistory('#we-redo', TARGETS[0], 'Redo');
    assert(JSON.stringify(redoStep1.state) === JSON.stringify(step1), `Redo did not restore step1 exactly: ${JSON.stringify({ step1, actual: redoStep1.state })}`);
    const redoStep2 = await traverseHistory('#we-redo', TARGETS[1], 'Redo');
    assert(JSON.stringify(redoStep2.state) === JSON.stringify(step2), `Redo did not restore step2 exactly: ${JSON.stringify({ step2, actual: redoStep2.state })}`);
    const redoFinal = await traverseHistory('#we-redo', TARGETS[2], 'Redo');
    assert(JSON.stringify(redoFinal.state) === JSON.stringify(final), `Redo did not restore final non-uniform scale exactly: ${JSON.stringify({ final, actual: redoFinal.state })}`);

    const redoHistory = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(redoHistory.redoDepth === 0, `Redo did not consume redo history: ${JSON.stringify(redoHistory)}`);
    const selectionAfterRestore = await page.locator('#we-selection-status').textContent();
    assert(selectionAfterRestore?.includes('yok'), `History restore unexpectedly retained selection contract: ${selectionAfterRestore}`);

    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    await page.waitForFunction((target) => ['x', 'y', 'z'].every((axis, index) => (
      Math.abs(Number(document.getElementById(`we-scale-${axis}`).value) - target[index]) < 1e-9
    )), TARGETS[2], { timeout: 30000 });
    const inspectorScale = await page.evaluate(() => ['x', 'y', 'z'].map((axis) => Number(document.getElementById(`we-scale-${axis}`).value)));
    assert(sameScale(inspectorScale, TARGETS[2]), `Inspector lost final non-uniform scale after re-selection: ${JSON.stringify(inspectorScale)}`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-redo-reselected-nonuniform-scale.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(160);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-mobile-final-nonuniform-scale.png'), fullPage: true });

    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    console.log(`[checkRun227EditorNonUniformScaleHistory] PASS ${JSON.stringify({ original, step1, step2, final, redoHistory, selectionAfterRestore, inspectorScale, undoVisited: [undoStep2.visited, undoStep1.visited, undoOriginal.visited], redoVisited: [redoStep1.visited, redoStep2.visited, redoFinal.visited], screenshots: 3 })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun227EditorNonUniformScaleHistory] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
