#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'run266-entry-gate');

function assert(value, message) {
  if (!value) throw new Error(message);
}

function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.fbx': 'application/octet-stream'
  })[ext] || 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
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

function movedEnough(before, after, minimum = 36) {
  if (!before || !after) return false;
  return Math.hypot(after.x - before.x, after.y - before.y) >= minimum;
}

async function verifyGateBasics(page) {
  await page.waitForSelector('#run266-entry-gate', { state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__WESTEROS_ENTRY_GATE_RUN266__?.isOpen?.()), null, { timeout: 30000 });
  const basics = await page.evaluate(() => {
    const gate = document.getElementById('run266-entry-gate');
    const back = document.getElementById('run266-entry-back');
    const enter = document.getElementById('run266-entry-enter');
    const image = gate?.querySelector('.run266-entry-art');
    return {
      gateVisible: Boolean(gate && !gate.hidden),
      imageSrc: image?.getAttribute('src'),
      naturalWidth: image?.naturalWidth || 0,
      naturalHeight: image?.naturalHeight || 0,
      backText: back?.textContent?.trim(),
      enterText: enter?.textContent?.trim(),
      backAriaDisabled: back?.getAttribute('aria-disabled'),
      backTabIndex: back?.getAttribute('tabindex'),
      backRect: back?.getBoundingClientRect().toJSON(),
      enterRect: enter?.getBoundingClientRect().toJSON(),
      bodyContainsGate: document.body.contains(gate)
    };
  });
  assert(basics.gateVisible && basics.bodyContainsGate, 'Entry gate is not visible');
  assert(basics.imageSrc === './giriş.png', `Unexpected entry image: ${basics.imageSrc}`);
  assert(basics.naturalWidth > 0 && basics.naturalHeight > 0, 'giriş.png did not render');
  assert(basics.backText === 'Geri dön' && basics.enterText === 'Giriş yap', 'Button copy mismatch');
  assert(basics.backAriaDisabled === 'true' && basics.backTabIndex === '-1', 'Back button must be non-keyboard-actionable');
  assert(basics.backRect.x < basics.enterRect.x, 'Back must begin left of Enter');
  return basics;
}

async function prove2DTo3DRoute(context, base) {
  const routePage = await context.newPage();
  try {
    await routePage.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const href = await routePage.evaluate(() => document.querySelector('a.tb-btn[href="game3d.html"]')?.getAttribute('href'));
    assert(href === 'game3d.html', `2D 3D link changed unexpectedly: ${href}`);
    await routePage.evaluate(() => document.querySelector('a.tb-btn[href="game3d.html"]')?.click());
    await routePage.waitForURL(/game3d\.html$/, { timeout: 30000 });
    await routePage.waitForSelector('#run266-entry-gate', { state: 'visible', timeout: 30000 });
    const imageVisible = await routePage.locator('.run266-entry-art').evaluate((image) => image.naturalWidth > 0 && image.naturalHeight > 0);
    assert(imageVisible, '2D→3D route landed without rendered giriş.png');
    return { href, landedOnGate: true };
  } finally {
    await routePage.close();
  }
}

async function desktopProof(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const route = await prove2DTo3DRoute(context, base);
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`${page.url()} :: ${message.text()}`); });
    page.on('pageerror', (error) => errors.push(`${page.url()} :: ${String(error)}`));

    await page.goto(`${base}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const initial = await verifyGateBasics(page);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, '01-desktop-initial.png'), fullPage: true });

    const before = await page.locator('#run266-entry-back').boundingBox();
    assert(before, 'Desktop back button has no bounding box');
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2, { steps: 4 });
    await page.waitForFunction(() => Number(document.getElementById('run266-entry-back')?.dataset.run266Moves || 0) >= 1, null, { timeout: 5000 });
    const after = await page.locator('#run266-entry-back').boundingBox();
    assert(movedEnough(before, after), `Desktop back button did not evade pointer: ${JSON.stringify({ before, after })}`);
    assert(await page.evaluate(() => window.__WESTEROS_ENTRY_GATE_RUN266__?.isOpen?.()), 'Gate closed after desktop back evade');

    const urlBeforeReject = page.url();
    await page.locator('#run266-entry-back').dispatchEvent('click', { clientX: after.x + after.width / 2, clientY: after.y + after.height / 2 });
    assert(page.url() === urlBeforeReject, 'Back click navigated unexpectedly');
    assert(await page.evaluate(() => window.__WESTEROS_ENTRY_GATE_RUN266__?.isOpen?.()), 'Back click closed the gate');
    await page.screenshot({ path: path.join(OUT, '02-desktop-evaded.png'), fullPage: true });

    const enterBefore = await page.locator('#run266-entry-enter').boundingBox();
    assert(enterBefore, 'Desktop enter button was not measurable');
    await page.locator('#run266-entry-enter').click();
    await page.waitForFunction(() => !document.getElementById('run266-entry-gate') && !window.__WESTEROS_ENTRY_GATE_RUN266__, null, { timeout: 5000 });
    assert(errors.length === 0, `Desktop 3D gate console/page errors: ${errors.join(' | ')}`);
    await page.close();
    return { route, initial, backBefore: before, backAfter: after, enterRect: enterBefore, errors: errors.length };
  } finally {
    await context.close();
  }
}

async function mobileProof(browser, base) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${page.url()} :: ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`${page.url()} :: ${String(error)}`));

  try {
    await page.goto(`${base}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const initial = await verifyGateBasics(page);
    await page.screenshot({ path: path.join(OUT, '03-mobile-initial.png'), fullPage: true });

    const before = await page.locator('#run266-entry-back').boundingBox();
    assert(before, 'Mobile back button has no bounding box');
    await page.locator('#run266-entry-back').dispatchEvent('pointerdown', {
      pointerType: 'touch',
      clientX: before.x + before.width / 2,
      clientY: before.y + before.height / 2,
      bubbles: true,
      cancelable: true
    });
    await page.waitForFunction(() => Number(document.getElementById('run266-entry-back')?.dataset.run266Moves || 0) >= 1, null, { timeout: 5000 });
    const after = await page.locator('#run266-entry-back').boundingBox();
    assert(movedEnough(before, after), `Mobile back button did not slide away: ${JSON.stringify({ before, after })}`);
    assert(await page.evaluate(() => window.__WESTEROS_ENTRY_GATE_RUN266__?.isOpen?.()), 'Gate closed after mobile back touch');
    await page.screenshot({ path: path.join(OUT, '04-mobile-evaded.png'), fullPage: true });

    const enterBefore = await page.locator('#run266-entry-enter').boundingBox();
    assert(enterBefore, 'Mobile enter button was not measurable');
    await page.locator('#run266-entry-enter').tap();
    await page.waitForFunction(() => !document.getElementById('run266-entry-gate') && !window.__WESTEROS_ENTRY_GATE_RUN266__, null, { timeout: 5000 });
    assert(errors.length === 0, `Mobile 3D gate console/page errors: ${errors.join(' | ')}`);
    return { initial, backBefore: before, backAfter: after, enterRect: enterBefore, errors: errors.length };
  } finally {
    await context.close();
  }
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const desktop = await desktopProof(browser, base);
    const mobile = await mobileProof(browser, base);
    console.log(`[checkRun266EntryGate] PASS ${JSON.stringify({ desktop, mobile, screenshots: 4 })}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun266EntryGate] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
