#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'run216-editor-bright-authoring');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

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
  if (ext === '.fbx') return 'application/octet-stream';
  return 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright bulunamadı.');
  const server = await startServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  try {
    await page.goto(`http://127.0.0.1:${port}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.__WESTEROS_WORLD_EDITOR__ &&
      window.__WESTEROS_EDITOR_LIVE_WORLD__?.ready &&
      window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__
    ), null, { timeout: 120000 });
    await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_WORLD__.ready);
    await page.waitForTimeout(400);

    const first = await page.evaluate(() => ({
      snapshot: window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__.getSnapshot(),
      fogDisabled: window.__WESTEROS_WORLD_EDITOR__.scene.fog === null,
      badge: document.querySelector('.we-viewport-badge')?.textContent || '',
      exposure: window.__WESTEROS_WORLD_EDITOR__.renderer.toneMappingExposure
    }));

    assert(first.snapshot.mode === 'bright-authoring', `Unexpected editor visual mode: ${first.snapshot.mode}`);
    assert(Math.abs(first.snapshot.lockedTimeRatio - 0.5) < 1e-9, `Editor time is not noon-locked: ${first.snapshot.lockedTimeRatio}`);
    assert(first.snapshot.auroraFactor >= 1.25, `Aurora factor too weak: ${first.snapshot.auroraFactor}`);
    assert(first.snapshot.sunIntensity >= 2.35, `Editor sun too dim: ${first.snapshot.sunIntensity}`);
    assert(first.snapshot.hemisphereIntensity >= 1.65, `Editor hemisphere too dim: ${first.snapshot.hemisphereIntensity}`);
    assert(first.snapshot.ambientIntensity >= 1.5, `Editor ambient readability too dim: ${first.snapshot.ambientIntensity}`);
    assert(first.snapshot.fillIntensity >= 1.9, `Editor fill readability too dim: ${first.snapshot.fillIntensity}`);
    assert(first.snapshot.keyIntensity >= 2.7, `Editor key light too dim: ${first.snapshot.keyIntensity}`);
    assert(first.snapshot.rimIntensity >= 1.3, `Editor aurora fill too dim: ${first.snapshot.rimIntensity}`);
    assert(first.fogDisabled && first.snapshot.fogDisabled, 'Edit mode fog returned unexpectedly.');
    assert(first.exposure >= 1.15, `Editor exposure floor missing: ${first.exposure}`);
    assert(first.badge.includes('LIVE WORLD'), `Live-world badge missing: ${first.badge}`);

    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'bright-authoring-angle-01.png'), fullPage: true });

    await page.evaluate(() => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      api.camera.position.x += 720;
      api.camera.position.y += 180;
      api.camera.position.z -= 360;
      api.orbitControls.target.x += 560;
      api.orbitControls.target.z -= 240;
      api.orbitControls.update();
    });
    await page.waitForTimeout(300);

    const second = await page.evaluate(() => window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__.getSnapshot());
    const near = (a, b) => Math.abs(a - b) < 0.2;
    assert(second.skyCenter.every((value, index) => near(value, second.cameraPosition[index])), 'Aurora sky did not follow editor camera.');
    assert(second.starsCenter.every((value, index) => near(value, second.cameraPosition[index])), 'Starfield did not follow editor camera.');
    assert(second.sunIntensity >= 2.35 && second.hemisphereIntensity >= 1.65, 'Brightness floor drifted after camera movement.');
    await page.screenshot({ path: path.join(OUT, 'bright-authoring-angle-02.png'), fullPage: true });

    assert(errors.length === 0, `Console/page errors: ${errors.join(' | ')}`);
    console.log(`[checkRun216EditorBrightAuthoringBrowser] PASS: ${JSON.stringify({ first: first.snapshot, second })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun216EditorBrightAuthoringBrowser] FAIL: ${error?.stack || error}`);
  process.exit(1);
});
