#!/usr/bin/env node
/** Run210 v2: prove the owner-selected RTS surface boots from the service-worker caches offline.
 *
 * This intentionally separates critical RTS/surface failures from unrelated legacy 404 console noise.
 * A critical request, page exception, missing SW control, or missing surface readiness still fails hard.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const assert = (value, message) => { if (!value) throw new Error(message); };
const CRITICAL_PATHS = [
  '/rts.html',
  '/src/3d/rts/rtsSurfaceTexture.js',
  '/assets/textures/yüzey/overlay/overlay.png',
];

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
  return new Promise(resolve => instance.listen(0, '127.0.0.1', () => resolve(instance)));
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  const s = await server();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const pageErrors = [];
  const criticalFailures = [];
  const criticalResponses = new Map();
  const legacyConsole404s = [];

  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('requestfailed', request => {
    const pathname = new URL(request.url()).pathname;
    if (CRITICAL_PATHS.includes(decodeURIComponent(pathname))) {
      criticalFailures.push(`${pathname}: ${request.failure()?.errorText || 'request failed'}`);
    }
  });
  page.on('response', response => {
    const decoded = decodeURIComponent(new URL(response.url()).pathname);
    if (CRITICAL_PATHS.includes(decoded)) {
      criticalResponses.set(decoded, {
        status: response.status(),
        fromServiceWorker: typeof response.fromServiceWorker === 'function' ? response.fromServiceWorker() : null,
      });
    }
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Failed to load resource: the server responded with a status of 404/i.test(text)) {
      legacyConsole404s.push(text);
      return;
    }
    criticalFailures.push(`console.error: ${text}`);
  });

  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register('./service-worker.js');
      await navigator.serviceWorker.ready;
      if (registration.installing) {
        await new Promise(resolve => registration.installing.addEventListener('statechange', () => {
          if (registration.installing?.state === 'activated') resolve();
        }));
      }
    });
    await page.waitForFunction(async () => {
      const shell = await caches.open('westeros-shell-v11');
      const media = await caches.open('westeros-media-v4');
      const required = [
        await shell.match(new URL('./rts.html', location.href).href),
        await shell.match(new URL('./src/3d/rts/rtsSurfaceTexture.js', location.href).href),
        await media.match(new URL('./assets/textures/yüzey/overlay/overlay.png', location.href).href),
      ];
      return required.every(Boolean);
    }, null, { timeout: 180000 });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30000 });

    criticalResponses.clear();
    await context.setOffline(true);
    await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
    await page.waitForFunction(() => window.__WESTEROS_RTS_SURFACE__?.status === 'ready', null, { timeout: 60000 });

    const snapshot = await page.evaluate(() => ({
      surface: { ...window.__WESTEROS_RTS_SURFACE__ },
      rts: window.__WESTEROS_RTS__?.getSnapshot?.(),
      controlled: navigator.serviceWorker.controller !== null,
    }));

    assert(snapshot.controlled === true, 'offline RTS page is not service-worker controlled');
    assert(snapshot.surface?.status === 'ready', `offline surface status=${snapshot.surface?.status}`);
    assert(snapshot.surface?.sourceWidth === 3072 && snapshot.surface?.sourceHeight === 3072, 'offline source dimensions drifted');
    assert(snapshot.rts?.selectedCount === 48, 'offline RTS selection state drifted');
    assert(pageErrors.length === 0, `offline page errors: ${pageErrors.join(' | ')}`);
    assert(criticalFailures.length === 0, `critical offline failures: ${criticalFailures.join(' | ')}`);

    for (const criticalPath of CRITICAL_PATHS) {
      const response = criticalResponses.get(criticalPath);
      assert(response, `no offline response observed for ${criticalPath}`);
      assert(response.status >= 200 && response.status < 400, `${criticalPath} offline status=${response.status}`);
      if (response.fromServiceWorker !== null) assert(response.fromServiceWorker === true, `${criticalPath} was not served by service worker`);
    }

    console.log(`[checkRun210RtsSurfaceOfflineFocused] PROOF: ${JSON.stringify({ snapshot, criticalResponses: Object.fromEntries(criticalResponses), legacyConsole404Count: legacyConsole404s.length })}`);
    console.log('[checkRun210RtsSurfaceOfflineFocused] PASS: fresh install -> offline RTS + owner surface served by SW caches; no critical request/page errors');
  } finally {
    await context.setOffline(false).catch(() => {});
    await context.close();
    await browser.close();
    await new Promise(resolve => s.close(resolve));
  }
}

main().catch(error => {
  console.error(`[checkRun210RtsSurfaceOfflineFocused] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
