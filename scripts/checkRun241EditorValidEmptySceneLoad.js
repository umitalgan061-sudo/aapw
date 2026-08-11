#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run241-editor-valid-empty-scene-load');

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
  const scenePath = path.join(ARTIFACT_DIR, 'valid-empty.scene.json');
  fs.writeFileSync(scenePath, JSON.stringify({
    schemaVersion: 1,
    world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' },
    editor: { gridVisible: true, snapEnabled: true, snapSize: 3 },
    objects: [],
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

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 0, null, { timeout: 120000 });

    await page.locator('#we-assets .we-asset', { hasText: 'Kale İşaretçisi' }).first().dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    await page.locator('#we-grid-toggle').uncheck();
    await page.locator('#we-snap-toggle').uncheck();
    await page.locator('#we-snap-size').fill('1.5');
    await page.locator('#we-snap-size').dispatchEvent('change');

    const before = await page.evaluate(() => ({
      objectCount: window.__WESTEROS_WORLD_EDITOR__.editableObjects.length,
      hierarchyCount: document.querySelectorAll('#we-hierarchy .we-hierarchy-item').length,
      selection: document.getElementById('we-selection-status').textContent,
      gridVisible: document.getElementById('we-grid-toggle').checked,
      snapEnabled: document.getElementById('we-snap-toggle').checked,
      snapSize: Number(document.getElementById('we-snap-size').value)
    }));
    assert(before.objectCount === 1 && before.hierarchyCount === 1, `Prepared scene missing object: ${JSON.stringify(before)}`);
    assert(before.selection.startsWith('Seçim: ') && !before.selection.includes('yok'), `Prepared selection missing: ${before.selection}`);
    assert(before.gridVisible === false && before.snapEnabled === false && before.snapSize === 1.5, `Prepared editor state drifted: ${JSON.stringify(before)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-before-valid-empty-load.png'), fullPage: true });

    await page.locator('#we-load-file').setInputFiles(scenePath);
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0 &&
      document.querySelectorAll('#we-hierarchy .we-hierarchy-item').length === 0 &&
      document.getElementById('we-selection-status').textContent.includes('yok') &&
      document.getElementById('we-grid-toggle').checked === true &&
      document.getElementById('we-snap-toggle').checked === true &&
      Number(document.getElementById('we-snap-size').value) === 3
    ), null, { timeout: 30000 });

    const after = await page.evaluate(() => ({
      objectCount: window.__WESTEROS_WORLD_EDITOR__.editableObjects.length,
      instanceGroupCount: window.__WESTEROS_WORLD_EDITOR__.instanceManager.groups.length,
      hierarchyCount: document.querySelectorAll('#we-hierarchy .we-hierarchy-item').length,
      selection: document.getElementById('we-selection-status').textContent,
      gridVisible: document.getElementById('we-grid-toggle').checked,
      snapEnabled: document.getElementById('we-snap-toggle').checked,
      snapSize: Number(document.getElementById('we-snap-size').value)
    }));
    assert(after.objectCount === 0 && after.instanceGroupCount === 0 && after.hierarchyCount === 0, `Valid empty scene did not clear authoring content: ${JSON.stringify(after)}`);
    assert(after.selection.includes('yok'), `Valid empty scene did not clear selection: ${after.selection}`);
    assert(after.gridVisible === true && after.snapEnabled === true && after.snapSize === 3, `Valid empty scene did not apply editor state: ${JSON.stringify(after)}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-after-valid-empty-load.png'), fullPage: true });

    console.log(`[checkRun241EditorValidEmptySceneLoad] PASS ${JSON.stringify({ before, after, browserErrors: errors.length, screenshots: 2 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun241EditorValidEmptySceneLoad] FAIL: ${error.stack || error}`); process.exitCode = 1; });
