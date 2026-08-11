#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run242-editor-missing-metadata-defaults-v3');

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
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    const directoryIndex = path.join(file, 'index.html');
    if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isDirectory() && fs.existsSync(directoryIndex)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(directoryIndex).pipe(res); return;
    }
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(clean === '/favicon.ico' ? 204 : 404); res.end(); return;
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
  const fixturePath = path.join(ARTIFACT_DIR, 'missing-editor-metadata.scene.json');
  const expected = {
    id: 'run242-tree-0001',
    name: 'Run242 Metadata Default Tree',
    asset: 'marker-tree',
    position: [12, 0, -8],
    rotation: [-0.25, 0.5, -1.125],
    scale: [0.007, 1.5, 2.25]
  };
  fs.writeFileSync(fixturePath, JSON.stringify({
    schemaVersion: 1,
    world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' },
    objects: [{
      id: expected.id,
      name: expected.name,
      asset: expected.asset,
      transform: { position: expected.position, rotation: expected.rotation, scale: expected.scale }
    }],
    instanceGroups: []
  }, null, 2));

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
    const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];
    const gridToggle = document.getElementById('we-grid-toggle');
    return {
      object: object ? {
        id: object.userData.editorId,
        name: object.name,
        asset: object.userData.editorAssetId,
        position: object.position.toArray().map(round),
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(round),
        scale: object.scale.toArray().map(round)
      } : null,
      objectCount: window.__WESTEROS_WORLD_EDITOR__.editableObjects.length,
      instanceGroupCount: window.__WESTEROS_WORLD_EDITOR__.instanceManager.groups.length,
      selection: document.getElementById('we-selection-status').textContent,
      gridChecked: gridToggle.checked,
      gridDisabled: gridToggle.disabled,
      gridVisible: window.__WESTEROS_WORLD_EDITOR__.grid.visible,
      snapEnabled: document.getElementById('we-snap-toggle').checked,
      snapSize: Number(document.getElementById('we-snap-size').value),
      toast: document.getElementById('we-toast').textContent
    };
  });

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__ &&
      document.getElementById('we-grid-toggle')?.disabled === true
    ), null, { timeout: 120000 });

    await page.locator('#we-snap-toggle').uncheck();
    await page.locator('#we-snap-size').fill('2.5');
    await page.locator('#we-snap-size').dispatchEvent('change');
    const before = await capture();
    assert(before.gridChecked === false && before.gridDisabled === true && before.gridVisible === false, `Live-editor grid ownership baseline drifted: ${JSON.stringify(before)}`);
    assert(before.snapEnabled === false && before.snapSize === 2.5, `Pre-load snap controls were not prepared: ${JSON.stringify(before)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-before-metadata-default-load.png'), fullPage: true });

    await page.locator('#we-load-file').setInputFiles(fixturePath);
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 1 &&
      document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.'
    ), null, { timeout: 120000 });
    await page.waitForFunction(() => (
      document.getElementById('we-grid-toggle')?.checked === false &&
      document.getElementById('we-grid-toggle')?.disabled === true &&
      window.__WESTEROS_WORLD_EDITOR__?.grid?.visible === false
    ), null, { timeout: 30000 });

    const after = await capture();
    assert(after.objectCount === 1, `Loaded object count drifted: ${JSON.stringify(after)}`);
    assert(after.instanceGroupCount === 0, `Unexpected instance groups after load: ${JSON.stringify(after)}`);
    assert(JSON.stringify(after.object) === JSON.stringify(expected), `Object transform/identity drifted: ${JSON.stringify({ expected, actual: after.object })}`);
    assert(after.gridChecked === false && after.gridDisabled === true && after.gridVisible === false, `Composed live-editor grid ownership drifted: ${JSON.stringify(after)}`);
    assert(after.snapEnabled === true, `Missing editor.snapEnabled did not resolve to enabled: ${JSON.stringify(after)}`);
    assert(after.snapSize === 1, `Missing editor.snapSize did not resolve to 1: ${JSON.stringify(after)}`);
    assert(after.selection.includes('yok'), `Scene load should clear selection: ${after.selection}`);
    assert(after.toast === 'Scene JSON yüklendi.', `Load completion signal drifted: ${after.toast}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-after-metadata-default-load.png'), fullPage: true });

    console.log(`[checkRun242EditorMissingMetadataDefaultsV3] PASS ${JSON.stringify({ object: after.object, gridChecked: after.gridChecked, gridDisabled: after.gridDisabled, gridVisible: after.gridVisible, snapEnabled: after.snapEnabled, snapSize: after.snapSize, unexpectedErrors: errors.length, screenshots: 2 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun242EditorMissingMetadataDefaultsV3] FAIL: ${error.stack || error}`); process.exitCode = 1; });
