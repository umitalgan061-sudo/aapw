#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'run264-editor-micro-scale-v5');
const MIN = 0.000001;

function assert(value, message) { if (!value) throw new Error(message); }
function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}
function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.fbx': 'application/octet-stream'
  })[ext] || 'application/octet-stream';
}
function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
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
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.__WESTEROS_WORLD_EDITOR__ &&
      window.__WESTEROS_EDITOR_HISTORY__?.getSnapshot?.().observersStarted &&
      window.__WESTEROS_EDITOR_SCALE_INPUT__ &&
      window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__
    ), null, { timeout: 120000 });

    const beforeIds = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.map((object) => object.userData?.editorId).filter(Boolean));
    await page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first().dblclick();
    await page.waitForFunction((knownIds) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.getSelectedObject?.();
      return Boolean(object && object.userData?.editorAssetId === 'marker-tree' && !knownIds.includes(object.userData?.editorId));
    }, beforeIds, { timeout: 30000 });
    const targetId = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.getSelectedObject().userData.editorId);

    await page.evaluate(() => {
      for (const id of ['we-scale-x', 'we-scale-y', 'we-scale-z']) {
        const input = document.getElementById(id);
        input.min = '0.001';
        input.step = '0.001';
      }
    });
    await page.waitForFunction(() => ['we-scale-x', 'we-scale-y', 'we-scale-z'].every((id) => {
      const input = document.getElementById(id);
      return input.min === '0.000001' && input.step === '0.000001' && input.getAttribute('inputmode') === 'decimal';
    }), null, { timeout: 5000 });

    for (const id of ['we-scale-x', 'we-scale-y', 'we-scale-z']) {
      const input = page.locator(`#${id}`);
      await input.fill('0.000001');
      await input.dispatchEvent('change');
    }
    await page.waitForFunction(({ id, expected }) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects.find((item) => item.userData?.editorId === id);
      return Boolean(object && object.scale.toArray().every((value) => Math.abs(value - expected) < 1e-12));
    }, { id: targetId, expected: MIN }, { timeout: 30000 });

    const direct = await page.evaluate(async (id) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects.find((item) => item.userData?.editorId === id);
      const text = ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((inputId) => document.getElementById(inputId).value);
      const { serializeEditorScene } = await import('/src/3d/editor/EditorSceneSerializer.js');
      const scene = serializeEditorScene(
        window.__WESTEROS_WORLD_EDITOR__.editableObjects,
        window.__WESTEROS_WORLD_EDITOR__.instanceManager.serialize(),
        window.__WESTEROS_WORLD_EDITOR__.getEditorState()
      );
      const record = scene.objects.find((item) => item.id === id);
      return { scale: object.scale.toArray(), text, persisted: record?.transform?.scale, json: JSON.stringify(scene) };
    }, targetId);
    assert(direct.scale.every((value) => Math.abs(value - MIN) < 1e-12), `Runtime lost 1e-6: ${JSON.stringify(direct.scale)}`);
    assert(direct.text.every((value) => value === '0.000001'), `Inspector rounded 1e-6: ${JSON.stringify(direct.text)}`);
    assert(direct.persisted?.every((value) => Math.abs(value - MIN) < 1e-12), `Serializer lost 1e-6: ${JSON.stringify(direct.persisted)}`);
    assert(direct.json.includes('0.000001'), 'Serialized scene does not contain 0.000001');

    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, '01-direct-000001.png'), fullPage: true });

    for (const id of ['we-scale-x', 'we-scale-y', 'we-scale-z']) {
      const input = page.locator(`#${id}`);
      await input.fill('0.000010');
      await input.dispatchEvent('change');
    }
    await page.click('#we-quick-shrink');
    await page.waitForFunction(({ id, expected }) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects.find((item) => item.userData?.editorId === id);
      return Boolean(object && object.scale.toArray().every((value) => Math.abs(value - expected) < 1e-12));
    }, { id: targetId, expected: MIN }, { timeout: 30000 });
    const shrinkText = await page.evaluate(() => ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => document.getElementById(id).value));
    assert(shrinkText.every((value) => value === '0.000001'), `Quick shrink rounded: ${JSON.stringify(shrinkText)}`);
    await page.screenshot({ path: path.join(OUT, '02-quick-shrink-floor.png'), fullPage: true });

    const teardown = await page.evaluate(() => {
      window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__?.dispose?.();
      return Boolean(window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__);
    });
    assert(teardown === false, 'Run264 global leaked after dispose');
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    console.log(`[checkRun264EditorMicroScaleBrowserV5] PASS ${JSON.stringify({ beforeCount: beforeIds.length, targetId, direct: { scale: direct.scale, text: direct.text, persisted: direct.persisted }, shrinkText, screenshots: 2 })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun264EditorMicroScaleBrowserV5] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
