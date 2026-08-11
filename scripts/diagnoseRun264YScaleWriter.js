#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = process.cwd();

function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}
function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.fbx':'application/octet-stream' })[ext] || 'application/octet-stream';
}
function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__), null, { timeout: 120000 });
    const beforeIds = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.map((object) => object.userData?.editorId).filter(Boolean));
    await page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first().dblclick();
    await page.waitForFunction((knownIds) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.getSelectedObject?.();
      return Boolean(object && object.userData?.editorAssetId === 'marker-tree' && !knownIds.includes(object.userData?.editorId));
    }, beforeIds, { timeout: 30000 });

    const targetId = await page.evaluate(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__.getSelectedObject();
      const scale = object.scale;
      let value = scale.y;
      const writes = [];
      Object.defineProperty(scale, 'y', {
        configurable: true,
        enumerable: true,
        get() { return value; },
        set(next) {
          const numeric = Number(next);
          if (writes.length < 40 && (!Object.is(numeric, value) || Math.abs(numeric - value) > 1e-15)) {
            writes.push({ from: value, to: numeric, stack: new Error('scale.y writer').stack });
          }
          value = numeric;
        }
      });
      window.__RUN264_Y_WRITES__ = writes;
      return object.userData.editorId;
    });

    const input = page.locator('#we-scale-y');
    await input.fill('0.000001');
    await page.waitForTimeout(120);
    await input.dispatchEvent('change');
    await page.waitForTimeout(120);

    const result = await page.evaluate((id) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects.find((item) => item.userData?.editorId === id);
      return {
        targetId: id,
        scale: object?.scale?.toArray?.() || null,
        input: document.getElementById('we-scale-y')?.value,
        writes: window.__RUN264_Y_WRITES__ || []
      };
    }, targetId);
    console.log(`[run264-y-writer] RESULT ${JSON.stringify(result)}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[run264-y-writer] FATAL ${error.stack || error}`);
  process.exitCode = 1;
});
