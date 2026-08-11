#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run259-editor-micro-scale-final');
const MICRO = 0.000001;
const PRE_SHRINK = 0.000010;

function assert(value, message) { if (!value) throw new Error(message); }
function near(a, b, epsilon = 1e-12) { return Math.abs(Number(a) - Number(b)) <= epsilon; }
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
  if (ext === '.json' || ext === '.webmanifest') return 'application/json; charset=utf-8';
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
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  async function userTypeScale(id, value) {
    const input = page.locator(`#${id}`);
    await input.click();
    await input.press('Control+A');
    await input.type(value, { delay: 10 });
    await input.press('Tab');
    await page.waitForTimeout(170);
  }
  async function userTypeAll(value) {
    for (const id of ['we-scale-x', 'we-scale-y', 'we-scale-z']) await userTypeScale(id, value);
  }
  async function state() {
    return page.evaluate(() => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const object = api?.getSelectedObject?.() || api?.editableObjects?.[0] || null;
      return {
        scale: object?.scale?.toArray?.() || null,
        values: ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => document.getElementById(id)?.value ?? null),
        min: ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => document.getElementById(id)?.min ?? null),
        step: ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => document.getElementById(id)?.step ?? null),
        version: window.__WESTEROS_EDITOR_MICRO_SCALE__?.version ?? null,
        minimumScale: window.__WESTEROS_EDITOR_MICRO_SCALE__?.minimumScale ?? null,
        decimals: window.__WESTEROS_EDITOR_MICRO_SCALE__?.decimals ?? null
      };
    });
  }

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__ &&
      window.__WESTEROS_EDITOR_HISTORY__ &&
      window.__WESTEROS_EDITOR_MICRO_SCALE__?.version === 2 &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0
    ), null, { timeout: 120000 });

    const initial = await state();
    assert(initial.version === 2, `micro-scale V2 surface missing: ${JSON.stringify(initial)}`);
    assert(near(initial.minimumScale, MICRO), `minimumScale mismatch: ${JSON.stringify(initial)}`);
    assert(initial.decimals === 6, `six-decimal policy missing: ${JSON.stringify(initial)}`);
    assert(initial.min.every((value) => value === '0.000001'), `min metadata mismatch: ${JSON.stringify(initial.min)}`);
    assert(initial.step.every((value) => value === '0.000001'), `step metadata mismatch: ${JSON.stringify(initial.step)}`);

    await page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first().dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();

    await userTypeAll('0.000001');
    const direct = await state();
    assert(direct.scale.every((value) => near(value, MICRO)), `X/Y/Z did not reach 0.000001: ${JSON.stringify(direct)}`);
    assert(direct.values.every((value) => value === '0.000001'), `Inspector did not preserve six decimals: ${JSON.stringify(direct.values)}`);

    const serialized = await page.evaluate(async () => {
      const { serializeEditorScene } = await import('/src/3d/editor/EditorSceneSerializer.js');
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const scene = serializeEditorScene(api.editableObjects, api.instanceManager.serialize(), api.getEditorState());
      return { scale: scene.objects[0].transform.scale, json: JSON.stringify(scene) };
    });
    assert(serialized.scale.every((value) => near(value, MICRO)), `scene serializer lost 0.000001: ${JSON.stringify(serialized.scale)}`);
    assert(serialized.json.includes('0.000001'), 'scene JSON does not contain 0.000001');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-direct-000001.png'), fullPage: true });

    await userTypeAll('0.000010');
    const preShrink = await state();
    assert(preShrink.scale.every((value) => near(value, PRE_SHRINK)), `quick-shrink setup failed: ${JSON.stringify(preShrink)}`);
    await page.click('#we-quick-shrink');
    await page.waitForFunction((expected) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.getSelectedObject?.();
      return Boolean(object) && object.scale.toArray().every((value) => Math.abs(value - expected) < 1e-12);
    }, MICRO, { timeout: 30000 });
    const shrunk = await state();
    assert(shrunk.values.every((value) => value === '0.000001'), `quick-shrink display lost 1e-6: ${JSON.stringify(shrunk)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-quick-shrink-000001.png'), fullPage: true });

    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    const reselected = await state();
    assert(reselected.scale.every((value) => near(value, MICRO)), `reselection changed micro scale: ${JSON.stringify(reselected)}`);
    assert(reselected.values.every((value) => value === '0.000001'), `reselection display lost six decimals: ${JSON.stringify(reselected)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-reselected-000001.png'), fullPage: true });

    assert(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
    console.log(`[checkRun259EditorMicroScaleBrowserFinal] PASS ${JSON.stringify({ initial, direct, serializedScale: serialized.scale, preShrink, shrunk, reselected, screenshots: 3 })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun259EditorMicroScaleBrowserFinal] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
