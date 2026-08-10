#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'run216-editor-usability');
const fail = (message) => { throw new Error(message); };
const assert = (value, message) => { if (!value) fail(message); };

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
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openEditor(playwright, base, viewport) {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  /*
  page.on('pageerror', (error) => errors.push(String(error));
  */
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => Boolean(
    window.__WESTEROS_WORLD_EDITOR__ &&
    window.__WESTEROS_EDITOR_LIVE_WORLD__?.ready &&
    window.__WESTEROS_EDITOR_LIVE_AUTHORING__ &&
    window.__WESTEROS_EDITOR_LIVE_VISUALS__ &&
    window.__WESTEROS_EDITOR_PLACEMENT__ &&
    window.__WESTEROS_EDITOR_TRANSFORM__ &&
    window.__WESTEROS_EDITOR_ROADS__ &&
    window.__WESTEROS_EDITOR_TERRAIN__
  ), null, { timeout: 120000 });
  await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_WORLD__.ready);
  await page.waitForFunction(() => window.__WESTEROS_EDITOR_LIVE_WORLD__.getSnapshot().realCastlesReady, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0, null, { timeout: 30000 });
  return { browser, context, page, errors };
}

async function canvasPoint(page, xRatio, yRatio) {
  return page.evaluate(({ xRatio, yRatio }) => {
    const rect = window.__WESTEROS_WORLD_EDITOR__.canvas.getBoundingClientRect();
    return { x: rect.left + rect.width * xRatio, y: rect.top + rect.height * yRatio };
  }, { xRatio, yRatio });
}

