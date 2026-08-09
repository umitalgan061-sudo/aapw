#!/usr/bin/env node
/** Run210: browser proof for the owner-uploaded RTS terrain detail layer. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run210-rts-surface-texture');
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
  await page.waitForFunction(() => window.__WESTEROS_RTS_SURFACE__?.status === 'ready', null, { timeout: 120000 });
  await page.waitForTimeout(700);
  return { context, page, errors };
}
async function surfaceSnapshot(page) {
  return page.evaluate(() => ({
    surface: { ...window.__WESTEROS_RTS_SURFACE__ },
    rts: window.__WESTEROS_RTS__?.getSnapshot?.(),
    sourceRequests: performance.getEntriesByType('resource')
      .filter(entry => entry.name.includes('/assets/textures/y%C3%BCzey/overlay/overlay.png') || entry.name.includes('/assets/textures/yüzey/overlay/overlay.png'))
      .map(entry => ({ name: entry.name, transferSize: entry.transferSize, decodedBodySize: entry.decodedBodySize })),
  }));
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
    const desktopSnapshot = await surfaceSnapshot(desktop.page);
    assert(desktopSnapshot.surface.status === 'ready', 'desktop surface did not become ready');
    assert(desktopSnapshot.surface.sourceWidth === 3072 && desktopSnapshot.surface.sourceHeight === 3072, `unexpected source dimensions ${desktopSnapshot.surface.sourceWidth}x${desktopSnapshot.surface.sourceHeight}`);
    assert(desktopSnapshot.surface.runtimeTextureSize === 1024, `desktop runtime texture size drifted: ${desktopSnapshot.surface.runtimeTextureSize}`);
    assert(desktopSnapshot.surface.detailOpacity === 0.24, `detail opacity drifted: ${desktopSnapshot.surface.detailOpacity}`);
    assert(desktopSnapshot.surface.appliedChunks > 0, 'desktop surface was not applied to terrain chunks');
    assert(desktopSnapshot.surface.uvMode === 'world-space-clamped', 'world-space UV contract missing');
    assert(desktopSnapshot.sourceRequests.length === 1, `surface source should load exactly once, got ${desktopSnapshot.sourceRequests.length}`);
    assert(desktopSnapshot.rts?.drawCalls < 2500, `desktop draw-call budget exceeded: ${desktopSnapshot.rts?.drawCalls}`);
    assert(desktopSnapshot.rts?.triangles < 5000000, `desktop triangle budget exceeded: ${desktopSnapshot.rts?.triangles}`);
    await desktop.page.screenshot({ path: path.join(OUT, 'desktop-surface-overview.png'), fullPage: true });
    await desktop.page.keyboard.down('KeyW');
    await desktop.page.keyboard.down('KeyD');
    await desktop.page.waitForTimeout(800);
    await desktop.page.keyboard.up('KeyD');
    await desktop.page.keyboard.up('KeyW');
    await desktop.page.mouse.wheel(0, -900);
    await desktop.page.waitForTimeout(500);
    await desktop.page.screenshot({ path: path.join(OUT, 'desktop-surface-close.png'), fullPage: true });
    assert(desktop.errors.length === 0, `desktop console/page errors: ${desktop.errors.join(' | ')}`);
    await desktop.context.close();

    const mobile = await openRts(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mobileSnapshot = await surfaceSnapshot(mobile.page);
    assert(mobileSnapshot.surface.status === 'ready', 'mobile surface did not become ready');
    assert(mobileSnapshot.surface.runtimeTextureSize === 512, `mobile runtime texture size drifted: ${mobileSnapshot.surface.runtimeTextureSize}`);
    assert(mobileSnapshot.surface.appliedChunks > 0, 'mobile surface was not applied to terrain chunks');
    assert(mobileSnapshot.sourceRequests.length === 1, `mobile surface source should load exactly once, got ${mobileSnapshot.sourceRequests.length}`);
    assert(mobileSnapshot.rts?.coarsePointer === true, 'mobile coarse-pointer path missing');
    assert(mobileSnapshot.rts?.drawCalls < 500, `mobile draw-call budget exceeded: ${mobileSnapshot.rts?.drawCalls}`);
    assert(mobileSnapshot.rts?.triangles < 500000, `mobile triangle budget exceeded: ${mobileSnapshot.rts?.triangles}`);
    await mobile.page.screenshot({ path: path.join(OUT, 'mobile-surface.png'), fullPage: true });
    assert(mobile.errors.length === 0, `mobile console/page errors: ${mobile.errors.join(' | ')}`);
    await mobile.context.close();

    const proof = { desktopSnapshot, mobileSnapshot, consoleErrors: 0, visualEvidence: ['desktop-surface-overview.png', 'desktop-surface-close.png', 'mobile-surface.png'] };
    fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`[checkRun210RtsSurfaceTexture] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun210RtsSurfaceTexture] PASS: owner surface projected with world UV, adaptive texture size, budgets and zero errors');
  } finally {
    await browser.close();
    await new Promise(resolve => s.close(resolve));
  }
}
main().catch(error => { console.error(`[checkRun210RtsSurfaceTexture] FAIL: ${error.stack || error}`); process.exitCode = 1; });
