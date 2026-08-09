#!/usr/bin/env node
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run212');
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
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  return 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function capture(playwright, base, contextOptions, label) {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
  await page.waitForFunction(() => window.__WESTEROS_RTS_COMMAND_STATUS__?.getSnapshot?.().chipText.length > 0, null, { timeout: 30000 });

  const initial = await page.evaluate(() => ({
    command: window.__WESTEROS_RTS_COMMAND_STATUS__.getSnapshot(),
    rts: window.__WESTEROS_RTS__?.getSnapshot?.(),
    describedBy: document.querySelector('.rts-commandbar')?.getAttribute('aria-describedby'),
    role: document.getElementById('rts-command-live-status')?.getAttribute('role'),
    live: document.getElementById('rts-command-live-status')?.getAttribute('aria-live'),
  }));
  assert(initial.command.mode === 'select', `${label}: initial mode=${initial.command.mode}`);
  assert(initial.command.chipText === 'KOMUT: SEÇİM', `${label}: initial chip=${initial.command.chipText}`);
  assert(initial.command.announcement.includes('48 / 48 asker seçili'), `${label}: selection announcement missing`);
  assert(initial.describedBy === 'rts-command-live-status', `${label}: commandbar aria-describedby missing`);
  assert(initial.role === 'status' && initial.live === 'polite', `${label}: live region contract missing`);

  await page.click('#rts-move-command');
  await page.waitForFunction(() => window.__WESTEROS_RTS_COMMAND_STATUS__?.getSnapshot?.().mode === 'move');
  const move = await page.evaluate(() => window.__WESTEROS_RTS_COMMAND_STATUS__.getSnapshot());
  assert(move.chipText === 'KOMUT: HEDEF SEÇ', `${label}: move chip=${move.chipText}`);
  assert(move.announcement.includes('Hareket emri etkin.'), `${label}: move announcement missing`);

  const snapshot = await page.evaluate(() => window.__WESTEROS_RTS__?.getSnapshot?.());
  assert(snapshot?.selectedCount === 48, `${label}: selection drifted`);
  assert(snapshot?.drawCalls < (label === 'mobile' ? 500 : 2500), `${label}: draw-call budget exceeded ${snapshot?.drawCalls}`);
  assert(snapshot?.triangles < (label === 'mobile' ? 500000 : 5000000), `${label}: triangle budget exceeded ${snapshot?.triangles}`);
  assert(errors.length === 0, `${label}: console/page errors: ${errors.join(' | ')}`);

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `${label}-command-status.png`), fullPage: true });
  await context.close();
  await browser.close();
  return { initial, move, snapshot, errors: errors.length };
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const desktop = await capture(playwright, base, { viewport: { width: 1440, height: 900 } }, 'desktop');
    const mobile = await capture(playwright, base, {
      viewport: { width: 430, height: 932 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    }, 'mobile');
    console.log(`[checkRun212RtsCommandStatus] PROOF: ${JSON.stringify({ desktop, mobile })}`);
    console.log('[checkRun212RtsCommandStatus] PASS: DOM-only command status + ARIA live region verified desktop/mobile with zero errors and render budgets intact');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(`[checkRun212RtsCommandStatus] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
