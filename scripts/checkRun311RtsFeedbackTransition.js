#!/usr/bin/env node
/** Run311: transition-based browser contract for the existing transient RTS destination marker. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run311-rts-feedback-transition');
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
  await page.waitForFunction(() => Boolean(window.__WESTEROS_RTS__?.getSnapshot));
  return { context, page, errors };
}

async function installTransitionRecorder(page) {
  await page.evaluate(() => {
    const marker = document.getElementById('rts-command-feedback');
    if (!marker) throw new Error('RTS command-feedback marker missing');
    const transitions = [];
    const snapshot = (reason) => ({
      reason,
      at: performance.now(),
      visible: marker.dataset.visible || '',
      opacity: marker.style.opacity || '',
      left: marker.style.left || '',
      top: marker.style.top || '',
      status: document.getElementById('rts-status')?.textContent || '',
    });
    const observer = new MutationObserver(() => transitions.push(snapshot('mutation')));
    observer.observe(marker, { attributes: true, attributeFilter: ['style', 'data-visible'] });
    window.__RUN311_FEEDBACK_TRANSITIONS__ = {
      transitions,
      finish: () => {
        observer.disconnect();
        return {
          transitions: transitions.map((entry) => ({ ...entry })),
          final: snapshot('final'),
        };
      },
    };
  });
}

function summarizeTransitions(record) {
  return {
    visible: record.transitions.filter((entry) => entry.visible === 'true'),
    hidden: record.transitions.filter((entry) => entry.visible === 'false'),
  };
}

async function desktopProof(browser, base) {
  const opened = await openRts(browser, base, { viewport: { width: 1440, height: 900 } });
  const { context, page, errors } = opened;
  try {
    await installTransitionRecorder(page);
    const canvas = page.locator('#rts-canvas');
    const bounds = await canvas.boundingBox();
    assert(bounds, 'desktop canvas bounds unavailable');
    const expected = {
      x: Math.round(bounds.x + bounds.width * 0.66),
      y: Math.round(bounds.y + bounds.height * 0.61),
    };
    const startedAt = Date.now();
    await page.mouse.click(expected.x, expected.y, { button: 'right' });
    const actionDurationMs = Date.now() - startedAt;
    await page.waitForTimeout(1100);
    const record = await page.evaluate(() => window.__RUN311_FEEDBACK_TRANSITIONS__.finish());
    const transitions = summarizeTransitions(record);
    const rts = await page.evaluate(() => window.__WESTEROS_RTS__.getSnapshot());

    assert(transitions.visible.length >= 1, `desktop marker never entered visible state: ${JSON.stringify(record.transitions)}`);
    assert(transitions.visible.some((entry) => entry.left && entry.top), 'desktop visible marker transition has no coordinates');
    assert(transitions.hidden.length >= 1, `desktop marker never returned hidden: ${JSON.stringify(record.transitions)}`);
    assert(record.final.visible === 'false', `desktop marker lifecycle did not settle hidden: ${record.final.visible}`);
    assert(rts.selectedCount === 48, `desktop selection drifted: ${rts.selectedCount}`);
    assert(rts.drawCalls < 2500, `desktop draw-call budget exceeded: ${rts.drawCalls}`);
    assert(rts.triangles < 5000000, `desktop triangle budget exceeded: ${rts.triangles}`);
    assert(errors.length === 0, `desktop console/page errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(OUT, 'desktop-after-feedback-lifecycle.png'), fullPage: true });
    return { expected, actionDurationMs, record, visibleTransitionCount: transitions.visible.length, hiddenTransitionCount: transitions.hidden.length, rts };
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
    await installTransitionRecorder(page);
    const expected = { x: 245, y: 430 };
    const startedAt = Date.now();
    await page.locator('#rts-canvas').tap({ position: expected, timeout: 30000 });
    const actionDurationMs = Date.now() - startedAt;
    const record = await page.evaluate(() => window.__RUN311_FEEDBACK_TRANSITIONS__.finish());
    const transitions = summarizeTransitions(record);
    const rts = await page.evaluate(() => window.__WESTEROS_RTS__.getSnapshot());

    assert(transitions.visible.length >= 1, `mobile marker never entered visible state: ${JSON.stringify(record.transitions)}`);
    assert(transitions.visible.some((entry) => entry.left === '245px' && entry.top === '430px'), `mobile marker did not record tap coordinates: ${JSON.stringify(transitions.visible)}`);
    assert(record.final.status.includes('ilerliyor'), `mobile movement command did not execute: ${record.final.status}`);
    assert(rts.coarsePointer === true, 'mobile coarse-pointer path missing');
    assert(rts.selectedCount === 48, `mobile selection drifted: ${rts.selectedCount}`);
    assert(rts.drawCalls < 500, `mobile draw-call budget exceeded: ${rts.drawCalls}`);
    assert(rts.triangles < 500000, `mobile triangle budget exceeded: ${rts.triangles}`);
    assert(errors.length === 0, `mobile console/page errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(OUT, 'mobile-after-feedback-lifecycle.png'), fullPage: true });
    return { expected, actionDurationMs, record, visibleTransitionCount: transitions.visible.length, hiddenTransitionCount: transitions.hidden.length, rts };
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
      baseMain: '09448963fdac06db9f2a35d9fc2e72d1882badfb',
      desktop,
      mobile,
      rca: 'Run309 proved mobile and Run310 reproduced desktop timing sensitivity: transient feedback can complete its visible->hidden lifecycle before a Playwright input promise or immediate post-wait snapshot is sampled. Run311 records marker transitions before input on both surfaces.',
      runtimeFilesChanged: 0,
      historicalRun208Changed: false,
      visualEvidence: ['desktop-after-feedback-lifecycle.png', 'mobile-after-feedback-lifecycle.png'],
      consoleErrors: 0,
      transitionBasedFeedbackContract: true,
    };
    fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`[checkRun311RtsFeedbackTransition] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun311RtsFeedbackTransition] PASS: desktop/mobile pre-input transition proof + movement + lifecycle + budgets + zero console/page errors');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun311RtsFeedbackTransition] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
