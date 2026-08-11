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
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  async function snapshot(label, targetId) {
    const state = await page.evaluate(({ label, targetId }) => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const selected = api?.getSelectedObject?.();
      const target = api?.editableObjects?.find((item) => item.userData?.editorId === targetId);
      return {
        label,
        selectedId: selected?.userData?.editorId || null,
        targetId,
        selectedScale: selected?.scale?.toArray?.() || null,
        targetScale: target?.scale?.toArray?.() || null,
        inputValues: ['we-scale-x','we-scale-y','we-scale-z'].map((id) => document.getElementById(id)?.value),
        inputMin: ['we-scale-x','we-scale-y','we-scale-z'].map((id) => document.getElementById(id)?.min),
        inputStep: ['we-scale-x','we-scale-y','we-scale-z'].map((id) => document.getElementById(id)?.step),
        run216: window.__WESTEROS_EDITOR_SCALE_INPUT__?.minimumScale ?? null,
        run264: window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__ ? {
          minimumScale: window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__.minimumScale,
          decimals: window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__.decimals
        } : null
      };
    }, { label, targetId });
    console.log(`[run264-diagnostic] ${JSON.stringify(state)}`);
    return state;
  }

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_SCALE_INPUT__ && window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__), null, { timeout: 120000 });
    const beforeIds = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.map((object) => object.userData?.editorId).filter(Boolean));
    await page.locator('#we-assets .we-asset', { hasText: 'Ağaç İşaretçisi' }).first().dblclick();
    await page.waitForFunction((knownIds) => {
      const object = window.__WESTEROS_WORLD_EDITOR__.getSelectedObject?.();
      return Boolean(object && object.userData?.editorAssetId === 'marker-tree' && !knownIds.includes(object.userData?.editorId));
    }, beforeIds, { timeout: 30000 });
    const targetId = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.getSelectedObject().userData.editorId);
    await snapshot('selected-new-tree', targetId);

    await page.evaluate(() => {
      for (const id of ['we-scale-x','we-scale-y','we-scale-z']) {
        const input = document.getElementById(id);
        input.min = '0.001';
        input.step = '0.001';
      }
    });
    await page.waitForTimeout(50);
    await snapshot('after-legacy-metadata-injection', targetId);

    for (const id of ['we-scale-x','we-scale-y','we-scale-z']) {
      const input = page.locator(`#${id}`);
      await input.fill('0.000001');
      await page.waitForTimeout(25);
      await snapshot(`after-fill-${id}`, targetId);
      await input.dispatchEvent('change');
      await page.waitForTimeout(25);
      await snapshot(`after-change-${id}`, targetId);
    }

    await page.evaluate(() => {
      const input = document.getElementById('we-scale-x');
      input.value = '0.000001';
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(25);
    await snapshot('after-native-change-x', targetId);

    console.log(`[run264-diagnostic] browserErrors=${JSON.stringify(errors)}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[run264-diagnostic] FATAL ${error.stack || error}`);
  process.exitCode = 1;
});
