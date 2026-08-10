#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run232-editor-mobile-scroll-reachability');
const MOBILE_VIEWPORT = Object.freeze({ width: 390, height: 844 });

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
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return ext === '.webmanifest' ? 'application/manifest+json' : 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  return 'application/octet-stream';
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
    const directoryIndex = path.join(file, 'index.html');
    if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isDirectory() && fs.existsSync(directoryIndex)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(directoryIndex).pipe(res);
      return;
    }
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

async function waitForEditor(page) {
  await page.waitForFunction(() => (
    window.__WESTEROS_WORLD_EDITOR__ &&
    window.__WESTEROS_EDITOR_HISTORY__ &&
    window.__WESTEROS_EDITOR_TRANSFORM__
  ), null, { timeout: 120000 });
  await page.waitForTimeout(500);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const tolerance = 2;
    const toolbar = document.querySelector('.we-toolbar-actions');
    const statusbar = document.querySelector('.we-statusbar');
    const visibleInteractive = [...toolbar.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
    const toolbarRect = toolbar.getBoundingClientRect();
    const statusRect = statusbar.getBoundingClientRect();
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        width: Math.round(rect.width * 100) / 100
      };
    };
    return {
      viewportWidth: innerWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      toolbar: {
        clientWidth: toolbar.clientWidth,
        scrollWidth: toolbar.scrollWidth,
        scrollLeft: toolbar.scrollLeft,
        maxScrollLeft: Math.max(0, toolbar.scrollWidth - toolbar.clientWidth),
        rect: rectOf(toolbar),
        first: visibleInteractive[0] ? { id: visibleInteractive[0].id, tag: visibleInteractive[0].tagName, rect: rectOf(visibleInteractive[0]) } : null,
        last: visibleInteractive.at(-1) ? { id: visibleInteractive.at(-1).id, tag: visibleInteractive.at(-1).tagName, rect: rectOf(visibleInteractive.at(-1]) } : null,
        count: visibleInteractive.length
      },
      statusbar: {
        clientWidth: statusbar.clientWidth,
        scrollWidth: statusbar.scrollWidth,
        scrollLeft: statusbar.scrollLeft,
        maxScrollLeft: Math.max(0, statusbar.scrollWidth - statusbar.clientWidth),
        rect: rectOf(statusbar),
        first: statusbar.firstElementChild ? { id: statusbar.firstElementChild.id, rect: rectOf(statusbar.firstElementChild) } : null,
        last: statusbar.lastElementChild ? { id: statusbar.lastElementChild.id, rect: rectOf(statusbar.lastElementChild) } : null
      },
      tolerance
    };
  });
}

function assertGlobalWidth(state, label) {
  assert(state.viewportWidth === MOBILE_VIEWPORT.width, `${label}: unexpected viewport width ${JSON.stringify(state)}`);
  assert(state.rootScrollWidth <= state.viewportWidth + state.tolerance, `${label}: root overflow ${JSON.stringify(state)}`);
  assert(state.bodyScrollWidth <= state.viewportWidth + state.tolerance, `${label}: body overflow ${JSON.stringify(state)}`);
}

function assertWithin(child, container, tolerance, label) {
  assert(child, `${label}: missing child geometry`);
  assert(child.rect.left >= container.rect.left - tolerance, `${label}: child is left-clipped ${JSON.stringify({ child, container })}`);
  assert(child.rect.right <= container.rect.right + tolerance, `${label}: child is right-clipped ${JSON.stringify({ child, container })}`);
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitForEditor(page);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

    const start = await snapshot(page);
    assertGlobalWidth(start, 'start');
    assert(start.toolbar.count >= 6, `Toolbar interactive control count unexpectedly small: ${JSON.stringify(start.toolbar)}`);
    assert(start.toolbar.scrollWidth > start.toolbar.clientWidth + 2, `Toolbar is not horizontally scrollable: ${JSON.stringify(start.toolbar)}`);
    assert(start.statusbar.scrollWidth > start.statusbar.clientWidth + 2, `Statusbar is not horizontally scrollable: ${JSON.stringify(start.statusbar)}`);
    assertWithin(start.toolbar.first, start.toolbar, start.tolerance, 'toolbar-start');
    assertWithin(start.statusbar.first, start.statusbar, start.tolerance, 'statusbar-start');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-scroll-start.png'), fullPage: false });

    const toolbarEndFocus = await page.evaluate(() => {
      const toolbar = document.querySelector('.we-toolbar-actions');
      const controls = [...toolbar.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        });
      toolbar.scrollLeft = toolbar.scrollWidth;
      const last = controls.at(-1);
      last?.focus({ preventScroll: true });
      return { lastId: last?.id || '', lastTag: last?.tagName || '', focused: document.activeElement === last };
    });
    await page.waitForTimeout(180);
    const toolbarEnd = await snapshot(page);
    assertGlobalWidth(toolbarEnd, 'toolbar-end');
    assert(toolbarEnd.toolbar.scrollLeft >= toolbarEnd.toolbar.maxScrollLeft - 2, `Toolbar did not reach end: ${JSON.stringify(toolbarEnd.toolbar)}`);
    assertWithin(toolbarEnd.toolbar.last, toolbarEnd.toolbar, toolbarEnd.tolerance, 'toolbar-end');
    assert(toolbarEndFocus.focused, `Rightmost toolbar control could not receive focus after scroll: ${JSON.stringify(toolbarEndFocus)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-toolbar-end.png'), fullPage: false });

    await page.evaluate(() => {
      const toolbar = document.querySelector('.we-toolbar-actions');
      toolbar.scrollLeft = 0;
      const statusbar = document.querySelector('.we-statusbar');
      statusbar.scrollLeft = statusbar.scrollWidth;
    });
    await page.waitForTimeout(180);
    const statusEnd = await snapshot(page);
    assertGlobalWidth(statusEnd, 'status-end');
    assert(statusEnd.statusbar.scrollLeft >= statusEnd.statusbar.maxScrollLeft - 2, `Statusbar did not reach end: ${JSON.stringify(statusEnd.statusbar)}`);
    assertWithin(statusEnd.statusbar.last, statusEnd.statusbar, statusEnd.tolerance, 'statusbar-end');
    assertWithin(statusEnd.toolbar.first, statusEnd.toolbar, statusEnd.tolerance, 'toolbar-return-start');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-statusbar-end.png'), fullPage: false });

    await page.evaluate(() => {
      document.querySelector('.we-statusbar').scrollLeft = 0;
    });
    await page.waitForTimeout(180);
    const returned = await snapshot(page);
    assertGlobalWidth(returned, 'returned');
    assert(returned.statusbar.scrollLeft <= 2, `Statusbar did not return to start: ${JSON.stringify(returned.statusbar)}`);
    assertWithin(returned.statusbar.first, returned.statusbar, returned.tolerance, 'statusbar-return-start');
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    console.log(`[checkRun232EditorMobileScrollReachability] PASS ${JSON.stringify({ start, toolbarEndFocus, toolbarEnd, statusEnd, returned, screenshots: 3 })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun232EditorMobileScrollReachability] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
