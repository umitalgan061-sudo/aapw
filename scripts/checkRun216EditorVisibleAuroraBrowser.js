#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'run216-editor-visible-aurora');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try {
      return require(id);
    } catch {}
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

async function main() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright bulunamadı.');
  const server = await startServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const missing = [];

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    errors.push(String(error));
  });
  page.on('response', (response) => {
    if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`);
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/editor.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });
    await page.waitForFunction(() => Boolean(
      window.__WESTEROS_WORLD_EDITOR__ &&
      window.__WESTEROS_EDITOR_LIVE_WORLD__?.ready &&
      window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__ &&
      window.__WESTEROS_EDITOR_VISIBLE_AURORA__
    ), null, { timeout: 120000 });
    await page.evaluate(() => window.__WESTEROS_EDITOR_LIVE_WORLD__.ready);
    await page.waitForTimeout(700);

    const first = await page.evaluate(() => ({
      bright: window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__.getSnapshot(),
      aurora: window.__WESTEROS_EDITOR_VISIBLE_AURORA__.getSnapshot(),
      actualUniform: Number(window.__WESTEROS_EDITOR_LIVE_WORLD__.liveState.sky.material.uniforms.uNightFactor.value),
      fogDisabled: window.__WESTEROS_WORLD_EDITOR__.scene.fog === null,
      exposure: Number(window.__WESTEROS_WORLD_EDITOR__.renderer.toneMappingExposure)
    }));

    assert(first.bright.mode === 'bright-authoring', `Unexpected bright mode: ${first.bright.mode}`);
    assert(first.bright.lockedTimeRatio === 0.5, `Editor clock drifted: ${first.bright.lockedTimeRatio}`);
    assert(first.bright.sunIntensity >= 2.35, `Editor sun too dim: ${first.bright.sunIntensity}`);
    assert(first.bright.hemisphereIntensity >= 1.65, `Editor hemisphere too dim: ${first.bright.hemisphereIntensity}`);
    assert(first.fogDisabled, 'Edit mode fog returned unexpectedly.');
    assert(first.exposure >= 1.15, `Editor exposure floor missing: ${first.exposure}`);
    assert(first.aurora.mode === 'visible-aurora-boost', `Unexpected aurora mode: ${first.aurora.mode}`);
    assert(first.aurora.configuredFactor >= 3.4, `Configured aurora factor too weak: ${first.aurora.configuredFactor}`);
    assert(first.aurora.actualUniformFactor >= 3.4, `Actual aurora uniform too weak: ${first.aurora.actualUniformFactor}`);
    assert(first.actualUniform >= 3.4, `Live sky aurora uniform too weak: ${first.actualUniform}`);
    assert(first.aurora.auroraColorA === '39ffd0', `Aurora A color drifted: ${first.aurora.auroraColorA}`);
    assert(first.aurora.auroraColorB === '8f68ff', `Aurora B color drifted: ${first.aurora.auroraColorB}`);

    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'editor-visible-aurora-normal.png'), fullPage: true });

    await page.evaluate(() => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const target = api.orbitControls.target;
      api.camera.position.set(target.x + 24, target.y + 14, target.z + 32);
      target.set(target.x, target.y + 18, target.z - 55);
      api.orbitControls.update();
    });
    await page.waitForTimeout(650);

    const second = await page.evaluate(() => ({
      aurora: window.__WESTEROS_EDITOR_VISIBLE_AURORA__.getSnapshot(),
      bright: window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__.getSnapshot()
    }));
    assert(second.aurora.actualUniformFactor >= 3.4, `Aurora boost drifted after camera movement: ${second.aurora.actualUniformFactor}`);
    assert(second.bright.sunIntensity >= 2.35 && second.bright.hemisphereIntensity >= 1.65, 'Brightness floor drifted after camera movement.');
    await page.screenshot({ path: path.join(OUT, 'editor-visible-aurora-sky.png'), fullPage: true });

    assert(missing.length === 0, `HTTP errors: ${missing.join(' | ')}`);
    assert(errors.length === 0, `Console/page errors: ${errors.join(' | ')}`);
    console.log(`[checkRun216EditorVisibleAuroraBrowser] PASS: ${JSON.stringify({ first, second })}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkRun216EditorVisibleAuroraBrowser] FAIL: ${error?.stack || error}`);
  process.exit(1);
});
