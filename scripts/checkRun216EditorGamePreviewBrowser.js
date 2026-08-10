#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'run216-editor-game-preview');
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
  if (ext === '.fbx') return 'application/octet-stream';
  return 'application/octet-stream';
}
function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function previewFixture() {
  return {
    schemaVersion: 1,
    world: { name: 'westeros', units: 'meters' },
    editor: { gridVisible: true, snapEnabled: true, snapSize: 1 },
    objects: [
      { id: 'preview-tree-001', name: 'Önizleme Ağacı', asset: 'marker-tree', transform: { position: [6, 0, 4], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { id: 'preview-road-001', name: 'Önizleme Yolu', asset: 'editor-road-segment', transform: { position: [0, 0.4, 0], rotation: [0, 0, 0], scale: [16, 1, 8] } }
    ],
    instanceGroups: []
  };
}
async function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error));
  return errors;
}
async function normalGameProof(playwright, base) {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = await collectErrors(page);
  try {
    await page.goto(`${base}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 120000 });
    const normal = await page.evaluate(() => ({
      previewGlobal: Boolean(window.__WESTEROS_GAME_EDITOR_PREVIEW__),
      badge: Boolean(document.getElementById('game3d-editor-preview-badge')),
      resources: performance.getEntriesByType('resource').map((entry) => entry.name)
    }));
    assert(!normal.previewGlobal && !normal.badge, 'Normal game unexpectedly activated editor preview.');
    assert(!normal.resources.some((name) => name.includes('EditorGamePatchPreview.js')), 'Normal game loaded heavy preview module.');
    assert(errors.length === 0, `Normal game console/page errors: ${errors.join(' | ')}`);
    console.log(`[checkRun216EditorGamePreviewBrowser] NORMAL PROOF: ${JSON.stringify({ previewGlobal: normal.previewGlobal, badge: normal.badge })}`);
  } finally {
    await context.close();
    await browser.close();
  }
}
async function previewGameProof(playwright, base) {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((fixture) => {
    localStorage.setItem('westeros-world-editor.scene.v1', JSON.stringify(fixture));
  }, previewFixture());
  const page = await context.newPage();
  const errors = await collectErrors(page);
  try {
    await page.goto(`${base}/game3d.html?editorPatch=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_GAME_EDITOR_PREVIEW__?.getSnapshot?.().active === true, null, { timeout: 120000 });
    const proof = await page.evaluate(() => ({
      snapshot: window.__WESTEROS_GAME_EDITOR_PREVIEW__.getSnapshot(),
      badge: document.getElementById('game3d-editor-preview-badge')?.textContent || '',
      gateLoaded: performance.getEntriesByType('resource').some((entry) => entry.name.includes('EditorGamePatchPreviewGateSafe.js')),
      previewLoaded: performance.getEntriesByType('resource').some((entry) => entry.name.includes('EditorGamePatchPreview.js'))
    }));
    assert(proof.snapshot.objectCount === 2, `Preview object count mismatch: ${proof.snapshot.objectCount}`);
    assert(proof.snapshot.instanceGroupCount === 0, 'Preview instance group count mismatch.');
    assert(proof.snapshot.collisionPolicy === 'visual-only', `Unexpected collision policy: ${proof.snapshot.collisionPolicy}`);
    assert(proof.snapshot.rootAttached === true, 'Preview root is not attached to gameplay scene.');
    assert(proof.gateLoaded && proof.previewLoaded, 'Preview lazy-loading evidence missing.');
    assert(proof.badge.includes('fizik değişmez'), `Preview policy badge missing: ${proof.badge}`);
    assert(errors.length === 0, `Preview game console/page errors: ${errors.join(' | ')}`);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'game-editor-preview.png'), fullPage: true });
    console.log(`[checkRun216EditorGamePreviewBrowser] PREVIEW PROOF: ${JSON.stringify(proof)}`);
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
    await normalGameProof(playwright, base);
    await previewGameProof(playwright, base);
    console.log('[checkRun216EditorGamePreviewBrowser] PASS: normal game stays editor-free while query-gated preview lazy-loads saved editor objects into real gameplay scene as visual-only overlay with zero console/page errors.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(`[checkRun216EditorGamePreviewBrowser] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
