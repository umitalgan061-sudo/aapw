#!/usr/bin/env node
/** Run200: real opt-in developer startup + rollback + service-worker offline reload proof. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run200-canonical-developer-startup');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.fbx': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch (error) { /* try next */ }
  }
  return null;
}

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const clean = decodeURIComponent(req.url.split('?')[0]);
      const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
      const file = path.join(ROOT, relative);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      res.writeHead(500); res.end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function waitCanonical(page) {
  await page.waitForFunction(() => window.__WESTEROS_CANONICAL_DEV__?.getMode?.() === 'canonical', null, { timeout: 90000 });
  await page.waitForTimeout(350);
}

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      }
      if (!registration.active) throw new Error('service worker did not become active');
    });

    await page.goto(`${origin}/game3d-canonical-dev.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitCanonical(page);

    const online = await page.evaluate(() => {
      const api = window.__WESTEROS_CANONICAL_DEV__;
      const state = api.getState();
      window.__RUN200_ORIGINAL_PLAYER_UPDATE__ = state.player.update;
      const stats = api.getFreezeStats();
      return {
        requestedBeforeInit: api.requestedBeforeInit,
        mode: api.getMode(),
        bridgeId: api.getBridgeId(),
        activationError: api.getActivationError(),
        counts: api.getCounts(),
        freezeStats: stats,
        currentRoots: state.scene.children.length,
        loadedChunks: state.chunkManager.loadedCount,
      };
    });
    assert(online.requestedBeforeInit === true, 'canonical selection was not requested before initGame3D');
    assert(online.mode === 'canonical', `online developer mode expected canonical, got ${online.mode}`);
    assert(!online.activationError, `online activation error: ${online.activationError}`);
    assert(online.bridgeId, 'canonical bridge id missing');
    assert(Object.keys(online.freezeStats).length >= 5, 'too few frozen current simulation entry points');
    assert(Object.values(online.freezeStats).every((entry) => entry.blockedCalls > 0), `not every current simulation entry point was frozen: ${JSON.stringify(online.freezeStats)}`);
    assert(online.loadedChunks > 0, 'current runtime did not finish terrain boot before ownership transfer');
    await page.screenshot({ path: path.join(OUT, 'canonical-near.png'), fullPage: true });

    await page.evaluate(() => {
      const state = window.__WESTEROS_CANONICAL_DEV__.getState();
      state.camera.position.y += 420;
      state.camera.position.z += 760;
      state.camera.updateMatrixWorld?.(true);
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, 'canonical-far.png'), fullPage: true });

    const rollback = await page.evaluate(() => {
      const api = window.__WESTEROS_CANONICAL_DEV__;
      const state = api.getState();
      const result = api.rollbackToCurrent();
      return {
        mode: api.getMode(),
        counts: api.getCounts(),
        playerMethodRestored: state.player.update === window.__RUN200_ORIGINAL_PLAYER_UPDATE__,
        transitions: api.getTransitions(),
        rollbackKeys: Object.keys(result?.freezeStats || {}),
      };
    });
    assert(rollback.mode === 'current', `rollback mode expected current, got ${rollback.mode}`);
    assert(rollback.playerMethodRestored, 'player update method identity was not restored on rollback');
    assert(rollback.counts.rollbackCount === 1, 'rollback count expected 1');
    assert(rollback.transitions.some((entry) => entry.type === 'rollback' && entry.methodIdentityRestored), 'rollback transition did not prove method restoration');
    assert(rollback.rollbackKeys.length >= 5, 'rollback did not report the frozen simulation set');

    const reactivated = await page.evaluate(() => {
      const api = window.__WESTEROS_CANONICAL_DEV__;
      const mode = api.reactivateCanonical();
      return { mode, counts: api.getCounts(), error: api.getActivationError() };
    });
    assert(reactivated.mode === 'canonical', `reactivation expected canonical, got ${reactivated.mode}`);
    assert(reactivated.counts.activationCount === 2, 'canonical activation count expected 2');
    assert(!reactivated.error, `reactivation error: ${reactivated.error}`);
    await page.waitForTimeout(500);

    const cached = await page.evaluate(async () => {
      const paths = ['/game3d-canonical-dev.html', '/dev/run200CanonicalStartup.js', '/dev/run200SceneManagerProxy.js'];
      const pairs = await Promise.all(paths.map(async (item) => [item, Boolean(await caches.match(item))]));
      return Object.fromEntries(pairs);
    });
    assert(Object.values(cached).every(Boolean), `developer startup warm-cache incomplete: ${JSON.stringify(cached)}`);

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitCanonical(page);
    const offline = await page.evaluate(() => {
      const api = window.__WESTEROS_CANONICAL_DEV__;
      return {
        mode: api.getMode(),
        requestedBeforeInit: api.requestedBeforeInit,
        bridgeId: api.getBridgeId(),
        activationError: api.getActivationError(),
        controller: Boolean(navigator.serviceWorker.controller),
        freezeStats: api.getFreezeStats(),
      };
    });
    assert(offline.controller, 'offline reload was not service-worker controlled');
    assert(offline.requestedBeforeInit, 'offline canonical selection was not requested before init');
    assert(offline.mode === 'canonical', `offline developer mode expected canonical, got ${offline.mode}`);
    assert(!offline.activationError, `offline activation error: ${offline.activationError}`);
    assert(offline.bridgeId === online.bridgeId, `online/offline bridge selection drifted: ${online.bridgeId} vs ${offline.bridgeId}`);
    assert(Object.values(offline.freezeStats).every((entry) => entry.blockedCalls > 0), 'offline canonical tick freeze did not engage');
    await page.screenshot({ path: path.join(OUT, 'canonical-offline.png'), fullPage: true });
    await context.setOffline(false);

    assert(consoleErrors.length === 0, `console/page errors: ${JSON.stringify(consoleErrors)}`);
    const report = {
      version: 'run200-canonical-developer-startup-v1',
      online,
      rollback,
      reactivated,
      cached,
      offline,
      consoleErrors,
    };
    fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[checkRun200CanonicalDeveloperStartup] PASS: ${JSON.stringify({ bridgeId: online.bridgeId, frozen: Object.keys(online.freezeStats).length, rollback: rollback.mode, offline: offline.mode, consoleErrors: consoleErrors.length })}`);
  } finally {
    await context.setOffline(false).catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun200CanonicalDeveloperStartup] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
