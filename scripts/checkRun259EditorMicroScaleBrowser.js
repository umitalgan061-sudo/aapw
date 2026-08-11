#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run259-editor-micro-scale');
const MICRO_SCALE = 0.000001;

function assert(value, message) {
  if (!value) throw new Error(message);
}

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
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.fbx') return 'application/octet-stream';
  return 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    const directoryIndex = path.join(file, 'index.html');
    if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isDirectory() && fs.existsSync(directoryIndex)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(directoryIndex).pipe(res);
      return;
    }
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__ &&
      window.__WESTEROS_EDITOR_HISTORY__ &&
      window.__WESTEROS_EDITOR_SCALE_INPUT__ &&
      window.__WESTEROS_EDITOR_MICRO_SCALE__ &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0
    ), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted === true, null, { timeout: 30000 });

    const treeButton = page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first();
    await treeButton.dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });

    const scaleMeta = await page.evaluate(() => ({
      minimumScale: window.__WESTEROS_EDITOR_MICRO_SCALE__.minimumScale,
      decimals: window.__WESTEROS_EDITOR_MICRO_SCALE__.decimals,
      min: [
        document.getElementById('we-scale-x').min,
        document.getElementById('we-scale-y').min,
        document.getElementById('we-scale-z').min
      ],
      step: [
        document.getElementById('we-scale-x').step,
        document.getElementById('we-scale-y').step,
        document.getElementById('we-scale-z').step
      ]
    }));
    assert(Math.abs(scaleMeta.minimumScale - MICRO_SCALE) < 1e-12, `Micro policy minimum mismatch: ${JSON.stringify(scaleMeta)}`);
    assert(scaleMeta.decimals === 6, `Micro policy decimals mismatch: ${JSON.stringify(scaleMeta)}`);
    assert(scaleMeta.min.every((value) => value === '0.000001'), `Inspector min metadata mismatch: ${JSON.stringify(scaleMeta)}`);
    assert(scaleMeta.step.every((value) => value === '0.000001'), `Inspector step metadata mismatch: ${JSON.stringify(scaleMeta)}`);

    for (const id of ['we-scale-x', 'we-scale-y', 'we-scale-z']) {
      const input = page.locator(`#${id}`);
      await input.fill('0.000001');
      await input.dispatchEvent('change');
    }
    await page.waitForFunction((expected) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];
      return Boolean(object) && object.scale.toArray().every((value) => Math.abs(value - expected) < 1e-12);
    }, MICRO_SCALE, { timeout: 30000 });

    const directScale = await page.evaluate(async () => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];
      const inputText = ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => document.getElementById(id).value);
      const { serializeEditorScene } = await import('/src/3d/editor/EditorSceneSerializer.js');
      const serialized = serializeEditorScene(
        window.__WESTEROS_WORLD_EDITOR__.editableObjects,
        window.__WESTEROS_WORLD_EDITOR__.instanceManager.serialize(),
        window.__WESTEROS_WORLD_EDITOR__.getEditorState()
      );
      return { scale: object.scale.toArray(), inputText, persisted: serialized.objects[0].transform.scale, json: JSON.stringify(serialized) };
    });
    assert(directScale.scale.every((value) => Math.abs(value - MICRO_SCALE) < 1e-12), `Runtime scale lost 1e-6: ${JSON.stringify(directScale)}`);
    assert(directScale.inputText.every((value) => value === '0.000001'), `Inspector rounded 1e-6: ${JSON.stringify(directScale.inputText)}`);
    assert(directScale.persisted.every((value) => Math.abs(value - MICRO_SCALE) < 1e-12), `Scene JSON lost 1e-6: ${JSON.stringify(directScale.persisted)}`);
    assert(directScale.json.includes('0.000001'), 'Serialized scene JSON does not contain 0.000001');

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-direct-000001.png'), fullPage: true });

    for (const id of ['we-scale-x', 'we-scale-y', 'we-scale-z']) {
      const input = page.locator(`#${id}`);
      await input.fill('0.000010');
      await input.dispatchEvent('change');
    }
    await page.click('#we-quick-shrink');
    await page.waitForFunction((expected) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];
      return object.scale.toArray().every((value) => Math.abs(value - expected) < 1e-12);
    }, MICRO_SCALE, { timeout: 30000 });
    const afterQuickShrink = await page.evaluate(() => ({
      scale: window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].scale.toArray(),
      text: ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => document.getElementById(id).value)
    }));
    assert(afterQuickShrink.text.every((value) => value === '0.000001'), `Quick shrink display lost precision: ${JSON.stringify(afterQuickShrink)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-quick-shrink-floor.png'), fullPage: true });

    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());
    await page.click('#we-undo');
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
    await page.click('#we-redo');
    await page.waitForFunction((expected) => (
      window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1 &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].scale.toArray().every((value) => Math.abs(value - expected) < 1e-12)
    ), MICRO_SCALE, { timeout: 120000 });

    const restoredHierarchyItem = page.locator('#we-hierarchy .we-hierarchy-item').first();
    await restoredHierarchyItem.click();
    await page.waitForFunction(() => ['we-scale-x', 'we-scale-y', 'we-scale-z'].every((id) => document.getElementById(id).value === '0.000001'), null, { timeout: 30000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-redo-reselected-000001.png'), fullPage: true });

    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    console.log(`[checkRun259EditorMicroScaleBrowser] PASS ${JSON.stringify({ scaleMeta, directScale: { scale: directScale.scale, inputText: directScale.inputText, persisted: directScale.persisted }, afterQuickShrink, screenshots: 3 })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun259EditorMicroScaleBrowser] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
