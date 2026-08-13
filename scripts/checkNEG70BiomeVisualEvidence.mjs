#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import {
  buildG70Terrain3DBiomeSource,
  measureG70Terrain3DBiome,
} from '../godot/terrain-authoring/geocells/ne/g70_biome.mjs';

const { loadPlaywright, startStaticServer } = devServerHelper;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(ROOT, OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/ne-g70-biome-visual');
const EXPECTED_MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

function fail(message) {
  console.error(`[checkNEG70BiomeVisualEvidence] FAIL: ${message}`);
  process.exit(1);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const source = buildG70Terrain3DBiomeSource();
const sourceMetrics = measureG70Terrain3DBiome();
requireCondition(source.sourceMapSha256 === EXPECTED_MAP_SHA, 'canonical map.png provenance drifted');
requireCondition(source.width === 65 && source.height === 65, 'G70 biome source must remain 65x65 addressing evidence');
requireCondition(sourceMetrics.canonicalSea === 96 && sourceMetrics.canonicalLand === 0, 'G70 must remain canonical open sea');
requireCondition(sourceMetrics.denseNonSeaSamples === 0, 'G70 visual source guard domain invented non-sea semantics');
requireCondition(sourceMetrics.maxGuardColorDelta <= 0.04, 'G70 visual source macro albedo guard seam exceeded tolerance');
requireCondition(sourceMetrics.maxGuardRoughnessDelta <= 0.04, 'G70 visual source roughness guard seam exceeded tolerance');

const playwright = loadPlaywright();
requireCondition(Boolean(playwright), 'Playwright is required for visual evidence');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });

  const renderMetrics = await page.evaluate(async (biomeSource) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    document.body.innerHTML = '<canvas id="g70-biome-proof" width="960" height="640"></canvas>';
    document.body.style.margin = '0';
    document.body.style.background = '#071722';

    const canvas = document.getElementById('g70-biome-proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071722);
    const camera = new THREE.PerspectiveCamera(48, 960 / 640, 1, 6000);
    const size = biomeSource.width;
    const widthMeters = 1200;
    const depthMeters = 760;
    const positions = [];
    const colors = [];
    const indices = [];
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    let sampleFingerprint = 2166136261;

    const mixFingerprint = (value) => {
      const q = Math.round(value * 1000000);
      for (let shift = 0; shift < 32; shift += 8) {
        sampleFingerprint ^= (q >>> shift) & 0xff;
        sampleFingerprint = Math.imul(sampleFingerprint, 16777619) >>> 0;
      }
    };

    for (let row = 0; row < size; row += 1) {
      const v = row / (size - 1);
      for (let col = 0; col < size; col += 1) {
        const u = col / (size - 1);
        const index = row * size + col;
        const height = biomeSource.heights[index];
        const r = biomeSource.colorR[index];
        const g = biomeSource.colorG[index];
        const b = biomeSource.colorB[index];
        const roughness = biomeSource.roughness[index];
        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
        positions.push((u - 0.5) * widthMeters, 0, (v - 0.5) * depthMeters);
        const roughnessShade = 0.96 + (1 - roughness) * 0.12;
        colors.push(Math.min(1, r * roughnessShade), Math.min(1, g * roughnessShade), Math.min(1, b * roughnessShade));
        for (const value of [height, r, g, b, roughness]) mixFingerprint(value);
      }
    }
    for (let row = 0; row < size - 1; row += 1) {
      for (let col = 0; col < size - 1; col += 1) {
        const a = row * size + col;
        const b = a + 1;
        const c = a + size;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const meanRoughness = biomeSource.roughness.reduce((sum, value) => sum + value, 0) / biomeSource.roughness.length;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: meanRoughness,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    scene.add(new THREE.HemisphereLight(0xcce8ff, 0x142832, 1.8));
    const sun = new THREE.DirectionalLight(0xffefd4, 2.4);
    sun.position.set(-420, 720, -360);
    scene.add(sun);

    window.__g70BiomeProof = {
      renderer,
      scene,
      camera,
      geometry,
      material,
      render(kind) {
        if (kind === 'near') {
          camera.position.set(-330, 225, 470);
          camera.lookAt(-60, 0, 0);
        } else {
          camera.position.set(0, 920, 1260);
          camera.lookAt(0, 0, 0);
        }
        renderer.render(scene, camera);
      },
      dispose() {
        geometry.dispose();
        material.dispose();
        renderer.dispose();
      },
    };
    window.__g70BiomeProof.render('near');
    return {
      grid: size,
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      minHeight,
      maxHeight,
      meanRoughness,
      sampleFingerprint,
    };
  }, source);

  async function capturePerspective(kind, filename) {
    await page.evaluate((value) => window.__g70BiomeProof.render(value), kind);
    const png = await page.locator('#g70-biome-proof').screenshot();
    requireCondition(png.length > 1024, `${kind} G70 biome evidence PNG is unexpectedly small`);
    fs.writeFileSync(path.join(OUT_DIR, filename), png);
    return sha256(png);
  }

  const nearSha256 = await capturePerspective('near', 'g70-biome-near.png');
  const farSha256 = await capturePerspective('far', 'g70-biome-far.png');
  await page.evaluate(() => window.__g70BiomeProof.dispose());

  await page.setViewportSize({ width: 1200, height: 800 });
  const topdownMetrics = await page.evaluate(async (biomeSource) => {
    const {
      WORLD_REFERENCE_BASE_SURFACE_MASK,
      sampleReferencePindexQualityV2,
    } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');

    const canvasWidth = 1200;
    const canvasHeight = 800;
    const contextWidth = 768;
    const contextHeight = 512;
    document.body.innerHTML = `<canvas id="g70-world-proof" width="${canvasWidth}" height="${canvasHeight}"></canvas>`;
    const canvas = document.getElementById('g70-world-proof');
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const context = document.createElement('canvas');
    context.width = contextWidth;
    context.height = contextHeight;
    const cctx = context.getContext('2d', { alpha: false });
    const contextData = cctx.createImageData(contextWidth, contextHeight);
    const palette = Object.freeze({
      sea: Object.freeze([41, 77, 93]),
      lake: Object.freeze([79, 127, 134]),
      soil: Object.freeze([125, 135, 88]),
      rock: Object.freeze([117, 108, 96]),
      snow: Object.freeze([216, 223, 220]),
    });
    const surfaces = Object.freeze(['soil', 'rock', 'snow', 'sea', 'lake']);
    const dominantSurfaceCounts = { sea: 0, lake: 0, soil: 0, rock: 0, snow: 0 };
    let transitionEdges = 0;
    let previousRow = null;

    for (let y = 0; y < contextHeight; y += 1) {
      const ny = (y + 0.5) / contextHeight;
      const row = [];
      for (let x = 0; x < contextWidth; x += 1) {
        const nx = (x + 0.5) / contextWidth;
        const sample = sampleReferencePindexQualityV2(nx, ny);
        dominantSurfaceCounts[sample.dominantSurface] += 1;
        row.push(sample.dominantSurface);
        if (x > 0 && row[x - 1] !== row[x]) transitionEdges += 1;
        if (previousRow && previousRow[x] !== row[x]) transitionEdges += 1;
        let r = 0;
        let g = 0;
        let b = 0;
        for (const surface of surfaces) {
          const weight = sample.surfaceWeights[surface];
          const color = palette[surface];
          r += color[0] * weight;
          g += color[1] * weight;
          b += color[2] * weight;
        }
        const reliefShade = 0.94 + 0.06 * sample.reliefInfluence;
        const offset = (y * contextWidth + x) * 4;
        contextData.data[offset] = Math.round(Math.min(255, r * reliefShade));
        contextData.data[offset + 1] = Math.round(Math.min(255, g * reliefShade));
        contextData.data[offset + 2] = Math.round(Math.min(255, b * reliefShade));
        contextData.data[offset + 3] = 255;
      }
      previousRow = row;
    }
    cctx.putImageData(contextData, 0, 0);
    ctx.drawImage(context, 0, 0, canvasWidth, canvasHeight);

    const core = biomeSource.coreBounds;
    const guard = biomeSource.guardBounds;
    const patch = document.createElement('canvas');
    patch.width = 384;
    patch.height = 256;
    const pctx = patch.getContext('2d');
    const patchData = pctx.createImageData(patch.width, patch.height);
    let maxPatchAlpha = 0;
    let maxPatchEdgeAlpha = 0;

    const sampleChannel = (channel, nx, ny) => {
      const u = Math.max(0, Math.min(1, (nx - guard.xMin) / (guard.xMax - guard.xMin)));
      const v = Math.max(0, Math.min(1, (ny - guard.yMin) / (guard.yMax - guard.yMin)));
      const gx = u * (biomeSource.width - 1);
      const gy = v * (biomeSource.height - 1);
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const x1 = Math.min(x0 + 1, biomeSource.width - 1);
      const y1 = Math.min(y0 + 1, biomeSource.height - 1);
      const tx = gx - x0;
      const ty = gy - y0;
      const values = biomeSource[channel];
      const a = values[y0 * biomeSource.width + x0];
      const b = values[y0 * biomeSource.width + x1];
      const c = values[y1 * biomeSource.width + x0];
      const d = values[y1 * biomeSource.width + x1];
      return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    };

    for (let y = 0; y < patch.height; y += 1) {
      const v = y / (patch.height - 1);
      const ny = core.yMin + (core.yMax - core.yMin) * v;
      for (let x = 0; x < patch.width; x += 1) {
        const u = x / (patch.width - 1);
        const nx = core.xMin + (core.xMax - core.xMin) * u;
        const edgeDistance = Math.min(x, y, patch.width - 1 - x, patch.height - 1 - y);
        const edgeT = Math.min(1, edgeDistance / 32);
        const smoothEdge = edgeT * edgeT * (3 - 2 * edgeT);
        const alpha = Math.round(132 * smoothEdge);
        maxPatchAlpha = Math.max(maxPatchAlpha, alpha);
        if (edgeDistance === 0) maxPatchEdgeAlpha = Math.max(maxPatchEdgeAlpha, alpha);
        const offset = (y * patch.width + x) * 4;
        patchData.data[offset] = Math.round(sampleChannel('colorR', nx, ny) * 255);
        patchData.data[offset + 1] = Math.round(sampleChannel('colorG', nx, ny) * 255);
        patchData.data[offset + 2] = Math.round(sampleChannel('colorB', nx, ny) * 255);
        patchData.data[offset + 3] = alpha;
      }
    }
    pctx.putImageData(patchData, 0, 0);
    const x0 = core.xMin * canvasWidth;
    const y0 = core.yMin * canvasHeight;
    const width = (core.xMax - core.xMin) * canvasWidth;
    const height = (core.yMax - core.yMin) * canvasHeight;
    ctx.drawImage(patch, x0, y0, width, height);

    return {
      referenceContext: 'committed-owner-map-pindex-quality-v2',
      referenceSourcePixels: [WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth, WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight],
      contextResolution: [contextWidth, contextHeight],
      outputResolution: [canvasWidth, canvasHeight],
      dominantSurfaceCounts,
      transitionEdges,
      g70CoreBounds: core,
      patchResolution: [patch.width, patch.height],
      maxPatchAlpha,
      maxPatchEdgeAlpha,
      gridOverlay: false,
      nearestNeighbour: false,
      highQualityFiltering: true,
    };
  }, source);

  const fullWorldPng = await page.locator('#g70-world-proof').screenshot();
  requireCondition(fullWorldPng.length > 4096, 'full-world top-down evidence PNG is unexpectedly small');
  fs.writeFileSync(path.join(OUT_DIR, 'g70-biome-full-world.png'), fullWorldPng);
  const fullWorldSha256 = sha256(fullWorldPng);

  requireCondition(renderMetrics.vertices === 65 * 65, 'near/far proof vertex count drifted');
  requireCondition(renderMetrics.triangles === 64 * 64 * 2, 'near/far proof triangle count drifted');
  requireCondition(renderMetrics.maxHeight <= -2.5, 'near/far proof raised canonical G70 seabed');
  requireCondition(topdownMetrics.referenceSourcePixels[0] === 1536 && topdownMetrics.referenceSourcePixels[1] === 1024, 'full-world proof lost map.png source dimensions');
  requireCondition(topdownMetrics.dominantSurfaceCounts.sea > 0, 'full-world proof lost canonical sea');
  requireCondition(topdownMetrics.dominantSurfaceCounts.soil + topdownMetrics.dominantSurfaceCounts.rock + topdownMetrics.dominantSurfaceCounts.snow > 0, 'full-world proof lost readable land silhouette');
  requireCondition(topdownMetrics.transitionEdges > 100, 'full-world proof lacks enough land/water/surface contour transitions');
  requireCondition(topdownMetrics.maxPatchEdgeAlpha === 0, 'G70 full-world patch created a rectangular edge seam');
  requireCondition(topdownMetrics.gridOverlay === false && topdownMetrics.nearestNeighbour === false && topdownMetrics.highQualityFiltering === true, 'full-world proof enabled a grid or nearest-neighbour rendering path');
  requireCondition(pageErrors.length === 0, `visual proof page errors: ${pageErrors.join(' | ')}`);

  const metrics = {
    schema: 'westeros-ne-g70-biome-visual-evidence-v1',
    sourceMapSha256: EXPECTED_MAP_SHA,
    sourceChecksum: source.sourceChecksum,
    sourceMetrics,
    renderMetrics,
    topdownMetrics,
    pngSha256: {
      near: nearSha256,
      far: farSha256,
      fullWorld: fullWorldSha256,
    },
    note: 'PNG hashes are provenance only; deterministic numeric source/seam metrics remain the acceptance oracle.',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'g70-biome-visual-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  console.log(`NE_G70_BIOME_VISUAL_METRICS=${JSON.stringify({ sourceChecksum: source.sourceChecksum, vertices: renderMetrics.vertices, triangles: renderMetrics.triangles, transitionEdges: topdownMetrics.transitionEdges, maxPatchEdgeAlpha: topdownMetrics.maxPatchEdgeAlpha, nearSha256, farSha256, fullWorldSha256 })}`);
  console.log('NE_G70_BIOME_VISUAL_EVIDENCE_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
