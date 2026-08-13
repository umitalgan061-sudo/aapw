#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/sw-g07-runtime-visual');

function fail(message) {
  console.error(`[checkSWG07RuntimeVisualParity] FAIL: ${message}`);
  process.exit(1);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const playwright = loadPlaywright();
requireCondition(Boolean(playwright), 'Playwright is required');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, {
    waitUntil: 'load',
    timeout: 20000,
  });

  const proofMetrics = await page.evaluate(async () => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const {
      G07_TERRAIN3D_RUNTIME_BAKE,
      sampleG07Terrain3dBakeNormalized,
    } = await import('/src/3d/world/g07Terrain3dBake.js');

    const canvas = document.getElementById('terrain-proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071722);
    scene.fog = new THREE.Fog(0x071722, 1200, 2500);
    const grid = G07_TERRAIN3D_RUNTIME_BAKE.gridSize;
    const bounds = G07_TERRAIN3D_RUNTIME_BAKE.normalizedBounds;
    const width = 1662;
    const depth = 1293;
    const verticalExaggeration = 40;
    const positions = [];
    const colors = [];
    const indices = [];
    let minHeight = Infinity;
    let maxHeight = -Infinity;

    for (let row = 0; row < grid; row += 1) {
      const v = row / (grid - 1);
      const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * v;
      for (let col = 0; col < grid; col += 1) {
        const u = col / (grid - 1);
        const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * u;
        const sample = sampleG07Terrain3dBakeNormalized(nx, ny);
        if (!sample) throw new Error(`missing G07 sample ${col},${row}`);
        minHeight = Math.min(minHeight, sample.height);
        maxHeight = Math.max(maxHeight, sample.height);
        positions.push(
          (u - 0.5) * width,
          (sample.height - G07_TERRAIN3D_RUNTIME_BAKE.heightOffsetMeters) * verticalExaggeration,
          (v - 0.5) * depth,
        );
        const rockShade = 0.82 + sample.rockBlend * 0.18;
        colors.push(
          Math.min(1, sample.color[0] * rockShade * 1.15),
          Math.min(1, sample.color[1] * rockShade * 1.15),
          Math.min(1, sample.color[2] * rockShade * 1.2),
        );
      }
    }
    for (let row = 0; row < grid - 1; row += 1) {
      for (let col = 0; col < grid - 1; col += 1) {
        const a = row * grid + col;
        const b = a + 1;
        const c = a + grid;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    scene.add(new THREE.HemisphereLight(0xc6e7ff, 0x17242d, 1.55));
    const sun = new THREE.DirectionalLight(0xfff0d4, 2.2);
    sun.position.set(-550, 900, -350);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(48, 960 / 640, 1, 6000);
    window.__g07Proof = {
      THREE,
      renderer,
      scene,
      camera,
      mesh,
      render(kind) {
        if (kind === 'near') {
          camera.position.set(-380, 285, 430);
          camera.lookAt(-90, 20, 10);
        } else {
          camera.position.set(0, 1120, 1550);
          camera.lookAt(0, 10, 0);
        }
        renderer.render(scene, camera);
      },
    };
    window.__g07Proof.render('near');
    return {
      grid,
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      minHeight,
      maxHeight,
      verticalExaggeration,
      canonicalBakeSha256: G07_TERRAIN3D_RUNTIME_BAKE.canonicalBakeSha256,
      importedTopdownSha256: G07_TERRAIN3D_RUNTIME_BAKE.importedTopdownSha256,
    };
  });

  async function deterministicTerrainCapture(kind, filename) {
    await page.evaluate((value) => window.__g07Proof.render(value), kind);
    const first = await page.locator('#terrain-proof').screenshot();
    await page.evaluate((value) => window.__g07Proof.render(value), kind);
    const second = await page.locator('#terrain-proof').screenshot();
    requireCondition(first.equals(second), `${kind} Three.js render is not byte-deterministic`);
    fs.writeFileSync(path.join(OUT_DIR, filename), first);
    return sha256(first);
  }

  const nearSha256 = await deterministicTerrainCapture('near', 'g07-runtime-near.png');
  const farSha256 = await deterministicTerrainCapture('far', 'g07-runtime-far.png');

  await page.setViewportSize({ width: 1200, height: 800 });
  const topdownMetrics = await page.evaluate(async () => {
    const {
      G07_TERRAIN3D_RUNTIME_BAKE,
      sampleG07Terrain3dBakeNormalized,
    } = await import('/src/3d/world/g07Terrain3dBake.js');
    document.body.innerHTML = '<canvas id="topdown-proof" width="1200" height="800"></canvas>';
    const canvas = document.getElementById('topdown-proof');
    const ctx = canvas.getContext('2d', { alpha: false });
    const image = new Image();
    image.src = '/resimler/map.png';
    await image.decode();
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const sourceWidth = 1536;
    const sourceHeight = 1024;
    const b = G07_TERRAIN3D_RUNTIME_BAKE.normalizedBounds;
    const x0 = b.xMin * canvas.width;
    const y0 = b.yMin * canvas.height;
    const patchWidth = (b.xMax - b.xMin) * canvas.width;
    const patchHeight = (b.yMax - b.yMin) * canvas.height;
    const patch = document.createElement('canvas');
    patch.width = 384;
    patch.height = 256;
    const pctx = patch.getContext('2d');
    const data = pctx.createImageData(patch.width, patch.height);
    for (let y = 0; y < patch.height; y += 1) {
      const v = y / (patch.height - 1);
      const ny = b.yMin + (b.yMax - b.yMin) * v;
      for (let x = 0; x < patch.width; x += 1) {
        const u = x / (patch.width - 1);
        const nx = b.xMin + (b.xMax - b.xMin) * u;
        const sample = sampleG07Terrain3dBakeNormalized(nx, ny);
        const edgeFade = Math.min(1, Math.min(x, y, patch.width - 1 - x, patch.height - 1 - y) / 18);
        const offset = (y * patch.width + x) * 4;
        data.data[offset] = Math.round(sample.color[0] * 255);
        data.data[offset + 1] = Math.round(sample.color[1] * 255);
        data.data[offset + 2] = Math.round(sample.color[2] * 255);
        data.data[offset + 3] = Math.round(150 * edgeFade);
      }
    }
    pctx.putImageData(data, 0, 0);
    ctx.drawImage(patch, x0, y0, patchWidth, patchHeight);
    return {
      sourceWidth,
      sourceHeight,
      mapAspect: sourceWidth / sourceHeight,
      canvasAspect: canvas.width / canvas.height,
      g07CanvasBounds: { x0, y0, width: patchWidth, height: patchHeight },
      referenceSha256: G07_TERRAIN3D_RUNTIME_BAKE.sourceMapSha256,
    };
  });

  const topdownFirst = await page.locator('#topdown-proof').screenshot();
  const topdownSecond = await page.locator('#topdown-proof').screenshot();
  requireCondition(topdownFirst.equals(topdownSecond), 'full-world reference-context top-down is not byte-deterministic');
  fs.writeFileSync(path.join(OUT_DIR, 'g07-full-world-reference-topdown.png'), topdownFirst);
  const topdownSha256 = sha256(topdownFirst);

  requireCondition(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  requireCondition(proofMetrics.vertices === 1089, `unexpected runtime vertices ${proofMetrics.vertices}`);
  requireCondition(proofMetrics.triangles === 2048, `unexpected runtime triangles ${proofMetrics.triangles}`);
  requireCondition(proofMetrics.maxHeight < 0, `G07 visual surface crossed sea level: ${proofMetrics.maxHeight}`);
  requireCondition(proofMetrics.maxHeight > proofMetrics.minHeight, 'G07 visual surface lost relief variation');
  requireCondition(Math.abs(topdownMetrics.mapAspect - topdownMetrics.canvasAspect) < 1e-12, 'full-world evidence distorted map.png aspect ratio');

  const metrics = {
    ...proofMetrics,
    ...topdownMetrics,
    nearSha256,
    farSha256,
    topdownSha256,
    note: 'near/far are diagnostic Three.js renders with declared vertical exaggeration; full-world PNG is reference context plus a feathered G07 runtime patch, not a claim that all 64 cells are runtime-qualified',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`SW_G07_RUNTIME_VISUAL_PARITY_METRICS=${JSON.stringify(metrics)}`);
  console.log('SW_G07_RUNTIME_VISUAL_PARITY_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
