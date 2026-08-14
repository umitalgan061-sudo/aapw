#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run216-editor-live-world');

function fail(message) { throw new Error(message); }

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
  if (ext === '.fbx') return 'application/octet-stream';
  return 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/favicon.ico') {
      res.writeHead(204, { 'cache-control': 'no-store' });
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

async function dragPitch(page, direction) {
  const x = 800;
  const startY = direction === 'up' ? 760 : 240;
  const endY = direction === 'up' ? 120 : 880;
  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, endY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) fail('Playwright unavailable');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  try {
    await page.goto(`${base}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });

    const enter = page.locator('#run266-entry-enter');
    await enter.waitFor({ state: 'visible', timeout: 120000 });
    await enter.click();
    await page.locator('#run266-entry-gate').waitFor({ state: 'detached', timeout: 120000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 180000 });
    await page.waitForTimeout(4500);

    const canvas = page.locator('#game3d-canvas');
    await canvas.waitFor({ state: 'visible', timeout: 60000 });

    // Real in-game F4 free camera. First point almost straight up, then fly ~10.8 km vertically.
    await page.keyboard.press('F4');
    await page.waitForTimeout(250);
    await dragPitch(page, 'up');
    await dragPitch(page, 'up');
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(18000);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    await page.waitForTimeout(700);

    // Rotate to the free-camera pitch clamp: essentially straight down.
    await dragPitch(page, 'down');
    await dragPitch(page, 'down');
    await dragPitch(page, 'down');
    await page.waitForTimeout(1800);

    // Remove only HTML overlays; the live WebGL canvas keeps rendering unchanged.
    await page.evaluate(() => {
      const canvas = document.querySelector('#game3d-canvas');
      for (const child of [...document.body.children]) {
        if (child !== canvas) child.style.display = 'none';
      }
      if (canvas) {
        canvas.style.position = 'fixed';
        canvas.style.inset = '0';
        canvas.style.width = '100vw';
        canvas.style.height = '100vh';
      }
    });
    await page.waitForTimeout(600);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const session = await context.newCDPSession(page);
    const shot = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'game3d-current-full-topdown.png'), Buffer.from(shot.data, 'base64'));
    console.log('[checkRun216EditorLiveWorldBrowser] PASS: fresh current game3d.html full-world-style top-down WebGL frame captured with the real F4 camera.');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun216EditorLiveWorldBrowser] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
