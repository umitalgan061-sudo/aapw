#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run254-editor-mobile-offgrid-load');

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
  const fixturePath = path.join(ARTIFACT_DIR, 'mobile-offgrid.scene.json');
  const expected = {
    id: 'run254-mobile-tree-0001',
    name: 'Run254 Mobile Offgrid Tree',
    asset: 'marker-tree',
    position: [-13.375, 0.125, 19.625],
    rotation: [0.625, -1.375, 2.125],
    scale: [0.007, 1.875, 0.625]
  };
  fs.writeFileSync(fixturePath, JSON.stringify({
    schemaVersion: 1,
    world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' },
    editor: { gridVisible: false, snapEnabled: true, snapSize: 2.5 },
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
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });
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
      selection: document.getElementById('we-selection-status').textContent,
      snapEnabled: document.getElementById('we-snap-toggle').checked,
      snapSize: Number(document.getElementById('we-snap-size').value),
      gridChecked: gridToggle.checked,
      gridDisabled: gridToggle.disabled,
      gridVisible: window.__WESTEROS_WORLD_EDITOR__.grid.visible,
      history: window.__WESTEROS_EDITOR_HISTORY__?.getSnapshot?.(),
      toast: document.getElementById('we-toast').textContent,
      maxTouchPoints: navigator.maxTouchPoints,
      viewport: [window.innerWidth, window.innerHeight],
      scrollHeight: document.documentElement.scrollHeight
    };
  });

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_HISTORY__, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted === true, null, { timeout: 30000 });

    const mobile = await capture();
    assert(mobile.maxTouchPoints > 0, `Touch context was not active: ${JSON.stringify(mobile)}`);
    assert(mobile.viewport[0] === 390 && mobile.viewport[1] === 844, `Mobile viewport drifted: ${JSON.stringify(mobile.viewport)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-mobile-editor-before-load.png'), fullPage: false });

    await page.locator('#we-snap-toggle').check();
    await page.locator('#we-snap-size').fill('4.25');
    await page.locator('#we-snap-size').dispatchEvent('change');
    await page.locator('#we-load-file').setInputFiles(fixturePath);
    await page.waitForFunction(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.[0];
      return window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 1 &&
        object?.userData?.editorId === 'run254-mobile-tree-0001' &&
        document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.' &&
        Number(document.getElementById('we-snap-size')?.value) === 2.5;
    }, null, { timeout: 120000 });

    const after = await capture();
    assert(after.objectCount === 1, `Mobile scene object count drifted: ${JSON.stringify(after)}`);
    assert(JSON.stringify(after.object) === JSON.stringify(expected), `Mobile off-grid transform was quantized or drifted: ${JSON.stringify({ expected, actual: after.object })}`);
    assert(after.snapEnabled === true && after.snapSize === 2.5, `Serialized snap metadata was not restored on mobile: ${JSON.stringify(after)}`);
    assert(after.gridChecked === false && after.gridDisabled === true && after.gridVisible === false, `Owner grid policy drifted on mobile: ${JSON.stringify(after)}`);
    assert(after.selection.includes('yok'), `Mobile scene load should clear selection: ${after.selection}`);
    assert(after.history?.observersStarted === true && after.history?.restoring === false, `History unstable after mobile scene load: ${JSON.stringify(after.history)}`);
    assert(after.toast === 'Scene JSON yüklendi.', `Mobile success toast drifted: ${after.toast}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    await page.locator('#we-hierarchy').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-mobile-loaded-hierarchy.png'), fullPage: false });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-mobile-loaded-lower-panel.png'), fullPage: false });

    console.log(`[checkRun254EditorMobileOffgridLoad] PASS ${JSON.stringify({ object: after.object, snapEnabled: after.snapEnabled, snapSize: after.snapSize, touch: after.maxTouchPoints, viewport: after.viewport, unexpectedErrors: errors.length, screenshots: 3 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun254EditorMobileOffgridLoad] FAIL: ${error.stack || error}`); process.exitCode = 1; });
