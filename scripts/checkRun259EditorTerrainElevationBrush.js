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
      const terrainMeshes = [...liveState.chunkManager.loaded.values()].filter((mesh) => mesh?.isMesh && mesh.parent === api.scene);
      const hit = raycaster.intersectObjects(terrainMeshes, false)[0] || null;
      return {
        object: {
          id: object.userData.editorId,
          asset: object.userData.editorAssetId,
          position: object.position.toArray(),
          scale: object.scale.toArray(),
          signedElevation: object.userData.editorTerrainElevationMeters
        },
        offset,
        colliderY,
        baseY,
        meshRayY: hit?.point?.y ?? null,
        objectCount: api.editableObjects.length,
        snapshot: elevation.getSnapshot(),
        strengthValue: Number(document.getElementById('we-terrain-elevation-strength')?.value),
        gridVisible: api.grid.visible,
        gridDisabled: document.getElementById('we-grid-toggle')?.disabled === true,
        selection: document.getElementById('we-selection-status')?.textContent || ''
      };
    }, assetId);
  }

  async function dispatchTerrainStroke(clientX, clientY) {
    const canvas = page.locator('#we-canvas');
    const common = { button: 0, pointerId: 17, pointerType: 'mouse', isPrimary: true, clientX, clientY };
    await canvas.dispatchEvent('pointerdown', { ...common, buttons: 1 });
    await canvas.dispatchEvent('pointerup', { ...common, buttons: 0 });
  }

  try {
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
    assert(errors.length === 0, `Boot browser errors: ${errors.join(' | ')}`);

    const canvas = await page.locator('#we-canvas').boundingBox();
    assert(canvas && canvas.width > 100 && canvas.height > 100, `Editor canvas unavailable: ${JSON.stringify(canvas)}`);
    const clickX = canvas.x + canvas.width * 0.5;
    const clickY = canvas.y + canvas.height * 0.5;
    const surfacePoint = await page.evaluate(({ x, y }) => window.__WESTEROS_EDITOR_LIVE_AUTHORING__.surfacePointFromClient(x, y)?.toArray?.() || null, { x: clickX, y: clickY });
    assert(surfacePoint && surfacePoint.every(Number.isFinite), `Canvas center does not resolve to live terrain/water surface: ${JSON.stringify({ canvas, clickX, clickY, surfacePoint })}`);

    await page.locator('#we-terrain-elevation-strength').fill('2');
    await page.locator('#we-terrain-elevation-strength').dispatchEvent('change');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-before-sculpt.png'), fullPage: true });

    await page.locator('[data-terrain-mode="water-add"]').click();
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_TERRAIN__?.getMode?.() === 'water-add', null, { timeout: 5000 });
    await dispatchTerrainStroke(clickX, clickY);
    await page.waitForFunction(() => {
      const elevation = window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__;
      return elevation?.getSnapshot?.().waterStampCount === 1 && elevation.getSnapshot().landStampCount === 0;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(150);
    const water = await capture('editor-water-cell');
    assert(water.object, `Water brush did not create a persistent water elevation stamp: ${JSON.stringify(water)}`);
    assert(water.object.scale[1] === 2, `Water brush strength did not persist in scale.y: ${JSON.stringify(water.object)}`);
    assert(water.object.signedElevation === -2, `Water signed elevation metadata drifted: ${JSON.stringify(water.object)}`);
    assert(water.offset < -1.99, `Water brush must lower terrain at stamp center: ${JSON.stringify(water)}`);
    assert(water.colliderY < water.baseY - 1.99, `Ground collider did not move downward: ${JSON.stringify(water)}`);
    assert(Number.isFinite(water.meshRayY) && Math.abs(water.meshRayY - water.colliderY) < 1.25, `Rendered terrain and lowered collider diverged: ${JSON.stringify(water)}`);
    assert(water.snapshot.groundColliderPatched === true && water.snapshot.waterStampCount === 1, `Water snapshot drifted: ${JSON.stringify(water.snapshot)}`);
    assert(water.gridVisible === false && water.gridDisabled === true, `Owner grid policy drifted: ${JSON.stringify(water)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-water-lowers-terrain.png'), fullPage: true });

    await page.locator('[data-terrain-mode="land-add"]').click();
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_TERRAIN__?.getMode?.() === 'land-add', null, { timeout: 5000 });
    await dispatchTerrainStroke(clickX, clickY);
    await page.waitForFunction(() => {
      const elevation = window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__;
      return elevation?.getSnapshot?.().landStampCount === 1 && elevation.getSnapshot().waterStampCount === 0;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(150);
    const land = await capture('editor-land-cell');
    assert(land.object, `Land brush did not create a persistent land elevation stamp: ${JSON.stringify(land)}`);
    assert(land.object.scale[1] === 2, `Land brush strength did not persist in scale.y: ${JSON.stringify(land.object)}`);
    assert(land.object.signedElevation === 2, `Land signed elevation metadata drifted: ${JSON.stringify(land.object)}`);
    assert(land.offset > 1.99, `Land brush must raise terrain at stamp center: ${JSON.stringify(land)}`);
    assert(land.colliderY > land.baseY + 1.99, `Ground collider did not move upward: ${JSON.stringify(land)}`);
    assert(Math.abs(land.baseY - water.baseY) < 0.0001, `Base procedural terrain changed instead of additive overlay: ${JSON.stringify({ water, land })}`);
    assert(Number.isFinite(land.meshRayY) && Math.abs(land.meshRayY - land.colliderY) < 1.25, `Rendered terrain and raised collider diverged: ${JSON.stringify(land)}`);
    assert(land.objectCount === 1, `Land/water conversion must leave one terrain stamp: ${JSON.stringify(land)}`);
    assert(land.snapshot.landStampCount === 1 && land.snapshot.waterStampCount === 0, `Land snapshot drifted: ${JSON.stringify(land.snapshot)}`);
    assert(land.strengthValue === 2, `Kot strength UI drifted: ${JSON.stringify(land)}`);
    assert(land.gridVisible === false && land.gridDisabled === true, `Owner grid policy drifted after land brush: ${JSON.stringify(land)}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-land-raises-terrain.png'), fullPage: true });

    console.log(`[checkRun259EditorTerrainElevationBrush] PASS ${JSON.stringify({ surfacePoint, waterOffset: water.offset, waterGround: water.colliderY, landOffset: land.offset, landGround: land.colliderY, baseGround: land.baseY, strengthMeters: land.strengthValue, screenshots: 3, unexpectedErrors: errors.length })}`);
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
