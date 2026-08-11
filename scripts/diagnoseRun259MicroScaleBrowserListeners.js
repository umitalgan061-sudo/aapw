#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
function pw() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  throw new Error('Playwright unavailable');
}
function type(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return 'application/json; charset=utf-8';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.fbx') return 'application/octet-stream';
  return 'application/octet-stream';
}
function serve() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const rel = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, rel);
    const index = path.join(file, 'index.html');
    if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isDirectory() && fs.existsSync(index)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); fs.createReadStream(index).pipe(res); return;
    }
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': type(file), 'cache-control': 'no-store' }); fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const server = await serve();
  const browser = await pw().chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = EventTarget.prototype.addEventListener;
    window.__RUN259_LISTENER_TRACE__ = [];
    EventTarget.prototype.addEventListener = function run259TraceAdd(type, listener, options) {
      try {
        const id = this === window ? 'window' : (this?.id || this?.tagName || 'unknown');
        if ((type === 'input' || type === 'change' || type === 'click') && (id === 'window' || String(id).startsWith('we-scale-') || id === 'we-quick-shrink')) {
          window.__RUN259_LISTENER_TRACE__.push({ id, type, name: listener?.name || '(anonymous)', capture: options === true || options?.capture === true });
        }
      } catch {}
      return original.call(this, type, listener, options);
    };
  });
  const url = `http://127.0.0.1:${server.address().port}/editor.html`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_TRANSFORM__ && window.__WESTEROS_EDITOR_MICRO_SCALE__, null, { timeout: 120000 });
    await page.waitForTimeout(100);
    const boot = await page.evaluate(() => ({
      version: window.__WESTEROS_EDITOR_MICRO_SCALE__?.version ?? null,
      minimumScale: window.__WESTEROS_EDITOR_MICRO_SCALE__?.minimumScale ?? null,
      listeners: window.__RUN259_LISTENER_TRACE__.filter((entry) => entry.id === 'window' || String(entry.id).startsWith('we-scale-')),
      inputs: ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => ({ id, min: document.getElementById(id).min, step: document.getElementById(id).step, value: document.getElementById(id).value }))
    }));
    console.log(`[diagnoseRun259MicroScaleBrowserListeners] BOOT ${JSON.stringify(boot)}`);
    const tree = page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first();
    await tree.dblclick();
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length > 0, null, { timeout: 30000 });
    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    const y = page.locator('#we-scale-y');
    await y.fill('0.000001');
    const afterInput = await page.evaluate(() => ({
      version: window.__WESTEROS_EDITOR_MICRO_SCALE__?.version ?? null,
      yValue: document.getElementById('we-scale-y').value,
      scale: window.__WESTEROS_WORLD_EDITOR__.getSelectedObject()?.scale?.toArray?.() || null
    }));
    console.log(`[diagnoseRun259MicroScaleBrowserListeners] AFTER_INPUT ${JSON.stringify(afterInput)}`);
    await y.dispatchEvent('change');
    await page.waitForTimeout(50);
    const afterChange = await page.evaluate(() => ({
      version: window.__WESTEROS_EDITOR_MICRO_SCALE__?.version ?? null,
      yValue: document.getElementById('we-scale-y').value,
      scale: window.__WESTEROS_WORLD_EDITOR__.getSelectedObject()?.scale?.toArray?.() || null
    }));
    console.log(`[diagnoseRun259MicroScaleBrowserListeners] AFTER_CHANGE ${JSON.stringify(afterChange)}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
