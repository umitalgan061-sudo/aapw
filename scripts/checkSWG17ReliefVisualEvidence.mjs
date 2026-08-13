#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import {
  G17,
  G17_RELIEF_POLICY,
  sampleG17Relief,
} from '../godot/terrain-authoring/geocells/sw/g17_relief.mjs';

const { loadPlaywright, startStaticServer } = devServerHelper;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/sw-g17-relief-visual');
const CONTEXT_DIR = path.join(OUT_DIR, 'hydrology-context');
const DIAGNOSTIC_HEIGHT_SCALE = 18;

function fail(message) {
  throw new Error(`[checkSWG17ReliefVisualEvidence] FAIL: ${message}`);
}
function requireCondition(condition, message) {
  if (!condition) fail(message);
}
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const contextRun = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts/checkSWG17HydrologyVisualEvidence.mjs'),
  `--out-dir=${CONTEXT_DIR}`,
], { cwd: ROOT, env: process.env, encoding: 'utf8' });
if (contextRun.status !== 0) {
  fail(`qualified hydrology SDF context failed: ${contextRun.stderr || contextRun.stdout}`);
}
const contextMetricsPath = path.join(CONTEXT_DIR, 'g17-hydrology-visual-metrics.json');
requireCondition(fs.existsSync(contextMetricsPath), 'qualified SDF context metrics missing');
const contextMetrics = JSON.parse(fs.readFileSync(contextMetricsPath, 'utf8'));
requireCondition(contextMetrics?.topdown?.visibleGeoCellOverlay === false, 'full-world context exposed a GeoCell overlay');
requireCondition(String(contextMetrics?.topdown?.referenceContext || '').includes('sdf-contour-v1'), 'full-world context lost SDF contour policy');
const contextTopdown = fs.readFileSync(path.join(CONTEXT_DIR, 'g17-hydrology-full-world-topdown.png'));
fs.writeFileSync(path.join(OUT_DIR, 'g17-relief-full-world-topdown.png'), contextTopdown);

const visualSize = 129;
const samples = [];
let minHeight = Infinity;
let maxHeight = -Infinity;
let minRoughness = Infinity;
let maxRoughness = -Infinity;
for (let y = 0; y < visualSize; y += 1) {
  const ny = G17.normalizedBounds.minY + (G17.normalizedBounds.maxY - G17.normalizedBounds.minY) * y / (visualSize - 1);
  for (let x = 0; x < visualSize; x += 1) {
    const nx = G17.normalizedBounds.minX + (G17.normalizedBounds.maxX - G17.normalizedBounds.minX) * x / (visualSize - 1);
    const sample = sampleG17Relief(nx, ny);
    requireCondition(sample.marineWeight >= 1 - 1e-12 && sample.landWeight <= 1e-12, 'visual probe leaked terrestrial surface');
    requireCondition(sample.height < G17_RELIEF_POLICY.waterCeilingMeters, 'visual probe invented land');
    minHeight = Math.min(minHeight, sample.height);
    maxHeight = Math.max(maxHeight, sample.height);
    minRoughness = Math.min(minRoughness, sample.roughness);
    maxRoughness = Math.max(maxRoughness, sample.roughness);
    samples.push([sample.height, ...sample.color, sample.roughness]);
  }
}
requireCondition(maxHeight - minHeight >= 0.5, 'visual relief is too flat');

