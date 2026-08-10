#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run233-editor-scene-json-roundtrip-v2');

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
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  const captureScene = () => page.evaluate(() => {
    const round = (value) => Number(value.toFixed(6));
    const normalize = (object) => ({
      id: object.userData.editorId,
      asset: object.userData.editorAssetId,
      name: object.name,
      position: object.position.toArray().map(round),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(round),
      scale: object.scale.toArray().map(round)
    });
    return {
      objects: window.__WESTEROS_WORLD_EDITOR__.editableObjects.map(normalize).sort((a, b) => a.id.localeCompare(b.id)),
      editor: {
        gridVisible: document.getElementById('we-grid-toggle').checked,
        snapEnabled: document.getElementById('we-snap-toggle').checked,
        snapSize: Number(document.getElementById('we-snap-size').value)
      },
      selection: document.getElementById('we-selection-status').textContent
    };
  });

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 0, null, { timeout: 120000 });

    const castle = page.locator('#we-assets .we-asset', { hasText: 'Kale İşaretçisi' }).first();
    const tree = page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first();
    await castle.dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await tree.dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 2, null, { timeout: 30000 });

    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    await page.locator('#we-snap-toggle').uncheck();
    await page.locator('#we-grid-toggle').uncheck();
    await page.locator('#we-snap-size').fill('2.5');
    await page.locator('#we-snap-size').dispatchEvent('change');

    const fields = {
      '#we-name': 'Run233 JSON Castle',
      '#we-pos-x': '-12.345', '#we-pos-y': '3.125', '#we-pos-z': '27.875',
      '#we-rot-x': '-15', '#we-rot-y': '37.5', '#we-rot-z': '92',
      '#we-scale-x': '0.007', '#we-scale-y': '1.375', '#we-scale-z': '2.125'
    };
    for (const [selector, value] of Object.entries(fields)) {
      const input = page.locator(selector); await input.fill(value); await input.dispatchEvent('change');
    }
    await page.waitForTimeout(240);

    const before = await captureScene();
    assert(before.objects.length === 2, `Expected two deterministic editor objects: ${JSON.stringify(before)}`);
    const edited = before.objects.find((object) => object.name === 'Run233 JSON Castle');
    assert(edited, `Renamed object missing before save: ${JSON.stringify(before.objects)}`);
    assert(Math.abs(edited.scale[0] - 0.007) < 1e-9, `Sub-0.01 X scale not applied: ${JSON.stringify(edited.scale)}`);
    assert(before.editor.gridVisible === false && before.editor.snapEnabled === false && before.editor.snapSize === 2.5, `Editor settings not prepared: ${JSON.stringify(before.editor)}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-before-save.png'), fullPage: true });

    const downloadPromise = page.waitForEvent('download');
    await page.click('#we-save');
    const download = await downloadPromise;
    const savedPath = path.join(ARTIFACT_DIR, 'westeros-world.scene.json');
    await download.saveAs(savedPath);
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    assert(saved.schemaVersion === 1, `Unexpected scene schema: ${saved.schemaVersion}`);
    assert(Array.isArray(saved.objects) && saved.objects.length === 2, `Saved scene object count invalid: ${saved.objects?.length}`);
    assert(saved.editor?.gridVisible === false && saved.editor?.snapEnabled === false && Number(saved.editor?.snapSize) === 2.5, `Saved editor state drifted: ${JSON.stringify(saved.editor)}`);

    const savedNormalized = saved.objects.map((record) => ({
      id: record.id,
      asset: record.asset,
      name: record.name,
      position: record.transform.position,
      rotation: record.transform.rotation,
      scale: record.transform.scale
    })).sort((a, b) => a.id.localeCompare(b.id));
    assert(JSON.stringify(savedNormalized) === JSON.stringify(before.objects), `Serializer output differs from normalized live scene: ${JSON.stringify({ before: before.objects, saved: savedNormalized })}`);

    await page.locator('#we-load-file').setInputFiles(savedPath);
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 2 &&
      document.getElementById('we-selection-status')?.textContent?.includes('yok')
    ), null, { timeout: 120000 });
    await page.waitForTimeout(300);

    const after = await captureScene();
    assert(JSON.stringify(after.objects) === JSON.stringify(savedNormalized), `Scene JSON round-trip drifted: ${JSON.stringify({ saved: savedNormalized, after: after.objects })}`);
    assert(JSON.stringify(after.editor) === JSON.stringify(before.editor), `Editor state round-trip drifted: ${JSON.stringify({ before: before.editor, after: after.editor })}`);
    assert(after.selection.includes('yok'), `Load should clear selection: ${after.selection}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-after-load.png'), fullPage: true });
    console.log(`[checkRun233EditorSceneJsonRoundtripV2] PASS ${JSON.stringify({ objects: after.objects, editor: after.editor, selection: after.selection, screenshots: 2 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun233EditorSceneJsonRoundtripV2] FAIL: ${error.stack || error}`); process.exitCode = 1; });
