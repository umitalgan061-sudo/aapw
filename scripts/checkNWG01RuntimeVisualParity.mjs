#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const ROOT = process.cwd();
const BAKE_PATH = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g01-runtime-bake.json');
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/nw-g01-runtime-visual');
const EXPECTED_MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

function fail(message) {
  console.error(`[checkNWG01RuntimeVisualParity] FAIL: ${message}`);
  process.exit(1);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

requireCondition(fs.existsSync(BAKE_PATH), 'real Terrain3D G01 bake proof is missing');
const bake = JSON.parse(fs.readFileSync(BAKE_PATH, 'utf8'));
requireCondition(bake.schema === 'westeros-g01-terrain3d-bake-v1', `unexpected bake schema ${bake.schema}`);
requireCondition(bake.sourceMapSha256 === EXPECTED_MAP_SHA, 'G01 bake map.png provenance drifted');
requireCondition(bake.width === 65 && bake.height === 65, `unexpected G01 bake size ${bake.width}x${bake.height}`);
requireCondition(bake.regionCount >= 4 && bake.savedRegionFiles >= 4, 'visual evidence must consume a persisted multi-region Terrain3D bake');
requireCondition(bake.bakedVertices > 0, 'visual evidence must consume a non-empty Terrain3D LOD0 bake');

const playwright = loadPlaywright();
requireCondition(Boolean(playwright), 'Playwright is required for G01 runtime visual parity');
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

  const proof = await page.evaluate(async (payload) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { WORLD_SCALE } = await import('/src/3d/config.js');
    const {
      G01_TERRAIN3D_RUNTIME_PARITY,
      createG01Terrain3DBakeSampler,
      createG01Terrain3DWorldSampler,
    } = await import('/src/3d/world/g01Terrain3dRuntimeAdapter.js');
    const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js');

    const canvas = document.getElementById('terrain-proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1721);

    const bounds = G01_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
    const sampleNormalized = createG01Terrain3DBakeSampler(payload);
    const sampleWorld = createG01Terrain3DWorldSampler(payload, {
      mapBounds: WORLD_SCALE.MAP_BOUNDS,
      metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
    });
    const grid = payload.width;
    const positions = [];
    const colors = [];
    const indices = [];
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    let minWorldX = Infinity;
    let maxWorldX = -Infinity;
    let minWorldZ = Infinity;
    let maxWorldZ = -Infinity;
    let maxWorldParityError = 0;
    let checksum = 2166136261;

    const center = normalizedReferenceToWorldXZ(
      (bounds.xMin + bounds.xMax) * 0.5,
      (bounds.yMin + bounds.yMax) * 0.5,
      WORLD_SCALE.MAP_BOUNDS,
      WORLD_SCALE.METERS_PER_MAP_UNIT,
    );
    const mix = (value) => {
      const q = Math.round(value * 100000);
      for (let shift = 0; shift < 32; shift += 8) {
        checksum ^= (q >>> shift) & 0xff;
        checksum = Math.imul(checksum, 16777619) >>> 0;
      }
    };

    for (let row = 0; row < grid; row += 1) {
      const v = row / (grid - 1);
      const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * v;
      for (let col = 0; col < grid; col += 1) {
        const u = col / (grid - 1);
        const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * u;
        const world = normalizedReferenceToWorldXZ(nx, ny, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
        const normalizedSample = sampleNormalized(nx, ny);
        const worldSample = sampleWorld(world.x, world.z);
        const values = ['heightMeters', 'snowWeight', 'tintR', 'tintG', 'tintB', 'roughness'];
        for (const key of values) maxWorldParityError = Math.max(maxWorldParityError, Math.abs(normalizedSample[key] - worldSample[key]));
        minHeight = Math.min(minHeight, normalizedSample.heightMeters);
        maxHeight = Math.max(maxHeight, normalizedSample.heightMeters);
        minWorldX = Math.min(minWorldX, world.x);
        maxWorldX = Math.max(maxWorldX, world.x);
        minWorldZ = Math.min(minWorldZ, world.z);
        maxWorldZ = Math.max(maxWorldZ, world.z);
        positions.push(world.x - center.x, normalizedSample.heightMeters * 24, world.z - center.z);
        const snow = normalizedSample.snowWeight;
        const shade = 0.78 + snow * 0.22;
        colors.push(
          Math.min(1, normalizedSample.tintR * shade),
          Math.min(1, normalizedSample.tintG * shade),
          Math.min(1, normalizedSample.tintB * (0.82 + snow * 0.18)),
        );
        for (const value of [nx, ny, world.x, world.z, normalizedSample.heightMeters, snow, normalizedSample.roughness]) mix(value);
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

    const spanX = maxWorldX - minWorldX;
    const spanZ = maxWorldZ - minWorldZ;
    const span = Math.max(spanX, spanZ);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide })));
    scene.add(new THREE.HemisphereLight(0xd6efff, 0x17242d, 1.6));
    const sun = new THREE.DirectionalLight(0xffedd1, 2.1);
    sun.position.set(-spanX * 0.35, span * 0.75, -spanZ * 0.35);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(48, 960 / 640, 1, span * 6);
    window.__g01Visual = {
      render(kind) {
        if (kind === 'near') camera.position.set(-spanX * 0.32, span * 0.28, spanZ * 0.38);
        else camera.position.set(0, span * 0.82, spanZ * 1.08);
        camera.lookAt(0, (minHeight + maxHeight) * 6, 0);
        renderer.render(scene, camera);
      },
    };
    window.__g01Visual.render('near');
    return {
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      minHeight,
      maxHeight,
      maxWorldParityError,
      checksum,
      bounds,
      worldSpanMeters: { x: spanX, z: spanZ },
      sourceMapSha256: payload.sourceMapSha256,
    };
  }, bake);

  const capture = async (kind, filename) => {
    await page.evaluate((mode) => window.__g01Visual.render(mode), kind);
    const png = await page.locator('#terrain-proof').screenshot();
    requireCondition(png.length > 1024, `${kind} runtime PNG is unexpectedly small`);
    fs.writeFileSync(path.join(OUT_DIR, filename), png);
    return sha256(png);
  };
  const nearSha256 = await capture('near', 'g01-runtime-near.png');
  const farSha256 = await capture('far', 'g01-runtime-far.png');

  await page.setViewportSize({ width: 1200, height: 800 });
  const topdown = await page.evaluate(async (payload) => {
    const { G01_TERRAIN3D_RUNTIME_PARITY, createG01Terrain3DBakeSampler } = await import('/src/3d/world/g01Terrain3dRuntimeAdapter.js');
    const { WORLD_REFERENCE_BASE_SURFACE_MASK, sampleReferencePindexQualityV2 } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    const canvasWidth = 1200;
    const canvasHeight = 800;
    document.body.innerHTML = `<canvas id="topdown-proof" width="${canvasWidth}" height="${canvasHeight}"></canvas>`;
    const canvas = document.getElementById('topdown-proof');
    const ctx = canvas.getContext('2d', { alpha: false });
    const low = document.createElement('canvas');
    low.width = 384;
    low.height = 256;
    const lctx = low.getContext('2d', { alpha: false });
    const image = lctx.createImageData(low.width, low.height);
    const palette = { sea: [41,77,93], lake: [79,127,134], soil: [125,135,88], rock: [117,108,96], snow: [216,223,220] };
    const surfaces = Object.keys(palette);
    for (let y = 0; y < low.height; y += 1) {
      const ny = (y + 0.5) / low.height;
      for (let x = 0; x < low.width; x += 1) {
        const nx = (x + 0.5) / low.width;
        const sample = sampleReferencePindexQualityV2(nx, ny);
        let r = 0; let g = 0; let b = 0;
        for (const surface of surfaces) {
          const weight = sample.surfaceWeights[surface];
          r += palette[surface][0] * weight;
          g += palette[surface][1] * weight;
          b += palette[surface][2] * weight;
        }
        const o = (y * low.width + x) * 4;
        image.data[o] = Math.round(r); image.data[o + 1] = Math.round(g); image.data[o + 2] = Math.round(b); image.data[o + 3] = 255;
      }
    }
    lctx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(low, 0, 0, canvasWidth, canvasHeight);

    const sampleG01 = createG01Terrain3DBakeSampler(payload);
    const bounds = G01_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
    const patch = document.createElement('canvas');
    patch.width = 320;
    patch.height = 320;
    const pctx = patch.getContext('2d');
    const patchData = pctx.createImageData(patch.width, patch.height);
    for (let y = 0; y < patch.height; y += 1) {
      const v = y / (patch.height - 1);
      const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * v;
      for (let x = 0; x < patch.width; x += 1) {
        const u = x / (patch.width - 1);
        const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * u;
        const sample = sampleG01(nx, ny);
        const edge = Math.min(1, Math.min(x, y, patch.width - 1 - x, patch.height - 1 - y) / 18);
        const o = (y * patch.width + x) * 4;
        patchData.data[o] = Math.round(sample.tintR * 255);
        patchData.data[o + 1] = Math.round(sample.tintG * 255);
        patchData.data[o + 2] = Math.round(sample.tintB * 255);
        patchData.data[o + 3] = Math.round(180 * edge);
      }
    }
    pctx.putImageData(patchData, 0, 0);
    ctx.drawImage(patch, bounds.xMin * canvasWidth, bounds.yMin * canvasHeight, (bounds.xMax - bounds.xMin) * canvasWidth, (bounds.yMax - bounds.yMin) * canvasHeight);
    return {
      sourceWidth: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth,
      sourceHeight: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight,
      sourceMapSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256,
      sourceAspect: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth / WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight,
      canvasAspect: canvasWidth / canvasHeight,
      g01CanvasBounds: { x: bounds.xMin * canvasWidth, y: bounds.yMin * canvasHeight, width: (bounds.xMax - bounds.xMin) * canvasWidth, height: (bounds.yMax - bounds.yMin) * canvasHeight },
    };
  }, bake);

  const topdownPng = await page.locator('#topdown-proof').screenshot();
  requireCondition(topdownPng.length > 1024, 'full-world top-down PNG is unexpectedly small');
  fs.writeFileSync(path.join(OUT_DIR, 'g01-full-world-reference-topdown.png'), topdownPng);
  const topdownSha256 = sha256(topdownPng);

  requireCondition(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  requireCondition(proof.vertices === 4225 && proof.triangles === 8192, `unexpected runtime mesh ${proof.vertices}/${proof.triangles}`);
  requireCondition(proof.maxWorldParityError <= 1e-7, `normalized/world runtime parity error ${proof.maxWorldParityError}`);
  requireCondition(proof.maxHeight > proof.minHeight, 'G01 runtime visual lost relief variation');
  requireCondition(proof.sourceMapSha256 === EXPECTED_MAP_SHA && topdown.sourceMapSha256 === EXPECTED_MAP_SHA, 'visual map.png provenance mismatch');
  requireCondition(topdown.sourceWidth === 1536 && topdown.sourceHeight === 1024, 'owner-map source dimensions drifted');
  requireCondition(Math.abs(topdown.sourceAspect - topdown.canvasAspect) < 1e-12, 'full-world evidence distorted canonical aspect ratio');

  const metrics = {
    ...proof,
    ...topdown,
    nearSha256,
    farSha256,
    topdownSha256,
    terrain3dRegionCount: bake.regionCount,
    savedRegionFiles: bake.savedRegionFiles,
    bakedVertices: bake.bakedVertices,
    rasterPolicy: 'near/far/top-down PNG bytes are evidence; deterministic gating remains the repeated Terrain3D source/bake checks plus numeric runtime checksum',
    note: 'Full-world context is reconstructed from the committed map.png-derived owner-map semantic contract with a feathered G01 Terrain3D runtime patch. GeoCell/source grids are addressing only and are never drawn.',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`NW_G01_RUNTIME_VISUAL_PARITY_METRICS=${JSON.stringify(metrics)}`);
  console.log('NW_G01_RUNTIME_VISUAL_PARITY_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
