#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'run259-editor-fallback-palette');
function assert(value, message) { if (!value) throw new Error(message); }
function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}
function typeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}
function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/__run259_visual__.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end('<!doctype html><html><head><meta charset="utf-8"><title>Run259 visual proof</title></head><body style="margin:0;overflow:hidden"></body></html>');
      return;
    }
    const relative = clean === '/' ? 'editor.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(clean === '/favicon.ico' ? 204 : 404); res.end(); return;
    }
    res.writeHead(200, { 'content-type': typeFor(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(`${base}/__run259_visual__.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const result = await page.evaluate(async () => {
      const THREE = await import('/src/3d/vendor/three/three.module.js');
      const { applyEditorFallbackMaterialPalette } = await import('/src/3d/editor/EditorFallbackMaterialPalette.js');
      const canvas = document.createElement('canvas');
      canvas.id = 'run259-visual-evidence';
      Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '99999' });
      document.body.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(innerWidth, innerHeight, false);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x172033);
      const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
      const light = new THREE.HemisphereLight(0xffffff, 0x334155, 2.4);
      scene.add(light);
      const root = new THREE.Group();
      const names = ['Body', 'Cape', 'Shield'];
      for (let i = 0; i < names.length; i += 1) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8 }));
        mesh.name = names[i];
        mesh.position.x = (i - 1) * 2.2;
        root.add(mesh);
      }
      scene.add(root);
      const applied = applyEditorFallbackMaterialPalette(root, { id: 'run259-visual-fbx', format: 'fbx' });
      const colors = root.children.map((mesh) => mesh.material.color.getHex());
      window.__RUN259_VISUAL__ = { renderer, scene, camera, root, colors, applied };
      camera.position.set(0, 4.5, 9);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      return { tintedMeshes: applied.tintedMeshes, colors, uniqueColors: new Set(colors).size };
    });
    assert(result.tintedMeshes === 3, `Expected 3 tinted meshes, got ${JSON.stringify(result)}`);
    assert(result.uniqueColors >= 2, `Palette lacks visible differentiation: ${JSON.stringify(result)}`);
    await page.screenshot({ path: path.join(OUT, '01-front-angle.png'), fullPage: false });
    await page.evaluate(() => {
      const { renderer, scene, camera } = window.__RUN259_VISUAL__;
      camera.position.set(8, 3.5, 4.5);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    });
    await page.screenshot({ path: path.join(OUT, '02-oblique-angle.png'), fullPage: false });
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    console.log(`[checkRun259EditorFallbackMaterialVisual] PASS ${JSON.stringify({ ...result, screenshots: 2, browserErrors: errors.length })}`);
  } finally {
    await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(`[checkRun259EditorFallbackMaterialVisual] FAIL: ${error.stack || error}`); process.exitCode = 1; });
