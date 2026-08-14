#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run220-editor-history-shortcuts-mobile');

function assert(value, message) {
  if (!value) throw new Error(message);
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
    window.__WESTEROS_EDITOR_HISTORY__ &&
    window.__WESTEROS_EDITOR_LIVE_AUTHORING__ &&
    window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0
  ), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted === true, null, { timeout: 30000 });
  return { browser, context, page, errors };
}

async function desktopShortcutProof(playwright, base) {
  const { browser, context, page, errors } = await openEditor(playwright, base, { width: 1440, height: 900 });
  try {
    const treeButton = page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first();
    await treeButton.dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 30000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.captureNow());

    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 0, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
    const undoSnapshot = await page.evaluate(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot());
    assert(undoSnapshot.redoDepth === 1, `Ctrl+Z did not create redo state: ${JSON.stringify(undoSnapshot)}`);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length === 1, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().restoring === false, null, { timeout: 120000 });
    const restored = await page.evaluate(() => ({
      assetId: window.__WESTEROS_WORLD_EDITOR__.editableObjects[0]?.userData?.editorAssetId,
      history: window.__WESTEROS_EDITOR_HISTORY__.getSnapshot()
    }));
    assert(restored.assetId === 'marker-tree', `Ctrl+Shift+Z restored wrong asset: ${restored.assetId}`);
    assert(restored.history.redoDepth === 0, `Redo stack not consumed by shortcut: ${JSON.stringify(restored.history)}`);
    assert(errors.length === 0, `Desktop browser errors: ${errors.join(' | ')}`);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-shortcut-redo.png'), fullPage: true });
    return { undoSnapshot, restored };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function mobileUiProof(playwright, base) {
  const { browser, context, page, errors } = await openEditor(playwright, base, { width: 390, height: 844 });
  try {
    const proof = await page.evaluate(() => {
      const visible = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const undo = document.getElementById('we-undo')?.getBoundingClientRect();
      const redo = document.getElementById('we-redo')?.getBoundingClientRect();
      return {
        undoVisible: visible('#we-undo'),
        redoVisible: visible('#we-redo'),
        undoDisabled: document.getElementById('we-undo')?.disabled === true,
        redoDisabled: document.getElementById('we-redo')?.disabled === true,
        bodyScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        undoRect: undo ? { left: undo.left, right: undo.right } : null,
        redoRect: redo ? { left: redo.left, right: redo.right } : null
      };
    });
    assert(proof.undoVisible && proof.redoVisible, `Mobile history buttons are hidden: ${JSON.stringify(proof)}`);
    assert(proof.undoDisabled && proof.redoDisabled, `Clean mobile boot history buttons should be disabled: ${JSON.stringify(proof)}`);
    assert(proof.bodyScrollWidth <= proof.viewportWidth + 2, `Mobile page has horizontal overflow: ${proof.bodyScrollWidth} > ${proof.viewportWidth}`);
    assert(errors.length === 0, `Mobile browser errors: ${errors.join(' | ')}`);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile-history-toolbar.png'), fullPage: true });
    return proof;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const desktop = await desktopShortcutProof(playwright, base);
    const mobile = await mobileUiProof(playwright, base);
    console.log(`[checkRun220EditorHistoryShortcutMobile] PASS ${JSON.stringify({ desktop, mobile })}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun220EditorHistoryShortcutMobile] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
