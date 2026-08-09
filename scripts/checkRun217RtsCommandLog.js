#!/usr/bin/env node
/** Run217: browser proof for additive RTS command-history telemetry. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run217-rts-command-log');
const assert = (value, message) => { if (!value) throw new Error(message); };

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
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => instance.listen(0, '127.0.0.1', () => resolve(instance)));
}

async function openRts(browser, base, options) {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
  await page.waitForSelector('#rts-command-log');
  await page.waitForFunction(() => Boolean(window.__WESTEROS_RTS_COMMAND_LOG__?.getSnapshot));
  return { context, page, errors };
}

async function issueRepresentativeCommands(page) {
  await page.click('#rts-select-all');
  await page.waitForFunction(() => window.__WESTEROS_RTS_COMMAND_LOG__?.getSnapshot?.().lastCommandType === 'SEÇİM');
  await page.click('#rts-focus-army');
  await page.waitForFunction(() => window.__WESTEROS_RTS_COMMAND_LOG__?.getSnapshot?.().lastCommandType === 'KAMERA');
  await page.click('#rts-move-command');
  const canvas = page.locator('#rts-canvas');
  const bounds = await canvas.boundingBox();
  assert(bounds, 'RTS canvas bounds unavailable');
  await page.mouse.click(bounds.x + bounds.width * 0.61, bounds.y + bounds.height * 0.58);
  await page.waitForFunction(() => window.__WESTEROS_RTS_COMMAND_LOG__?.getSnapshot?.().lastCommandType === 'HAREKET');
  return bounds;
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
    await issueRepresentativeCommands(desktop.page);
    const desktopLog = await desktop.page.evaluate(() => window.__WESTEROS_RTS_COMMAND_LOG__.getSnapshot());
    const desktopRts = await desktop.page.evaluate(() => window.__WESTEROS_RTS__.getSnapshot());
    assert(desktopLog.entryCount >= 3, `desktop command log too short: ${desktopLog.entryCount}`);
    assert(desktopLog.entryCount <= desktopLog.maxEntries, `desktop command log exceeded cap: ${desktopLog.entryCount}`);
    assert(desktopLog.entries.some((entry) => entry.type === 'SEÇİM'), 'desktop selection command missing');
    assert(desktopLog.entries.some((entry) => entry.type === 'KAMERA'), 'desktop camera command missing');
    assert(desktopLog.entries.some((entry) => entry.type === 'HAREKET'), 'desktop movement command missing');
    assert(desktopRts.drawCalls < 2500, `desktop draw-call budget exceeded: ${desktopRts.drawCalls}`);
    assert(desktopRts.triangles < 5000000, `desktop triangle budget exceeded: ${desktopRts.triangles}`);
    assert(desktop.errors.length === 0, `desktop console/page errors: ${desktop.errors.join(' | ')}`);
    await desktop.page.screenshot({ path: path.join(OUT, 'desktop-command-log.png'), fullPage: true });
    await desktop.context.close();

    const mobile = await openRts(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await mobile.page.click('#rts-select-all');
    await mobile.page.click('#rts-focus-army');
    const mobileLog = await mobile.page.evaluate(() => window.__WESTEROS_RTS_COMMAND_LOG__.getSnapshot());
    const mobileRts = await mobile.page.evaluate(() => window.__WESTEROS_RTS__.getSnapshot());
    assert(mobileLog.coarsePointer === true, 'mobile command log coarse-pointer path missing');
    assert(mobileLog.entryCount >= 2, `mobile command log too short: ${mobileLog.entryCount}`);
    assert(mobileLog.entryCount <= mobileLog.maxEntries, `mobile command log exceeded cap: ${mobileLog.entryCount}`);
    assert(mobileRts.drawCalls < 500, `mobile draw-call budget exceeded: ${mobileRts.drawCalls}`);
    assert(mobileRts.triangles < 500000, `mobile triangle budget exceeded: ${mobileRts.triangles}`);
    assert(mobile.errors.length === 0, `mobile console/page errors: ${mobile.errors.join(' | ')}`);
    await mobile.page.screenshot({ path: path.join(OUT, 'mobile-command-log.png'), fullPage: true });
    await mobile.context.close();

    const proof = {
      desktopLog,
      desktopRts,
      mobileLog,
      mobileRts,
      visualEvidence: ['desktop-command-log.png', 'mobile-command-log.png'],
      consoleErrors: 0,
      maxEntries: 5,
    };
    fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`[checkRun217RtsCommandLog] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun217RtsCommandLog] PASS: desktop/mobile command history + budgets + zero console/page errors');
  } finally {
    await browser.close();
    await new Promise((resolve) => s.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun217RtsCommandLog] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
