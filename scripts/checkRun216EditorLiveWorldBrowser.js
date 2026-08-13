#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'run216-editor-live-world');

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
  if (ext === '.json' || ext === '.webmanifest') return 'application/json; charset=utf-8';
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
async function dragLook(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}
async function cdpShot(context, page, outputPath) {
  const session = await context.newCDPSession(page);
  try {
    const result = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    const png = Buffer.from(result.data, 'base64');
    assert(png.length > 10000, `Captured PNG too small: ${png.length}`);
    fs.writeFileSync(outputPath, png);
    return png.length;
  } finally { await session.detach(); }
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(`${base}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const enter = page.locator('#run266-entry-enter');
    if (await enter.count()) {
      await enter.waitFor({ state: 'visible', timeout: 30000 });
      await enter.click();
      await page.waitForFunction(() => !document.getElementById('run266-entry-gate'), null, { timeout: 15000 });
    }
    await page.waitForFunction(() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 180000 });
    await page.waitForTimeout(3500);

    const canvas = page.locator('#game3d-canvas');
    await canvas.waitFor({ state: 'visible', timeout: 30000 });
    const box = await canvas.boundingBox();
    assert(box && box.width > 1000 && box.height > 600, 'game3d canvas is not render-sized');

    await page.keyboard.press('F4');
    await page.waitForTimeout(500);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await dragLook(page, cx, cy, cx, box.y + 20);
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1150);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    await page.waitForTimeout(800);

    await page.evaluate(() => {
      const canvas = document.getElementById('game3d-canvas');
      for (const child of Array.from(document.body.children)) {
        if (child !== canvas) child.style.setProperty('display', 'none', 'important');
      }
      document.documentElement.style.background = '#000';
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';
    });

    await dragLook(page, cx, cy, cx, cy + 330);
    await page.waitForTimeout(900);
    const aBytes = await cdpShot(context, page, path.join(OUT, 'game3d-real-angle-a.png'));

    await dragLook(page, cx, cy, cx, cy + 150);
    await page.waitForTimeout(900);
    const bBytes = await cdpShot(context, page, path.join(OUT, 'game3d-real-angle-b.png'));

    await dragLook(page, cx, cy, cx, cy + 150);
    await page.waitForTimeout(900);
    const cBytes = await cdpShot(context, page, path.join(OUT, 'game3d-real-angle-c.png'));

    fs.writeFileSync(path.join(OUT, 'game3d-real-angle-metrics.json'), JSON.stringify({ aBytes, bBytes, cBytes, viewport: [1600,1000], browserErrors: errors }, null, 2));
    console.log(`[checkRun216EditorLiveWorldBrowser] REAL MULTI-ANGLE GAME3D CAPTURE PASS ${JSON.stringify({ aBytes, bBytes, cBytes })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun216EditorLiveWorldBrowser] FAIL: ${error.stack || error}`);
  process.exit(1);
});
