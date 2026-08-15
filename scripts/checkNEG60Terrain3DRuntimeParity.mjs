#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { sampleG60NearDetail } from '../godot/terrain-authoring/geocells/ne/g60_near_detail.mjs';
import {
  G60_TERRAIN3D_RUNTIME_PARITY,
  assertG60Terrain3DBakePayload,
} from '../src/3d/world/g60Terrain3dRuntimeAdapter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_DIR = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const SOURCE_PATH = path.join(PROOF_DIR, 'g60-runtime-source.json');
const BAKE_PATH = path.join(PROOF_DIR, 'g60-runtime-bake.json');
const OUT_ARG = process.argv.find((value) => value.startsWith('--out-dir='));
const OUT_DIR = path.resolve(ROOT, OUT_ARG ? OUT_ARG.slice(10) : 'artifacts/ne-g60-runtime-parity');
const SOURCE_SIZE = G60_TERRAIN3D_RUNTIME_PARITY.sourceSize;
const HEIGHT_TOLERANCE = 0.015;
const UNIT_TOLERANCE = 0.006;

function requireOk(condition, message) {
  if (!condition) throw new Error(message);
}
const round = (value, digits = 8) => Number(value.toFixed(digits));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function hashNumber(checksum, value) {
  const quantized = Math.round(value * 1e6) | 0;
  let out = checksum;
  for (const shift of [0, 8, 16, 24]) out = Math.imul((out ^ ((quantized >>> shift) & 0xff)) >>> 0, 16777619) >>> 0;
  return out >>> 0;
}

function buildSource() {
  const bounds = G60_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
  const payload = {
    schema: 'westeros-g60-terrain3d-runtime-source-v1',
    policyId: G60_TERRAIN3D_RUNTIME_PARITY.id,
    sourceMapSha256: G60_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256,
    width: SOURCE_SIZE, height: SOURCE_SIZE, normalizedBounds: bounds,
    baseTextureId: 0, overlayTextureId: 1,
    heights: [], controlBlend: [], tintR: [], tintG: [], tintB: [], roughness: [],
  };
  let checksum = 2166136261;
  let seaSamples = 0, maxRoadPath = 0, maxRockSnow = 0, maxFoliage = 0, maxControl = 0;
  for (let y = 0; y < SOURCE_SIZE; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / (SOURCE_SIZE - 1);
    for (let x = 0; x < SOURCE_SIZE; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / (SOURCE_SIZE - 1);
      const sample = sampleG60NearDetail(nx, ny);
      const fields = [sample.authoredHeight, sample.controlBlend, sample.tintR, sample.tintG, sample.tintB, sample.roughness];
      requireOk(fields.every(Number.isFinite), `non-finite G60 source sample at ${x},${y}`);
      requireOk(sample.water === true && sample.body === 'sea', `G60 invented non-sea geography at ${x},${y}`);
      seaSamples += 1;
      maxRoadPath = Math.max(maxRoadPath, Math.abs(sample.coverage), Math.abs(sample.roadPathControlBlend));
      maxRockSnow = Math.max(maxRockSnow, Math.abs(sample.rockWeight), Math.abs(sample.snowWeight));
      maxFoliage = Math.max(maxFoliage, Math.abs(sample.foliageDensity));
      maxControl = Math.max(maxControl, Math.abs(sample.controlBlend));
      for (const [name, value, digits] of [
        ['heights', sample.authoredHeight, 6], ['controlBlend', sample.controlBlend, 8],
        ['tintR', sample.tintR, 8], ['tintG', sample.tintG, 8], ['tintB', sample.tintB, 8], ['roughness', sample.roughness, 8],
      ]) {
        payload[name].push(round(value, digits)); checksum = hashNumber(checksum, value);
      }
    }
  }
  requireOk(seaSamples === SOURCE_SIZE * SOURCE_SIZE, 'G60 source is not complete canonical sea');
  requireOk(Math.max(maxRoadPath, maxRockSnow, maxFoliage, maxControl) <= 1e-9, 'G60 terrestrial/road/control leakage detected');
  requireOk(Math.max(...payload.heights) === -8 && Math.min(...payload.heights) === -8, 'G60 canonical -8m authored height drifted');
  payload.semanticMetrics = { seaSamples, maxRoadPath, maxRockSnow, maxFoliage, maxControl, heightMeters: -8 };
  payload.sourceChecksum = checksum >>> 0;
  return payload;
}

