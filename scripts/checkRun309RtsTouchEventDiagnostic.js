#!/usr/bin/env node
/** Run309: test-only real-mobile event/timing diagnostic for the legacy Run208 tap contract. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run309-rts-touch-event-diagnostic');
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

async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
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

    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
    await page.waitForFunction(() => Boolean(window.__WESTEROS_RTS__?.getSnapshot));

    await page.click('#rts-select-all');
    await page.click('#rts-move-command');
    const canvas = page.locator('#rts-canvas');
    const bounds = await canvas.boundingBox();
    assert(bounds, 'RTS canvas bounds unavailable');
    const relativeTap = { x: 245, y: 430 };
    const absoluteTap = { x: bounds.x + relativeTap.x, y: bounds.y + relativeTap.y };

    await page.evaluate(({ x, y }) => {
      const canvasNode = document.getElementById('rts-canvas');
      const marker = document.getElementById('rts-command-feedback');
      const move = document.getElementById('rts-move-command');
      const status = document.getElementById('rts-status');
      const trace = [];
      const describeTarget = (target) => ({
        id: target?.id || '',
        tag: target?.tagName || '',
        className: typeof target?.className === 'string' ? target.className : '',
      });
      const snapshot = (label) => ({
        label,
        at: performance.now(),
        markerVisible: marker?.dataset.visible || '',
        markerOpacity: marker?.style.opacity || '',
        markerLeft: marker?.style.left || '',
        markerTop: marker?.style.top || '',
        moveActive: move?.classList.contains('is-active') === true,
        status: status?.textContent || '',
      });
      const listener = (scope) => (event) => {
        trace.push({
          kind: 'event',
          scope,
          at: performance.now(),
          type: event.type,
          target: describeTarget(event.target),
          currentTarget: describeTarget(event.currentTarget),
          pointerType: event.pointerType || '',
          button: Number.isFinite(event.button) ? event.button : null,
          buttons: Number.isFinite(event.buttons) ? event.buttons : null,
          clientX: Number.isFinite(event.clientX) ? event.clientX : null,
          clientY: Number.isFinite(event.clientY) ? event.clientY : null,
          markerVisible: marker?.dataset.visible || '',
          moveActive: move?.classList.contains('is-active') === true,
          status: status?.textContent || '',
        });
      };
      const eventTypes = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'contextmenu'];
      const documentListener = listener('document-capture');
      const canvasListener = listener('canvas-capture');
      for (const type of eventTypes) {
        document.addEventListener(type, documentListener, true);
        canvasNode?.addEventListener(type, canvasListener, true);
      }
      const markerObserver = new MutationObserver(() => trace.push({ kind: 'marker-mutation', ...snapshot('marker-mutation') }));
      if (marker) markerObserver.observe(marker, { attributes: true, attributeFilter: ['style', 'data-visible'] });
      const statusObserver = new MutationObserver(() => trace.push({ kind: 'status-mutation', ...snapshot('status-mutation') }));
      if (status) statusObserver.observe(status, { childList: true, characterData: true, subtree: true });
      const hit = document.elementFromPoint(x, y);
      window.__RUN309_TOUCH_DIAGNOSTIC__ = {
        trace,
        before: snapshot('before-tap'),
        hitAtTap: describeTarget(hit),
        absoluteTap: { x, y },
        finish: () => {
          markerObserver.disconnect();
          statusObserver.disconnect();
          for (const type of eventTypes) {
            document.removeEventListener(type, documentListener, true);
            canvasNode?.removeEventListener(type, canvasListener, true);
          }
          return { after: snapshot('finish'), trace: trace.map((entry) => ({ ...entry })) };
        },
      };
    }, absoluteTap);

    const tapStartedAt = Date.now();
    await canvas.tap({ position: relativeTap, timeout: 30000 });
    const tapDurationMs = Date.now() - tapStartedAt;
    const immediate = await page.evaluate(() => ({
      markerVisible: document.getElementById('rts-command-feedback')?.dataset.visible || '',
      markerOpacity: document.getElementById('rts-command-feedback')?.style.opacity || '',
      moveActive: document.getElementById('rts-move-command')?.classList.contains('is-active') === true,
      status: document.getElementById('rts-status')?.textContent || '',
      trace: window.__RUN309_TOUCH_DIAGNOSTIC__.trace.map((entry) => ({ ...entry })),
    }));
    await page.waitForTimeout(1200);
    const finished = await page.evaluate(() => window.__RUN309_TOUCH_DIAGNOSTIC__.finish());
    const initial = await page.evaluate(() => ({
      before: window.__RUN309_TOUCH_DIAGNOSTIC__.before,
      hitAtTap: window.__RUN309_TOUCH_DIAGNOSTIC__.hitAtTap,
      absoluteTap: window.__RUN309_TOUCH_DIAGNOSTIC__.absoluteTap,
    }));
    const rts = await page.evaluate(() => window.__WESTEROS_RTS__.getSnapshot());

    const eventTrace = finished.trace.filter((entry) => entry.kind === 'event');
    const markerMutations = finished.trace.filter((entry) => entry.kind === 'marker-mutation');
    const statusMutations = finished.trace.filter((entry) => entry.kind === 'status-mutation');
    const eventTypesSeen = [...new Set(eventTrace.map((entry) => entry.type))];
    const pointerUps = eventTrace.filter((entry) => entry.type === 'pointerup');
    const touchEnds = eventTrace.filter((entry) => entry.type === 'touchend');
    const clicks = eventTrace.filter((entry) => entry.type === 'click');
    const markerEverVisible = markerMutations.some((entry) => entry.markerVisible === 'true') || eventTrace.some((entry) => entry.markerVisible === 'true') || immediate.markerVisible === 'true';
    const markerVisibleAtTapReturn = immediate.markerVisible === 'true';

    assert(eventTrace.length > 0, 'Playwright tap emitted no observable input events');
    assert(eventTypesSeen.includes('touchstart') || eventTypesSeen.includes('pointerdown'), `no touch/pointer start event observed: ${eventTypesSeen.join(',')}`);
    assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);

    const proof = {
      baseMain: '09448963fdac06db9f2a35d9fc2e72d1882badfb',
      tapDurationMs,
      initial,
      immediate,
      finished,
      summary: {
        eventTypesSeen,
        pointerUpCount: pointerUps.length,
        pointerUps,
        touchEndCount: touchEnds.length,
        touchEnds,
        clickCount: clicks.length,
        clicks,
        markerMutationCount: markerMutations.length,
        markerMutations,
        statusMutationCount: statusMutations.length,
        statusMutations,
        markerEverVisible,
        markerVisibleAtTapReturn,
      },
      rts,
      consoleErrors: errors,
    };
    fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    await page.screenshot({ path: path.join(OUT, 'mobile-after-tap.png'), fullPage: true });
    console.log(`[checkRun309RtsTouchEventDiagnostic] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun309RtsTouchEventDiagnostic] PASS: real Playwright mobile tap event/timing trace captured without runtime changes');
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun309RtsTouchEventDiagnostic] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