async function desktopProof(playwright, base) {
  const { browser, context, page, errors } = await openEditor(playwright, base, { width: 1440, height: 900 });
  try {
    const boot = await page.evaluate(() => ({
      live: window.__WESTEROS_EDITOR_LIVE_WORLD__.getSnapshot(),
      authoring: window.__WESTEROS_EDITOR_LIVE_AUTHORING__.getSnapshot(),
      placement: window.__WESTEROS_EDITOR_PLACEMENT__.getSnapshot(),
      fog: window.__WESTEROS_WORLD_EDITOR__.scene.fog,
      badge: document.querySelector('.we-viewport-badge')?.textContent || ''
    }));
    assert(boot.live.terrainChunkCount > 0, 'Live terrain did not boot.');
    assert(boot.live.roadSegmentCount > 0, 'Canonical road network did not boot.');
    assert(boot.live.settlementCount === 14, `Expected 14 settlements, found ${boot.live.settlementCount}`);
    assert(boot.live.realCastleCount === 8, `Expected 8 real castles, found ${boot.live.realCastleCount}`);
    assert(boot.authoring.syntheticGroundHidden && boot.authoring.groundRaycastPatched, 'Synthetic ground was not replaced as authoring surface.');
    assert(boot.fog === null, 'Edit mode fog is not disabled.');
    assert(boot.badge.includes('LIVE WORLD'), `Live-world badge missing: ${boot.badge}`);

    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'desktop-live-world-01.png'), fullPage: true });

    const tree = page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first();
    await tree.click();
    await page.click('#we-place-mode');
    const placementPoint = await canvasPoint(page, 0.52, 0.58);
    const expectedSurface = await page.evaluate(({ x, y }) => window.__WESTEROS_EDITOR_LIVE_AUTHORING__.surfacePointFromClient(x, y)?.toArray() || null, placementPoint);
    assert(expectedSurface, 'Placement screen point did not intersect live world.');
    await page.mouse.click(placementPoint.x, placementPoint.y);
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    const placed = await page.evaluate(() => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const object = api.editableObjects[0];
      const ground = window.__WESTEROS_EDITOR_LIVE_AUTHORING__.groundHeight(object.position.x, object.position.z);
      return { id: object.userData.editorId, asset: object.userData.editorAssetId, position: object.position.toArray(), ground };
    });
    assert(placed.asset === 'marker-tree', `Click placement created unexpected asset: ${placed.asset}`);
    assert(placed.id.includes('-placed-'), `Click placement id is not fresh: ${placed.id}`);
    assert(placed.position[1] >= placed.ground - 0.001, 'Placed asset is below canonical ground.');

    await page.evaluate(() => { window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].position.y += 25; });
    await page.click('#we-ground-selected');
    const grounded = await page.evaluate(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];
      return { y: object.position.y, ground: window.__WESTEROS_EDITOR_LIVE_AUTHORING__.groundHeight(object.position.x, object.position.z) };
    });
    assert(Math.abs(grounded.y - grounded.ground) < 0.05, `Tree did not ground-snap: ${JSON.stringify(grounded)}`);
    await page.click('#we-place-mode');

    const visualBefore = await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_VISUALS__.getSnapshot());
    await page.evaluate(() => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      api.camera.position.x += 650;
      api.camera.position.z += 280;
      api.orbitControls.target.x += 650;
      api.orbitControls.target.z += 280;
      api.orbitControls.update();
      window.__WESTEROS_EDITOR_LIVE_AUTHORING__.syncWorkingArea();
    });
    await page.waitForTimeout(150);
    const visualAfter = await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_VISUALS__.getSnapshot());
    const near = (a, b) => Math.abs(a - b) < 0.1;
    assert(near(visualAfter.waterCenter[0], visualAfter.cameraPosition[0]) && near(visualAfter.waterCenter[2], visualAfter.cameraPosition[2]), 'Water did not follow editor camera.');
    assert(visualAfter.skyCenter.every((value, index) => near(value, visualAfter.cameraPosition[index])), 'Sky did not follow editor camera.');
    assert(visualAfter.starsCenter.every((value, index) => near(value, visualAfter.cameraPosition[index])), 'Stars did not follow editor camera.');
    assert(!near(visualBefore.cameraPosition[0], visualAfter.cameraPosition[0]), 'Camera movement proof did not move.');
    await page.screenshot({ path: path.join(OUT, 'desktop-live-world-02.png'), fullPage: true });

    const roadA = await canvasPoint(page, 0.47, 0.58);
    const roadB = await canvasPoint(page, 0.55, 0.58);
    const expectedRoadA = await page.evaluate(({ x, y }) => window.__WESTEROS_EDITOR_LIVE_AUTHORING__.surfacePointFromClient(x, y)?.toArray() || null, roadA);
    const expectedRoadB = await page.evaluate(({ x, y }) => window.__WESTEROS_EDITOR_LIVE_AUTHORING__.surfacePointFromClient(x, y)?.toArray() || null, roadB);
    assert(expectedRoadA && expectedRoadB, 'Road proof points did not intersect live surface.');
    await page.click('#we-road-draw');
    await page.mouse.click(roadA.x, roadA.y);
    await page.mouse.click(roadB.x, roadB.y);
    await page.evaluate(() => window.__WESTEROS_EDITOR_ROADS__.waitForPendingSegments());
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.some((object) => object.userData.editorAssetId === 'editor-road-segment'));
    const road = await page.evaluate(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects.find((candidate) => candidate.userData.editorAssetId === 'editor-road-segment');
      return { from: object.userData.editorRoadFrom, to: object.userData.editorRoadTo };
    });
    assert(road.from.every(Number.isFinite) && road.to.every(Number.isFinite), 'Road endpoints are not finite.');
    assert(Math.abs(road.from[1] - expectedRoadA[1]) < 0.15, `Road start ignored live surface: ${road.from[1]} vs ${expectedRoadA[1]}`);
    assert(Math.abs(road.to[1] - expectedRoadB[1]) < 0.15, `Road end ignored live surface: ${road.to[1]} vs ${expectedRoadB[1]}`);
    await page.click('#we-road-draw');

    const terrainPoint = await canvasPoint(page, 0.50, 0.62);
    const expectedTerrain = await page.evaluate(({ x, y }) => window.__WESTEROS_EDITOR_LIVE_AUTHORING__.surfacePointFromClient(x, y)?.toArray() || null, terrainPoint);
    assert(expectedTerrain, 'Terrain proof point did not intersect live surface.');
    await page.click('[data-terrain-mode="land-add"]');
    await page.mouse.click(terrainPoint.x, terrainPoint.y);
    await page.waitForFunction(() => !window.__WESTEROS_EDITOR_TERRAIN__.isBusy());
    const land = await page.evaluate(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects.find((candidate) => candidate.userData.editorAssetId === 'editor-land-cell');
      return object ? { id: object.userData.editorId, position: object.position.toArray() } : null;
    });
    assert(land, 'Kara + did not create a persistent land cell.');
    assert(Math.abs(land.position[1] - expectedTerrain[1]) < 0.15, `Land cell ignored live surface Y: ${land.position[1]} vs ${expectedTerrain[1]}`);
    await page.click('[data-terrain-mode="land-remove"]');
    await page.mouse.click(terrainPoint.x, terrainPoint.y);
    await page.waitForFunction(() => !window.__WESTEROS_EDITOR_TERRAIN__.isBusy());
    const landCount = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.filter((object) => object.userData.editorAssetId === 'editor-land-cell').length);
    assert(landCount === 0, `Kara − did not remove painted cell: ${landCount}`);

    const downloadPromise = page.waitForEvent('download');
    await page.click('#we-save');
    const download = await downloadPromise;
    const downloadPath = await download.path();
    assert(downloadPath, 'Scene JSON download did not produce a file.');
    const sceneText = fs.readFileSync(downloadPath, 'utf8');
    const sceneData = JSON.parse(sceneText);
    assert(sceneData.schemaVersion === 1, `Unexpected scene schema: ${sceneData.schemaVersion}`);
    assert(sceneData.objects.some((object) => object.id === placed.id), 'Saved JSON lost placed object.');
    assert(sceneData.objects.some((object) => object.asset === 'editor-road-segment'), 'Saved JSON lost road segment.');

    const idsBeforeLoad = sceneData.objects.map((object) => object.id).sort();
    await page.setInputFiles('#we-load-file', { name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(sceneText) });
    await page.waitForFunction(() => document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.', null, { timeout: 30000 });
    const idsAfterLoad = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.map((object) => object.userData.editorId).sort());
    assert(JSON.stringify(idsAfterLoad) === JSON.stringify(idsBeforeLoad), `Save/load round-trip ids drifted: ${JSON.stringify({ idsBeforeLoad, idsAfterLoad })}`);

    assert(errors.length === 0, `Desktop console/page errors: ${errors.join(' | ')}`);
    console.log(`[checkRun216EditorUsabilityBrowser] DESKTOP PROOF: ${JSON.stringify({ boot, placed, grounded, road, idsAfterLoad, visualAfter })}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function mobileProof(playwright, base) {
  const { browser, context, page, errors } = await openEditor(playwright, base, { width: 390, height: 844 });
  try {
    const proof = await page.evaluate(() => {
      const visible = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      return {
        placement: visible('#we-place-mode'),
        ground: visible('#we-ground-selected'),
        road: visible('#we-road-draw'),
        land: visible('[data-terrain-mode="land-add"]'),
        water: visible('[data-terrain-mode="water-add"]'),
        copy: visible('#we-copy'),
        paste: visible('#we-paste'),
        live: window.__WESTEROS_EDITOR_LIVE_WORLD__.getSnapshot(),
        authoring: window.__WESTEROS_EDITOR_LIVE_AUTHORING__.getSnapshot(),
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      };
    });
    assert(proof.placement && proof.ground && proof.road && proof.land && proof.water && proof.copy && proof.paste, `Mobile editor tools hidden: ${JSON.stringify(proof)}`);
    assert(proof.live.terrainChunkCount > 0 && proof.authoring.groundRaycastPatched, 'Mobile live terrain authoring is not ready.');
    assert(proof.scrollWidth <= proof.viewportWidth + 2, `Mobile global horizontal overflow: ${proof.scrollWidth} > ${proof.viewportWidth}`);
    assert(errors.length === 0, `Mobile console/page errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(OUT, 'mobile-live-world.png'), fullPage: true });
    console.log(`[checkRun216EditorUsabilityBrowser] MOBILE PROOF: ${JSON.stringify(proof)}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) fail('Playwright unavailable');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await desktopProof(playwright, base);
    await mobileProof(playwright, base);
    console.log('[checkRun216EditorUsabilityBrowser] PASS: live-world desktop/mobile editor usability, two-angle visual evidence, click placement, ground snap, live-surface road/terrain authoring, save/load round-trip and console-zero verified.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun216EditorUsabilityBrowser] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});