function writeSource() {
  fs.mkdirSync(PROOF_DIR, { recursive: true });
  const source = buildSource();
  fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(source)}\n`);
  console.log(`G60_RUNTIME_SOURCE_METRICS=${JSON.stringify({ samples: source.width * source.height, checksum: source.sourceChecksum, ...source.semanticMetrics })}`);
  console.log('NE_G60_RUNTIME_PARITY_SOURCE_OK');
}

function compareBake(source, bake) {
  assertG60Terrain3DBakePayload(bake);
  requireOk(bake.regionCount >= 4 && bake.savedRegionFiles >= 4 && bake.savedRegionBytes > 0, 'Terrain3D region persistence incomplete');
  requireOk(bake.bakedSurfaces > 0 && bake.bakedVertices > 0, 'Terrain3D LOD0 bake is empty');
  requireOk(bake.alignedSamples === SOURCE_SIZE * SOURCE_SIZE && bake.seamSamples >= 24, 'Terrain3D aligned/seam proof coverage changed');
  requireOk(bake.maxSeamHeightError <= 0.025 && bake.maxSeamUnitError <= 0.008, 'Terrain3D 255/256 seam parity exceeded tolerance');
  let maxHeightError = 0, maxControlError = 0, maxColorError = 0, maxRoughnessError = 0;
  for (let i = 0; i < SOURCE_SIZE * SOURCE_SIZE; i += 1) {
    maxHeightError = Math.max(maxHeightError, Math.abs(bake.heights[i] - source.heights[i]));
    maxControlError = Math.max(maxControlError, Math.abs(bake.controlBlend[i] - source.controlBlend[i]));
    maxColorError = Math.max(maxColorError,
      Math.abs(bake.tintR[i] - source.tintR[i]), Math.abs(bake.tintG[i] - source.tintG[i]), Math.abs(bake.tintB[i] - source.tintB[i]));
    maxRoughnessError = Math.max(maxRoughnessError, Math.abs(bake.roughness[i] - source.roughness[i]));
  }
  requireOk(maxHeightError <= HEIGHT_TOLERANCE, `native height parity error ${maxHeightError}`);
  requireOk(maxControlError <= UNIT_TOLERANCE, `native control parity error ${maxControlError}`);
  requireOk(maxColorError <= UNIT_TOLERANCE, `native color parity error ${maxColorError}`);
  requireOk(maxRoughnessError <= UNIT_TOLERANCE, `native roughness parity error ${maxRoughnessError}`);
  return { maxHeightError, maxControlError, maxColorError, maxRoughnessError };
}

async function verifyBrowser(bake) {
  const playwright = devServerHelper.loadPlaywright();
  requireOk(Boolean(playwright), 'Playwright is required for G60 Three.js parity');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await devServerHelper.startStaticServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page:${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${baseUrl}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30000 });
    const adapter = await page.evaluate(async (payload) => {
      const { createG60Terrain3DWorldSampler, G60_TERRAIN3D_RUNTIME_PARITY } = await import('/src/3d/world/g60Terrain3dRuntimeAdapter.js');
      const { CURRENT_TERRAIN_POLICY } = await import('/src/3d/world/terrain.js');
      const { WORLD_SCALE } = await import('/src/3d/config.js');
      const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js');
      if (!CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage || CURRENT_TERRAIN_POLICY.sourceMapSha256 !== G60_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) {
        return { error: 'shipped terrain no longer has matching full-owner-map provenance' };
      }
      const sampler = createG60Terrain3DWorldSampler(payload, { mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
      const bounds = G60_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
      let finiteSamples = 0, maxNodeError = 0;
      for (let y = 0; y < payload.height; y += 1) for (let x = 0; x < payload.width; x += 1) {
        const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / (payload.width - 1);
        const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / (payload.height - 1);
        const world = normalizedReferenceToWorldXZ(nx, ny, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
        const sample = sampler(world.x, world.z), i = y * payload.width + x;
        const actual = [sample.heightMeters, sample.controlBlend, sample.tintR, sample.tintG, sample.tintB, sample.roughness];
        const expected = [payload.heights[i], payload.controlBlend[i], payload.tintR[i], payload.tintG[i], payload.tintB[i], payload.roughness[i]];
        if (!actual.every(Number.isFinite)) return { error: `non-finite Three.js adapter sample ${x},${y}` };
        for (let c = 0; c < actual.length; c += 1) maxNodeError = Math.max(maxNodeError, Math.abs(actual[c] - expected[c]));
        finiteSamples += 1;
      }
      return { finiteSamples, maxNodeError, currentTerrainPolicy: CURRENT_TERRAIN_POLICY.id, worldWidth: WORLD_SCALE.WORLD_WIDTH_METERS, worldDepth: WORLD_SCALE.WORLD_DEPTH_METERS };
    }, bake);
    requireOk(!adapter.error, adapter.error ?? 'unknown adapter error');
    requireOk(adapter.finiteSamples === SOURCE_SIZE * SOURCE_SIZE && adapter.maxNodeError <= 1e-7, `Three.js adapter node parity ${adapter.maxNodeError}`);

    const fullWorld = await page.evaluate(async () => {
      const importMap = document.createElement('script');
      importMap.type = 'importmap';
      importMap.textContent = JSON.stringify({ imports: { three: '/src/3d/vendor/three/three.module.js', 'three/addons/': '/src/3d/vendor/three/addons/' } });
      document.head.append(importMap);
      document.body.innerHTML = '<canvas id="g60-full-world"></canvas>';
      const THREE = await import('/src/3d/vendor/three/three.module.js');
      const { createScene } = await import('/src/3d/sceneManager.js');
      const { WORLD_SCALE } = await import('/src/3d/config.js');
      const state = createScene(document.getElementById('g60-full-world'));
      state.controls.enabled = false; state.scene.fog = null; state.sky.visible = false; state.stars.visible = false;
      state.renderer.setPixelRatio(1); state.renderer.setSize(1536, 1024, false); state.chunkManager.loadSquare(0, 0, 12);
      const terrainMeshes = [...state.chunkManager.loaded.values()];
      const missingSingleSource = terrainMeshes.filter((mesh) => mesh.userData.currentTerrainSingleSource !== true).length;
      const worldWidth = WORLD_SCALE.WORLD_WIDTH_METERS, worldDepth = WORLD_SCALE.WORLD_DEPTH_METERS, aspect = 1536 / 1024;
      const halfWidth = Math.max(worldWidth / 2, worldDepth * aspect / 2) * 1.025, halfHeight = halfWidth / aspect;
      state.water.geometry.computeBoundingBox();
      const waterExtent = state.water.geometry.boundingBox.max.x - state.water.geometry.boundingBox.min.x;
      const coverage = Math.max(halfWidth * 2, halfHeight * 2) * 1.04;
      state.water.scale.set(coverage / waterExtent, 1, coverage / waterExtent); state.water.position.set(0, state.water.position.y, 0);
      const depthTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType); depthTexture.needsUpdate = true;
      state.water.material.uniforms.uDepthMap.value = depthTexture; state.water.material.uniforms.uDepthFieldExtentMeters.value = 1; state.water.material.uniforms.uSwellStrength.value = 0;
      const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 30000);
      camera.up.set(0, 0, -1); camera.position.set(0, 13000, 0); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
      state.renderer.render(state.scene, camera);
      return { terrainMeshCount: terrainMeshes.length, missingSingleSource, camera: 'THREE.OrthographicCamera', resolution: [1536, 1024], pitchDegrees: 90, worldWidth, worldDepth };
    });
    requireOk(fullWorld.terrainMeshCount >= 500, `full-world runtime incomplete: ${fullWorld.terrainMeshCount} meshes`);
    requireOk(fullWorld.missingSingleSource === 0, `full-world runtime has ${fullWorld.missingSingleSource} meshes outside single height authority`);
    requireOk(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
    const png = await page.screenshot();
    requireOk(png.length > 4096, 'real 3D full-world top-down PNG unexpectedly small');
    fs.writeFileSync(path.join(OUT_DIR, 'g60-runtime-full-world-orthographic.png'), png);
    const metrics = { adapter, fullWorld, screenshotSha256: sha256(png), browserErrors: errors };
    fs.writeFileSync(path.join(OUT_DIR, 'g60-runtime-browser-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
    return metrics;
  } finally {
    await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes('--verify')) {
  requireOk(fs.existsSync(SOURCE_PATH), 'G60 runtime source proof missing');
  requireOk(fs.existsSync(BAKE_PATH), 'G60 native Terrain3D bake proof missing');
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
  const bake = JSON.parse(fs.readFileSync(BAKE_PATH, 'utf8'));
  const native = compareBake(source, bake);
  const browser = await verifyBrowser(bake);
  console.log(`G60_RUNTIME_PARITY_METRICS=${JSON.stringify({ ...native, adapter: browser.adapter, fullWorld: browser.fullWorld, screenshotSha256: browser.screenshotSha256, bakeChecksum: bake.bakeChecksum })}`);
  console.log('NE_G60_TERRAIN3D_RUNTIME_PARITY_OK');
} else {
  writeSource();
}
