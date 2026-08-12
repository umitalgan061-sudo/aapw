#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run257-editor-mobile-multiobject-save-load-roundtrip');

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
function sceneData(objects, editor) {
  return {
    schemaVersion: 1,
    world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' },
    editor,
    objects,
    instanceGroups: []
  };
}
function normalizedObject(object) {
  const round = (value) => Number(value.toFixed(6));
  return {
    id: object.userData.editorId,
    name: object.name,
    asset: object.userData.editorAssetId,
    transform: {
      position: object.position.toArray().map(round),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(round),
      scale: object.scale.toArray().map(round)
    }
  };
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const sourceObjects = [
    {
      id: 'run257-source-tree-0001',
      name: 'Run257 Multi Tree A',
      asset: 'marker-tree',
      transform: { position: [-18.375, 0.125, 27.625], rotation: [0.625, -1.375, 2.125], scale: [0.007, 1.875, 0.625] }
    },
    {
      id: 'run257-source-rock-0002',
      name: 'Run257 Multi Rock B',
      asset: 'marker-rock',
      transform: { position: [11.875, 2.625, -9.375], rotation: [-0.375, 0.875, -1.625], scale: [2.125, 0.375, 1.625] }
    }
  ];
  const replacementObjects = [{
    id: 'run257-replacement-tree-0001',
    name: 'Run257 Temporary Replacement',
    asset: 'marker-tree',
    transform: { position: [4.125, 1.375, 8.625], rotation: [0.25, -0.5, 0.75], scale: [1.25, 1.5, 0.75] }
  }];
  const sourceEditor = { gridVisible: false, snapEnabled: true, snapSize: 2.5 };
  const replacementEditor = { gridVisible: false, snapEnabled: false, snapSize: 1.25 };
  const sourcePath = path.join(ARTIFACT_DIR, 'multi-source.scene.json');
  const replacementPath = path.join(ARTIFACT_DIR, 'multi-replacement.scene.json');
  const downloadedPath = path.join(ARTIFACT_DIR, 'actual-downloaded-westeros-world.scene.json');
  fs.writeFileSync(sourcePath, JSON.stringify(sceneData(sourceObjects, sourceEditor), null, 2));
  fs.writeFileSync(replacementPath, JSON.stringify(sceneData(replacementObjects, replacementEditor), null, 2));

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  const capture = () => page.evaluate(() => ({
    objects: (window.__WESTEROS_WORLD_EDITOR__?.editableObjects || []).map((object) => {
      const round = (value) => Number(value.toFixed(6));
      return {
        id: object.userData.editorId,
        name: object.name,
        asset: object.userData.editorAssetId,
        transform: {
          position: object.position.toArray().map(round),
          rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(round),
          scale: object.scale.toArray().map(round)
        }
      };
    }),
    hierarchyText: document.getElementById('we-hierarchy').textContent,
    selection: document.getElementById('we-selection-status').textContent,
    snapEnabled: document.getElementById('we-snap-toggle').checked,
    snapSize: Number(document.getElementById('we-snap-size').value),
    gridChecked: document.getElementById('we-grid-toggle').checked,
    gridDisabled: document.getElementById('we-grid-toggle').disabled,
    gridVisible: window.__WESTEROS_WORLD_EDITOR__.grid.visible,
    toast: document.getElementById('we-toast').textContent,
    loadInputValue: document.getElementById('we-load-file').value,
    maxTouchPoints: navigator.maxTouchPoints,
    viewport: [window.innerWidth, window.innerHeight],
    history: window.__WESTEROS_EDITOR_HISTORY__?.getSnapshot?.()
  }));

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_HISTORY__, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted === true, null, { timeout: 30000 });

    const initial = await capture();
    assert(initial.maxTouchPoints > 0, `Touch context was not active: ${JSON.stringify(initial)}`);
    assert(initial.viewport[0] === 390 && initial.viewport[1] === 844, `Mobile viewport drifted: ${JSON.stringify(initial.viewport)}`);

    await page.locator('#we-load-file').setInputFiles(sourcePath);
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 2 && document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.', null, { timeout: 120000 });
    const sourceLoaded = await capture();
    assert(JSON.stringify(sourceLoaded.objects) === JSON.stringify(sourceObjects), `Two-object source scene drifted before save: ${JSON.stringify(sourceLoaded.objects)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-multi-source-loaded.png'), fullPage: false });

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#we-save').click();
    const download = await downloadPromise;
    assert(download.suggestedFilename() === 'westeros-world.scene.json', `Unexpected saved filename: ${download.suggestedFilename()}`);
    await download.saveAs(downloadedPath);
    const downloaded = JSON.parse(fs.readFileSync(downloadedPath, 'utf8'));
    assert(JSON.stringify(downloaded) === JSON.stringify(sceneData(sourceObjects, sourceEditor)), `Downloaded multi-object JSON diverged: ${JSON.stringify(downloaded)}`);

    await page.locator('#we-load-file').setInputFiles(replacementPath);
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 1 && window.__WESTEROS_WORLD_EDITOR__.editableObjects[0]?.userData?.editorId === 'run257-replacement-tree-0001', null, { timeout: 120000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-replacement-loaded.png'), fullPage: false });

    await page.locator('#we-load-file').setInputFiles(downloadedPath);
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 2 && window.__WESTEROS_WORLD_EDITOR__.editableObjects[0]?.userData?.editorId === 'run257-source-tree-0001' && window.__WESTEROS_WORLD_EDITOR__.editableObjects[1]?.userData?.editorId === 'run257-source-rock-0002', null, { timeout: 120000 });
    const restored = await capture();
    assert(JSON.stringify(restored.objects) === JSON.stringify(sourceObjects), `Multi-object roundtrip did not restore exact object order/transforms: ${JSON.stringify(restored.objects)}`);
    assert(!restored.hierarchyText.includes(replacementObjects[0].name), `Replacement object leaked after multi-object roundtrip: ${restored.hierarchyText}`);
    assert(sourceObjects.every((object) => restored.hierarchyText.includes(object.name)), `One or more restored objects missing from hierarchy: ${restored.hierarchyText}`);
    assert(restored.snapEnabled === true && restored.snapSize === 2.5, `Editor metadata did not roundtrip: ${JSON.stringify(restored)}`);
    assert(restored.gridChecked === false && restored.gridDisabled === true && restored.gridVisible === false, `Owner grid policy drifted after roundtrip: ${JSON.stringify(restored)}`);
    assert(restored.selection.includes('yok'), `Roundtrip load should clear selection: ${restored.selection}`);
    assert(restored.history?.observersStarted === true && restored.history?.restoring === false, `History unstable after multi-object roundtrip: ${JSON.stringify(restored.history)}`);
    assert(restored.loadInputValue === '', `File input was not reset after multi-object roundtrip: ${restored.loadInputValue}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-multi-object-restored.png'), fullPage: false });

    console.log(`[checkRun257EditorMobileMultiObjectSaveLoadRoundtrip] PASS ${JSON.stringify({ objectCount: restored.objects.length, ids: restored.objects.map((object) => object.id), editor: { snapEnabled: restored.snapEnabled, snapSize: restored.snapSize }, touch: restored.maxTouchPoints, viewport: restored.viewport, unexpectedErrors: errors.length, screenshots: 3 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun257EditorMobileMultiObjectSaveLoadRoundtrip] FAIL: ${error.stack || error}`); process.exitCode = 1; });
