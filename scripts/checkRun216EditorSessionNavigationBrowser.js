#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'run216-editor-session-navigation');
const fail = (message) => { throw new Error(message); };
const assert = (value, message) => { if (!value) fail(message); };

function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} }
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
  return 'application/octet-stream';
}
function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
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
  await page.waitForFunction(() => Boolean(
    window.__WESTEROS_EDITOR_LIVE_WORLD__?.ready &&
    window.__WESTEROS_EDITOR_LIVE_AUTHORING__ &&
    window.__WESTEROS_EDITOR_PLACEMENT__ &&
    window.__WESTEROS_EDITOR_TERRAIN_SEMANTICS__ &&
    window.__WESTEROS_EDITOR_LOCAL_SESSION__ &&
    window.__WESTEROS_EDITOR_HISTORY__ &&
    window.__WESTEROS_EDITOR_LOCATION_NAV__ &&
    window.__WESTEROS_EDITOR_GAME_PREVIEW_LAUNCHER__
  ), null, { timeout: 120000 });
  await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_WORLD__.ready);
  await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted, null, { timeout: 30000 });
  return { browser, context, page, errors };
}
async function desktopProof(playwright, base) {
  const { browser, context, page, errors } = await openEditor(playwright, base, { width: 1440, height: 900 });
  try {
    const semantic = await page.evaluate(() => window.__WESTEROS_EDITOR_TERRAIN_SEMANTICS__.getSnapshot());
    assert(semantic.landRemoveLabel === 'Kara → Deniz' && semantic.waterRemoveLabel === 'Deniz → Kara', `Terrain semantic labels wrong: ${JSON.stringify(semantic)}`);

    const navBefore = await page.evaluate(() => window.__WESTEROS_EDITOR_LOCATION_NAV__.getSnapshot());
    assert(navBefore.seatCount === 14, `Expected 14 live seats, got ${navBefore.seatCount}`);
    const seatTarget = await page.evaluate(() => {
      const seat = window.__WESTEROS_EDITOR_LIVE_WORLD__.liveState.settlementSeats.find((candidate) => candidate.id === 'umit');
      window.__WESTEROS_EDITOR_LOCATION_NAV__.navigateTo('umit');
      return { seat: [seat.x, seat.groundY, seat.z], snapshot: window.__WESTEROS_EDITOR_LOCATION_NAV__.getSnapshot(), grid: window.__WESTEROS_WORLD_EDITOR__.grid.position.toArray() };
    });
    const near = (a, b, epsilon = 0.1) => Math.abs(a - b) <= epsilon;
    assert(seatTarget.snapshot.locationId === 'umit', `Navigator did not select umit: ${seatTarget.snapshot.locationId}`);
    assert(seatTarget.snapshot.target.every((value, index) => near(value, seatTarget.seat[index])), `Navigator target drift: ${JSON.stringify(seatTarget)}`);
    assert(near(seatTarget.grid[0], seatTarget.seat[0]) && near(seatTarget.grid[2], seatTarget.seat[2]), 'Working grid did not follow selected kingdom seat.');

    await page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first().click();
    const point = await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_AUTHORING__.targetGroundPoint().toArray());
    await page.evaluate((position) => window.__WESTEROS_EDITOR_PLACEMENT__.placeSelectedAtPoint({ x: position[0], y: position[1], z: position[2] }), point);
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.scheduleCapture());
    await page.waitForTimeout(300);
    const historyAfterPlace = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(historyAfterPlace.historyDepth >= 2, `History did not capture placement: ${JSON.stringify(historyAfterPlace)}`);

    await page.click('#we-undo');
    await page.waitForFunction(() => !window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0, null, { timeout: 30000 });
    await page.click('#we-redo');
    await page.waitForFunction(() => !window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });

    assert(await page.evaluate(() => window.__WESTEROS_EDITOR_LOCAL_SESSION__.saveLocal()), 'Local save returned false.');
    const localSnapshot = await page.evaluate(() => window.__WESTEROS_EDITOR_LOCAL_SESSION__.getSnapshot());
    assert(localSnapshot.available && localSnapshot.hasLocalScene, `Local session not persisted: ${JSON.stringify(localSnapshot)}`);
    await page.click('#we-delete');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0);
    assert(await page.evaluate(() => window.__WESTEROS_EDITOR_LOCAL_SESSION__.loadLocal()), 'Local load returned false.');
    await page.waitForFunction(() => document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.', null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });

    await page.click('[data-terrain-mode="land-remove"]');
    const landToWater = await page.evaluate(() => window.__WESTEROS_EDITOR_TERRAIN_SEMANTICS__.getSnapshot());
    assert(landToWater.semanticMode === 'land-to-water', `Kara→Deniz semantic mode failed: ${JSON.stringify(landToWater)}`);
    await page.click('[data-terrain-mode="water-remove"]');
    const waterToLand = await page.evaluate(() => window.__WESTEROS_EDITOR_TERRAIN_SEMANTICS__.getSnapshot());
    assert(waterToLand.semanticMode === 'water-to-land', `Deniz→Kara semantic mode failed: ${JSON.stringify(waterToLand)}`);

    const buttons = await page.evaluate(() => ({
      undo: !document.getElementById('we-undo').disabled,
      localSave: Boolean(document.getElementById('we-local-save')),
      preview: Boolean(document.getElementById('we-preview-game')),
      navigator: document.getElementById('we-location-select')?.options.length || 0
    }));
    assert(buttons.localSave && buttons.preview && buttons.navigator === 15, `Desktop usability controls incomplete: ${JSON.stringify(buttons)}`);
    assert(errors.length === 0, `Desktop console/page errors: ${errors.join(' | ')}`);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'desktop-session-navigation.png'), fullPage: true });
    console.log(`[checkRun216EditorSessionNavigationBrowser] DESKTOP PROOF: ${JSON.stringify({ seatTarget, historyAfterPlace, localSnapshot, landToWater, waterToLand, buttons })}`);
  } finally { await context.close(); await browser.close(); }
}
async function mobileProof(playwright, base) {
  const { browser, context, page, errors } = await openEditor(playwright, base, { width: 390, height: 844 });
  try {
    const proof = await page.evaluate(() => {
      const visible = (selector) => { const element = document.querySelector(selector); if (!element) return false; const style = getComputedStyle(element); return style.display !== 'none' && style.visibility !== 'hidden'; };
      return {
        undo: visible('#we-undo'), redo: visible('#we-redo'), localSave: visible('#we-local-save'), localLoad: visible('#we-local-load'), preview: visible('#we-preview-game'), navigator: visible('#we-location-select'),
        seatOptions: document.getElementById('we-location-select')?.options.length || 0,
        scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth
      };
    });
    assert(proof.undo && proof.redo && proof.localSave && proof.localLoad && proof.preview && proof.navigator, `Mobile session/navigation controls hidden: ${JSON.stringify(proof)}`);
    assert(proof.seatOptions === 15, `Mobile navigator option count wrong: ${proof.seatOptions}`);
    assert(proof.scrollWidth <= proof.viewportWidth + 2, `Mobile global horizontal overflow: ${proof.scrollWidth} > ${proof.viewportWidth}`);
    assert(errors.length === 0, `Mobile console/page errors: ${errors.join(' | ')}`);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'mobile-session-navigation.png'), fullPage: true });
    console.log(`[checkRun216EditorSessionNavigationBrowser] MOBILE PROOF: ${JSON.stringify(proof)}`);
  } finally { await context.close(); await browser.close(); }
}
async function main() {
  const playwright = playwrightModule(); if (!playwright) fail('Playwright unavailable');
  const server = await startServer(); const base = `http://127.0.0.1:${server.address().port}`;
  try { await desktopProof(playwright, base); await mobileProof(playwright, base); console.log('[checkRun216EditorSessionNavigationBrowser] PASS: undo/redo, local save/load, canonical 14-seat navigation, land/sea semantic conversion, preview launcher and mobile visibility verified with zero console/page errors.'); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(`[checkRun216EditorSessionNavigationBrowser] FAIL: ${error.stack || error}`); process.exitCode = 1; });
