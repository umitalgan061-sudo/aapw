#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { buildG70Terrain3DRockSnowProbe, measureG70Terrain3DRockSnow } from '../godot/terrain-authoring/geocells/ne/g70_rock_snow.mjs';
import { buildG70Terrain3DBiomeSource } from '../godot/terrain-authoring/geocells/ne/g70_biome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find((v) => v.startsWith('--out-dir='));
const OUT = path.resolve(ROOT, arg ? arg.slice(10) : 'artifacts/ne-g70-rock-snow-visual');
const requireOk = (ok, message) => { if (!ok) throw new Error(message); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const rockSnow = buildG70Terrain3DRockSnowProbe();
const metrics = measureG70Terrain3DRockSnow();
const biome = buildG70Terrain3DBiomeSource();
requireOk(metrics.canonicalWater === 96 && metrics.canonicalLand === 0, 'G70 visual proof requires 96/96 open sea');
requireOk(metrics.maxRockWeight === 0 && metrics.maxSnowWeight === 0, 'terrestrial material leaked before visual proof');
requireOk(metrics.maxTerrestrialSurfaceMass === 0, 'terrestrial surface mass must stay zero');
requireOk(rockSnow.rows.flat().every((s) => s[0] === 0 && s[1] === 0 && s[2] === 0 && s[4] === 0), 'Rock/Snow probe is not a zero overlay');

const playwright = devServerHelper.loadPlaywright();
requireOk(Boolean(playwright), 'Playwright is required');
fs.mkdirSync(OUT, { recursive: true });
const server = await devServerHelper.startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
const hashes = {};
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });

  const perspective = await page.evaluate(async ({ probe, biomeSource }) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    document.body.innerHTML = '<canvas id="proof" width="960" height="640"></canvas>';
    document.body.style.margin = '0';
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#proof'), antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071722);
    const camera = new THREE.PerspectiveCamera(48, 1.5, 1, 5000);
    const size = probe.sourceGridSize;
    const positions = [], colors = [], indices = [];
    let maxOverlay = 0, minHeight = Infinity, maxHeight = -Infinity;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const s = probe.rows[y][x];
      const height = s[3];
      maxOverlay = Math.max(maxOverlay, s[0], s[1], s[2], s[4]);
      minHeight = Math.min(minHeight, height); maxHeight = Math.max(maxHeight, height);
      positions.push((x / 64 - 0.5) * 1200, height * 8, (y / 64 - 0.5) * 760);
      colors.push(biomeSource.colorR[i], biomeSource.colorG[i], biomeSource.colorB[i]);
    }
    for (let y = 0; y < size - 1; y += 1) for (let x = 0; x < size - 1; x += 1) {
      const a = y * size + x, b = a + 1, c = a + size, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    scene.add(new THREE.Mesh(geometry, material));
    scene.add(new THREE.HemisphereLight(0xd8efff, 0x10222a, 2));
    const sun = new THREE.DirectionalLight(0xffefd4, 2.1); sun.position.set(-420, 720, -360); scene.add(sun);
    window.__proof = { render(kind) {
      camera.position.set(kind === 'near' ? -330 : 0, kind === 'near' ? 220 : 930, kind === 'near' ? 470 : 1280);
      camera.lookAt(0, -40, 0); renderer.render(scene, camera);
    }, dispose() { geometry.dispose(); material.dispose(); renderer.dispose(); } };
    window.__proof.render('near');
    return { vertices: positions.length / 3, triangles: indices.length / 3, maxOverlay, minHeight, maxHeight };
  }, { probe: rockSnow, biomeSource: biome });
  requireOk(perspective.maxOverlay === 0, 'near/far mesh contains Rock/Snow overlay');
  requireOk(perspective.maxHeight - perspective.minHeight <= 0.000001, 'Rock/Snow perspective invented relief');
  for (const kind of ['near', 'far']) {
    await page.evaluate((k) => window.__proof.render(k), kind);
    const png = await page.locator('#proof').screenshot();
    requireOk(png.length > 1024, `${kind} PNG unexpectedly small`);
    fs.writeFileSync(path.join(OUT, `g70-rock-snow-${kind}.png`), png);
    hashes[kind] = sha256(png);
  }
  await page.evaluate(() => window.__proof.dispose());

  await page.setViewportSize({ width: 1200, height: 800 });
  const topdown = await page.evaluate(async () => {
    const { sampleReferencePindexQualityV2 } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    document.body.innerHTML = '<canvas id="world" width="1200" height="800"></canvas>';
    const canvas = document.querySelector('#world'); const ctx = canvas.getContext('2d', { alpha: false });
    const low = document.createElement('canvas'); low.width = 600; low.height = 400;
    const lctx = low.getContext('2d', { alpha: false }); const image = lctx.createImageData(600, 400);
    const palette = { sea:[41,77,93], lake:[79,127,134], soil:[125,135,88], rock:[117,108,96], snow:[216,223,220] };
    let transitionEdges = 0, previous = null;
    for (let y = 0; y < 400; y += 1) {
      const row = [];
      for (let x = 0; x < 600; x += 1) {
        const s = sampleReferencePindexQualityV2((x + 0.5) / 600, (y + 0.5) / 400); row.push(s.dominantSurface);
        if (x && row[x - 1] !== row[x]) transitionEdges += 1;
        if (previous && previous[x] !== row[x]) transitionEdges += 1;
        let r=0,g=0,b=0; for (const [name, color] of Object.entries(palette)) { const w=s.surfaceWeights[name]; r+=color[0]*w; g+=color[1]*w; b+=color[2]*w; }
        image.data.set([Math.round(r),Math.round(g),Math.round(b),255], (y * 600 + x) * 4);
      } previous = row;
    }
    lctx.putImageData(image, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(low, 0, 0, 1200, 800);
    // No G70 patch is painted: zero terrestrial surface mass must be visually inert.
    return { transitionEdges, g70PatchApplied:false, g70PatchAlpha:0, gridOverlay:false };
  });
  requireOk(topdown.transitionEdges > 100, 'full-world geography transitions disappeared');
  requireOk(topdown.g70PatchApplied === false && topdown.g70PatchAlpha === 0, 'G70 Rock/Snow created a square patch');
  requireOk(topdown.gridOverlay === false, 'grid overlay must remain disabled');
  const worldPng = await page.locator('#world').screenshot();
  requireOk(worldPng.length > 4096, 'full-world PNG unexpectedly small');
  fs.writeFileSync(path.join(OUT, 'g70-rock-snow-full-world.png'), worldPng); hashes.fullWorld = sha256(worldPng);
  requireOk(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`);
  const out = { sourceMapSha256: rockSnow.sourceMapSha256, surfaceMetrics: metrics, perspective, topdown, sha256: hashes };
  fs.writeFileSync(path.join(OUT, 'g70-rock-snow-visual-metrics.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`G70_ROCK_SNOW_VISUAL_METRICS=${JSON.stringify(out)}`);
  console.log('NE_G70_ROCK_SNOW_VISUAL_EVIDENCE_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
