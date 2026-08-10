#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run216-editor-authoring');

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
  if (ext === '.webp') return 'image/webp';
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

async function openEditor(playwright, base, viewport) {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => (
    window.__WESTEROS_WORLD_EDITOR__ &&
    window.__WESTEROS_EDITOR_TRANSFORM__ &&
    window.__WESTEROS_EDITOR_CLIPBOARD__ &&
    window.__WESTEROS_EDITOR_ENVIRONMENT__ &&
    window.__WESTEROS_EDITOR_ROADS__ &&
    window.__WESTEROS_EDITOR_TERRAIN__
  ), null, { timeout: 30000 });
  await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length >= 2, null, { timeout: 30000 });
  return { browser, context, page, errors };
}

async function worldPointScreen(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const api = window.__WESTEROS_WORLD_EDITOR__;
    api.camera.updateMatrixWorld(true);
    const rect = api.canvas.getBoundingClientRect();
    const point = api.grid.position.clone().set(x, 0, z).project(api.camera);
    const screen = {
      x: rect.left + (point.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - point.y) * 0.5 * rect.height,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    };
    return screen;
  }, { x, z });
}

function assertInsideCanvas(point, label) {
  assert(Number.isFinite(point.x) && Number.isFinite(point.y), `${label} projected to non-finite screen coordinates`);
  assert(point.x > point.rect.left + 5 && point.x < point.rect.right - 5, `${label} projected outside canvas horizontally`);
  assert(point.y > point.rect.top + 5 && point.y < point.rect.bottom - 5, `${label} projected outside canvas vertically`);
}

