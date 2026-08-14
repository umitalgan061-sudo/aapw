#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import {
  G65_NEAR_DETAIL_POLICY,
  sampleG65NearDetail,
} from '../godot/terrain-authoring/geocells/se/g65_near_detail.mjs';
import {
  G65_TERRAIN3D_RUNTIME_PARITY,
} from '../src/3d/world/worldReferenceTerrainAdapter.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_DIR = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const SOURCE_PATH = path.join(PROOF_DIR, 'g65-runtime-source.json');
const BAKE_PATH = path.join(PROOF_DIR, 'g65-runtime-bake.json');
const EXPECTED_SOURCE_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const SOURCE_SIZE = 129;
const HEIGHT_TOLERANCE = 0.012;
const UNIT_TOLERANCE = 0.006;

function fail(message) {
  console.error(`[checkSEG65Terrain3DRuntimeParity] FAIL: ${message}`);
  process.exit(1);
}
function requireCondition(condition, message) {
  if (!condition) fail(message);
}
function round(value, digits = 8) {
  return Number(value.toFixed(digits));
}
function checksumNumbers(values) {
  let hash = 2166136261;
  for (const value of values) {
    const quantized = Math.round(value * 1000000);
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (quantized >>> shift) & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash >>> 0;
}

function buildSource() {
  requireCondition(G65_NEAR_DETAIL_POLICY.sourceMapSha256 === EXPECTED_SOURCE_SHA, 'G65 Near Detail map.png provenance changed');
  requireCondition(G65_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256 === EXPECTED_SOURCE_SHA, 'runtime adapter map.png provenance changed');
  requireCondition(G65_TERRAIN3D_RUNTIME_PARITY.sourceSize === SOURCE_SIZE, 'runtime adapter source size changed');
  requireCondition(JSON.stringify(G65_NEAR_DETAIL_POLICY.normalizedBounds) === JSON.stringify(G65_TERRAIN3D_RUNTIME_PARITY.normalizedBounds), 'G65 runtime bounds diverged from Near Detail owner-map bounds');
  const bounds = G65_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
  const payload = {
    schema: 'westeros-g65-terrain3d-source-v1',
    policyId: G65_TERRAIN3D_RUNTIME_PARITY.id,
    sourceMapSha256: EXPECTED_SOURCE_SHA,
    terrain3dVersion: G65_TERRAIN3D_RUNTIME_PARITY.terrain3dVersion,
    width: SOURCE_SIZE,
    height: SOURCE_SIZE,
    normalizedBounds: bounds,
    groundTextureId: G65_NEAR_DETAIL_POLICY.groundTextureId,
    rockTextureId: G65_NEAR_DETAIL_POLICY.rockTextureId,
    heights: [],
    rockBlend: [],
    tintR: [],
    tintG: [],
    tintB: [],
    roughness: [],
  };
  let canonicalLandSamples = 0;
  for (let y = 0; y < SOURCE_SIZE; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (SOURCE_SIZE - 1));
    for (let x = 0; x < SOURCE_SIZE; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (SOURCE_SIZE - 1));
      const sample = sampleG65NearDetail(nx, ny);
      requireCondition(sample.waterConfidence < 0.5, `G65 runtime source unexpectedly classified water at ${x},${y}`);
      requireCondition(sample.roadCoverage === 0 && sample.pathCoverage === 0, `G65 runtime source developed a phantom road/path at ${x},${y}`);
      requireCondition(sample.snowWeight === 0, `G65 runtime source developed snow at ${x},${y}`);
      payload.heights.push(round(sample.authoredHeight, 6));
      payload.rockBlend.push(round(sample.rockBlend));
      payload.tintR.push(round(sample.tintR));
      payload.tintG.push(round(sample.tintG));
      payload.tintB.push(round(sample.tintB));
      payload.roughness.push(round(sample.roughness));
      canonicalLandSamples += 1;
    }
  }
  payload.semanticMetrics = {
    canonicalLandSamples,
    canonicalWaterSamples: 0,
    activeRoadSamples: 0,
    activePathSamples: 0,
    snowSamples: 0,
  };
  payload.sourceChecksum = checksumNumbers([
    ...payload.heights,
    ...payload.rockBlend,
    ...payload.tintR,
    ...payload.tintG,
    ...payload.tintB,
    ...payload.roughness,
  ]);
  return payload;
}

