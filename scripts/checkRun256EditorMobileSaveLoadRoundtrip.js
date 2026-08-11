#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run256-editor-mobile-save-load-roundtrip');

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
  if (ext === '.gltf') return 'model/gltf+json';
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
function sceneData(object, editor) {
  return {
    schemaVersion: 1,
    world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' },
    editor,
    objects: [object],
    instanceGroups: []
  };
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const sourceObject = {
    id: 'run256-source-tree-0001',
    name: 'Run256 Saved Roundtrip Tree',
    asset: 'marker-tree',
    transform: {
      position: [-18.375, 0.125, 27.625],
      rotation: [0.625, -1.375, 2.125],
      scale: [0.007, 1.875, 0.625]
    }
  };
  const replacementObject = {
    id: 'run256-replacement-tree-0001',
    name: 'Run256 Temporary Replacement Tree',
    asset: 'marker-tree',
    transform: {
      position: [8.125, 1.875, -12.375],
      rotation: [-0.5, 0.75, -2.25],
      scale: [1.5, 0.5, 2.25]
    }
  };
  const sourceEditor = { gridVisible: false, snapEnabled: true, snapSize: 2.5 };
  const replacementEditor = { gridVisible: false, snapEnabled: false, snapSize: 1.25 };
  const sourcePath = path.join(ARTIFACT_DIR, 'roundtrip-source.scene.json');
  const replacementPath = path.join(ARTIFACT_DIR, 'roundtrip-replacement.scene.json');
  const downloadedPath = path.join(ARTIFACT_DIR, 'actual-downloaded-westeros-world.scene.json');
  fs.writeFileSync(sourcePath, JSON.stringify(sceneData(sourceObject, sourceEditor), null, 2));
  fs.writeFileSync(replacementPath, JSON.stringify(sceneData(replacementObject, replacementEditor), null, 2));

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    acceptDownloads: true
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  const capture = () => page.evaluate(() => {
    const round = (value) => Number(value.toFixed(6));
    const object = window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.[0];
    const gridToggle = document.getElementById('we-grid-toggle');
    return {
      object: object ? {
        id: object.userData.editorId,
        name: object.name,
        asset: object.userData.editorAssetId,
        transform: {
          position: object.position.toArray().map(round),
          rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(round),
          scale: object.scale.toArray().map(round)
        }
      } : null,
      objectCount: window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length,
      hierarchyText: document.getElementById('we-hierarchy').textContent,
      selection: document.getElementById('we-selection-status').textContent,
      snapEnabled: document.getElementById('we-snap-toggle').checked,
      snapSize: Number(document.getElementById('we-snap-size').value),
      gridChecked: gridToggle.checked,
      gridDisabled: gridToggle.disabled,
      gridVisible: window.__WESTEROS_WORLD_EDITOR__.grid.visible,
      toast: document.getElementById('we-toast').textContent,
      loadInputValue: document.getElementById('we-load-file').value,
      maxTouchPoints: navigator.maxTouchPoints,
      viewport: [window.innerWidth, window.innerHeight],
      history: window.__WESTEROS_EDITOR_HISTORY__?.getSnapshot?.()
    };
  });

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_HISTORY__, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted === true, null, { timeout: 30000 });

    const initial = await capture();
    assert(initial.maxTouchPoints > 0, `Touch context was not active: ${JSON.stringify(initial)}`);
    assert(initial.viewport[0] === 390 && initial.viewport[1] === 844, `Mobile viewport drifted: ${JSON.stringify(initial.viewport)}`);

    await page.locator('#we-snap-toggle').check();
    await page.locator('#we-snap-size').fill('4.25');
    await page.locator('#we-snap-size').dispatchEvent('change');
    await page.locator('#we-load-file').setInputFiles(sourcePath);
    await page.waitForFunction(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.[0];
      return window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 1 &&
        object?.userData?.editorId === 'run256-source-tree-0001' &&
        document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.' &&
        Number(document.getElementById('we-snap-size')?.value) === 2.5;
    }, null, { timeout: 120000 });
    const sourceLoaded = await capture();
    assert(JSON.stringify(sourceLoaded.object) === JSON.stringify(sourceObject), `Source scene drifted before save: ${JSON.stringify({ sourceObject, actual: sourceLoaded.object })}`);
    assert(sourceLoaded.snapEnabled === true && sourceLoaded.snapSize === 2.5, `Source editor metadata drifted: ${JSON.stringify(sourceLoaded)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-source-loaded-before-save.png'), fullPage: false });

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#we-save').click();
    const download = await downloadPromise;
    assert(download.suggestedFilename() === 'westeros-world.scene.json', `Unexpected saved filename: ${download.suggestedFilename()}`);
    await download.saveAs(downloadedPath);
    assert(fs.existsSync(downloadedPath) && fs.statSync(downloadedPath).size > 0, 'Actual browser download was not persisted for roundtrip');
    const downloaded = JSON.parse(fs.readFileSync(downloadedPath, 'utf8'));
    assert(JSON.stringify(downloaded) === JSON.stringify(sceneData(sourceObject, sourceEditor)), `Downloaded JSON diverged before roundtrip reload: ${JSON.stringify(downloaded)}`);

    await page.locator('#we-load-file').setInputFiles(replacementPath);
    await page.waitForFunction(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.[0];
      return window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 1 &&
        object?.userData?.editorId === 'run256-replacement-tree-0001' &&
        document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.' &&
        Number(document.getElementById('we-snap-size')?.value) === 1.25;
    }, null, { timeout: 120000 });
    const replacementLoaded = await capture();
    assert(JSON.stringify(replacementLoaded.object) === JSON.stringify(replacementObject), `Replacement scene did not load exactly: ${JSON.stringify(replacementLoaded)}`);
    assert(replacementLoaded.snapEnabled === false && replacementLoaded.snapSize === 1.25, `Replacement editor metadata drifted: ${JSON.stringify(replacementLoaded)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-temporary-replacement-loaded.png'), fullPage: false });

    await page.locator('#we-snap-toggle').check();
    await page.locator('#we-snap-size').fill('4.25');
    await page.locator('#we-snap-size').dispatchEvent('change');
    await page.locator('#we-load-file').setInputFiles(downloadedPath);
    await page.waitForFunction(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.[0];
      return window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 1 &&
        object?.userData?.editorId === 'run256-source-tree-0001' &&
        document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.' &&
        document.getElementById('we-snap-toggle')?.checked === true &&
        Number(document.getElementById('we-snap-size')?.value) === 2.5;
    }, null, { timeout: 120000 });

    const restored = await capture();
    assert(JSON.stringify(restored.object) === JSON.stringify(sourceObject), `Actual downloaded file did not restore the source scene exactly: ${JSON.stringify({ sourceObject, actual: restored.object })}`);
    assert(!restored.hierarchyText.includes(replacementObject.name), `Replacement object leaked after downloaded-file roundtrip: ${restored.hierarchyText}`);
    assert(restored.hierarchyText.includes(sourceObject.name), `Restored source object missing from hierarchy: ${restored.hierarchyText}`);
    assert(restored.snapEnabled === true && restored.snapSize === 2.5, `Downloaded editor metadata did not roundtrip: ${JSON.stringify(restored)}`);
    assert(restored.gridChecked === false && restored.gridDisabled === true && restored.gridVisible === false, `Owner grid policy drifted after roundtrip: ${JSON.stringify(restored)}`);
    assert(restored.selection.includes('yok'), `Roundtrip load should clear selection: ${restored.selection}`);
    assert(restored.history?.observersStarted === true && restored.history?.restoring === false, `History unstable after downloaded-file roundtrip: ${JSON.stringify(restored.history)}`);
    assert(restored.loadInputValue === '', `File input was not reset after downloaded-file roundtrip: ${restored.loadInputValue}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-actual-download-restored.png'), fullPage: false });

    console.log(`[checkRun256EditorMobileSaveLoadRoundtrip] PASS ${JSON.stringify({ filename: download.suggestedFilename(), source: restored.object, replacementRemoved: true, editor: { snapEnabled: restored.snapEnabled, snapSize: restored.snapSize }, touch: restored.maxTouchPoints, viewport: restored.viewport, unexpectedErrors: errors.length, screenshots: 3 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun256EditorMobileSaveLoadRoundtrip] FAIL: ${error.stack || error}`); process.exitCode = 1; });
