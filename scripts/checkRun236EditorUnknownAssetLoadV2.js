#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run236-editor-unknown-asset-load-v2');

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
  const scenePath = path.join(ARTIFACT_DIR, 'unknown-asset.scene.json');
  const knownTransform = {
    // Integer positions deliberately isolate unknown-asset behavior from the editor's existing
    // load-time snap ordering; signed rotation and sub-0.01 scale remain covered independently.
    position: [-14, 4, 23],
    rotation: [-0.125, 0.75, 1.5],
    scale: [0.007, 1.625, 2.25]
  };
  fs.writeFileSync(scenePath, JSON.stringify({
    schemaVersion: 1,
    world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' },
    editor: { gridVisible: false, snapEnabled: false, snapSize: 2.5 },
    objects: [
      { id: 'run236-known-castle', name: 'Run236 Known Castle', asset: 'marker-castle', transform: knownTransform },
      { id: 'run236-missing-asset', name: 'Run236 Missing Asset', asset: 'asset-does-not-exist-run236', transform: { position: [99, 0, 99], rotation: [0, 0, 0], scale: [1, 1, 1] } }
    ],
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
    await page.waitForFunction(() => Boolean(window.__WESTEROS_WORLD_EDITOR__?.editableObjects), null, { timeout: 120000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-before-load.png'), fullPage: true });

    await page.locator('#we-load-file').setInputFiles(scenePath);
    await page.waitForFunction(() => document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.', null, { timeout: 120000 });
    await page.waitForTimeout(250);

    const state = await page.evaluate(() => {
      const round = (value) => Number(value.toFixed(6));
      return {
        objects: window.__WESTEROS_WORLD_EDITOR__.editableObjects.map((object) => ({
          id: object.userData.editorId,
          asset: object.userData.editorAssetId,
          name: object.name,
          position: object.position.toArray().map(round),
          rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(round),
          scale: object.scale.toArray().map(round)
        })),
        hierarchy: [...document.querySelectorAll('#we-hierarchy .we-hierarchy-item')].map((node) => node.textContent),
        selection: document.getElementById('we-selection-status').textContent,
        gridVisible: document.getElementById('we-grid-toggle').checked,
        snapEnabled: document.getElementById('we-snap-toggle').checked,
        snapSize: Number(document.getElementById('we-snap-size').value)
      };
    });

    assert(state.objects.length === 1, `Unknown asset was not skipped cleanly: ${JSON.stringify(state.objects)}`);
    const object = state.objects[0];
    assert(object.id === 'run236-known-castle', `Known record id drifted: ${JSON.stringify(object)}`);
    assert(object.asset === 'marker-castle', `Known asset drifted: ${JSON.stringify(object)}`);
    assert(object.name === 'Run236 Known Castle', `Known record name drifted: ${JSON.stringify(object)}`);
    assert(JSON.stringify(object.position) === JSON.stringify(knownTransform.position), `Known position drifted: ${JSON.stringify(object.position)}`);
    assert(JSON.stringify(object.rotation) === JSON.stringify(knownTransform.rotation), `Known rotation drifted: ${JSON.stringify(object.rotation)}`);
    assert(JSON.stringify(object.scale) === JSON.stringify(knownTransform.scale), `Known scale drifted: ${JSON.stringify(object.scale)}`);
    assert(!state.objects.some((entry) => entry.id === 'run236-missing-asset'), `Unknown asset leaked into live objects: ${JSON.stringify(state.objects)}`);
    assert(state.hierarchy.length === 1 && state.hierarchy[0].includes('Run236 Known Castle'), `Hierarchy contains unknown/missing record: ${JSON.stringify(state.hierarchy)}`);
    assert(state.selection.includes('yok'), `Scene load should clear selection: ${state.selection}`);
    assert(state.gridVisible === false && state.snapEnabled === false && state.snapSize === 2.5, `Editor settings were not restored: ${JSON.stringify(state)}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-after-unknown-asset-load.png'), fullPage: true });
    console.log(`[checkRun236EditorUnknownAssetLoadV2] PASS ${JSON.stringify({ objectCount: state.objects.length, hierarchyCount: state.hierarchy.length, selection: state.selection, settings: { gridVisible: state.gridVisible, snapEnabled: state.snapEnabled, snapSize: state.snapSize }, screenshots: 2 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun236EditorUnknownAssetLoadV2] FAIL: ${error.stack || error}`); process.exitCode = 1; });