const playwright = loadPlaywright();
requireCondition(Boolean(playwright), 'Playwright is required');
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20000 });

  const renderMetrics = await page.evaluate(async ({ samples, visualSize, bounds, heightScale }) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
    const canvas = document.getElementById('terrain-proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071722);

    const centerMap = normalizedReferenceToMapCanvas((bounds.minX + bounds.maxX) * 0.5, (bounds.minY + bounds.maxY) * 0.5);
    const centerWorld = mapCanvasToPlannedWorldXZ(centerMap.x, centerMap.y);
    const positions = [];
    const colors = [];
    const indices = [];
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    let minY = Infinity; let maxY = -Infinity;
    let roughnessSum = 0;
    for (let row = 0; row < visualSize; row += 1) {
      const ny = bounds.minY + (bounds.maxY - bounds.minY) * row / (visualSize - 1);
      for (let col = 0; col < visualSize; col += 1) {
        const nx = bounds.minX + (bounds.maxX - bounds.minX) * col / (visualSize - 1);
        const source = samples[row * visualSize + col];
        const map = normalizedReferenceToMapCanvas(nx, ny);
        const world = mapCanvasToPlannedWorldXZ(map.x, map.y);
        const py = source[0] * heightScale;
        minX = Math.min(minX, world.x); maxX = Math.max(maxX, world.x);
        minZ = Math.min(minZ, world.z); maxZ = Math.max(maxZ, world.z);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        positions.push(world.x - centerWorld.x, py, world.z - centerWorld.z);
        const depth = Math.max(0, Math.min(1, (source[0] + 9) / 6.5));
        colors.push(source[1] * (0.74 + 0.26 * depth), source[2] * (0.74 + 0.26 * depth), source[3] * (0.74 + 0.26 * depth));
        roughnessSum += source[4];
      }
    }
    for (let row = 0; row < visualSize - 1; row += 1) {
      for (let col = 0; col < visualSize - 1; col += 1) {
        const a = row * visualSize + col; const b = a + 1; const c = a + visualSize; const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const spanX = maxX - minX; const spanZ = maxZ - minZ; const span = Math.max(spanX, spanZ);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const substrate = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: roughnessSum / samples.length,
      metalness: 0,
      side: THREE.DoubleSide,
    }));
    scene.add(substrate);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(spanX * 2.2, spanZ * 2.2),
      new THREE.MeshPhysicalMaterial({ color: 0x397e9a, transparent: true, opacity: 0.25, roughness: 0.18, metalness: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    water.rotation.x = -Math.PI / 2;
    scene.add(water);
    scene.add(new THREE.HemisphereLight(0xcdeeff, 0x10232c, 1.6));
    const sun = new THREE.DirectionalLight(0xffefd2, 2.4);
    sun.position.set(-spanX * 0.35, span * 0.6, -spanZ * 0.3);
    scene.add(sun);
    scene.fog = new THREE.Fog(0x071722, span * 1.05, span * 2.5);
    const camera = new THREE.PerspectiveCamera(48, 960 / 640, 1, span * 6);
    window.__g17ReliefProof = { renderer, scene, camera, spanX, spanZ, span, minY, maxY, render(kind) {
      if (kind === 'near') camera.position.set(-spanX * 0.30, span * 0.12, spanZ * 0.30);
      else camera.position.set(0, span * 0.58, spanZ * 0.62);
      camera.lookAt(0, (minY + maxY) * 0.5, 0);
      renderer.render(scene, camera);
    }};
    window.__g17ReliefProof.render('near');
    return {
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      averageRoughness: roughnessSum / samples.length,
      diagnosticHeightScale: heightScale,
      diagnosticVerticalSpan: maxY - minY,
      worldSpanMeters: { x: spanX, z: spanZ },
    };
  }, { samples, visualSize, bounds: G17.normalizedBounds, heightScale: DIAGNOSTIC_HEIGHT_SCALE });

  async function capture(kind, name) {
    await page.evaluate((value) => window.__g17ReliefProof.render(value), kind);
    const png = await page.locator('#terrain-proof').screenshot();
    requireCondition(png.length > 1024, `${kind} PNG is unexpectedly small`);
    fs.writeFileSync(path.join(OUT_DIR, name), png);
    return sha256(png);
  }
  const nearSha256 = await capture('near', 'g17-relief-near.png');
  const farSha256 = await capture('far', 'g17-relief-far.png');
  requireCondition(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`);

  const fullWorldSha256 = sha256(contextTopdown);
  const metrics = {
    schema: 'westeros-g17-relief-visual-evidence-v1',
    sourceMapSha256: G17_RELIEF_POLICY.sourceMapSha256,
    visualSize,
    physicalHeightRange: [minHeight, maxHeight],
    roughnessRange: [minRoughness, maxRoughness],
    render: renderMetrics,
    fullWorld: {
      referenceContext: contextMetrics.topdown.referenceContext,
      sourceWidth: contextMetrics.topdown.sourceWidth,
      sourceHeight: contextMetrics.topdown.sourceHeight,
      visibleGeoCellOverlay: false,
      contextPolicy: 'qualified G17 SDF/no-overlay owner-map silhouette; relief ownership is proven by near/far plus numeric Terrain3D height/normal seams',
    },
    evidenceSha256: { near: nearSha256, far: farSha256, fullWorldTopdown: fullWorldSha256 },
    determinismPolicy: 'numeric source/import/seam metrics gate determinism; GPU PNG hashes are provenance only',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'g17-relief-visual-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`SW_G17_RELIEF_VISUAL_METRICS=${JSON.stringify(metrics)}`);
  console.log('SW_G17_RELIEF_VISUAL_OK');
} catch (error) {
  console.log(`SW_G17_RELIEF_VISUAL_ERROR=${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