async function desktopProof(playwright, base) {
  const { browser, context, page, errors } = await openEditor(playwright, base, { width: 1440, height: 900 });
  try {
    const environment = await page.evaluate(() => window.__WESTEROS_EDITOR_ENVIRONMENT__.getSnapshot());
    assert(environment.fogDisabled === true, 'Edit Mode fog is not disabled');

    await page.evaluate(() => window.__WESTEROS_EDITOR_CLIPBOARD__.syncButtons());
    await page.waitForFunction(() => !document.getElementById('we-copy').disabled);
    const beforeClipboardCount = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length);
    await page.click('#we-copy');
    assert(await page.isEnabled('#we-paste'), 'Paste did not enable after copy');
    await page.click('#we-paste');
    await page.waitForFunction((count) => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === count + 1, beforeClipboardCount);
    const pasted = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.at(-1).userData.editorId);
    assert(pasted.includes('-paste-'), `Paste did not create a fresh paste id: ${pasted}`);

    const beforeDuplicateCount = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length);
    await page.click('#we-duplicate');
    await page.waitForFunction((count) => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === count + 1, beforeDuplicateCount);
    const duplicated = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.at(-1).userData.editorId);
    assert(duplicated.includes('-duplicate-'), `Duplicate did not use safe recreation id: ${duplicated}`);
    assert((await page.textContent('#we-duplicate')).trim() === 'Çoğalt', 'Legacy copy button was not relabeled to Çoğalt');

    const binaButton = page.getByRole('button', { name: 'Bina', exact: true });
    await binaButton.click();
    assert(await page.locator('#we-assets .we-asset').count() === 8, 'Bina category does not expose exactly 8 optimized buildings');
    const beforeBuildingCount = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length);
    await page.locator('#we-assets .we-asset').first().dblclick();
    await page.waitForFunction((count) => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === count + 1, beforeBuildingCount, { timeout: 120000 });
    const building = await page.evaluate(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects.at(-1);
      const box = new window.__WESTEROS_WORLD_EDITOR__.grid.geometry.constructor; // sentinel only; bounds are checked through object scale policy in Node contract
      void box;
      return { assetId: object.userData.editorAssetId, scale: object.scale.toArray() };
    });
    assert(building.assetId.startsWith('castle_'), `Building placement loaded unexpected asset ${building.assetId}`);
    assert(building.scale.every(Number.isFinite), 'Building placement produced non-finite scale');

    await page.click('#we-road-draw');
    const roadA = await worldPointScreen(page, -20, -20);
    const roadB = await worldPointScreen(page, 0, -20);
    assertInsideCanvas(roadA, 'road A');
    assertInsideCanvas(roadB, 'road B');
    await page.mouse.click(roadA.x, roadA.y);
    await page.mouse.click(roadB.x, roadB.y);
    await page.evaluate(() => window.__WESTEROS_EDITOR_ROADS__.waitForPendingSegments());
    const roadCount = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.filter((object) => object.userData.editorAssetId === 'editor-road-segment').length);
    assert(roadCount >= 1, 'Road drawing did not create a persistent road segment');

    const terrainPoint = await worldPointScreen(page, -30, 20);
    assertInsideCanvas(terrainPoint, 'terrain');
    const landBefore = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.filter((object) => object.userData.editorAssetId === 'editor-land-cell').length);
    await page.click('[data-terrain-mode="land-add"]');
    await page.mouse.click(terrainPoint.x, terrainPoint.y);
    await page.waitForFunction(() => !window.__WESTEROS_EDITOR_TERRAIN__.isBusy());
    const landAfter = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.filter((object) => object.userData.editorAssetId === 'editor-land-cell').length);
    assert(landAfter === landBefore + 1, `Land add did not create exactly one cell: ${landBefore} -> ${landAfter}`);

    const waterBefore = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.filter((object) => object.userData.editorAssetId === 'editor-water-cell').length);
    await page.click('[data-terrain-mode="water-add"]');
    await page.mouse.click(terrainPoint.x, terrainPoint.y);
    await page.waitForFunction(() => !window.__WESTEROS_EDITOR_TERRAIN__.isBusy());
    const terrainSwap = await page.evaluate(() => ({
      land: window.__WESTEROS_WORLD_EDITOR__.editableObjects.filter((object) => object.userData.editorAssetId === 'editor-land-cell').length,
      water: window.__WESTEROS_WORLD_EDITOR__.editableObjects.filter((object) => object.userData.editorAssetId === 'editor-water-cell').length
    }));
    assert(terrainSwap.land === landBefore, 'Water add did not replace the same-size land cell');
    assert(terrainSwap.water === waterBefore + 1, 'Water add did not create exactly one water cell');

    await page.click('[data-terrain-mode="water-remove"]');
    await page.mouse.click(terrainPoint.x, terrainPoint.y);
    await page.waitForFunction(() => !window.__WESTEROS_EDITOR_TERRAIN__.isBusy());
    const waterAfterRemove = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.filter((object) => object.userData.editorAssetId === 'editor-water-cell').length);
    assert(waterAfterRemove === waterBefore, 'Water remove did not delete the painted water cell');

    assert(errors.length === 0, `Desktop browser errors: ${errors.join(' | ')}`);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-authoring.png'), fullPage: true });
    console.log(`[checkRun216EditorAuthoringBrowser] DESKTOP PROOF: ${JSON.stringify({ pasted, duplicated, building: building.assetId, roadCount, landBefore, landAfter, terrainSwap, waterAfterRemove })}`);
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
        return Boolean(element && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
      };
      return {
        fogDisabled: window.__WESTEROS_EDITOR_ENVIRONMENT__.getSnapshot().fogDisabled,
        copy: visible('#we-copy'),
        paste: visible('#we-paste'),
        road: visible('#we-road-draw'),
        land: visible('[data-terrain-mode="land-add"]'),
        water: visible('[data-terrain-mode="water-add"]'),
        bodyScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      };
    });
    assert(proof.fogDisabled === true, 'Mobile Edit Mode fog is not disabled');
    assert(proof.copy && proof.paste && proof.road && proof.land && proof.water, `Mobile authoring tools hidden: ${JSON.stringify(proof)}`);
    assert(proof.bodyScrollWidth <= proof.viewportWidth + 2, `Mobile page has global horizontal overflow: ${proof.bodyScrollWidth} > ${proof.viewportWidth}`);
    assert(errors.length === 0, `Mobile browser errors: ${errors.join(' | ')}`);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile-authoring.png'), fullPage: true });
    console.log(`[checkRun216EditorAuthoringBrowser] MOBILE PROOF: ${JSON.stringify(proof)}`);
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
    console.log('[checkRun216EditorAuthoringBrowser] PASS: desktop/mobile fog-free authoring, clipboard, building placement, roads, land/sea add-remove and console-zero verified.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun216EditorAuthoringBrowser] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
