#!/usr/bin/env node
/** Run209: browser proof for additive RTS camera framing presets. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run209-rts-camera-presets');
const assert = (value, message) => { if (!value) throw new Error(message); };
function playwrightModule() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return ext === '.webmanifest' ? 'application/manifest+json' : 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.fbx') return 'application/octet-stream';
  return 'application/octet-stream';
}
function server() {
  const instance = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => instance.listen(0, '127.0.0.1', () => resolve(instance)));
}
async function openRts(browser, base, options) {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
  await page.waitForSelector('#rts-camera-close');
  await page.waitForSelector('#rts-camera-overview');
  await page.waitForTimeout(800);
  return { context, page, errors };
}
async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const s = await server();
  const browser = await playwright.chromium.launch({ headless: true });
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    const desktop = await openRts(browser, base, { viewport: { width: 1440, height: 900 } });
    await desktop.page.click('#rts-camera-close');
    await desktop.page.waitForFunction(() => document.body.dataset.rtsCameraPreset === 'close');
    await desktop.page.waitForTimeout(500);
    const closeSnapshot = await desktop.page.evaluate(() => window.__WESTEROS_RTS__?.getSnapshot?.());
    assert(closeSnapshot?.selectedCount === 48, 'desktop selection drifted after close preset');
    assert(closeSnapshot.drawCalls < 2500, `desktop draw-call budget exceeded: ${closeSnapshot.drawCalls}`);
    assert(closeSnapshot.triangles < 5000000, `desktop triangle budget exceeded: ${closeSnapshot.triangles}`);
    await desktop.page.screenshot({ path: path.join(OUT, 'desktop-close-preset.png'), fullPage: true });

    await desktop.page.click('#rts-camera-overview');
    await desktop.page.waitForFunction(() => document.body.dataset.rtsCameraPreset === 'overview');
    await desktop.page.waitForTimeout(500);
    const overviewSnapshot = await desktop.page.evaluate(() => window.__WESTEROS_RTS__?.getSnapshot?.());
    assert(overviewSnapshot?.selectedCount === 48, 'desktop selection drifted after overview preset');
    await desktop.page.screenshot({ path: path.join(OUT, 'desktop-overview-preset.png'), fullPage: true });

    await desktop.page.keyboard.press('Digit1');
    await desktop.page.waitForFunction(() => document.body.dataset.rtsCameraPreset === 'close');
    assert(desktop.errors.length === 0, `desktop console/page errors: ${desktop.errors.join(' | ')}`);
    await desktop.context.close();

    const mobile = await openRts(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await mobile.page.click('#rts-camera-close');
    await mobile.page.waitForFunction(() => document.body.dataset.rtsCameraPreset === 'close');
    await mobile.page.waitForTimeout(400);
    const mobileSnapshot = await mobile.page.evaluate(() => window.__WESTEROS_RTS__?.getSnapshot?.());
    assert(mobileSnapshot?.coarsePointer === true, 'mobile coarse-pointer path missing');
    assert(mobileSnapshot.drawCalls < 500, `mobile draw-call budget exceeded: ${mobileSnapshot.drawCalls}`);
    assert(mobileSnapshot.triangles < 500000, `mobile triangle budget exceeded: ${mobileSnapshot.triangles}`);
    await mobile.page.screenshot({ path: path.join(OUT, 'mobile-close-preset.png'), fullPage: true });
    assert(mobile.errors.length === 0, `mobile console/page errors: ${mobile.errors.join(' | ')}`);
    await mobile.context.close();

    const proof = {
      closeSnapshot,
      overviewSnapshot,
      mobileSnapshot,
      visualEvidence: ['desktop-close-preset.png', 'desktop-overview-preset.png', 'mobile-close-preset.png'],
      consoleErrors: 0,
      cameraPresets: ['close', 'overview'],
      keyboardShortcut: 'Digit1/Digit2',
    };
    fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`[checkRun209RtsCameraPresets] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun209RtsCameraPresets] PASS: close/overview camera presets + desktop/mobile proof + budgets + zero console/page errors');
  } finally {
    await browser.close();
    await new Promise(resolve => s.close(resolve));
  }
}
main().catch(error => { console.error(`[checkRun209RtsCameraPresets] FAIL: ${error.stack || error}`); process.exitCode = 1; });
