#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run259-editor-terrain-elevation-brush');

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
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
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
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  async function waitReady() {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__ &&
      window.__WESTEROS_EDITOR_LIVE_WORLD__ &&
      window.__WESTEROS_EDITOR_LIVE_AUTHORING__ &&
      window.__WESTEROS_EDITOR_TERRAIN__ &&
      window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__ &&
      document.getElementById('we-terrain-elevation-strength') &&
      document.getElementById('we-grid-toggle')?.disabled === true
    ), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 0, null, { timeout: 30000 });
    await page.waitForFunction(() => {
      const liveState = window.__WESTEROS_EDITOR_LIVE_WORLD__?.liveState;
      const scene = window.__WESTEROS_WORLD_EDITOR__?.scene;
      return [...(liveState?.chunkManager?.loaded?.values?.() || [])].some((mesh) => mesh?.isMesh && mesh.parent === scene);
    }, null, { timeout: 30000 });
  }

  async function findVisibleStroke() {
    const canvas = await page.locator('#we-canvas').boundingBox();
    assert(canvas && canvas.width > 100 && canvas.height > 100, `Editor canvas unavailable: ${JSON.stringify(canvas)}`);
    const stroke = await page.evaluate(({ left, top, width, height }) => {
      const live = window.__WESTEROS_EDITOR_LIVE_AUTHORING__;
      const candidates = [
        [0.50, 0.68], [0.40, 0.68], [0.60, 0.68], [0.50, 0.58],
        [0.35, 0.58], [0.65, 0.58], [0.50, 0.78], [0.30, 0.72],
        [0.70, 0.72], [0.25, 0.82], [0.75, 0.82], [0.20, 0.62],
        [0.80, 0.62], [0.35, 0.82], [0.65, 0.82], [0.50, 0.88]
      ];
      for (const [nx, ny] of candidates) {
        const clientX = left + width * nx;
        const clientY = top + height * ny;
        const point = live.surfacePointFromClient(clientX, clientY);
        if (point && [point.x, point.y, point.z].every(Number.isFinite)) {
          return { clientX, clientY, point: point.toArray(), normalized: [nx, ny] };
        }
      }
      return null;
    }, { left: canvas.x, top: canvas.y, width: canvas.width, height: canvas.height });
    assert(stroke, `No visible live terrain/water stroke point found: ${JSON.stringify(canvas)}`);
    return stroke;
  }

  async function dispatchStroke(stroke) {
    const common = { button: 0, pointerId: 17, pointerType: 'mouse', isPrimary: true, clientX: stroke.clientX, clientY: stroke.clientY };
    const canvas = page.locator('#we-canvas');
    await canvas.dispatchEvent('pointerdown', { ...common, buttons: 1 });
    await canvas.dispatchEvent('pointerup', { ...common, buttons: 0 });
  }

  async function capture(assetId) {
    return page.evaluate(async (wantedAssetId) => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const elevation = window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__;
      const liveState = window.__WESTEROS_EDITOR_LIVE_WORLD__.liveState;
      const object = api.editableObjects.find((candidate) => candidate.userData?.editorAssetId === wantedAssetId) || null;
      if (!object) return { object: null, snapshot: elevation.getSnapshot() };
      const x = object.position.x;
      const z = object.position.z;
      const offset = elevation.sampleOffsetAt(x, z);
      const colliderY = liveState.groundCollider.getGroundHeight(x, z);
      const baseY = colliderY - offset;
      const THREE = await import('./src/3d/vendor/three/three.module.js');
      const raycaster = new THREE.Raycaster(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0), 0, 2000);
      const meshes = [...liveState.chunkManager.loaded.values()].filter((mesh) => mesh?.isMesh && mesh.parent === api.scene);
      const hit = raycaster.intersectObjects(meshes, false)[0] || null;
      return {
        object: {
          id: object.userData.editorId,
          asset: object.userData.editorAssetId,
          scale: object.scale.toArray(),
          signedElevation: object.userData.editorTerrainElevationMeters
        },
        offset,
        colliderY,
        baseY,
        meshRayY: hit?.point?.y ?? null,
        snapshot: elevation.getSnapshot(),
        strengthValue: Number(document.getElementById('we-terrain-elevation-strength')?.value),
        gridVisible: api.grid.visible,
        gridDisabled: document.getElementById('we-grid-toggle')?.disabled === true
      };
    }, assetId);
  }

  async function runBrushCase({ mode, assetId, direction, screenshot }) {
    await waitReady();
    assert(errors.length === 0, `Boot browser errors: ${errors.join(' | ')}`);
    const stroke = await findVisibleStroke();
    await page.locator('#we-terrain-elevation-strength').fill('2');
    await page.locator('#we-terrain-elevation-strength').dispatchEvent('change');
    await page.locator(`[data-terrain-mode="${mode}"]`).click();
    await page.waitForFunction((wantedMode) => window.__WESTEROS_EDITOR_TERRAIN__?.getMode?.() === wantedMode, mode, { timeout: 5000 });
    await dispatchStroke(stroke);
    await page.waitForFunction((wantedAssetId) => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const elevation = window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__;
      return api?.editableObjects?.some((object) => object.userData?.editorAssetId === wantedAssetId) && elevation?.getSnapshot?.().stampCount === 1;
    }, assetId, { timeout: 30000 });
    await page.waitForTimeout(150);
    const state = await capture(assetId);
    assert(state.object, `${mode} did not create a persistent elevation stamp: ${JSON.stringify(state)}`);
    assert(state.object.scale[1] === 2, `${mode} strength did not persist in scale.y: ${JSON.stringify(state.object)}`);
    assert(state.object.signedElevation === direction * 2, `${mode} signed elevation metadata drifted: ${JSON.stringify(state.object)}`);
    assert(direction < 0 ? state.offset < -1.99 : state.offset > 1.99, `${mode} elevation direction drifted: ${JSON.stringify(state)}`);
    assert(direction < 0 ? state.colliderY < state.baseY - 1.99 : state.colliderY > state.baseY + 1.99, `${mode} collider elevation drifted: ${JSON.stringify(state)}`);
    assert(Number.isFinite(state.meshRayY) && Math.abs(state.meshRayY - state.colliderY) < 1.25, `${mode} rendered terrain/collider diverged: ${JSON.stringify(state)}`);
    assert(state.snapshot.groundColliderPatched === true && state.snapshot.stampCount === 1, `${mode} snapshot drifted: ${JSON.stringify(state.snapshot)}`);
    assert(state.strengthValue === 2, `${mode} Kot Δ UI drifted: ${JSON.stringify(state)}`);
    assert(state.gridVisible === false && state.gridDisabled === true, `${mode} owner grid policy drifted: ${JSON.stringify(state)}`);
    assert(errors.length === 0, `${mode} browser errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, screenshot), fullPage: true });
    return { stroke, state };
  }

  try {
    await waitReady();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-before-sculpt.png'), fullPage: true });
    const water = await runBrushCase({ mode: 'water-add', assetId: 'editor-water-cell', direction: -1, screenshot: '02-water-lowers-terrain.png' });
    const land = await runBrushCase({ mode: 'land-add', assetId: 'editor-land-cell', direction: 1, screenshot: '03-land-raises-terrain.png' });
    assert(Math.abs(water.state.baseY - water.state.colliderY - 2) < 0.01, `Sea brush did not lower by requested 2m: ${JSON.stringify(water.state)}`);
    assert(Math.abs(land.state.colliderY - land.state.baseY - 2) < 0.01, `Land brush did not raise by requested 2m: ${JSON.stringify(land.state)}`);
    console.log(`[checkRun259EditorTerrainElevationBrush] PASS ${JSON.stringify({ waterOffset: water.state.offset, landOffset: land.state.offset, strengthMeters: 2, screenshots: 3, unexpectedErrors: errors.length })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun259EditorTerrainElevationBrush] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
