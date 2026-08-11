#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run252-editor-local-offgrid-reload');
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

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const savedFixture = path.join(ARTIFACT_DIR, 'saved-offgrid.scene.json');
  const driftFixture = path.join(ARTIFACT_DIR, 'drift.scene.json');
  const expected = [
    { id: 'run252-tree-a', name: 'Run252 Saved North', asset: 'marker-tree', position: [-13.375, 0.125, 21.625], rotation: [0.625, -1.25, 2.125], scale: [0.007, 1.75, 0.5] },
    { id: 'run252-tree-b', name: 'Run252 Saved South', asset: 'marker-tree', position: [8.125, 2.375, -10.875], rotation: [-0.375, 0.875, -2.375], scale: [1.25, 0.333, 2.5] }
  ];
  const scene = (objects, editor) => ({ schemaVersion: 1, world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' }, editor, objects: objects.map((o) => ({ id: o.id, name: o.name, asset: o.asset, transform: { position: o.position, rotation: o.rotation, scale: o.scale } })), instanceGroups: [] });
  fs.writeFileSync(savedFixture, JSON.stringify(scene(expected, { gridVisible: false, snapEnabled: true, snapSize: 2.5 }), null, 2));
  fs.writeFileSync(driftFixture, JSON.stringify(scene([{ id: 'run252-drift', name: 'Run252 Drift', asset: 'marker-tree', position: [40, 0, 40], rotation: [0, 0, 0], scale: [1, 1, 1] }], { gridVisible: false, snapEnabled: false, snapSize: 1 }), null, 2));

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  const capture = () => page.evaluate(() => {
    const round = (value) => Number(value.toFixed(6));
    return {
      objects: window.__WESTEROS_WORLD_EDITOR__.editableObjects.map((object) => ({
        id: object.userData.editorId, name: object.name, asset: object.userData.editorAssetId,
        position: object.position.toArray().map(round), rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(round), scale: object.scale.toArray().map(round)
      })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      selection: document.getElementById('we-selection-status').textContent,
      snapEnabled: document.getElementById('we-snap-toggle').checked,
      snapSize: Number(document.getElementById('we-snap-size').value),
      gridChecked: document.getElementById('we-grid-toggle').checked,
      gridDisabled: document.getElementById('we-grid-toggle').disabled,
      gridVisible: window.__WESTEROS_WORLD_EDITOR__.grid.visible,
      toast: document.getElementById('we-toast').textContent,
      history: window.__WESTEROS_EDITOR_HISTORY__?.getSnapshot?.(),
      local: window.__WESTEROS_EDITOR_LOCAL_SESSION__?.getSnapshot?.()
    };
  });

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_HISTORY__ && window.__WESTEROS_EDITOR_LOCAL_SESSION__ && document.getElementById('we-grid-toggle')?.disabled === true, null, { timeout: 120000 });
    await page.locator('#we-load-file').setInputFiles(savedFixture);
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 2 && document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.', null, { timeout: 120000 });
    await page.locator('#we-local-save').click();
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_LOCAL_SESSION__?.getSnapshot?.().hasLocalScene === true, null, { timeout: 30000 });
    const saved = await capture();
    assert(saved.local?.hasLocalScene === true && Boolean(saved.local?.savedAt), `Local scene snapshot missing after save: ${JSON.stringify(saved.local)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-saved-offgrid-local.png'), fullPage: true });

    await page.locator('#we-load-file').setInputFiles(driftFixture);
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 1 && window.__WESTEROS_WORLD_EDITOR__.editableObjects[0]?.userData?.editorId === 'run252-drift', null, { timeout: 120000 });
    await page.locator('#we-snap-toggle').check();
    await page.locator('#we-snap-size').fill('4.25');
    await page.locator('#we-snap-size').dispatchEvent('change');
    await page.locator('#we-local-load').click();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 2 && window.__WESTEROS_WORLD_EDITOR__.editableObjects.every((object) => String(object.userData?.editorId || '').startsWith('run252-tree-')), null, { timeout: 120000 });
    await page.waitForFunction(() => document.getElementById('we-snap-toggle')?.checked === true && Number(document.getElementById('we-snap-size')?.value) === 2.5, null, { timeout: 30000 });

    const after = await capture();
    const sortedExpected = expected.slice().sort((a, b) => a.id.localeCompare(b.id));
    assert(JSON.stringify(after.objects) === JSON.stringify(sortedExpected), `Local off-grid reload drifted serialized transforms: ${JSON.stringify({ expected: sortedExpected, actual: after.objects })}`);
    assert(after.snapEnabled === true && after.snapSize === 2.5, `Saved snap metadata was not restored: ${JSON.stringify(after)}`);
    assert(after.gridChecked === false && after.gridDisabled === true && after.gridVisible === false, `Owner grid policy drifted: ${JSON.stringify(after)}`);
    assert(after.selection.includes('yok'), `Local reload should clear selection: ${after.selection}`);
    assert(after.history?.observersStarted === true && after.history?.restoring === false, `History controller unstable after local reload: ${JSON.stringify(after.history)}`);
    assert(after.local?.hasLocalScene === true && Boolean(after.local?.savedAt), `Local scene metadata disappeared after reload: ${JSON.stringify(after.local)}`);
    assert(!after.objects.some((object) => object.id === 'run252-drift'), `Drift scene object survived local reload: ${JSON.stringify(after.objects)}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-restored-offgrid-local.png'), fullPage: true });
    console.log(`[checkRun252EditorLocalOffgridReload] PASS ${JSON.stringify({ objectCount: after.objects.length, snapEnabled: after.snapEnabled, snapSize: after.snapSize, localScene: after.local?.hasLocalScene, unexpectedErrors: errors.length, screenshots: 2 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun252EditorLocalOffgridReload] FAIL: ${error.stack || error}`); process.exitCode = 1; });
