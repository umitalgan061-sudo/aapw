#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run238-editor-structural-scene-atomicity');
function assert(value, message) { if (!value) throw new Error(message); }
function playwrightModule() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return ext === '.webmanifest' ? 'application/manifest+json' : 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  return 'application/octet-stream';
}
function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    const index = path.join(file, 'index.html');
    if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isDirectory() && fs.existsSync(index)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); fs.createReadStream(index).pipe(res); return;
    }
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(clean === '/favicon.ico' ? 204 : 404); res.end(); return; }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' }); fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function waitForCount(array, expected, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (array.length >= expected) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error(`Timed out waiting for handled load error count ${expected}; observed ${array.length}`));
      setTimeout(poll, 25);
    };
    poll();
  });
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const badObjects = path.join(ARTIFACT_DIR, 'objects-not-array.scene.json');
  const badGroups = path.join(ARTIFACT_DIR, 'instance-groups-not-array.scene.json');
  fs.writeFileSync(badObjects, JSON.stringify({ schemaVersion: 1, objects: {}, instanceGroups: [], editor: { gridVisible: true, snapEnabled: true, snapSize: 1 } }, null, 2));
  fs.writeFileSync(badGroups, JSON.stringify({ schemaVersion: 1, objects: [], instanceGroups: {}, editor: { gridVisible: true, snapEnabled: true, snapSize: 1 } }, null, 2));

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const handled = [];
  const unexpected = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('[worldEditor] scene load failed')) handled.push(text); else unexpected.push(text);
  });
  page.on('pageerror', (error) => unexpected.push(String(error)));

  const capture = () => page.evaluate(() => ({
    objects: window.__WESTEROS_WORLD_EDITOR__.editableObjects.map((o) => ({
      id: o.userData.editorId, asset: o.userData.editorAssetId, name: o.name,
      position: o.position.toArray().map((v) => Number(v.toFixed(6))),
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z].map((v) => Number(v.toFixed(6))),
      scale: o.scale.toArray().map((v) => Number(v.toFixed(6)))
    })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    groups: window.__WESTEROS_WORLD_EDITOR__.instanceManager.groups.length,
    hierarchy: [...document.querySelectorAll('#we-hierarchy .we-hierarchy-item')].map((n) => n.textContent).sort(),
    selection: document.getElementById('we-selection-status').textContent,
    gridVisible: document.getElementById('we-grid-toggle').checked,
    snapEnabled: document.getElementById('we-snap-toggle').checked,
    snapSize: Number(document.getElementById('we-snap-size').value)
  }));

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 0, null, { timeout: 120000 });
    await page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first().dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    await page.locator('#we-grid-toggle').uncheck();
    await page.locator('#we-snap-toggle').uncheck();
    await page.locator('#we-snap-size').fill('2.5');
    await page.locator('#we-snap-size').dispatchEvent('change');
    await page.waitForTimeout(150);
    const before = await capture();
    assert(before.objects.length === 1, `Expected one deterministic baseline object: ${JSON.stringify(before)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-before-structural-invalid-loads.png'), fullPage: true });

    await page.locator('#we-load-file').setInputFiles(badObjects);
    await waitForCount(handled, 1);
    const afterObjects = await capture();
    assert(JSON.stringify(afterObjects) === JSON.stringify(before), `objects-not-array mutated live state: ${JSON.stringify({ before, afterObjects })}`);
    assert(handled[0].includes('Scene objects bir dizi olmalı.'), `objects validation contract drifted: ${handled[0]}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-after-objects-not-array.png'), fullPage: true });

    await page.locator('#we-load-file').setInputFiles(badGroups);
    await waitForCount(handled, 2);
    const afterGroups = await capture();
    assert(JSON.stringify(afterGroups) === JSON.stringify(before), `instanceGroups-not-array mutated live state: ${JSON.stringify({ before, afterGroups })}`);
    assert(handled[1].includes('Scene instanceGroups bir dizi olmalı.'), `instanceGroups validation contract drifted: ${handled[1]}`);
    assert(unexpected.length === 0, `Unexpected browser errors: ${unexpected.join(' | ')}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-after-instance-groups-not-array.png'), fullPage: true });
    console.log(`[checkRun238EditorStructuralSceneAtomicity] PASS ${JSON.stringify({ objectCount: before.objects.length, handledErrors: handled.length, unexpectedErrors: unexpected.length, screenshots: 3 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(`[checkRun238EditorStructuralSceneAtomicity] FAIL: ${error.stack || error}`); process.exitCode = 1; });