function writeSource() {
  fs.mkdirSync(PROOF_DIR, { recursive: true });
  const source = buildSource();
  fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(source)}\n`, 'utf8');
  console.log(`G65_RUNTIME_SOURCE_METRICS=${JSON.stringify({
    samples: source.width * source.height,
    sourceChecksum: source.sourceChecksum,
    minHeight: Math.min(...source.heights),
    maxHeight: Math.max(...source.heights),
    minRockBlend: Math.min(...source.rockBlend),
    maxRockBlend: Math.max(...source.rockBlend),
    minRoughness: Math.min(...source.roughness),
    maxRoughness: Math.max(...source.roughness),
    ...source.semanticMetrics,
  })}`);
  console.log('SE_G65_RUNTIME_PARITY_SOURCE_OK');
}

function compareBakeToSource(source, bake) {
  requireCondition(bake.schema === 'westeros-g65-terrain3d-bake-v1', `unexpected bake schema ${bake.schema}`);
  requireCondition(bake.policyId === G65_TERRAIN3D_RUNTIME_PARITY.id, `unexpected bake policy ${bake.policyId}`);
  requireCondition(bake.sourceMapSha256 === EXPECTED_SOURCE_SHA, 'bake map.png provenance mismatch');
  requireCondition(String(bake.terrain3dVersion).startsWith('1.0.2'), `unexpected Terrain3D version ${bake.terrain3dVersion}`);
  requireCondition(bake.lod === 0, `unexpected Terrain3D bake LOD ${bake.lod}`);
  requireCondition(bake.width === SOURCE_SIZE && bake.height === SOURCE_SIZE, 'bake dimensions changed');
  requireCondition(bake.regionCount >= 4, `257x257 guard import did not create four Terrain3D regions: ${bake.regionCount}`);
  requireCondition(bake.savedRegionFiles >= 4, `Terrain3D persisted fewer than four region files: ${bake.savedRegionFiles}`);
  requireCondition(bake.bakedVertices > 0, 'Terrain3D LOD0 bake returned no vertices');
  requireCondition(Number.isFinite(bake.boundaryProbeMaxHeightError) && bake.boundaryProbeMaxHeightError <= HEIGHT_TOLERANCE,
    `Terrain3D 255/256 boundary height error ${bake.boundaryProbeMaxHeightError}`);
  let maxHeightError = 0;
  let maxBlendError = 0;
  let maxColorError = 0;
  let maxRoughnessError = 0;
  const count = SOURCE_SIZE * SOURCE_SIZE;
  for (let i = 0; i < count; i += 1) {
    maxHeightError = Math.max(maxHeightError, Math.abs(bake.heights[i] - source.heights[i]));
    maxBlendError = Math.max(maxBlendError, Math.abs(bake.rockBlend[i] - source.rockBlend[i]));
    maxColorError = Math.max(maxColorError,
      Math.abs(bake.tintR[i] - source.tintR[i]),
      Math.abs(bake.tintG[i] - source.tintG[i]),
      Math.abs(bake.tintB[i] - source.tintB[i]));
    maxRoughnessError = Math.max(maxRoughnessError, Math.abs(bake.roughness[i] - source.roughness[i]));
  }
  requireCondition(maxHeightError <= HEIGHT_TOLERANCE, `Terrain3D G65 height parity error ${maxHeightError}`);
  requireCondition(maxBlendError <= UNIT_TOLERANCE, `Terrain3D G65 rock-blend parity error ${maxBlendError}`);
  requireCondition(maxColorError <= UNIT_TOLERANCE, `Terrain3D G65 tint parity error ${maxColorError}`);
  requireCondition(maxRoughnessError <= UNIT_TOLERANCE, `Terrain3D G65 roughness parity error ${maxRoughnessError}`);
  return { maxHeightError, maxBlendError, maxColorError, maxRoughnessError };
}

async function verifyBrowserAdapter(bake) {
  const playwright = loadPlaywright();
  requireCondition(Boolean(playwright), 'Playwright is required for G65 Three.js runtime parity verification');
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20000 });
    const result = await page.evaluate(async (payload) => {
      const { G65_TERRAIN3D_RUNTIME_PARITY, createG65Terrain3DWorldSampler } = await import('/src/3d/world/worldReferenceTerrainAdapter.js');
      const { WORLD_SCALE } = await import('/src/3d/config.js');
      const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js');
      const sampler = createG65Terrain3DWorldSampler(payload, {
        mapBounds: WORLD_SCALE.MAP_BOUNDS,
        metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
      });
      const bounds = G65_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
      let maxNodeError = 0;
      let finiteSamples = 0;
      let checksum = 2166136261;
      for (let y = 0; y < payload.height; y += 1) {
        const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (payload.height - 1));
        for (let x = 0; x < payload.width; x += 1) {
          const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (payload.width - 1));
          const world = normalizedReferenceToWorldXZ(nx, ny, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
          const sample = sampler(world.x, world.z);
          const i = y * payload.width + x;
          const actual = [sample.heightMeters, sample.rockBlend, sample.tintR, sample.tintG, sample.tintB, sample.roughness];
          const expected = [payload.heights[i], payload.rockBlend[i], payload.tintR[i], payload.tintG[i], payload.tintB[i], payload.roughness[i]];
          if (!actual.every(Number.isFinite)) return { error: `non-finite G65 browser sample at ${x},${y}` };
          for (let c = 0; c < actual.length; c += 1) maxNodeError = Math.max(maxNodeError, Math.abs(actual[c] - expected[c]));
          for (const value of actual) {
            const q = Math.round(value * 10000);
            checksum ^= q & 0xff;
            checksum = Math.imul(checksum, 16777619) >>> 0;
          }
          finiteSamples += 1;
        }
      }
      return { finiteSamples, maxNodeError, checksum };
    }, bake);
    requireCondition(!result.error, result.error ?? 'unknown G65 browser adapter failure');
    requireCondition(errors.length === 0, `browser page errors: ${errors.join(' | ')}`);
    requireCondition(result.finiteSamples === SOURCE_SIZE * SOURCE_SIZE, `G65 browser sampled ${result.finiteSamples} points`);
    requireCondition(result.maxNodeError <= 1e-7, `G65 browser bake adapter exact-node error ${result.maxNodeError}`);
    return result;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes('--verify')) {
  requireCondition(fs.existsSync(SOURCE_PATH), 'G65 runtime source proof missing');
  requireCondition(fs.existsSync(BAKE_PATH), 'G65 Terrain3D bake proof missing');
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
  const bake = JSON.parse(fs.readFileSync(BAKE_PATH, 'utf8'));
  requireCondition(source.sourceChecksum === buildSource().sourceChecksum, 'G65 runtime source is not deterministic');
  const terrain3d = compareBakeToSource(source, bake);
  const browser = await verifyBrowserAdapter(bake);
  console.log(`G65_RUNTIME_PARITY_METRICS=${JSON.stringify({ ...terrain3d, ...browser, bakeChecksum: bake.bakeChecksum })}`);
  console.log('SE_G65_TERRAIN3D_RUNTIME_PARITY_OK');
} else {
  writeSource();
}
