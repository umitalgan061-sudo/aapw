#!/usr/bin/env node
/** Run307: real-browser proof for additive RTS touch feedback compatibility. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run307-rts-touch-feedback');
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

async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const s = await server();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${s.address().port}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
    await page.waitForFunction(() => Boolean(window.__WESTEROS_RTS_TOUCH_FEEDBACK_BRIDGE__?.getSnapshot));

    await page.click('#rts-select-all');
    await page.click('#rts-move-command');
    const canvas = page.locator('#rts-canvas');
    await canvas.tap({ position: { x: 245, y: 430 } });
    await page.waitForFunction(() => document.getElementById('rts-command-feedback')?.dataset.visible === 'true');
    await page.waitForFunction(() => (window.__WESTEROS_RTS_TOUCH_FEEDBACK_BRIDGE__?.getSnapshot?.().bridgedCount || 0) >= 1);
    await page.waitForFunction(() => document.getElementById('rts-status')?.textContent?.includes('ilerliyor'));

    const visibleSnapshot = await page.evaluate(() => ({
      bridge: window.__WESTEROS_RTS_TOUCH_FEEDBACK_BRIDGE__.getSnapshot(),
      rts: window.__WESTEROS_RTS__.getSnapshot(),
      marker: {
        visible: document.getElementById('rts-command-feedback')?.dataset.visible || '',
        left: document.getElementById('rts-command-feedback')?.style.left || '',
        top: document.getElementById('rts-command-feedback')?.style.top || '',
      },
      status: document.getElementById('rts-status')?.textContent || '',
    }));
    assert(visibleSnapshot.bridge.bridgedCount >= 1, 'real touch command did not use additive feedback bridge');
    assert(visibleSnapshot.marker.visible === 'true', 'touch destination marker was not visible');
    assert(visibleSnapshot.marker.left && visibleSnapshot.marker.top, 'touch destination marker coordinates missing');
    assert(visibleSnapshot.status.includes('ilerliyor'), `touch movement status missing: ${visibleSnapshot.status}`);
    assert(visibleSnapshot.rts.coarsePointer === true, 'mobile RTS coarse-pointer path missing');
    assert(visibleSnapshot.rts.drawCalls < 500, `mobile draw-call budget exceeded: ${visibleSnapshot.rts.drawCalls}`);
    assert(visibleSnapshot.rts.triangles < 500000, `mobile triangle budget exceeded: ${visibleSnapshot.rts.triangles}`);
    assert(errors.length === 0, `mobile console/page errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(OUT, 'mobile-touch-feedback-visible.png'), fullPage: true });

    await page.waitForFunction(() => document.getElementById('rts-command-feedback')?.dataset.visible === 'false', null, { timeout: 5000 });
    const beforeDispose = await page.evaluate(() => window.__WESTEROS_RTS_TOUCH_FEEDBACK_BRIDGE__.getSnapshot());
    await page.evaluate(() => window.__WESTEROS_RTS_TOUCH_FEEDBACK_BRIDGE__.dispose());
    await page.evaluate(() => {
      const canvasNode = document.getElementById('rts-canvas');
      canvasNode?.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        button: -1,
        clientX: 180,
        clientY: 320,
      }));
    });
    await page.waitForTimeout(100);
    const disposedSnapshot = await page.evaluate(() => ({
      bridge: window.__WESTEROS_RTS_TOUCH_FEEDBACK_BRIDGE__.getSnapshot(),
      markerVisible: document.getElementById('rts-command-feedback')?.dataset.visible || '',
    }));
    assert(disposedSnapshot.bridge.disposed === true, 'touch-feedback bridge disposal flag missing');
    assert(disposedSnapshot.bridge.bridgedCount === beforeDispose.bridgedCount, 'disposed bridge still handled touch pointerup');
    assert(disposedSnapshot.markerVisible !== 'true', 'disposed bridge re-opened destination marker');
    assert(errors.length === 0, `errors after bridge disposal: ${errors.join(' | ')}`);

    const proof = {
      visibleSnapshot,
      disposedSnapshot,
      baselineRca: 'Run208 mobile marker wait fails on untouched a5b9dcfc main at line 82; Run307 restores the intended touch feedback contract additively.',
      visualEvidence: ['mobile-touch-feedback-visible.png'],
      consoleErrors: 0,
      disposalVerified: true,
    };
    fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`[checkRun307RtsTouchFeedbackBridge] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun307RtsTouchFeedbackBridge] PASS: real mobile tap feedback + movement + budget + hide lifecycle + disposal + zero console/page errors');
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => s.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun307RtsTouchFeedbackBridge] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
