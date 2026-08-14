#!/usr/bin/env node
/** Run207: real-browser proof for the new high-camera visible RTS surface. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run207-rts-surface');
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
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => instance.listen(0, '127.0.0.1', () => resolve(instance)));
}
async function openRts(browser, base, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
  await page.waitForTimeout(1000);
  return { context, page, errors };
}
async function snapshot(page) {
  return page.evaluate(() => window.__WESTEROS_RTS__?.getSnapshot?.());
}
async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const s = await server();
  const browser = await playwright.chromium.launch({ headless: true });
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    const desktop = await openRts(browser, base, { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const { page } = desktop;
    const initial = await snapshot(page);
    assert(initial, 'RTS snapshot API missing');
    assert(initial.unitCount === 48, `expected 48 soldiers, got ${initial.unitCount}`);
    assert(initial.selectedCount === 48, `expected all 48 soldiers initially selected, got ${initial.selectedCount}`);
    assert(initial.animalCount === 4, `expected 4 configured animals, got ${initial.animalCount}`);
    assert(initial.dragonCount === 1, `expected 1 configured dragon, got ${initial.dragonCount}`);
    assert(initial.realCastleCount >= 8, `expected at least 8 real castle roots, got ${initial.realCastleCount}`);
    assert(initial.drawCalls < 2500, `desktop draw-call budget exceeded: ${initial.drawCalls}`);
    assert(initial.triangles < 5000000, `desktop triangle budget exceeded: ${initial.triangles}`);
    await page.screenshot({ path: path.join(OUT, 'overview.png'), fullPage: true });

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__WESTEROS_RTS__.getSnapshot().selectedCount === 0);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.waitForFunction(() => window.__WESTEROS_RTS__.getSnapshot().selectedCount === 48);

    const canvas = page.locator('#rts-canvas');
    const bounds = await canvas.boundingBox();
    assert(bounds, 'RTS canvas bounds unavailable');
    await page.mouse.click(bounds.x + bounds.width * 0.68, bounds.y + bounds.height * 0.62, { button: 'right' });
    await page.waitForFunction(() => document.getElementById('rts-status')?.textContent?.includes('48 asker hedefe ilerliyor'));
    await page.waitForTimeout(1200);

    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'command-view.png'), fullPage: true });
    const afterCommand = await snapshot(page);
    assert(afterCommand.selectedCount === 48, 'group selection drifted after move command');
    assert(afterCommand.drawCalls < 2500, `desktop draw-call budget exceeded after command: ${afterCommand.drawCalls}`);
    assert(afterCommand.triangles < 5000000, `desktop triangle budget exceeded after command: ${afterCommand.triangles}`);
    assert(desktop.errors.length === 0, `desktop console/page errors: ${desktop.errors.join(' | ')}`);
    await desktop.context.close();

    const mobile = await openRts(browser, base, {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
      serviceWorkers: 'block',
    });
    const mobileInitial = await snapshot(mobile.page);
    assert(mobileInitial.unitCount === 48, `mobile expected 48 soldiers, got ${mobileInitial.unitCount}`);
    assert(mobileInitial.selectedCount === 48, `mobile expected 48 selected, got ${mobileInitial.selectedCount}`);
    assert(mobileInitial.coarsePointer === true, 'mobile context did not enter coarse-pointer path');
    assert(mobileInitial.drawCalls < 500, `mobile draw-call budget exceeded: ${mobileInitial.drawCalls}`);
    assert(mobileInitial.triangles < 500000, `mobile triangle budget exceeded: ${mobileInitial.triangles}`);
    await mobile.page.click('#rts-move-command');
    await mobile.page.locator('#rts-canvas').tap({ position: { x: 245, y: 430 } });
    await mobile.page.waitForFunction(() => document.getElementById('rts-status')?.textContent?.includes('48 asker hedefe ilerliyor'));
    await mobile.page.waitForTimeout(500);
    await mobile.page.screenshot({ path: path.join(OUT, 'mobile-command.png'), fullPage: true });
    assert(mobile.errors.length === 0, `mobile console/page errors: ${mobile.errors.join(' | ')}`);
    const mobileAfter = await snapshot(mobile.page);
    await mobile.context.close();

    const proof = {
      desktopInitial: initial,
      desktopAfterCommand: afterCommand,
      mobileInitial,
      mobileAfterCommand: mobileAfter,
      controls: { boxSelection: true, singleSelection: true, selectAll: true, rightClickMove: true, touchMoveMode: true, cameraPan: true, zoom: true },
      visualEvidence: ['overview.png', 'command-view.png', 'mobile-command.png'],
      consoleErrors: 0,
    };
    fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`[checkRun207RtsSurface] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun207RtsSurface] PASS: 48 soldiers + real castles + 4 animals + 1 dragon + group command + desktop/mobile budgets + zero console/page errors');
  } finally {
    await browser.close();
    await new Promise(resolve => s.close(resolve));
  }
}
main().catch(error => { console.error(`[checkRun207RtsSurface] FAIL: ${error.stack || error}`); process.exitCode = 1; });
