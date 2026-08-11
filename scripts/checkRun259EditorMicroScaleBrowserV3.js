#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run259-editor-micro-scale-v3');
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

  async function readObject() {
    return page.evaluate(() => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const object = api?.editableObjects?.[0] || null;
      return object ? {
        editorId: object.userData?.editorId || null,
        scale: object.scale.toArray(),
        position: object.position.toArray(),
        values: ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => document.getElementById(id)?.value ?? null)
      } : null;
    });
  }

  async function userTypeScale(id, value) {
    const input = page.locator(`#${id}`);
    await input.click();
    await input.press('Control+A');
    await input.type(value, { delay: 12 });
    await input.press('Tab');
    await page.waitForTimeout(190);
  }
  async function userTypeAll(value) {
    for (const id of ['we-scale-x', 'we-scale-y', 'we-scale-z']) await userTypeScale(id, value);
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
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted === true, null, { timeout: 30000 });

    const policy = await page.evaluate(() => ({
      version: window.__WESTEROS_EDITOR_MICRO_SCALE__?.version,
      minimumScale: window.__WESTEROS_EDITOR_MICRO_SCALE__?.minimumScale,
      decimals: window.__WESTEROS_EDITOR_MICRO_SCALE__?.decimals,
      min: ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => document.getElementById(id).min),
      step: ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => document.getElementById(id).step)
    }));
    assert(policy.version === 2 && near(policy.minimumScale, MICRO) && policy.decimals === 6, `micro policy mismatch: ${JSON.stringify(policy)}`);
    assert(policy.min.every((value) => value === '0.000001') && policy.step.every((value) => value === '0.000001'), `input metadata mismatch: ${JSON.stringify(policy)}`);

    await page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first().dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();

    await userTypeAll('0.000001');
    const direct = await readObject();
    assert(direct.scale.every((value) => near(value, MICRO)), `three-axis micro scale failed: ${JSON.stringify(direct)}`);
    assert(direct.values.every((value) => value === '0.000001'), `six-decimal Inspector failed: ${JSON.stringify(direct)}`);

    const serialized = await page.evaluate(async () => {
      const { serializeEditorScene } = await import('/src/3d/editor/EditorSceneSerializer.js');
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const scene = serializeEditorScene(api.editableObjects, api.instanceManager.serialize(), api.getEditorState());
      return { scale: scene.objects[0].transform.scale, json: JSON.stringify(scene) };
    });
    assert(serialized.scale.every((value) => near(value, MICRO)) && serialized.json.includes('0.000001'), `scene JSON lost micro scale: ${JSON.stringify(serialized.scale)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-direct-000001.png'), fullPage: true });

    await userTypeAll('0.000010');
    const preShrink = await readObject();
    assert(preShrink.scale.every((value) => near(value, PRE_SHRINK)), `quick-shrink setup failed: ${JSON.stringify(preShrink)}`);
    await page.click('#we-quick-shrink');
    await page.waitForFunction((expected) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.getSelectedObject?.();
      return Boolean(object) && object.scale.toArray().every((value) => Math.abs(value - expected) < 1e-12);
    }, MICRO, { timeout: 30000 });
    const shrunk = await readObject();
    assert(shrunk.values.every((value) => value === '0.000001'), `quick-shrink precision failed: ${JSON.stringify(shrunk)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-quick-shrink-000001.png'), fullPage: true });

    await page.waitForTimeout(230);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());
    const baseline = await readObject();
    const changedPosition = baseline.position[0] + 3;
    await page.evaluate((nextX) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];
      object.position.x = nextX;
      window.__WESTEROS_EDITOR_HISTORY__.captureNow();
    }, changedPosition);
    const moved = await readObject();
    assert(near(moved.position[0], changedPosition) && moved.scale.every((value) => near(value, MICRO)), `history setup changed micro scale: ${JSON.stringify(moved)}`);

    await page.click('#we-undo');
    await page.waitForFunction((expectedX) => (
      window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1 &&
      Math.abs(window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].position.x - expectedX) < 1e-9
    ), baseline.position[0], { timeout: 120000 });
    const afterUndo = await readObject();
    assert(afterUndo.scale.every((value) => near(value, MICRO)), `undo lost micro scale: ${JSON.stringify(afterUndo)}`);

    await page.click('#we-redo');
    await page.waitForFunction((expectedX) => (
      window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false &&
      window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1 &&
      Math.abs(window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].position.x - expectedX) < 1e-9
    ), changedPosition, { timeout: 120000 });
    const afterRedo = await readObject();
    assert(afterRedo.scale.every((value) => near(value, MICRO)), `redo lost micro scale: ${JSON.stringify(afterRedo)}`);

    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    await page.waitForFunction(() => ['we-scale-x', 'we-scale-y', 'we-scale-z'].every((id) => document.getElementById(id).value === '0.000001'), null, { timeout: 30000 });
    const reselected = await readObject();
    assert(reselected.values.every((value) => value === '0.000001'), `reselection lost six-decimal micro scale: ${JSON.stringify(reselected)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-redo-reselected-000001.png'), fullPage: true });

    assert(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
    console.log(`[checkRun259EditorMicroScaleBrowserV3] PASS ${JSON.stringify({ policy, direct, serializedScale: serialized.scale, preShrink, shrunk, baseline, moved, afterUndo, afterRedo, reselected, screenshots: 3 })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun259EditorMicroScaleBrowserV3] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
