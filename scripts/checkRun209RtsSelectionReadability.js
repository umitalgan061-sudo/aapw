#!/usr/bin/env node
/** Run209: browser proof for additive RTS selection-readability HUD. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run209-rts-selection-readability');
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
  await page.waitForSelector('#rts-selection-readability[data-selected="48"]');
  await page.waitForTimeout(600);
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
    await desktop.page.screenshot({ path: path.join(OUT, 'desktop-all-selected.png'), fullPage: true });
    await desktop.page.keyboard.press('Escape');
    await desktop.page.waitForSelector('#rts-selection-readability[data-selected="0"]');
    const emptyWidth = await desktop.page.locator('[data-rts-selection-fill]').evaluate(node => node.style.width);
    assert(emptyWidth === '0%', `expected empty meter, got ${emptyWidth}`);
    await desktop.page.screenshot({ path: path.join(OUT, 'desktop-none-selected.png'), fullPage: true });
    await desktop.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await desktop.page.waitForSelector('#rts-selection-readability[data-selected="48"]');
    const fullWidth = await desktop.page.locator('[data-rts-selection-fill]').evaluate(node => node.style.width);
    assert(fullWidth === '100%', `expected full meter, got ${fullWidth}`);
    const desktopSnapshot = await desktop.page.evaluate(() => window.__WESTEROS_RTS__?.getSnapshot?.());
    assert(desktopSnapshot?.selectedCount === 48, 'desktop selection count drifted');
    assert(desktopSnapshot.drawCalls < 2500, `desktop draw-call budget exceeded: ${desktopSnapshot.drawCalls}`);
    assert(desktopSnapshot.triangles < 5000000, `desktop triangle budget exceeded: ${desktopSnapshot.triangles}`);
    assert(desktop.errors.length === 0, `desktop console/page errors: ${desktop.errors.join(' | ')}`);
    await desktop.context.close();

    const mobile = await openRts(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mobileSnapshot = await mobile.page.evaluate(() => window.__WESTEROS_RTS__?.getSnapshot?.());
    assert(mobileSnapshot?.coarsePointer === true, 'mobile coarse-pointer path missing');
    assert(mobileSnapshot.drawCalls < 500, `mobile draw-call budget exceeded: ${mobileSnapshot.drawCalls}`);
    assert(mobileSnapshot.triangles < 500000, `mobile triangle budget exceeded: ${mobileSnapshot.triangles}`);
    await mobile.page.screenshot({ path: path.join(OUT, 'mobile-selection-readability.png'), fullPage: true });
    assert(mobile.errors.length === 0, `mobile console/page errors: ${mobile.errors.join(' | ')}`);
    await mobile.context.close();

    const proof = { desktopSnapshot, mobileSnapshot, visualEvidence: ['desktop-all-selected.png', 'desktop-none-selected.png', 'mobile-selection-readability.png'], consoleErrors: 0, selectionReadability: true };
    fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`[checkRun209RtsSelectionReadability] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun209RtsSelectionReadability] PASS: selection HUD desktop/mobile + selection state transitions + budgets + zero console/page errors');
  } finally {
    await browser.close();
    await new Promise(resolve => s.close(resolve));
  }
}
main().catch(error => { console.error(`[checkRun209RtsSelectionReadability] FAIL: ${error.stack || error}`); process.exitCode = 1; });
