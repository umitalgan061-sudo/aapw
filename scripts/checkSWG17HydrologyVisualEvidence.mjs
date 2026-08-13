#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/sw-g17-hydrology-visual');

function fail(message) {
  console.error(`[checkSWG17HydrologyVisualEvidence] FAIL: ${message}`);
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

  const terrainMetrics = await page.evaluate(async () => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const {
      G17,
      buildG17HydrologyProbe,
      sampleG17HydrologyHeight,
      sampleG17WaterConfidence,
    } = await import('/godot/terrain-authoring/geocells/sw/g17_hydrology.mjs');
    const { WORLD_REFERENCE_WATER_MASK } = await import('/src/3d/world/worldReferenceWaterMask.js');
    const { normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');

    const canvas = document.getElementById('terrain-proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071722);
    const probe = buildG17HydrologyProbe(97, 1);
    const { bounds } = probe;
    const verticalExaggeration = 32;
    const centerNormalized = {
      x: (G17.normalizedBounds.minX + G17.normalizedBounds.maxX) * 0.5,
      y: (G17.normalizedBounds.minY + G17.normalizedBounds.maxY) * 0.5,
    };
    const centerMap = normalizedReferenceToMapCanvas(centerNormalized.x, centerNormalized.y);
    const centerWorld = mapCanvasToPlannedWorldXZ(centerMap.x, centerMap.y);
    const positions = [];
    const indices = [];
    let minWorldX = Infinity;
    let maxWorldX = -Infinity;
    let minWorldZ = Infinity;
    let maxWorldZ = -Infinity;
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    let minConfidence = Infinity;
    let maxConfidence = -Infinity;

    for (let row = 0; row < probe.size; row += 1) {
      const v = row / (probe.size - 1);
      const ny = bounds.minY + (bounds.maxY - bounds.minY) * v;
      for (let col = 0; col < probe.size; col += 1) {
        const u = col / (probe.size - 1);
        const nx = bounds.minX + (bounds.maxX - bounds.minX) * u;
        const height = sampleG17HydrologyHeight(nx, ny);
        const confidence = sampleG17WaterConfidence(nx, ny);
        const map = normalizedReferenceToMapCanvas(nx, ny);
        const world = mapCanvasToPlannedWorldXZ(map.x, map.y);
        minWorldX = Math.min(minWorldX, world.x);
        maxWorldX = Math.max(maxWorldX, world.x);
        minWorldZ = Math.min(minWorldZ, world.z);
        maxWorldZ = Math.max(maxWorldZ, world.z);
        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
        minConfidence = Math.min(minConfidence, confidence);
        maxConfidence = Math.max(maxConfidence, confidence);
        positions.push(world.x - centerWorld.x, height * verticalExaggeration, world.z - centerWorld.z);
      }
    }
    for (let row = 0; row < probe.size - 1; row += 1) {
      for (let col = 0; col < probe.size - 1; col += 1) {
        const a = row * probe.size + col;
        const b = a + 1;
        const c = a + probe.size;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const worldSpanX = maxWorldX - minWorldX;
    const worldSpanZ = maxWorldZ - minWorldZ;
    const worldSpanMax = Math.max(worldSpanX, worldSpanZ);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const seabed = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0x39596a, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    );
    scene.add(seabed);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(worldSpanX * 2.4, worldSpanZ * 2.4, 1, 1),
      new THREE.MeshPhysicalMaterial({
        color: 0x3e819d,
        transparent: true,
        opacity: 0.58,
        roughness: 0.18,
        metalness: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    scene.add(water);

    scene.add(new THREE.HemisphereLight(0xc9eaff, 0x10232c, 1.75));
    const sun = new THREE.DirectionalLight(0xffefd2, 2.1);
    sun.position.set(-worldSpanX * 0.35, worldSpanMax * 0.7, -worldSpanZ * 0.2);
    scene.add(sun);
    scene.fog = new THREE.Fog(0x071722, worldSpanMax * 0.8, worldSpanMax * 2.2);

    const camera = new THREE.PerspectiveCamera(48, 960 / 640, 1, worldSpanMax * 6);
    window.__g17Proof = {
      renderer,
      scene,
      camera,
      render(kind) {
        if (kind === 'near') {
          camera.position.set(-worldSpanX * 0.18, worldSpanMax * 0.14, worldSpanZ * 0.2);
          camera.lookAt(0, -40, 0);
        } else {
          camera.position.set(0, worldSpanMax * 0.48, worldSpanZ * 0.46);
          camera.lookAt(0, -45, 0);
        }
        renderer.render(scene, camera);
      },
    };

    const seamOffsetX = 1 / WORLD_REFERENCE_WATER_MASK.width;
    const seamOffsetY = 1 / WORLD_REFERENCE_WATER_MASK.height;
    let maxGuardConfidenceDelta = 0;
    let maxGuardHeightDelta = 0;
    for (let i = 0; i <= 128; i += 1) {
      const t = i / 128;
      const ny = G17.normalizedBounds.minY + (G17.normalizedBounds.maxY - G17.normalizedBounds.minY) * t;
      const nx = G17.normalizedBounds.minX + (G17.normalizedBounds.maxX - G17.normalizedBounds.minX) * t;
      for (const [ax, ay, bx, by] of [
        [G17.normalizedBounds.minX, ny, G17.normalizedBounds.minX - seamOffsetX, ny],
        [G17.normalizedBounds.maxX, ny, G17.normalizedBounds.maxX + seamOffsetX, ny],
        [nx, G17.normalizedBounds.minY, nx, G17.normalizedBounds.minY - seamOffsetY],
      ]) {
        maxGuardConfidenceDelta = Math.max(
          maxGuardConfidenceDelta,
          Math.abs(sampleG17WaterConfidence(ax, ay) - sampleG17WaterConfidence(bx, by)),
        );
        maxGuardHeightDelta = Math.max(
          maxGuardHeightDelta,
          Math.abs(sampleG17HydrologyHeight(ax, ay) - sampleG17HydrologyHeight(bx, by)),
        );
      }
    }
    window.__g17Proof.render('near');
    return {
      probeSize: probe.size,
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      verticalExaggeration,
      minHeight,
      maxHeight,
      minConfidence,
      maxConfidence,
      maxGuardConfidenceDelta,
      maxGuardHeightDelta,
      canonicalWorldSpanMeters: { x: worldSpanX, z: worldSpanZ },
      sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
    };
  });

  requireCondition(Math.abs(terrainMetrics.minHeight + 4) < 1e-12 && Math.abs(terrainMetrics.maxHeight + 4) < 1e-12, 'visual source must remain the -4m Coast/Hydrology proof plane');
  requireCondition(Math.abs(terrainMetrics.minConfidence - 1) < 1e-12 && Math.abs(terrainMetrics.maxConfidence - 1) < 1e-12, 'visual source must remain canonical open sea');
  requireCondition(terrainMetrics.maxGuardConfidenceDelta < 1e-12, `visual guard confidence seam ${terrainMetrics.maxGuardConfidenceDelta}`);
  requireCondition(terrainMetrics.maxGuardHeightDelta < 1e-12, `visual guard height seam ${terrainMetrics.maxGuardHeightDelta}`);

  async function capture(kind, filename) {
    await page.evaluate((value) => window.__g17Proof.render(value), kind);
    const png = await page.locator('#terrain-proof').screenshot();
    requireCondition(png.length > 1024, `${kind} evidence PNG is unexpectedly small`);
    fs.writeFileSync(path.join(OUT_DIR, filename), png);
    return sha256(png);
  }

  const nearSha256 = await capture('near', 'g17-hydrology-near.png');
  const farSha256 = await capture('far', 'g17-hydrology-far.png');

  await page.setViewportSize({ width: 1200, height: 800 });
  const topdownMetrics = await page.evaluate(async () => {
    const { G17, sampleG17WaterConfidence } = await import('/godot/terrain-authoring/geocells/sw/g17_hydrology.mjs');
    const {
      WORLD_REFERENCE_BASE_SURFACE_MASK,
      sampleReferencePindexQualityV2,
    } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');

    const canvasWidth = 1200;
    const canvasHeight = 800;
    const contextWidth = 768;
    const contextHeight = 512;
    document.body.innerHTML = `<canvas id="topdown-proof" width="${canvasWidth}" height="${canvasHeight}"></canvas>`;
    const canvas = document.getElementById('topdown-proof');
    const ctx = canvas.getContext('2d', { alpha: false });
    const context = document.createElement('canvas');
    context.width = contextWidth;
    context.height = contextHeight;
    const cctx = context.getContext('2d', { alpha: false });
    const image = cctx.createImageData(contextWidth, contextHeight);
    const palette = Object.freeze({
      sea: [35, 74, 92],
      lake: [69, 116, 128],
      soil: [123, 132, 84],
      rock: [116, 106, 95],
      snow: [219, 226, 224],
    });
    const surfaces = ['soil', 'rock', 'snow', 'sea', 'lake'];
    let landLikePixels = 0;
    let waterLikePixels = 0;

    for (let y = 0; y < contextHeight; y += 1) {
      const ny = (y + 0.5) / contextHeight;
      for (let x = 0; x < contextWidth; x += 1) {
        const nx = (x + 0.5) / contextWidth;
        const sample = sampleReferencePindexQualityV2(nx, ny);
        if (sample.dominantSurface === 'sea' || sample.dominantSurface === 'lake') waterLikePixels += 1;
        else landLikePixels += 1;
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
        const reliefShade = 0.93 + 0.07 * sample.reliefInfluence;
        const offset = (y * contextWidth + x) * 4;
        image.data[offset] = Math.round(Math.min(255, r * reliefShade));
        image.data[offset + 1] = Math.round(Math.min(255, g * reliefShade));
        image.data[offset + 2] = Math.round(Math.min(255, b * reliefShade));
        image.data[offset + 3] = 255;
      }
    }
    cctx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(context, 0, 0, canvasWidth, canvasHeight);

    const patch = document.createElement('canvas');
    patch.width = 512;
    patch.height = 384;
    const pctx = patch.getContext('2d');
    const patchData = pctx.createImageData(patch.width, patch.height);
    for (let y = 0; y < patch.height; y += 1) {
      const v = y / (patch.height - 1);
      const ny = G17.normalizedBounds.minY + (G17.normalizedBounds.maxY - G17.normalizedBounds.minY) * v;
      for (let x = 0; x < patch.width; x += 1) {
        const u = x / (patch.width - 1);
        const nx = G17.normalizedBounds.minX + (G17.normalizedBounds.maxX - G17.normalizedBounds.minX) * u;
        const confidence = sampleG17WaterConfidence(nx, ny);
        const edge = Math.min(x, y, patch.width - 1 - x, patch.height - 1 - y);
        const feather = Math.min(1, edge / 24);
        const offset = (y * patch.width + x) * 4;
        patchData.data[offset] = 47;
        patchData.data[offset + 1] = 103;
        patchData.data[offset + 2] = 129;
        patchData.data[offset + 3] = Math.round(92 * confidence * feather);
      }
    }
    pctx.putImageData(patchData, 0, 0);
    ctx.drawImage(
      patch,
      G17.normalizedBounds.minX * canvasWidth,
      G17.normalizedBounds.minY * canvasHeight,
      (G17.normalizedBounds.maxX - G17.normalizedBounds.minX) * canvasWidth,
      (G17.normalizedBounds.maxY - G17.normalizedBounds.minY) * canvasHeight,
    );

    return {
      referenceContext: 'committed-owner-map-pindex-quality-v2',
      sourceWidth: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth,
      sourceHeight: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight,
      landLikePixels,
      waterLikePixels,
      patchResolution: [patch.width, patch.height],
      imageSmoothing: ctx.imageSmoothingEnabled,
    };
  });

  requireCondition(topdownMetrics.sourceWidth === 1536 && topdownMetrics.sourceHeight === 1024, `unexpected owner-map source dimensions ${topdownMetrics.sourceWidth}x${topdownMetrics.sourceHeight}`);
  requireCondition(topdownMetrics.landLikePixels > 0 && topdownMetrics.waterLikePixels > 0, 'full-world context must visibly contain both land and water silhouette');
  requireCondition(topdownMetrics.imageSmoothing === true, 'full-world evidence must use filtered rendering');
  const topdownPng = await page.locator('#topdown-proof').screenshot();
  requireCondition(topdownPng.length > 4096, 'full-world top-down evidence PNG is unexpectedly small');
  fs.writeFileSync(path.join(OUT_DIR, 'g17-hydrology-full-world-topdown.png'), topdownPng);
  const topdownSha256 = sha256(topdownPng);

  requireCondition(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`);
  const metrics = {
    schema: 'westeros-g17-hydrology-visual-evidence-v1',
    terrain: terrainMetrics,
    topdown: topdownMetrics,
    evidenceSha256: { near: nearSha256, far: farSha256, fullWorldTopdown: topdownSha256 },
    determinismPolicy: 'numeric hydrology/seam metrics are gating; GPU PNG hashes are evidence-only',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'g17-hydrology-visual-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`SW_G17_HYDROLOGY_VISUAL_METRICS=${JSON.stringify(metrics)}`);
  console.log('SW_G17_HYDROLOGY_VISUAL_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
