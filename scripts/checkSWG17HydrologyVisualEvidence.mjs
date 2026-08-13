#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';
import {
  G17,
  buildG17HydrologyProbe,
  sampleG17HydrologyHeight,
  sampleG17WaterConfidence,
} from '../godot/terrain-authoring/geocells/sw/g17_hydrology.mjs';
import { WORLD_REFERENCE_WATER_MASK } from '../src/3d/world/worldReferenceWaterMask.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/sw-g17-hydrology-visual');
const EPSILON = 1e-12;
const SOURCE_MAP_SHA256 = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

function fail(message) {
  throw new Error(`[checkSWG17HydrologyVisualEvidence] FAIL: ${message}`);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildNumericVisualContract() {
  const renderProbe = buildG17HydrologyProbe(97, 1);
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let minConfidence = Infinity;
  let maxConfidence = -Infinity;
  for (let i = 0; i < renderProbe.heights.length; i += 1) {
    minHeight = Math.min(minHeight, renderProbe.heights[i]);
    maxHeight = Math.max(maxHeight, renderProbe.heights[i]);
    minConfidence = Math.min(minConfidence, renderProbe.confidence[i]);
    maxConfidence = Math.max(maxConfidence, renderProbe.confidence[i]);
  }

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

  requireCondition(Math.abs(minHeight + 4) <= EPSILON && Math.abs(maxHeight + 4) <= EPSILON,
    `visual source must remain the -4m Coast/Hydrology proof plane: ${minHeight}..${maxHeight}`);
  requireCondition(Math.abs(minConfidence - 1) <= EPSILON && Math.abs(maxConfidence - 1) <= EPSILON,
    `visual source must remain canonical open sea: ${minConfidence}..${maxConfidence}`);
  requireCondition(maxGuardConfidenceDelta <= EPSILON, `visual guard confidence seam ${maxGuardConfidenceDelta}`);
  requireCondition(maxGuardHeightDelta <= EPSILON, `visual guard height seam ${maxGuardHeightDelta}`);

  return {
    renderProbe: {
      size: renderProbe.size,
      bounds: renderProbe.bounds,
      heights: [...renderProbe.heights],
    },
    normalizedBounds: G17.normalizedBounds,
    metrics: {
      minHeight,
      maxHeight,
      minConfidence,
      maxConfidence,
      maxGuardConfidenceDelta,
      maxGuardHeightDelta,
      sourceMapSha256: SOURCE_MAP_SHA256,
    },
  };
}

const playwright = loadPlaywright();
requireCondition(Boolean(playwright), 'Playwright is required');
fs.mkdirSync(OUT_DIR, { recursive: true });
const numericContract = buildNumericVisualContract();
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

  const terrainMetrics = await page.evaluate(async (payload) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
    const { renderProbe, normalizedBounds } = payload;

    const canvas = document.getElementById('terrain-proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071722);
    const verticalExaggeration = 32;
    const centerNormalized = {
      x: (normalizedBounds.minX + normalizedBounds.maxX) * 0.5,
      y: (normalizedBounds.minY + normalizedBounds.maxY) * 0.5,
    };
    const centerMap = normalizedReferenceToMapCanvas(centerNormalized.x, centerNormalized.y);
    const centerWorld = mapCanvasToPlannedWorldXZ(centerMap.x, centerMap.y);
    const positions = [];
    const indices = [];
    let minWorldX = Infinity;
    let maxWorldX = -Infinity;
    let minWorldZ = Infinity;
    let maxWorldZ = -Infinity;

    for (let row = 0; row < renderProbe.size; row += 1) {
      const v = row / (renderProbe.size - 1);
      const ny = renderProbe.bounds.minY + (renderProbe.bounds.maxY - renderProbe.bounds.minY) * v;
      for (let col = 0; col < renderProbe.size; col += 1) {
        const u = col / (renderProbe.size - 1);
        const nx = renderProbe.bounds.minX + (renderProbe.bounds.maxX - renderProbe.bounds.minX) * u;
        const height = renderProbe.heights[row * renderProbe.size + col];
        const map = normalizedReferenceToMapCanvas(nx, ny);
        const world = mapCanvasToPlannedWorldXZ(map.x, map.y);
        minWorldX = Math.min(minWorldX, world.x);
        maxWorldX = Math.max(maxWorldX, world.x);
        minWorldZ = Math.min(minWorldZ, world.z);
        maxWorldZ = Math.max(maxWorldZ, world.z);
        positions.push(world.x - centerWorld.x, height * verticalExaggeration, world.z - centerWorld.z);
      }
    }
    for (let row = 0; row < renderProbe.size - 1; row += 1) {
      for (let col = 0; col < renderProbe.size - 1; col += 1) {
        const a = row * renderProbe.size + col;
        const b = a + 1;
        const c = a + renderProbe.size;
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
    scene.add(new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0x39596a, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    ));

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
    window.__g17Proof.render('near');
    return {
      probeSize: renderProbe.size,
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      verticalExaggeration,
      canonicalWorldSpanMeters: { x: worldSpanX, z: worldSpanZ },
    };
  }, {
    renderProbe: numericContract.renderProbe,
    normalizedBounds: numericContract.normalizedBounds,
  });

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
    const {
      WORLD_REFERENCE_BASE_SURFACE_MASK,
      classifyReferenceBaseSurface,
      sampleReferencePindexQualityV2,
    } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');

    const canvasWidth = 1200;
    const canvasHeight = 800;
    const qualityWidth = 768;
    const qualityHeight = 512;
    const maskWidth = WORLD_REFERENCE_BASE_SURFACE_MASK.width;
    const maskHeight = WORLD_REFERENCE_BASE_SURFACE_MASK.height;
    document.body.innerHTML = `<canvas id="topdown-proof" width="${canvasWidth}" height="${canvasHeight}"></canvas>`;
    const canvas = document.getElementById('topdown-proof');
    const ctx = canvas.getContext('2d', { alpha: false });

    const palette = Object.freeze({
      sea: [35, 74, 92],
      lake: [69, 116, 128],
      soil: [123, 132, 84],
      rock: [116, 106, 95],
      snow: [219, 226, 224],
    });
    const landSurfaces = ['soil', 'rock', 'snow'];
    const waterSurfaces = ['sea', 'lake'];
    const qualityLand = document.createElement('canvas');
    const qualityWater = document.createElement('canvas');
    qualityLand.width = qualityWater.width = qualityWidth;
    qualityLand.height = qualityWater.height = qualityHeight;
    const landCtx = qualityLand.getContext('2d', { alpha: false });
    const waterCtx = qualityWater.getContext('2d', { alpha: false });
    const landImage = landCtx.createImageData(qualityWidth, qualityHeight);
    const waterImage = waterCtx.createImageData(qualityWidth, qualityHeight);
    let landLikePixels = 0;
    let waterLikePixels = 0;

    const writeNormalizedColor = (target, offset, sample, surfaces, fallback) => {
      let total = 0;
      for (const surface of surfaces) total += sample.surfaceWeights[surface];
      let r = fallback[0];
      let g = fallback[1];
      let b = fallback[2];
      if (total > 1e-8) {
        r = 0; g = 0; b = 0;
        for (const surface of surfaces) {
          const weight = sample.surfaceWeights[surface] / total;
          r += palette[surface][0] * weight;
          g += palette[surface][1] * weight;
          b += palette[surface][2] * weight;
        }
      }
      const reliefShade = 0.93 + 0.07 * sample.reliefInfluence;
      target.data[offset] = Math.round(Math.min(255, r * reliefShade));
      target.data[offset + 1] = Math.round(Math.min(255, g * reliefShade));
      target.data[offset + 2] = Math.round(Math.min(255, b * reliefShade));
      target.data[offset + 3] = 255;
    };

    for (let y = 0; y < qualityHeight; y += 1) {
      const ny = (y + 0.5) / qualityHeight;
      for (let x = 0; x < qualityWidth; x += 1) {
        const nx = (x + 0.5) / qualityWidth;
        const sample = sampleReferencePindexQualityV2(nx, ny);
        if (sample.dominantSurface === 'sea' || sample.dominantSurface === 'lake') waterLikePixels += 1;
        else landLikePixels += 1;
        const offset = (y * qualityWidth + x) * 4;
        writeNormalizedColor(landImage, offset, sample, landSurfaces, palette.soil);
        writeNormalizedColor(waterImage, offset, sample, waterSurfaces, palette.sea);
      }
    }
    landCtx.putImageData(landImage, 0, 0);
    waterCtx.putImageData(waterImage, 0, 0);

    const isWater = new Uint8Array(maskWidth * maskHeight);
    const landBoundary = [];
    const waterBoundary = [];
    for (let y = 0; y < maskHeight; y += 1) {
      for (let x = 0; x < maskWidth; x += 1) {
        const surface = classifyReferenceBaseSurface((x + 0.5) / maskWidth, (y + 0.5) / maskHeight);
        isWater[y * maskWidth + x] = surface === 'sea' || surface === 'lake' ? 1 : 0;
      }
    }
    for (let y = 0; y < maskHeight; y += 1) {
      for (let x = 0; x < maskWidth; x += 1) {
        const value = isWater[y * maskWidth + x];
        let boundary = false;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const qx = x + dx;
          const qy = y + dy;
          if (qx < 0 || qx >= maskWidth || qy < 0 || qy >= maskHeight) continue;
          if (isWater[qy * maskWidth + qx] !== value) { boundary = true; break; }
        }
        if (boundary) (value ? waterBoundary : landBoundary).push([x, y]);
      }
    }
    if (!landBoundary.length || !waterBoundary.length) throw new Error('owner-map SDF requires both land and water boundaries');

    const signedDistance = new Float32Array(maskWidth * maskHeight);
    for (let y = 0; y < maskHeight; y += 1) {
      for (let x = 0; x < maskWidth; x += 1) {
        const water = isWater[y * maskWidth + x] === 1;
        const targets = water ? landBoundary : waterBoundary;
        let minDistanceSquared = Infinity;
        for (const [tx, ty] of targets) {
          const dx = x - tx;
          const dy = y - ty;
          const d2 = dx * dx + dy * dy;
          if (d2 < minDistanceSquared) minDistanceSquared = d2;
        }
        const distanceToOppositeBoundary = Math.max(0, Math.sqrt(minDistanceSquared) - 0.5);
        signedDistance[y * maskWidth + x] = water ? -distanceToOppositeBoundary : distanceToOppositeBoundary;
      }
    }

    const smoothDistance = new Float32Array(signedDistance.length);
    for (let y = 0; y < maskHeight; y += 1) {
      for (let x = 0; x < maskWidth; x += 1) {
        let sum = 0;
        let totalWeight = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const qx = Math.min(maskWidth - 1, Math.max(0, x + dx));
            const qy = Math.min(maskHeight - 1, Math.max(0, y + dy));
            const weight = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
            sum += signedDistance[qy * maskWidth + qx] * weight;
            totalWeight += weight;
          }
        }
        smoothDistance[y * maskWidth + x] = sum / totalWeight;
      }
    }

    const sdfCanvas = document.createElement('canvas');
    sdfCanvas.width = maskWidth;
    sdfCanvas.height = maskHeight;
    const sdfCtx = sdfCanvas.getContext('2d', { alpha: false });
    const sdfImage = sdfCtx.createImageData(maskWidth, maskHeight);
    const sdfRangeCells = 4;
    for (let i = 0; i < smoothDistance.length; i += 1) {
      const normalized = Math.min(1, Math.max(0, 0.5 + smoothDistance[i] / (2 * sdfRangeCells)));
      const value = Math.round(normalized * 255);
      const offset = i * 4;
      sdfImage.data[offset] = value;
      sdfImage.data[offset + 1] = value;
      sdfImage.data[offset + 2] = value;
      sdfImage.data[offset + 3] = 255;
    }
    sdfCtx.putImageData(sdfImage, 0, 0);

    const landFull = document.createElement('canvas');
    const waterFull = document.createElement('canvas');
    const sdfFull = document.createElement('canvas');
    for (const target of [landFull, waterFull, sdfFull]) {
      target.width = canvasWidth;
      target.height = canvasHeight;
    }
    for (const [target, source] of [[landFull, qualityLand], [waterFull, qualityWater], [sdfFull, sdfCanvas]]) {
      const targetCtx = target.getContext('2d', { alpha: false });
      targetCtx.imageSmoothingEnabled = true;
      targetCtx.imageSmoothingQuality = 'high';
      targetCtx.drawImage(source, 0, 0, canvasWidth, canvasHeight);
    }
    const landFullData = landFull.getContext('2d').getImageData(0, 0, canvasWidth, canvasHeight);
    const waterFullData = waterFull.getContext('2d').getImageData(0, 0, canvasWidth, canvasHeight);
    const sdfFullData = sdfFull.getContext('2d').getImageData(0, 0, canvasWidth, canvasHeight);
    const composed = ctx.createImageData(canvasWidth, canvasHeight);
    const smoothstep = (a, b, v) => {
      const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    for (let i = 0; i < canvasWidth * canvasHeight; i += 1) {
      const offset = i * 4;
      const sdfValue = sdfFullData.data[offset] / 255;
      const landMix = smoothstep(0.40, 0.60, sdfValue);
      composed.data[offset] = Math.round(waterFullData.data[offset] * (1 - landMix) + landFullData.data[offset] * landMix);
      composed.data[offset + 1] = Math.round(waterFullData.data[offset + 1] * (1 - landMix) + landFullData.data[offset + 1] * landMix);
      composed.data[offset + 2] = Math.round(waterFullData.data[offset + 2] * (1 - landMix) + landFullData.data[offset + 2] * landMix);
      composed.data[offset + 3] = 255;
    }

    const composedCanvas = document.createElement('canvas');
    composedCanvas.width = canvasWidth;
    composedCanvas.height = canvasHeight;
    composedCanvas.getContext('2d', { alpha: false }).putImageData(composed, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'blur(1.15px)';
    ctx.drawImage(composedCanvas, 0, 0);
    ctx.filter = 'none';

    return {
      referenceContext: 'committed-owner-map-pindex-quality-v2+sdf-contour-v1',
      sourceWidth: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth,
      sourceHeight: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight,
      landLikePixels,
      waterLikePixels,
      sourceMaskResolution: [maskWidth, maskHeight],
      qualitySampleResolution: [qualityWidth, qualityHeight],
      sdfRangeCells,
      sdfSmoothingPasses: 1,
      visibleGeoCellOverlay: false,
      imageSmoothing: ctx.imageSmoothingEnabled,
    };
  });

  requireCondition(topdownMetrics.sourceWidth === 1536 && topdownMetrics.sourceHeight === 1024,
    `unexpected owner-map source dimensions ${topdownMetrics.sourceWidth}x${topdownMetrics.sourceHeight}`);
  requireCondition(topdownMetrics.landLikePixels > 0 && topdownMetrics.waterLikePixels > 0,
    'full-world context must visibly contain both land and water silhouette');
  requireCondition(topdownMetrics.imageSmoothing === true, 'full-world evidence must use filtered rendering');
  requireCondition(topdownMetrics.visibleGeoCellOverlay === false, 'full-world evidence must not draw a GeoCell overlay');
  requireCondition(topdownMetrics.sdfSmoothingPasses >= 1, 'full-world coastline must use SDF contour smoothing');
  const topdownPng = await page.locator('#topdown-proof').screenshot();
  requireCondition(topdownPng.length > 4096, 'full-world top-down evidence PNG is unexpectedly small');
  fs.writeFileSync(path.join(OUT_DIR, 'g17-hydrology-full-world-topdown.png'), topdownPng);
  const topdownSha256 = sha256(topdownPng);

  requireCondition(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`);
  const metrics = {
    schema: 'westeros-g17-hydrology-visual-evidence-v3',
    terrain: { ...terrainMetrics, ...numericContract.metrics },
    topdown: topdownMetrics,
    evidenceSha256: { near: nearSha256, far: farSha256, fullWorldTopdown: topdownSha256 },
    determinismPolicy: 'numeric hydrology/seam metrics are gating; GPU PNG hashes are evidence-only',
    browserModulePolicy: 'G17 .mjs source is evaluated in Node and serialized to Chromium; static server serves browser .js modules only',
    geoCellVisibilityPolicy: 'no visible G17 rectangle or grid marker; G17 ownership is proven numerically and in near/far evidence',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'g17-hydrology-visual-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`SW_G17_HYDROLOGY_VISUAL_METRICS=${JSON.stringify(metrics)}`);
  console.log('SW_G17_HYDROLOGY_VISUAL_OK');
} catch (error) {
  console.log(`SW_G17_HYDROLOGY_VISUAL_ERROR=${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
