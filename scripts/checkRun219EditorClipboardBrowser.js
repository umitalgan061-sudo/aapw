#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run219-editor-clipboard-browser');
const assert = (value, message) => { if (!value) throw new Error(message); };

function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}

function type(file) {
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
    if (clean === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    const index = path.join(file, 'index.html');
    if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isDirectory() && fs.existsSync(index)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(index).pipe(res);
      return;
    }
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': type(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function exercise(page, label) {
  const errors = [];
  const missing = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response', (response) => { if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`); });

  await page.waitForFunction(() => Boolean(window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_CLIPBOARD__), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length >= 2, null, { timeout: 120000 });
  await page.waitForSelector('#we-copy');
  await page.waitForSelector('#we-paste');

  await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
  const before = await page.evaluate(() => {
    const api = window.__WESTEROS_WORLD_EDITOR__;
    const object = api.getSelectedObject();
    return {
      count: api.editableObjects.length,
      id: object.userData.editorId,
      assetId: object.userData.editorAssetId,
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: object.scale.toArray(),
      name: object.name,
      snap: api.getEditorState()
    };
  });
  assert(before.assetId, `${label}: selected object has no editor asset id`);
  assert(await page.locator('#we-copy').isEnabled(), `${label}: copy button disabled after selection`);
  assert(!(await page.locator('#we-paste').isEnabled()), `${label}: paste button should start disabled`);

  await page.click('#we-copy');
  assert(await page.locator('#we-paste').isEnabled(), `${label}: paste button did not enable after copy`);
  const clipboard = await page.evaluate(() => window.__WESTEROS_EDITOR_CLIPBOARD__.getClipboard());
  assert(clipboard?.assetId === before.assetId, `${label}: clipboard asset mismatch`);

  await page.click('#we-paste');
  await page.waitForFunction((count) => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === count + 1, before.count);
  const afterButtonPaste = await page.evaluate(() => {
    const api = window.__WESTEROS_WORLD_EDITOR__;
    const object = api.getSelectedObject();
    return {
      count: api.editableObjects.length,
      id: object.userData.editorId,
      assetId: object.userData.editorAssetId,
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: object.scale.toArray(),
      name: object.name
    };
  });
  assert(afterButtonPaste.id !== before.id, `${label}: pasted object reused editor id`);
  assert(afterButtonPaste.id.includes('-paste-'), `${label}: pasted object id is not paste-scoped`);
  assert(afterButtonPaste.assetId === before.assetId, `${label}: pasted asset mismatch`);
  assert(JSON.stringify(afterButtonPaste.rotation) === JSON.stringify(before.rotation), `${label}: rotation changed during paste`);
  assert(JSON.stringify(afterButtonPaste.scale) === JSON.stringify(before.scale), `${label}: scale changed during paste`);
  const expectedOffset = before.snap.snapEnabled ? Math.max(0.1, Number(before.snap.snapSize) || 1) : 1;
  assert(Math.abs(afterButtonPaste.position[0] - (before.position[0] + expectedOffset)) < 1e-6, `${label}: paste X offset mismatch`);
  assert(Math.abs(afterButtonPaste.position[1] - before.position[1]) < 1e-6, `${label}: paste Y drifted`);
  assert(Math.abs(afterButtonPaste.position[2] - before.position[2]) < 1e-6, `${label}: paste Z drifted`);

  const beforeKeyboard = afterButtonPaste.count;
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForFunction((count) => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === count + 1, beforeKeyboard);
  const afterKeyboard = await page.evaluate(() => {
    const api = window.__WESTEROS_WORLD_EDITOR__;
    const object = api.getSelectedObject();
    return { count: api.editableObjects.length, id: object.userData.editorId, name: object.name };
  });
  assert(afterKeyboard.id.includes('-paste-'), `${label}: keyboard paste did not create paste-scoped id`);
  assert(afterKeyboard.count === beforeKeyboard + 1, `${label}: keyboard paste count mismatch`);
  assert(missing.length === 0, `${label}: HTTP errors: ${missing.join(' | ')}`);
  assert(errors.length === 0, `${label}: console/page errors: ${errors.join(' | ')}`);

  return { before, afterButtonPaste, afterKeyboard };
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const desktopContext = await browser.newContext({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
    const desktop = await desktopContext.newPage();
    await desktop.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const desktopResult = await exercise(desktop, 'desktop');
    await desktop.screenshot({ path: path.join(OUT, 'desktop-clipboard.png'), fullPage: true });
    await desktopContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const mobile = await mobileContext.newPage();
    await mobile.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const mobileResult = await exercise(mobile, 'mobile');
    const display = await mobile.locator('#we-paste').evaluate((node) => getComputedStyle(node).display);
    assert(display !== 'none', 'mobile: paste button is not visible');
    await mobile.screenshot({ path: path.join(OUT, 'mobile-clipboard.png'), fullPage: true });
    await mobileContext.close();

    console.log(`[checkRun219EditorClipboardBrowser] PASS ${JSON.stringify({ desktopResult, mobileResult })}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun219EditorClipboardBrowser] FAIL: ${error?.stack || error}`);
  process.exit(1);
});
