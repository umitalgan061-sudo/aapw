#!/usr/bin/env node
/** Run211: prove the additive RTS surface patch cleans up its runtime hooks on pagehide. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
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
  return new Promise(resolve => instance.listen(0, '127.0.0.1', () => resolve(instance)));
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  const s = await server();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
    await page.waitForFunction(() => window.__WESTEROS_RTS_SURFACE__?.status === 'ready', null, { timeout: 120000 });

    const before = await page.evaluate(async () => {
      const { ChunkManager } = await import('./src/3d/world/chunkManager.js');
      return {
        status: window.__WESTEROS_RTS_SURFACE__?.status,
        loadChunkName: ChunkManager.prototype.loadChunk.name,
        streamTowardsName: ChunkManager.prototype.streamTowards.name,
        sourceRequests: performance.getEntriesByType('resource')
          .filter(entry => entry.name.includes('/assets/textures/y%C3%BCzey/overlay/overlay.png') || entry.name.includes('/assets/textures/yüzey/overlay/overlay.png')).length,
      };
    });
    assert(before.status === 'ready', `pre-cleanup surface status=${before.status}`);
    assert(before.loadChunkName === 'loadChunkWithRtsSurfaceRun210', `loadChunk patch missing: ${before.loadChunkName}`);
    assert(before.streamTowardsName === 'streamTowardsWithRtsSurfaceRun210', `streamTowards patch missing: ${before.streamTowardsName}`);
    assert(before.sourceRequests === 1, `surface source should load once, got ${before.sourceRequests}`);

    const after = await page.evaluate(async () => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
      await new Promise(resolve => setTimeout(resolve, 50));
      const { ChunkManager } = await import('./src/3d/world/chunkManager.js');
      return {
        status: window.__WESTEROS_RTS_SURFACE__?.status,
        loadChunkName: ChunkManager.prototype.loadChunk.name,
        streamTowardsName: ChunkManager.prototype.streamTowards.name,
      };
    });
    assert(after.status === 'disposed', `surface cleanup status=${after.status}`);
    assert(after.loadChunkName !== 'loadChunkWithRtsSurfaceRun210', 'loadChunk prototype patch leaked after pagehide');
    assert(after.streamTowardsName !== 'streamTowardsWithRtsSurfaceRun210', 'streamTowards prototype patch leaked after pagehide');
    assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);

    const proof = { before, after, consoleErrors: 0 };
    console.log(`[checkRun211RtsSurfaceLifecycle] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun211RtsSurfaceLifecycle] PASS: pagehide disposes surface state and restores ChunkManager prototype hooks with zero errors');
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => s.close(resolve));
  }
}

main().catch(error => {
  console.error(`[checkRun211RtsSurfaceLifecycle] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
