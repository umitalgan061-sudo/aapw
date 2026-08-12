#!/usr/bin/env node
/** Run310: timing-safe browser contract for existing RTS destination feedback. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run310-rts-command-feedback-timing');
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
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.webmanifest') return 'application/manifest+json';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.fbx') return 'application/octet-stream';
  return 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((req, res) => {
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
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openRts(browser, base, options) {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
  await page.waitForSelector('#rts-command-feedback');
  await page.waitForTimeout(800);
  return { context, page, errors };
}

async function desktopProof(browser, base) {
  const opened = await openRts(browser, base, { viewport: { width: 1440, height: 900 } });
  const { context, page, errors } = opened;
  try {
    const canvas = page.locator('#rts-canvas');
    const bounds = await canvas.boundingBox();
    assert(bounds, 'desktop canvas bounds unavailable');
    await page.mouse.click(bounds.x + bounds.width * 0.66, bounds.y + bounds.height * 0.61, { button: 'right' });
    await page.waitForFunction(() => document.getElementById('rts-command-feedback')?.dataset.visible === 'true');
    const marker = await page.evaluate(() => ({
      visible: document.getElementById('rts-command-feedback')?.dataset.visible || '',
      left: document.getElementById('rts-command-feedback')?.style.left || '',
      top: document.getElementById('rts-command-feedback')?.style.top || '',
      status: document.getElementById('rts-status')?.textContent || '',
    }));
    const rts = await page.evaluate(() => window.__WESTEROS_RTS__.getSnapshot());
    assert(marker.visible === 'true', 'desktop destination marker did not become visible');
    assert(marker.left && marker.top, 'desktop destination marker coordinates missing');
    assert(rts.selectedCount === 48, `desktop selection drifted: ${rts.selectedCount}`);
    assert(rts.drawCalls < 2500, `desktop draw-call budget exceeded: ${rts.drawCalls}`);
    assert(rts.triangles < 5000000, `desktop triangle budget exceeded: ${rts.triangles}`);
    assert(errors.length === 0, `desktop console/page errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(OUT, 'desktop-destination-feedback.png'), fullPage: true });
    return { marker, rts };
  } finally {
    await context.close();
  }
}

async function mobileProof(browser, base) {
  const opened = await openRts(browser, base, {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const { context, page, errors } = opened;
  try {
    await page.click('#rts-move-command');
    await page.evaluate(() => {
      const marker = document.getElementById('rts-command-feedback');
      const transitions = [];
      const snapshot = () => ({
        at: performance.now(),
        visible: marker?.dataset.visible || '',
        opacity: marker?.style.opacity || '',
        left: marker?.style.left || '',
        top: marker?.style.top || '',
        status: document.getElementById('rts-status')?.textContent || '',
      });
      const observer = new MutationObserver(() => transitions.push(snapshot()));
      if (marker) observer.observe(marker, { attributes: true, attributeFilter: ['style', 'data-visible'] });
      window.__RUN310_FEEDBACK_TIMING__ = {
        transitions,
        finish: () => {
          observer.disconnect();
          return { transitions: transitions.map((entry) => ({ ...entry })), final: snapshot() };
        },
      };
    });

    const startedAt = Date.now();
    await page.locator('#rts-canvas').tap({ position: { x: 245, y: 430 }, timeout: 30000 });
    const tapDurationMs = Date.now() - startedAt;
    const afterTap = await page.evaluate(() => window.__RUN310_FEEDBACK_TIMING__.finish());
    const rts = await page.evaluate(() => window.__WESTEROS_RTS__.getSnapshot());
    const visibleTransitions = afterTap.transitions.filter((entry) => entry.visible === 'true');
    const hiddenTransitions = afterTap.transitions.filter((entry) => entry.visible === 'false');

    assert(visibleTransitions.length >= 1, `mobile marker never entered visible state; transitions=${JSON.stringify(afterTap.transitions)}`);
    assert(visibleTransitions.some((entry) => entry.left === '245px' && entry.top === '430px'), `mobile marker did not record tap coordinates; transitions=${JSON.stringify(visibleTransitions)}`);
    assert(afterTap.final.status.includes('ilerliyor'), `mobile movement command did not execute: ${afterTap.final.status}`);
    assert(rts.coarsePointer === true, 'mobile coarse-pointer path missing');
    assert(rts.selectedCount === 48, `mobile selection drifted: ${rts.selectedCount}`);
    assert(rts.drawCalls < 500, `mobile draw-call budget exceeded: ${rts.drawCalls}`);
    assert(rts.triangles < 500000, `mobile triangle budget exceeded: ${rts.triangles}`);
    assert(errors.length === 0, `mobile console/page errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(OUT, 'mobile-after-tap.png'), fullPage: true });

    return {
      tapDurationMs,
      transitions: afterTap.transitions,
      visibleTransitionCount: visibleTransitions.length,
      hiddenTransitionCount: hiddenTransitions.length,
      final: afterTap.final,
      rts,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const desktop = await desktopProof(browser, base);
    const mobile = await mobileProof(browser, base);
    const proof = {
      desktop,
      mobile,
      rca: 'Run309 proved the existing mobile marker becomes visible during Playwright tap, while the tap promise can return after the transient marker has hidden. Run310 observes marker transitions before initiating tap.',
      visualEvidence: ['desktop-destination-feedback.png', 'mobile-after-tap.png'],
      consoleErrors: 0,
      timingSafeFeedbackContract: true,
    };
    fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`[checkRun310RtsCommandFeedbackTiming] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun310RtsCommandFeedbackTiming] PASS: desktop visible feedback + mobile pre-tap transition proof + movement + budgets + zero console/page errors');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun310RtsCommandFeedbackTiming] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
