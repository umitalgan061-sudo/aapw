#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { buildG60Terrain3DBiomeSource, measureG60Terrain3DBiome } from '../godot/terrain-authoring/geocells/ne/g60_biome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find((value) => value.startsWith('--out-dir='));
const OUT = path.resolve(ROOT, arg ? arg.slice(10) : 'artifacts/ne-g60-biome-visual');
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const { loadPlaywright, startStaticServer } = devServerHelper;
const source = buildG60Terrain3DBiomeSource();
const metrics = measureG60Terrain3DBiome();
const requireOk = (ok, message) => { if (!ok) throw new Error(message); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

requireOk(source.sourceMapSha256 === MAP_SHA, 'map.png provenance drifted');
requireOk(metrics.canonicalSea === 96 && metrics.canonicalLand === 0, 'G60 must remain canonical open sea');
requireOk(metrics.nonSeaSamples === 0, 'G60 visual source invented non-sea semantics');
const playwright = loadPlaywright();
requireOk(Boolean(playwright), 'Playwright is required');
fs.mkdirSync(OUT, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
const hashes = {};

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });

  const perspective = await page.evaluate(async (biome) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    document.body.innerHTML = '<canvas id="proof" width="960" height="640"></canvas>';
    document.body.style.margin = '0';
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#proof'), antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071722);
    const camera = new THREE.PerspectiveCamera(48, 1.5, 1, 5000);
    const positions = [];
    const colors = [];
    const indices = [];
    const size = biome.width;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = y * size + x;
        const u = x / (size - 1);
        const v = y / (size - 1);
        positions.push((u - 0.5) * 1200, biome.heights[i] * 8, (v - 0.5) * 760);
        const shade = 0.96 + (1 - biome.roughness[i]) * 0.12;
        colors.push(biome.colorR[i] * shade, biome.colorG[i] * shade, biome.colorB[i] * shade);
      }
    }
    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const a = y * size + x, b = a + 1, c = a + size, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
    scene.add(new THREE.Mesh(geometry, material));
    scene.add(new THREE.HemisphereLight(0xd8efff, 0x10222a, 2));
    const sun = new THREE.DirectionalLight(0xffefd4, 2.3);
    sun.position.set(-420, 720, -360);
    scene.add(sun);
    window.__g60 = {
      render(kind) {
        camera.position.set(kind === 'near' ? -330 : 0, kind === 'near' ? 220 : 930, kind === 'near' ? 470 : 1280);
        camera.lookAt(0, -40, 0);
        renderer.render(scene, camera);
      },
      dispose() { geometry.dispose(); material.dispose(); renderer.dispose(); },
    };
    window.__g60.render('near');
    return { vertices: positions.length / 3, triangles: indices.length / 3 };
  }, source);

  for (const kind of ['near', 'far']) {
    await page.evaluate((value) => window.__g60.render(value), kind);
    const png = await page.locator('#proof').screenshot();
    requireOk(png.length > 1024, `${kind} PNG unexpectedly small`);
    fs.writeFileSync(path.join(OUT, `g60-biome-${kind}.png`), png);
    hashes[kind] = sha256(png);
  }
  await page.evaluate(() => window.__g60.dispose());

  await page.setViewportSize({ width: 1200, height: 800 });
  const topdown = await page.evaluate(async () => {
    const { sampleReferencePindexQualityV2 } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    document.body.innerHTML = '<canvas id="world" width="1200" height="800"></canvas>';
    const canvas = document.querySelector('#world');
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const low = document.createElement('canvas');
    low.width = 600;
    low.height = 400;
    const lctx = low.getContext('2d', { alpha: false });
    const image = lctx.createImageData(low.width, low.height);
    const palette = { sea:[41,77,93], lake:[79,127,134], soil:[125,135,88], rock:[117,108,96], snow:[216,223,220] };
    const surfaces = Object.keys(palette);
    let transitionEdges = 0;
    let previous = null;
    for (let y = 0; y < low.height; y += 1) {
      const row = [];
      for (let x = 0; x < low.width; x += 1) {
        const sample = sampleReferencePindexQualityV2((x + 0.5) / low.width, (y + 0.5) / low.height);
        row.push(sample.dominantSurface);
        if (x && row[x - 1] !== row[x]) transitionEdges += 1;
        if (previous && previous[x] !== row[x]) transitionEdges += 1;
        let r = 0, g = 0, b = 0;
        for (const surface of surfaces) {
          const weight = sample.surfaceWeights[surface];
          r += palette[surface][0] * weight;
          g += palette[surface][1] * weight;
          b += palette[surface][2] * weight;
        }
        const i = (y * low.width + x) * 4;
        image.data.set([Math.round(r), Math.round(g), Math.round(b), 255], i);
      }
      previous = row;
    }
    lctx.putImageData(image, 0, 0);
    ctx.filter = 'blur(4px)';
    ctx.drawImage(low, 0, 0, 1200, 800);
    ctx.filter = 'none';
    return { outputResolution:[1200,800], contextResolution:[600,400], transitionEdges, gridOverlay:false };
  });

  const png = await page.locator('#world').screenshot();
  requireOk(png.length > 4096, 'full-world PNG unexpectedly small');
  requireOk(topdown.transitionEdges > 100, 'full-world map silhouette lost expected geographic transitions');
  requireOk(topdown.gridOverlay === false, 'GeoCell grid overlay must remain disabled');
  fs.writeFileSync(path.join(OUT, 'g60-biome-full-world.png'), png);
  hashes.fullWorld = sha256(png);
  requireOk(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`);

  const result = { mapSha256: MAP_SHA, sourceChecksum: source.sourceChecksum, sourceMetrics: metrics, perspective, topdown, sha256: hashes };
  fs.writeFileSync(path.join(OUT, 'g60-biome-visual-metrics.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`G60_BIOME_VISUAL_METRICS=${JSON.stringify(result)}`);
  console.log('NE_G60_BIOME_VISUAL_EVIDENCE_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}