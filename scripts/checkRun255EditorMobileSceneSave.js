#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run255-editor-mobile-scene-save');

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
async function readDownload(download) {
  const stream = await download.createReadStream();
  assert(stream, 'Download stream unavailable');
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const expectedObject = {
    id: 'run255-mobile-save-tree-0001',
    name: 'Run255 Mobile Saved Offgrid Tree',
    asset: 'marker-tree',
    transform: {
      position: [-15.375, 0.125, 22.625],
      rotation: [0.625, -1.375, 2.125],
      scale: [0.007, 1.875, 0.625]
    }
  };
  const fixturePath = path.join(ARTIFACT_DIR, 'mobile-save-source.scene.json');
  fs.writeFileSync(fixturePath, JSON.stringify({
    schemaVersion: 1,
    world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' },
    editor: { gridVisible: false, snapEnabled: true, snapSize: 2.5 },
    objects: [expectedObject],
    instanceGroups: []
  }, null, 2));

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
      selection: document.getElementById('we-selection-status').textContent,
      snapEnabled: document.getElementById('we-snap-toggle').checked,
      snapSize: Number(document.getElementById('we-snap-size').value),
      gridChecked: gridToggle.checked,
      gridDisabled: gridToggle.disabled,
      gridVisible: window.__WESTEROS_WORLD_EDITOR__.grid.visible,
      toast: document.getElementById('we-toast').textContent,
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
    await page.locator('#we-load-file').setInputFiles(fixturePath);
    await page.waitForFunction(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.[0];
      return window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 1 &&
        object?.userData?.editorId === 'run255-mobile-save-tree-0001' &&
        document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.' &&
        Number(document.getElementById('we-snap-size')?.value) === 2.5;
    }, null, { timeout: 120000 });

    const loaded = await capture();
    assert(JSON.stringify(loaded.object) === JSON.stringify(expectedObject), `Imported mobile object drifted before save: ${JSON.stringify({ expectedObject, actual: loaded.object })}`);
    assert(loaded.snapEnabled === true && loaded.snapSize === 2.5, `Serialized snap state did not restore before save: ${JSON.stringify(loaded)}`);
    assert(loaded.gridChecked === false && loaded.gridDisabled === true && loaded.gridVisible === false, `Owner grid policy drifted before mobile save: ${JSON.stringify(loaded)}`);
    assert(loaded.selection.includes('yok'), `Import should clear selection before save: ${loaded.selection}`);
    assert(loaded.history?.observersStarted === true && loaded.history?.restoring === false, `History unstable before mobile save: ${JSON.stringify(loaded.history)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-mobile-imported-before-save.png'), fullPage: false });

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#we-save').click();
    const download = await downloadPromise;
    assert(download.suggestedFilename() === 'westeros-world.scene.json', `Unexpected mobile save filename: ${download.suggestedFilename()}`);
    const downloadedText = await readDownload(download);
    const downloaded = JSON.parse(downloadedText);
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'downloaded-westeros-world.scene.json'), JSON.stringify(downloaded, null, 2));

    assert(downloaded.schemaVersion === 1, `Downloaded schemaVersion drifted: ${downloaded.schemaVersion}`);
    assert(JSON.stringify(downloaded.world) === JSON.stringify({ name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' }), `Downloaded world metadata drifted: ${JSON.stringify(downloaded.world)}`);
    assert(JSON.stringify(downloaded.editor) === JSON.stringify({ gridVisible: false, snapEnabled: true, snapSize: 2.5 }), `Downloaded editor metadata drifted: ${JSON.stringify(downloaded.editor)}`);
    assert(Array.isArray(downloaded.objects) && downloaded.objects.length === 1, `Downloaded object count drifted: ${JSON.stringify(downloaded.objects)}`);
    assert(JSON.stringify(downloaded.objects[0]) === JSON.stringify(expectedObject), `Downloaded mobile object lost exact identity/transform fidelity: ${JSON.stringify({ expectedObject, actual: downloaded.objects[0] })}`);
    assert(Array.isArray(downloaded.instanceGroups) && downloaded.instanceGroups.length === 0, `Downloaded instanceGroups drifted: ${JSON.stringify(downloaded.instanceGroups)}`);

    await page.waitForFunction(() => document.getElementById('we-toast')?.textContent === 'Scene JSON hazırlandı.', null, { timeout: 30000 });
    const saved = await capture();
    assert(saved.toast === 'Scene JSON hazırlandı.', `Mobile save completion toast drifted: ${saved.toast}`);
    assert(JSON.stringify(saved.object) === JSON.stringify(expectedObject), `Save mutated live mobile scene: ${JSON.stringify({ before: expectedObject, after: saved.object })}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-mobile-save-toast.png'), fullPage: false });
    await page.locator('#we-hierarchy').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-mobile-save-hierarchy.png'), fullPage: false });

    console.log(`[checkRun255EditorMobileSceneSave] PASS ${JSON.stringify({ filename: download.suggestedFilename(), object: downloaded.objects[0], editor: downloaded.editor, touch: saved.maxTouchPoints, viewport: saved.viewport, unexpectedErrors: errors.length, screenshots: 3 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun255EditorMobileSceneSave] FAIL: ${error.stack || error}`); process.exitCode = 1; });
