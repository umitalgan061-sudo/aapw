#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run239-editor-schema-version-atomicity');

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
function waitForCount(array, expected, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (array.length >= expected) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error(`Timed out waiting for handled load error count ${expected}; observed ${array.length}`));
      setTimeout(poll, 25);
    };
    poll();
  });
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const unsupportedPath = path.join(ARTIFACT_DIR, 'unsupported-version.scene.json');
  fs.writeFileSync(unsupportedPath, JSON.stringify({
    schemaVersion: 999,
    world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' },
    editor: { gridVisible: true, snapEnabled: true, snapSize: 4 },
    objects: [],
    instanceGroups: []
  }, null, 2));

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const handled = [];
  const unexpected = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('[worldEditor] scene load failed')) handled.push(text); else unexpected.push(text);
  });
  page.on('pageerror', (error) => unexpected.push(String(error)));

  const capture = () => page.evaluate(() => {
    const round = (value) => Number(value.toFixed(6));
    return {
      objects: window.__WESTEROS_WORLD_EDITOR__.editableObjects.map((object) => ({
        id: object.userData.editorId,
        asset: object.userData.editorAssetId,
        name: object.name,
        position: object.position.toArray().map(round),
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(round),
        scale: object.scale.toArray().map(round)
      })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      instanceGroupCount: window.__WESTEROS_WORLD_EDITOR__.instanceManager.groups.length,
      hierarchy: [...document.querySelectorAll('#we-hierarchy .we-hierarchy-item')].map((node) => node.textContent).sort(),
      selection: document.getElementById('we-selection-status').textContent,
      gridVisible: document.getElementById('we-grid-toggle').checked,
      snapEnabled: document.getElementById('we-snap-toggle').checked,
      snapSize: Number(document.getElementById('we-snap-size').value)
    };
  });

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 0, null, { timeout: 120000 });

    await page.locator('#we-assets .we-asset', { hasText: 'Kale İşaretçisi' }).first().dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    await page.locator('#we-grid-toggle').uncheck();
    await page.locator('#we-snap-toggle').uncheck();
    await page.locator('#we-snap-size').fill('2.5');
    await page.locator('#we-snap-size').dispatchEvent('change');

    const fields = {
      '#we-name': 'Run239 Schema Guard Castle',
      '#we-pos-x': '-17.375', '#we-pos-y': '3.25', '#we-pos-z': '29.625',
      '#we-rot-x': '-22.5', '#we-rot-y': '37.25', '#we-rot-z': '178.5',
      '#we-scale-x': '0.125', '#we-scale-y': '1.5', '#we-scale-z': '2.25'
    };
    for (const [selector, value] of Object.entries(fields)) {
      const input = page.locator(selector); await input.fill(value); await input.dispatchEvent('change');
    }
    await page.waitForTimeout(200);

    const before = await capture();
    assert(before.objects.length === 1, `Prepared object count drifted: ${JSON.stringify(before)}`);
    assert(before.objects[0].name === 'Run239 Schema Guard Castle', `Prepared object missing: ${JSON.stringify(before.objects)}`);
    assert(before.gridVisible === false && before.snapEnabled === false && before.snapSize === 2.5, `Prepared editor settings drifted: ${JSON.stringify(before)}`);
    assert(before.selection.startsWith('Seçim: ') && !before.selection.includes('yok'), `Prepared selection missing: ${before.selection}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-before-unsupported-version.png'), fullPage: true });

    await page.locator('#we-load-file').setInputFiles(unsupportedPath);
    await waitForCount(handled, 1);
    await page.waitForTimeout(150);
    const after = await capture();
    assert(JSON.stringify(after) === JSON.stringify(before), `Unsupported schemaVersion mutated live editor state: ${JSON.stringify({ before, after })}`);
    assert(handled.length === 1, `Expected one handled scene-load error: ${JSON.stringify(handled)}`);
    assert(handled[0].includes('Desteklenmeyen scene schemaVersion: 999'), `Schema-version validation contract drifted: ${handled[0]}`);
    assert(unexpected.length === 0, `Unexpected browser errors: ${unexpected.join(' | ')}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-after-unsupported-version.png'), fullPage: true });

    console.log(`[checkRun239EditorSchemaVersionAtomicity] PASS ${JSON.stringify({ objectCount: before.objects.length, instanceGroupCount: before.instanceGroupCount, handledErrors: handled.length, unexpectedErrors: unexpected.length, screenshots: 2 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun239EditorSchemaVersionAtomicity] FAIL: ${error.stack || error}`); process.exitCode = 1; });
