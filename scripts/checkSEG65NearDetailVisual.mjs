#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';
import {
  G65_NEAR_DETAIL_POLICY,
  sampleG65NearDetail,
} from '../godot/terrain-authoring/geocells/se/g65_near_detail.mjs';
import { sampleReferencePindexQualityV2 } from '../src/3d/world/worldReferenceSurfacePindexes.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/se-g65-near-detail-visual');
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };

const bounds = G65_NEAR_DETAIL_POLICY.normalizedBounds;
const grid = 129;
const samples = [];
let minHeight = Infinity;
let maxHeight = -Infinity;
for (let y = 0; y < grid; y += 1) {
  const v = y / (grid - 1);
  const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * v;
  for (let x = 0; x < grid; x += 1) {
    const u = x / (grid - 1);
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * u;
    const s = sampleG65NearDetail(nx, ny);
    minHeight = Math.min(minHeight, s.authoredHeight);
    maxHeight = Math.max(maxHeight, s.authoredHeight);
    samples.push([s.authoredHeight, s.tintR, s.tintG, s.tintB]);
  }
}

const worldWidth = 480;
const worldHeight = 320;
const worldPixels = new Uint8ClampedArray(worldWidth * worldHeight * 4);
const palette = { sea:[35,73,93], lake:[62,113,128], soil:[132,131,78], rock:[112,105,96], snow:[220,227,226] };
let g65Samples = 0;
for (let y = 0; y < worldHeight; y += 1) {
  for (let x = 0; x < worldWidth; x += 1) {
    const nx = (x + 0.5) / worldWidth;
    const ny = (y + 0.5) / worldHeight;
    const quality = sampleReferencePindexQualityV2(nx, ny);
    const base = palette[quality.dominantSurface] || palette.soil;
    let r = base[0]; let g = base[1]; let b = base[2];
    if (nx >= bounds.xMin && nx <= bounds.xMax && ny >= bounds.yMin && ny <= bounds.yMax) {
      const s = sampleG65NearDetail(nx, ny);
      r *= s.tintR; g *= s.tintG; b *= s.tintB;
      g65Samples += 1;
    }
    const offset = (y * worldWidth + x) * 4;
    worldPixels[offset] = Math.round(r);
    worldPixels[offset + 1] = Math.round(g);
    worldPixels[offset + 2] = Math.round(b);
    worldPixels[offset + 3] = 255;
  }
}

const playwright = loadPlaywright();
requireCondition(Boolean(playwright), 'Playwright is required');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20000 });

  const metrics = await page.evaluate(async ({ samples, grid, minHeight, maxHeight, bounds }) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    document.body.innerHTML = '<canvas id="proof" width="960" height="640"></canvas>';
    const canvas = document.getElementById('proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9ec8de);
    const positions = [];
    const colors = [];
    const indices = [];
    for (let y = 0; y < grid; y += 1) {
      const v = y / (grid - 1);
      for (let x = 0; x < grid; x += 1) {
        const u = x / (grid - 1);
        const sample = samples[y * grid + x];
        positions.push((u - 0.5) * 1200, (sample[0] - 8) * 9, (v - 0.5) * 800);
        colors.push(0.58 * sample[1], 0.49 * sample[2], 0.32 * sample[3]);
      }
    }
    for (let y = 0; y < grid - 1; y += 1) for (let x = 0; x < grid - 1; x += 1) {
      const a = y * grid + x; const b = a + 1; const c = a + grid; const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide })));
    scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x3b2f24, 1.8));
    const sun = new THREE.DirectionalLight(0xffe2b5, 2.4); sun.position.set(-400, 700, -300); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(48, 960 / 640, 1, 5000);
    window.__g65Visual = { renderer, scene, camera, render(kind) {
      if (kind === 'near') camera.position.set(-360, 250, 420);
      else camera.position.set(0, 780, 980);
      camera.lookAt(0, 0, 0); renderer.render(scene, camera);
    }};
    window.__g65Visual.render('near');
    return { grid, vertices: positions.length / 3, triangles: indices.length / 3, minHeight, maxHeight, bounds };
  }, { samples, grid, minHeight, maxHeight, bounds });

  const capture = async (kind, name) => {
    await page.evaluate((value) => window.__g65Visual.render(value), kind);
    const png = await page.locator('#proof').screenshot();
    requireCondition(png.length > 4096, `${kind} image too small`);
    fs.writeFileSync(path.join(OUT_DIR, name), png);
    return sha256(png);
  };
  const nearSha256 = await capture('near', 'g65-near.png');
  const farSha256 = await capture('far', 'g65-far.png');

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.evaluate(({ pixels, width, height }) => {
    document.body.innerHTML = '<canvas id="topdown" width="1200" height="800"></canvas>';
    const ctx = document.getElementById('topdown').getContext('2d', { alpha: false });
    const low = document.createElement('canvas'); low.width = width; low.height = height;
    const lctx = low.getContext('2d');
    const image = lctx.createImageData(width, height);
    image.data.set(pixels);
    lctx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(low, 0, 0, 1200, 800);
  }, { pixels: Array.from(worldPixels), width: worldWidth, height: worldHeight });
  const full = await page.locator('#topdown').screenshot();
  requireCondition(full.length > 10000, 'full-world top-down image too small');
  fs.writeFileSync(path.join(OUT_DIR, 'g65-full-world-topdown.png'), full);
  requireCondition(errors.length === 0, `browser page errors: ${errors.join(' | ')}`);
  requireCondition(metrics.vertices === 16641 && metrics.triangles === 32768, 'unexpected G65 visual mesh topology');
  requireCondition(g65Samples > 1000, 'G65 full-world overlay was not sampled densely enough');
  console.log(`SE_G65_NEAR_DETAIL_VISUAL_METRICS=${JSON.stringify({ ...metrics, g65Samples, width:1200, height:800, nearSha256, farSha256, fullWorldSha256: sha256(full) })}`);
  console.log('SE_G65_NEAR_DETAIL_VISUAL_OK');
} catch (error) {
  console.log(`SE_G65_NEAR_DETAIL_VISUAL_ERROR=${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
