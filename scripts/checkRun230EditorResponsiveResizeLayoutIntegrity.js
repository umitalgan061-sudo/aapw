#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run230-editor-responsive-resize-layout-integrity');
const MOBILE_VIEWPORT = Object.freeze({ width: 390, height: 844 });

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

async function waitForEditor(page) {
  await page.waitForFunction(() => (
    window.__WESTEROS_WORLD_EDITOR__ &&
    window.__WESTEROS_EDITOR_HISTORY__ &&
    window.__WESTEROS_EDITOR_TRANSFORM__
  ), null, { timeout: 120000 });
  await page.waitForTimeout(300);
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        left: Math.round(bounds.left * 100) / 100,
        right: Math.round(bounds.right * 100) / 100,
        width: Math.round(bounds.width * 100) / 100,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth
      };
    };
    return {
      viewportWidth,
      rootClientWidth: document.documentElement.clientWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      shell: rect('.we-shell'),
      toolbar: rect('.we-toolbar'),
      toolbarActions: rect('.we-toolbar-actions'),
      assetsPanel: rect('.we-assets-panel'),
      viewport: rect('.we-viewport-wrap'),
      rightPanel: rect('.we-right-panel'),
      statusbar: rect('.we-statusbar')
    };
  });
}

function assertMobileIntegrity(snapshot, label) {
  const tolerance = 2;
  assert(snapshot.viewportWidth === MOBILE_VIEWPORT.width, `${label}: unexpected viewport ${JSON.stringify(snapshot)}`);
  assert(snapshot.rootClientWidth <= snapshot.viewportWidth + tolerance, `${label}: root client width exceeds viewport: ${JSON.stringify(snapshot)}`);
  assert(snapshot.rootScrollWidth <= snapshot.viewportWidth + tolerance, `${label}: root scroll width exceeds viewport: ${JSON.stringify(snapshot)}`);
  assert(snapshot.bodyClientWidth <= snapshot.viewportWidth + tolerance, `${label}: body client width exceeds viewport: ${JSON.stringify(snapshot)}`);
  assert(snapshot.bodyScrollWidth <= snapshot.viewportWidth + tolerance, `${label}: body content is globally clipped/overflowing: ${JSON.stringify(snapshot)}`);
  for (const key of ['shell', 'toolbar', 'toolbarActions', 'assetsPanel', 'viewport', 'rightPanel', 'statusbar']) {
    const bounds = snapshot[key];
    assert(bounds, `${label}: missing ${key}`);
    assert(bounds.width <= snapshot.viewportWidth + tolerance, `${label}: ${key} width exceeds viewport: ${JSON.stringify(snapshot)}`);
    assert(bounds.right <= snapshot.viewportWidth + tolerance, `${label}: ${key} escapes right edge: ${JSON.stringify(snapshot)}`);
  }
  assert(
    snapshot.toolbarActions.scrollWidth >= snapshot.toolbarActions.clientWidth,
    `${label}: toolbar scroll geometry is invalid: ${JSON.stringify(snapshot.toolbarActions)}`
  );
  assert(
    snapshot.statusbar.scrollWidth >= snapshot.statusbar.clientWidth,
    `${label}: statusbar scroll geometry is invalid: ${JSON.stringify(snapshot.statusbar)}`
  );
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const errors = [];
  try {
    const freshContext = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const freshPage = await freshContext.newPage();
    freshPage.on('console', (message) => { if (message.type() === 'error') errors.push(`fresh:${message.text()}`); });
    freshPage.on('pageerror', (error) => errors.push(`fresh:${String(error)}`));
    await freshPage.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitForEditor(freshPage);
    const freshMobile = await layoutSnapshot(freshPage);
    assertMobileIntegrity(freshMobile, 'fresh-mobile');
    await freshContext.close();

    const resizeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const resizePage = await resizeContext.newPage();
    resizePage.on('console', (message) => { if (message.type() === 'error') errors.push(`resize:${message.text()}`); });
    resizePage.on('pageerror', (error) => errors.push(`resize:${String(error)}`));
    await resizePage.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitForEditor(resizePage);
    await resizePage.setViewportSize(MOBILE_VIEWPORT);
    await resizePage.waitForTimeout(400);
    const resizedMobile = await layoutSnapshot(resizePage);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await resizePage.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-to-mobile-layout-integrity.png'), fullPage: false });
    assertMobileIntegrity(resizedMobile, 'desktop-to-mobile');
    await resizeContext.close();

    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    console.log(`[checkRun230EditorResponsiveResizeLayoutIntegrity] PASS ${JSON.stringify({ freshMobile, resizedMobile })}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun230EditorResponsiveResizeLayoutIntegrity] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
