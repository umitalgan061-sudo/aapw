#!/usr/bin/env node
/** Run206: prove developer standalone PWA navigation never captures the production service-worker scope. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run206-service-worker-ownership');
const assert = (value, message) => { if (!value) throw new Error(message); };
function playwrightModule() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function contentType(file) { const ext = path.extname(file); if (ext === '.html') return 'text/html; charset=utf-8'; if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8'; if (ext === '.json' || ext === '.webmanifest') return ext === '.webmanifest' ? 'application/manifest+json' : 'application/json; charset=utf-8'; if (ext === '.css') return 'text/css; charset=utf-8'; if (ext === '.svg') return 'image/svg+xml'; if (ext === '.glb') return 'model/gltf-binary'; return 'application/octet-stream'; }
function server() { const s = http.createServer((req, res) => { const clean = decodeURIComponent(req.url.split('?')[0]); const file = path.join(ROOT, clean === '/' ? 'index.html' : clean.replace(/^\//, '')); if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; } res.writeHead(200, { 'content-type': contentType(file) }); fs.createReadStream(file).pipe(res); }); return new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(s))); }
async function snapshot(page) { return page.evaluate(async () => ({ controller: navigator.serviceWorker.controller?.scriptURL || '', registrations: (await navigator.serviceWorker.getRegistrations()).map(item => ({ scope: item.scope, active: item.active?.scriptURL || '' })).sort((a,b) => a.scope.localeCompare(b.scope)) })); }
async function waitForController(page, suffix, reloads = 4) { for (let i = 0; i < reloads; i += 1) { const value = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || ''); if (value.endsWith(suffix)) return value; await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(100); } const value = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || ''); throw new Error(`controller did not become ${suffix}; got ${value}`); }
async function main() {
  const playwright = playwrightModule(); if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const s = await server();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const base = `http://127.0.0.1:${s.address().port}`;

    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await waitForController(page, '/service-worker.js');
    const production = await snapshot(page);
    const rootRegistration = production.registrations.find(item => item.active.endsWith('/service-worker.js'));
    assert(rootRegistration && new URL(rootRegistration.scope).pathname === '/', `production SW scope drifted: ${JSON.stringify(production.registrations)}`);

    await page.goto(`${base}/canonical-dev-pwa/index.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await waitForController(page, '/canonical-dev-pwa/service-worker.js');
    const developer = await snapshot(page);
    const developerRegistration = developer.registrations.find(item => item.active.endsWith('/canonical-dev-pwa/service-worker.js'));
    assert(developerRegistration && new URL(developerRegistration.scope).pathname === '/canonical-dev-pwa/', `developer SW scope escaped subtree: ${JSON.stringify(developer.registrations)}`);
    assert(developer.registrations.some(item => item.active.endsWith('/service-worker.js') && new URL(item.scope).pathname === '/'), 'production registration disappeared after developer SW activation');

    const errors = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(String(error)));

    await page.click('#run205-current');
    await page.waitForSelector('body[data-run201-active-source="current"]');
    await page.waitForFunction(() => document.body.dataset.run201CacheReady === 'true');
    const current = await snapshot(page);
    assert(current.controller.endsWith('/service-worker.js') && !current.controller.includes('/canonical-dev-pwa/'), `Current route controller captured by developer SW: ${current.controller}`);
    assert(await page.locator('canvas').count() === 1, 'Current route must own exactly one runtime canvas');
    const currentBridge = await page.evaluate(() => document.body.dataset.run201BridgeId || '');

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitForController(page, '/canonical-dev-pwa/service-worker.js', 2);
    assert(await page.locator('canvas').count() === 0, 'developer shell must own zero runtime canvases after return');

    await page.click('#run205-canonical');
    await page.waitForSelector('body[data-run201-active-source="canonical"]');
    await page.waitForFunction(() => document.body.dataset.run201CacheReady === 'true');
    const canonical = await snapshot(page);
    assert(canonical.controller.endsWith('/service-worker.js') && !canonical.controller.includes('/canonical-dev-pwa/'), `Canonical route controller captured by developer SW: ${canonical.controller}`);
    assert(await page.locator('canvas').count() === 1, 'Canonical route must own exactly one runtime canvas');
    const canonicalBridge = await page.evaluate(() => document.body.dataset.run201BridgeId || '');
    assert(currentBridge && currentBridge === canonicalBridge, `deterministic bridge identity drifted: current=${currentBridge} canonical=${canonicalBridge}`);

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitForController(page, '/canonical-dev-pwa/service-worker.js', 2);
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert(await page.locator('body[data-run205-surface="developer-standalone-shell"]').count() === 1, 'offline developer shell recovery failed');
    const offlineShell = await snapshot(page);
    assert(offlineShell.controller.endsWith('/canonical-dev-pwa/service-worker.js'), `offline shell controller mismatch: ${offlineShell.controller}`);
    assert(await page.locator('canvas').count() === 0, 'offline developer shell unexpectedly owns runtime canvas');

    await page.goto(`${base}/canonical-dev.html?worldSource=canonical-dev`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body[data-run201-active-source="canonical"]');
    const offlineCanonical = await snapshot(page);
    assert(offlineCanonical.controller.endsWith('/service-worker.js') && !offlineCanonical.controller.includes('/canonical-dev-pwa/'), `offline canonical controller captured by developer SW: ${offlineCanonical.controller}`);
    assert(await page.locator('canvas').count() === 1, 'offline canonical route must own exactly one runtime canvas');
    assert((await page.evaluate(() => document.body.dataset.run201Offline)) === 'true', 'canonical route did not observe offline state');

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitForController(page, '/canonical-dev-pwa/service-worker.js', 2);
    assert(await page.locator('canvas').count() === 0, 'offline return to developer shell leaked runtime canvas');
    assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
    await context.setOffline(false);

    const proof = { productionController: production.controller, productionScope: new URL(rootRegistration.scope).pathname, developerController: developer.controller, developerScope: new URL(developerRegistration.scope).pathname, currentController: current.controller, canonicalController: canonical.controller, offlineShellController: offlineShell.controller, offlineCanonicalController: offlineCanonical.controller, deterministicBridge: canonicalBridge, runtimeCanvas: 1, shellCanvas: 0, offlineRecovery: true, developerNeverCapturedRuntimeRoutes: true, productionRegistrationPreserved: true, consoleErrors: errors.length };
    fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(`[checkRun206ServiceWorkerOwnership] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun206ServiceWorkerOwnership] PASS: productionScope=/ developerScope=/canonical-dev-pwa/ current=production canonical=production offlineRecovery=true shellCanvas=0 runtimeCanvas=1 consoleErrors=0');
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => s.close(resolve));
  }
}
main().catch(error => { console.error(`[checkRun206ServiceWorkerOwnership] FAIL: ${error.stack || error}`); process.exitCode = 1; });