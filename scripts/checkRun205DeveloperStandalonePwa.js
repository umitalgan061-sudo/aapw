#!/usr/bin/env node
/** Run205: prove the developer-only standalone PWA shell stays isolated and restores offline. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run205-developer-standalone-pwa');
const assert = (value, message) => { if (!value) throw new Error(message); };
function playwrightModule() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function contentType(file) { const ext = path.extname(file); if (ext === '.html') return 'text/html; charset=utf-8'; if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8'; if (ext === '.json' || ext === '.webmanifest') return ext === '.webmanifest' ? 'application/manifest+json' : 'application/json; charset=utf-8'; if (ext === '.css') return 'text/css; charset=utf-8'; if (ext === '.svg') return 'image/svg+xml'; if (ext === '.glb') return 'model/gltf-binary'; return 'application/octet-stream'; }
function server() { const s = http.createServer((req, res) => { const clean = decodeURIComponent(req.url.split('?')[0]); const file = path.join(ROOT, clean === '/' ? 'index.html' : clean.replace(/^\//, '')); if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; } res.writeHead(200, { 'content-type': contentType(file) }); fs.createReadStream(file).pipe(res); }); return new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(s))); }
async function main() {
  const playwright = playwrightModule(); if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const s = await server();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1280, height: 720 } });
    const errors = [];
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(String(error)));
    const base = `http://127.0.0.1:${s.address().port}`;
    await page.goto(`${base}/canonical-dev-pwa/index.html`, { waitUntil: 'domcontentloaded' });
    assert(await page.locator('canvas').count() === 0, 'developer standalone shell must not own a runtime canvas');
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return null;
      const response = await fetch(link.href);
      return { href: link.href, data: await response.json() };
    });
    assert(manifest && manifest.href.includes('/canonical-dev-pwa/manifest.webmanifest'), 'developer manifest link missing');
    assert(manifest.data.display === 'standalone', 'developer manifest display must be standalone');
    assert(manifest.data.start_url === './index.html' && manifest.data.scope === './', 'developer manifest start/scope mismatch');
    const links = await page.evaluate(() => ({ current: document.querySelector('#run205-current')?.href || '', canonical: document.querySelector('#run205-canonical')?.href || '' }));
    assert(links.current.includes('/canonical-dev.html?worldSource=current'), 'Current target drifted');
    assert(links.canonical.includes('/canonical-dev.html?worldSource=canonical-dev'), 'Canonical target drifted');
    assert(!links.current.includes('/canonical-dev-pwa/') && !links.canonical.includes('/canonical-dev-pwa/'), 'runtime targets must remain outside developer PWA scope');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    for (let i = 0; i < 3; i += 1) {
      const controlled = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || '');
      if (controlled.endsWith('/canonical-dev-pwa/service-worker.js')) break;
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    const sw = await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const registration = registrations.find(item => item.scope.endsWith('/canonical-dev-pwa/'));
      return { controller: navigator.serviceWorker.controller?.scriptURL || '', scope: registration?.scope || '', active: registration?.active?.scriptURL || '' };
    });
    assert(sw.controller.endsWith('/canonical-dev-pwa/service-worker.js'), `developer shell controller mismatch: ${sw.controller}`);
    assert(sw.scope.endsWith('/canonical-dev-pwa/'), `developer SW scope escaped subtree: ${sw.scope}`);
    const cacheKeys = await page.evaluate(async () => ({ names: await caches.keys(), urls: (await (await caches.open('westeros-canonical-dev-run205-v1')).keys()).map(request => request.url) }));
    assert(cacheKeys.names.includes('westeros-canonical-dev-run205-v1'), 'developer cache missing');
    assert(cacheKeys.urls.length === 3, `developer cache expected 3 shell entries, got ${cacheKeys.urls.length}`);
    assert(cacheKeys.urls.every(url => new URL(url).pathname.startsWith('/canonical-dev-pwa/')), 'developer cache escaped isolated subtree');
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert(await page.locator('body[data-run205-surface="developer-standalone-shell"]').count() === 1, 'offline shell restoration failed');
    assert(await page.locator('canvas').count() === 0, 'offline shell unexpectedly owns a runtime canvas');
    assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
    await context.setOffline(false);
    const proof = { surface: 'developer-standalone-shell', display: manifest.data.display, startUrl: manifest.data.start_url, scope: sw.scope, controller: sw.controller, cachedEntries: cacheKeys.urls.length, cacheIsolated: true, runtimeTargetsOutsideScope: true, offlineReload: true, canvas: 0, consoleErrors: errors.length };
    fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(`[checkRun205DeveloperStandalonePwa] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun205DeveloperStandalonePwa] PASS: standalone=true isolatedScope=true isolatedCache=true offlineReload=true runtimeTargetsOutsideScope=true canvas=0 consoleErrors=0');
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => s.close(resolve));
  }
}
main().catch(error => { console.error(`[checkRun205DeveloperStandalonePwa] FAIL: ${error.stack || error}`); process.exitCode = 1; });
