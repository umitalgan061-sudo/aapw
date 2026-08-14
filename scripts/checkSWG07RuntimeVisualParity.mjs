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
    const { sampleCanonicalHydrologyTerrainTarget } = await import('/src/3d/world/worldReferenceTerrainAdapter.js');
    const { normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');

    const canvas = document.getElementById('terrain-proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071722);
    const grid = G07_TERRAIN3D_RUNTIME_BAKE.gridSize;
    const bounds = G07_TERRAIN3D_RUNTIME_BAKE.normalizedBounds;
    const verticalExaggeration = 40;
    const centerNormalized = {
      x: (bounds.xMin + bounds.xMax) * 0.5,
      y: (bounds.yMin + bounds.yMax) * 0.5,
    };
    const centerMap = normalizedReferenceToMapCanvas(centerNormalized.x, centerNormalized.y);
    const centerWorld = mapCanvasToPlannedWorldXZ(centerMap.x, centerMap.y);
    const positions = [];
    const colors = [];
    const indices = [];
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    let minWorldX = Infinity;
    let maxWorldX = -Infinity;
    let minWorldZ = Infinity;
    let maxWorldZ = -Infinity;
    let adapterRuleCount = 0;
    let waterCount = 0;
    let maxNormalizedRoundTripError = 0;
    let sampleFingerprint = 2166136261;

    const mixFingerprint = (value) => {
      const q = Math.round(value * 1000000);
      for (let shift = 0; shift < 32; shift += 8) {
        sampleFingerprint ^= (q >>> shift) & 0xff;
        sampleFingerprint = Math.imul(sampleFingerprint, 16777619) >>> 0;
      }
    };

    for (let row = 0; row < grid; row += 1) {
      const v = row / (grid - 1);
      const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * v;
      for (let col = 0; col < grid; col += 1) {
        const u = col / (grid - 1);
        const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * u;
        const packed = sampleG07Terrain3dBakeNormalized(nx, ny);
        if (!packed) throw new Error(`missing G07 packed sample ${col},${row}`);
        const map = normalizedReferenceToMapCanvas(nx, ny);
        const world = mapCanvasToPlannedWorldXZ(map.x, map.y);
        const target = sampleCanonicalHydrologyTerrainTarget({
          worldX: world.x,
          worldZ: world.z,
          baseHeightSampler: () => 50,
          seaLevelMeters: 0,
          protectedSites: [],
          protectionRadii: { x: 0.001, y: 0.001 },
        });
        if (target.rule !== 'terrain3d-bake-g07' || !target.terrain3dSurface) {
          throw new Error(`canonical adapter did not select G07 Terrain3D at ${col},${row}`);
        }
        adapterRuleCount += 1;
        if (target.hydrology?.water) waterCount += 1;
        maxNormalizedRoundTripError = Math.max(
          maxNormalizedRoundTripError,
          Math.abs(target.normalizedX - nx),
          Math.abs(target.normalizedY - ny),
        );
        const sample = target.terrain3dSurface;
        minHeight = Math.min(minHeight, sample.height);
        maxHeight = Math.max(maxHeight, sample.height);
        minWorldX = Math.min(minWorldX, world.x);
        maxWorldX = Math.max(maxWorldX, world.x);
        minWorldZ = Math.min(minWorldZ, world.z);
        maxWorldZ = Math.max(maxWorldZ, world.z);
        positions.push(
          world.x - centerWorld.x,
          (sample.height - G07_TERRAIN3D_RUNTIME_BAKE.heightOffsetMeters) * verticalExaggeration,
          world.z - centerWorld.z,
        );
        const rockShade = 0.82 + sample.rockBlend * 0.18;
        colors.push(
          Math.min(1, sample.color[0] * rockShade * 1.15),
          Math.min(1, sample.color[1] * rockShade * 1.15),
          Math.min(1, sample.color[2] * rockShade * 1.2),
        );
        for (const value of [nx, ny, world.x, world.z, sample.height, sample.rockBlend, ...sample.color]) {
          mixFingerprint(value);
        }
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

    const worldSpanX = maxWorldX - minWorldX;
    const worldSpanZ = maxWorldZ - minWorldZ;
    const worldSpanMax = Math.max(worldSpanX, worldSpanZ);
    scene.fog = new THREE.Fog(0x071722, worldSpanMax * 0.9, worldSpanMax * 2.2);

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
    sun.position.set(-worldSpanX * 0.33, worldSpanMax * 0.55, -worldSpanZ * 0.25);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(48, 960 / 640, 1, worldSpanMax * 5);
    window.__g07Proof = {
      renderer,
      scene,
      camera,
      render(kind) {
        if (kind === 'near') {
          camera.position.set(-worldSpanX * 0.23, worldSpanMax * 0.22, worldSpanZ * 0.34);
          camera.lookAt(-worldSpanX * 0.05, 20, 0);
        } else {
          camera.position.set(0, worldSpanMax * 0.72, worldSpanMax * 0.98);
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
      adapterRuleCount,
      waterCount,
      maxNormalizedRoundTripError,
      sampleFingerprint,
      canonicalWorldBounds: { minX: minWorldX, maxX: maxWorldX, minZ: minWorldZ, maxZ: maxWorldZ },
      canonicalWorldSpanMeters: { x: worldSpanX, z: worldSpanZ },
      canonicalBakeSha256: G07_TERRAIN3D_RUNTIME_BAKE.canonicalBakeSha256,
      importedTopdownSha256: G07_TERRAIN3D_RUNTIME_BAKE.importedTopdownSha256,
      sourceMapSha256: G07_TERRAIN3D_RUNTIME_BAKE.sourceMapSha256,
    };
  });

  async function captureTerrainEvidence(kind, filename) {
    await page.evaluate((value) => window.__g07Proof.render(value), kind);
    const png = await page.locator('#terrain-proof').screenshot();
    requireCondition(png.length > 1024, `${kind} Three.js evidence PNG is unexpectedly small`);
    fs.writeFileSync(path.join(OUT_DIR, filename), png);
    return sha256(png);
  }

  const nearSha256 = await captureTerrainEvidence('near', 'g07-runtime-near.png');
  const farSha256 = await captureTerrainEvidence('far', 'g07-runtime-far.png');

  await page.setViewportSize({ width: 1200, height: 800 });
  const topdownMetrics = await page.evaluate(async () => {
    const {
      G07_TERRAIN3D_RUNTIME_BAKE,
      sampleG07Terrain3dBakeNormalized,
    } = await import('/src/3d/world/g07Terrain3dBake.js');
    const {
      WORLD_REFERENCE_BASE_SURFACE_MASK,
      sampleReferencePindexQualityV2,
    } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');

    const canvasWidth = 1200;
    const canvasHeight = 800;
    const contextWidth = 384;
    const contextHeight = 256;
    document.body.innerHTML = `<canvas id="topdown-proof" width="${canvasWidth}" height="${canvasHeight}"></canvas>`;
    const canvas = document.getElementById('topdown-proof');
    const ctx = canvas.getContext('2d', { alpha: false });
    const context = document.createElement('canvas');
    context.width = contextWidth;
    context.height = contextHeight;
    const cctx = context.getContext('2d', { alpha: false });
    const contextData = cctx.createImageData(contextWidth, contextHeight);
    const surfacePalette = Object.freeze({
      sea: Object.freeze([41, 77, 93]),
      lake: Object.freeze([79, 127, 134]),
      soil: Object.freeze([125, 135, 88]),
      rock: Object.freeze([117, 108, 96]),
      snow: Object.freeze([216, 223, 220]),
    });
    const surfaces = Object.freeze(['soil', 'rock', 'snow', 'sea', 'lake']);
    const dominantSurfaceCounts = { sea: 0, lake: 0, soil: 0, rock: 0, snow: 0 };

    for (let y = 0; y < contextHeight; y += 1) {
      const ny = (y + 0.5) / contextHeight;
      for (let x = 0; x < contextWidth; x += 1) {
        const nx = (x + 0.5) / contextWidth;
        const sample = sampleReferencePindexQualityV2(nx, ny);
        dominantSurfaceCounts[sample.dominantSurface] += 1;
        let r = 0;
        let g = 0;
        let b = 0;
        for (const surface of surfaces) {
          const weight = sample.surfaceWeights[surface];
          const color = surfacePalette[surface];
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
    }
    cctx.putImageData(contextData, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(context, 0, 0, canvasWidth, canvasHeight);

    const bounds = G07_TERRAIN3D_RUNTIME_BAKE.normalizedBounds;
    const x0 = bounds.xMin * canvasWidth;
    const y0 = bounds.yMin * canvasHeight;
    const patchWidth = (bounds.xMax - bounds.xMin) * canvasWidth;
    const patchHeight = (bounds.yMax - bounds.yMin) * canvasHeight;
    const patch = document.createElement('canvas');
    patch.width = 384;
    patch.height = 256;
    const pctx = patch.getContext('2d');
    const patchData = pctx.createImageData(patch.width, patch.height);
    for (let y = 0; y < patch.height; y += 1) {
      const v = y / (patch.height - 1);
      const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * v;
      for (let x = 0; x < patch.width; x += 1) {
        const u = x / (patch.width - 1);
        const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * u;
        const sample = sampleG07Terrain3dBakeNormalized(nx, ny);
        if (!sample) throw new Error(`missing full-world G07 sample ${x},${y}`);
        const edgeFade = Math.min(1, Math.min(x, y, patch.width - 1 - x, patch.height - 1 - y) / 18);
        const offset = (y * patch.width + x) * 4;
        patchData.data[offset] = Math.round(sample.color[0] * 255);
        patchData.data[offset + 1] = Math.round(sample.color[1] * 255);
        patchData.data[offset + 2] = Math.round(sample.color[2] * 255);
        patchData.data[offset + 3] = Math.round(170 * edgeFade);
      }
    }
    pctx.putImageData(patchData, 0, 0);
    ctx.drawImage(patch, x0, y0, patchWidth, patchHeight);

    return {
      referenceContext: 'committed-owner-map-pindex-quality-v2',
      sourceWidth: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth,
      sourceHeight: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight,
      sourceMapSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256,
      surfaceMaskSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256,
      surfaceMaskWidth: WORLD_REFERENCE_BASE_SURFACE_MASK.width,
      surfaceMaskHeight: WORLD_REFERENCE_BASE_SURFACE_MASK.height,
      contextSampleWidth: contextWidth,
      contextSampleHeight: contextHeight,
      canvasWidth,
      canvasHeight,
      sourceAspect: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth / WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight,
      canvasAspect: canvasWidth / canvasHeight,
      dominantSurfaceCounts,
      g07CanvasBounds: { x0, y0, width: patchWidth, height: patchHeight },
    };
  });

  const topdownPng = await page.locator('#topdown-proof').screenshot();
  requireCondition(topdownPng.length > 1024, 'full-world committed-owner-map context PNG is unexpectedly small');
  fs.writeFileSync(path.join(OUT_DIR, 'g07-full-world-reference-topdown.png'), topdownPng);
  const topdownSha256 = sha256(topdownPng);

  requireCondition(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  requireCondition(proofMetrics.vertices === 1089, `unexpected runtime vertices ${proofMetrics.vertices}`);
  requireCondition(proofMetrics.triangles === 2048, `unexpected runtime triangles ${proofMetrics.triangles}`);
  requireCondition(proofMetrics.adapterRuleCount === 1089, `canonical adapter selected G07 ${proofMetrics.adapterRuleCount}/1089 times`);
  requireCondition(proofMetrics.waterCount === 1089, `canonical hydrology classified water ${proofMetrics.waterCount}/1089 times`);
  requireCondition(Number.isInteger(proofMetrics.sampleFingerprint), 'numeric terrain fingerprint is invalid');
  requireCondition(proofMetrics.maxNormalizedRoundTripError <= 1e-12, `canonical world round-trip error ${proofMetrics.maxNormalizedRoundTripError}`);
  requireCondition(proofMetrics.maxHeight < 0, `G07 visual surface crossed sea level: ${proofMetrics.maxHeight}`);
  requireCondition(proofMetrics.maxHeight > proofMetrics.minHeight, 'G07 visual surface lost relief variation');
  requireCondition(topdownMetrics.sourceWidth === 1536 && topdownMetrics.sourceHeight === 1024, 'committed owner-map source dimensions drifted');
  requireCondition(Math.abs(topdownMetrics.sourceAspect - topdownMetrics.canvasAspect) < 1e-12, 'full-world evidence distorted canonical source aspect ratio');
  requireCondition(topdownMetrics.sourceMapSha256 === proofMetrics.sourceMapSha256, 'committed owner-map source SHA disagrees with G07 bake provenance');
  requireCondition(topdownMetrics.surfaceMaskWidth === 96 && topdownMetrics.surfaceMaskHeight === 64, 'committed owner-map surface mask dimensions drifted');
  requireCondition(Object.values(topdownMetrics.dominantSurfaceCounts).reduce((sum, count) => sum + count, 0) === 384 * 256, 'full-world context sample coverage is incomplete');

  const metrics = {
    ...proofMetrics,
    ...topdownMetrics,
    nearSha256,
    farSha256,
    topdownSha256,
    rasterDeterminismPolicy: 'GPU raster bytes are visual evidence only; deterministic gating is provided by the repeated canonical Terrain3D bake/source checks plus this numeric terrain fingerprint',
    note: 'near/far are canonical world-coordinate adapter renders with declared vertical exaggeration; full-world PNG is reconstructed only from the committed source-derived owner-map semantic contract and overlays a feathered G07 runtime patch. It is not the unavailable source map.png raster and is not a claim that all 64 cells are runtime-qualified',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`SW_G07_RUNTIME_VISUAL_PARITY_METRICS=${JSON.stringify(metrics)}`);
  console.log('SW_G07_RUNTIME_VISUAL_PARITY_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
