#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run216');

function fail(message) {
  throw new Error(message);
}

function assert(value, message) {
  if (!value) fail(message);
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
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  return 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
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

async function openEditor(playwright, base) {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__WESTEROS_EDITOR_TRANSFORM__?.getSnapshot?.().attachedEditorId, null, { timeout: 30000 });
  return { browser, context, page, errors };
}

async function pointerPlan(page) {
  return page.evaluate(() => {
    const surface = window.__WESTEROS_EDITOR_TRANSFORM__;
    const api = window.__WESTEROS_WORLD_EDITOR__;
    const transform = surface.transform;
    transform.setMode('translate');
    transform.setSpace('world');
    surface.syncSnap();
    transform.updateMatrixWorld(true);
    api.camera.updateMatrixWorld(true);

    const canvasRect = api.canvas.getBoundingClientRect();
    const worldCenter = transform.worldPosition.clone();
    const projectedCenter = worldCenter.clone().project(api.camera);
    const projectedX = worldCenter.clone().add({ x: 4, y: 0, z: 0 }).project(api.camera);
    const centerScreen = {
      x: canvasRect.left + (projectedCenter.x + 1) * 0.5 * canvasRect.width,
      y: canvasRect.top + (1 - projectedCenter.y) * 0.5 * canvasRect.height
    };
    const xScreen = {
      x: canvasRect.left + (projectedX.x + 1) * 0.5 * canvasRect.width,
      y: canvasRect.top + (1 - projectedX.y) * 0.5 * canvasRect.height
    };
    const dx = xScreen.x - centerScreen.x;
    const dy = xScreen.y - centerScreen.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 2) throw new Error(`Projected X axis too small: ${length}`);

    const picker = transform._gizmo?.picker?.translate;
    if (!picker) throw new Error('Translate picker hierarchy unavailable');
    picker.updateMatrixWorld(true);
    const candidates = [];
    for (const handle of picker.children) {
      if (handle.name !== 'X' || !handle.geometry) continue;
      handle.geometry.computeBoundingBox();
      if (!handle.geometry.boundingBox) continue;
      const point = handle.geometry.boundingBox.clone().getCenter(handle.position.clone()).applyMatrix4(handle.matrixWorld).project(api.camera);
      candidates.push({
        x: canvasRect.left + (point.x + 1) * 0.5 * canvasRect.width,
        y: canvasRect.top + (1 - point.y) * 0.5 * canvasRect.height
      });
    }
    if (candidates.length === 0) throw new Error('No X-axis picker candidate found');
    candidates.sort((a, b) => Math.hypot(a.x - centerScreen.x, a.y - centerScreen.y) - Math.hypot(b.x - centerScreen.x, b.y - centerScreen.y));
    const start = candidates[candidates.length - 1];
    const distance = 90;
    return {
      start,
      end: { x: start.x + dx / length * distance, y: start.y + dy / length * distance },
      before: surface.getSnapshot()
    };
  });
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) fail('Playwright unavailable');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const { browser, context, page, errors } = await openEditor(playwright, base);
  try {
    await page.check('#we-snap-toggle');
    await page.fill('#we-snap-size', '1');
    const plan = await pointerPlan(page);
    assert(plan.before.mode === 'translate', `Unexpected initial mode ${plan.before.mode}`);
    assert(plan.before.translationSnap === 1, `Unexpected initial snap ${plan.before.translationSnap}`);

    await page.mouse.move(plan.start.x, plan.start.y);
    await page.mouse.down();
    await page.mouse.move(plan.end.x, plan.end.y, { steps: 12 });
    const during = await page.evaluate(() => window.__WESTEROS_EDITOR_TRANSFORM__.getSnapshot());
    assert(during.dragging === true, 'TransformControls did not enter real pointer dragging state');
    assert(during.orbitEnabled === false, 'OrbitControls remained enabled during real pointer dragging');
    await page.mouse.up();

    const after = await page.evaluate(() => window.__WESTEROS_EDITOR_TRANSFORM__.getSnapshot());
    assert(after.dragging === false, 'TransformControls did not leave dragging state after pointerup');
    assert(after.orbitEnabled === true, 'OrbitControls did not restore after real pointer drag');
    assert(after.objectPosition && plan.before.objectPosition, 'Attached object position unavailable');
    const deltaX = Math.abs(after.objectPosition[0] - plan.before.objectPosition[0]);
    assert(deltaX >= 0.5, `Real X-axis pointer drag did not move object enough: ${deltaX}`);
    assert(Math.abs(after.objectPosition[0] - Math.round(after.objectPosition[0])) < 1e-6, `Real pointer drag ignored 1m translation snap: ${after.objectPosition[0]}`);
    const inspectorX = Number(await page.inputValue('#we-pos-x'));
    assert(Math.abs(inspectorX - after.objectPosition[0]) < 1e-6, `Inspector X did not follow pointer drag: inspector=${inspectorX} object=${after.objectPosition[0]}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-transform-pointer-drag.png'), fullPage: true });
    console.log(`[checkRun216TransformControlsPointerDrag] PROOF: ${JSON.stringify({ before: plan.before.objectPosition, after: after.objectPosition, deltaX })}`);
    console.log('[checkRun216TransformControlsPointerDrag] PASS: real pointer drag, 1m snap, Inspector sync and Orbit lock/restore verified');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun216TransformControlsPointerDrag] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
