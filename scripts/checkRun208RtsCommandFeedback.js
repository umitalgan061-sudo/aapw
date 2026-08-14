#!/usr/bin/env node
/** Run208: browser proof for additive RTS destination-command feedback. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run208-rts-command-feedback');
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
  await page.waitForSelector('#rts-command-feedback');
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
    const canvas = desktop.page.locator('#rts-canvas');
    const bounds = await canvas.boundingBox();
    assert(bounds, 'desktop canvas bounds unavailable');
    await desktop.page.mouse.click(bounds.x + bounds.width * 0.66, bounds.y + bounds.height * 0.61, { button: 'right' });
    await desktop.page.waitForFunction(() => document.getElementById('rts-command-feedback')?.dataset.visible === 'true');
    const desktopSnapshot = await desktop.page.evaluate(() => window.__WESTEROS_RTS__?.getSnapshot?.());
    assert(desktopSnapshot?.selectedCount === 48, 'desktop selection drifted');
    assert(desktopSnapshot.drawCalls < 2500, `desktop draw-call budget exceeded: ${desktopSnapshot.drawCalls}`);
    assert(desktopSnapshot.triangles < 5000000, `desktop triangle budget exceeded: ${desktopSnapshot.triangles}`);
    await desktop.page.screenshot({ path: path.join(OUT, 'desktop-destination-feedback.png'), fullPage: true });
    await desktop.page.keyboard.down('KeyW');
    await desktop.page.keyboard.down('KeyD');
    await desktop.page.waitForTimeout(700);
    await desktop.page.keyboard.up('KeyD');
    await desktop.page.keyboard.up('KeyW');
    await desktop.page.mouse.wheel(0, -700);
    await desktop.page.waitForTimeout(400);
    await desktop.page.mouse.click(bounds.x + bounds.width * 0.54, bounds.y + bounds.height * 0.52, { button: 'right' });
    await desktop.page.waitForFunction(() => document.getElementById('rts-command-feedback')?.dataset.visible === 'true');
    await desktop.page.screenshot({ path: path.join(OUT, 'desktop-panned-feedback.png'), fullPage: true });
    assert(desktop.errors.length === 0, `desktop console/page errors: ${desktop.errors.join(' | ')}`);
    await desktop.context.close();

    const mobile = await openRts(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await mobile.page.click('#rts-move-command');
    await mobile.page.locator('#rts-canvas').tap({ position: { x: 245, y: 430 } });
    await mobile.page.waitForFunction(() => document.getElementById('rts-command-feedback')?.dataset.visible === 'true');
    const mobileSnapshot = await mobile.page.evaluate(() => window.__WESTEROS_RTS__?.getSnapshot?.());
    assert(mobileSnapshot?.coarsePointer === true, 'mobile coarse-pointer path missing');
    assert(mobileSnapshot.drawCalls < 500, `mobile draw-call budget exceeded: ${mobileSnapshot.drawCalls}`);
    assert(mobileSnapshot.triangles < 500000, `mobile triangle budget exceeded: ${mobileSnapshot.triangles}`);
    await mobile.page.screenshot({ path: path.join(OUT, 'mobile-destination-feedback.png'), fullPage: true });
    assert(mobile.errors.length === 0, `mobile console/page errors: ${mobile.errors.join(' | ')}`);
    await mobile.context.close();

    const proof = { desktopSnapshot, mobileSnapshot, visualEvidence: ['desktop-destination-feedback.png', 'desktop-panned-feedback.png', 'mobile-destination-feedback.png'], consoleErrors: 0, destinationFeedback: true };
    fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`[checkRun208RtsCommandFeedback] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun208RtsCommandFeedback] PASS: desktop/mobile destination feedback + two desktop views + budgets + zero console/page errors');
  } finally {
    await browser.close();
    await new Promise(resolve => s.close(resolve));
  }
}
main().catch(error => { console.error(`[checkRun208RtsCommandFeedback] FAIL: ${error.stack || error}`); process.exitCode = 1; });
