#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { measureG01NearDetail, sampleG01NearDetail } from '../godot/terrain-authoring/geocells/nw/g01_near_detail.mjs';
import { G01_TERRAIN3D_RUNTIME_PARITY } from '../src/3d/world/worldReferenceTerrainAdapter.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_DIR = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const SOURCE_PATH = path.join(PROOF_DIR, 'g01-runtime-source.json');
const BAKE_PATH = path.join(PROOF_DIR, 'g01-runtime-bake.json');
const EXPECTED_SOURCE_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const SOURCE_SIZE = 65;
const HEIGHT_TOLERANCE = 0.012;
const UNIT_TOLERANCE = 0.006;

function fail(message) {
  console.error(`[checkNWG01Terrain3DRuntimeParity] FAIL: ${message}`);
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
  const metrics = measureG01NearDetail();
  requireCondition(metrics.policyId === 'buzul-muhafizi-g01-terrain3d-near-detail-2026-08-14-v1', `unexpected Near Detail policy ${metrics.policyId}`);
  requireCondition(metrics.sourceMapSha256 === EXPECTED_SOURCE_SHA, 'Near Detail owner-map provenance changed');
  requireCondition(metrics.canonicalWaterCells === 88 && metrics.canonicalLandCells === 8, `G01 canonical hydrology changed: ${metrics.canonicalWaterCells}/${metrics.canonicalLandCells}`);
  requireCondition(metrics.maxHeightDeltaMeters === 0 && metrics.maxControlDelta === 0, 'Near Detail changed prior authored height/control');
  requireCondition(metrics.maxG00SharedSeamTintDelta <= 0.00001 && metrics.maxG00SharedSeamRoughnessDelta <= 0.00001, 'G00/G01 Near Detail seam contract changed');

  const bounds = G01_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
  const payload = {
    schema: 'westeros-g01-terrain3d-source-v1',
    policyId: G01_TERRAIN3D_RUNTIME_PARITY.id,
    sourceMapSha256: EXPECTED_SOURCE_SHA,
    terrain3dVersion: G01_TERRAIN3D_RUNTIME_PARITY.terrain3dVersion,
    width: SOURCE_SIZE,
    height: SOURCE_SIZE,
    normalizedBounds: bounds,
    heights: [],
    snowWeight: [],
    tintR: [],
    tintG: [],
    tintB: [],
    roughness: [],
    waterConfidence: [],
  };
  let waterDominantSamples = 0;
  let landDominantSamples = 0;
  let canonicalWaterSamples = 0;
  let maxCanonicalWaterSnowWeight = 0;
  let maxCanonicalWaterTintDelta = 0;
  let maxCanonicalWaterRoughnessDelta = 0;
  for (let y = 0; y < SOURCE_SIZE; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (SOURCE_SIZE - 1));
    for (let x = 0; x < SOURCE_SIZE; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (SOURCE_SIZE - 1));
      const sample = sampleG01NearDetail(nx, ny);
      const fields = [sample.heightMeters, sample.snowWeight, sample.tintR, sample.tintG, sample.tintB, sample.roughness, sample.waterConfidence];
      requireCondition(fields.every(Number.isFinite), `non-finite G01 source at ${x},${y}`);
      if (sample.waterConfidence >= 0.5) waterDominantSamples += 1;
      else landDominantSamples += 1;
      if (sample.waterConfidence >= 0.999999) {
        canonicalWaterSamples += 1;
        maxCanonicalWaterSnowWeight = Math.max(maxCanonicalWaterSnowWeight, Math.abs(sample.snowWeight));
        maxCanonicalWaterTintDelta = Math.max(maxCanonicalWaterTintDelta,
          Math.abs(sample.tintR - 1), Math.abs(sample.tintG - 1), Math.abs(sample.tintB - 1));
        maxCanonicalWaterRoughnessDelta = Math.max(maxCanonicalWaterRoughnessDelta, Math.abs(sample.roughness - 0.9));
      }
      payload.heights.push(round(sample.heightMeters, 6));
      payload.snowWeight.push(round(sample.snowWeight));
      payload.tintR.push(round(sample.tintR));
      payload.tintG.push(round(sample.tintG));
      payload.tintB.push(round(sample.tintB));
      payload.roughness.push(round(sample.roughness));
      payload.waterConfidence.push(round(sample.waterConfidence));
    }
  }
  requireCondition(waterDominantSamples > 0 && landDominantSamples > 0, 'G01 runtime source collapsed to one hydrology class');
  requireCondition(canonicalWaterSamples > 0, 'G01 runtime source has no canonical-water samples');
  requireCondition(maxCanonicalWaterSnowWeight <= 1e-8, `canonical water snow leakage ${maxCanonicalWaterSnowWeight}`);
  requireCondition(maxCanonicalWaterTintDelta <= 1e-8, `canonical water tint leakage ${maxCanonicalWaterTintDelta}`);
  requireCondition(maxCanonicalWaterRoughnessDelta <= 1e-8, `canonical water roughness leakage ${maxCanonicalWaterRoughnessDelta}`);
  payload.semanticMetrics = {
    canonicalWaterCells: metrics.canonicalWaterCells,
    canonicalLandCells: metrics.canonicalLandCells,
    maxG00SharedSeamTintDelta: metrics.maxG00SharedSeamTintDelta,
    maxG00SharedSeamRoughnessDelta: metrics.maxG00SharedSeamRoughnessDelta,
    waterDominantSamples,
    landDominantSamples,
    canonicalWaterSamples,
    maxCanonicalWaterSnowWeight,
    maxCanonicalWaterTintDelta,
    maxCanonicalWaterRoughnessDelta,
  };
  payload.sourceChecksum = checksumNumbers([
    ...payload.heights, ...payload.snowWeight, ...payload.tintR, ...payload.tintG,
    ...payload.tintB, ...payload.roughness, ...payload.waterConfidence,
  ]);
  return payload;
}

function writeSource() {
  fs.mkdirSync(PROOF_DIR, { recursive: true });
  const source = buildSource();
  fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(source)}\n`, 'utf8');
  console.log(`G01_RUNTIME_SOURCE_METRICS=${JSON.stringify({
    samples: source.width * source.height,
    sourceChecksum: source.sourceChecksum,
    minHeight: Math.min(...source.heights),
    maxHeight: Math.max(...source.heights),
    minSnowWeight: Math.min(...source.snowWeight),
    maxSnowWeight: Math.max(...source.snowWeight),
    ...source.semanticMetrics,
  })}`);
  console.log('NW_G01_RUNTIME_PARITY_SOURCE_OK');
}

function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch { /* try next runner location */ }
  }
  return null;
}

function startStaticServer() {
  const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  };
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const relative = urlPath === '/' ? 'game3d.html' : urlPath.replace(/^\/+/, '');
      const filePath = path.resolve(ROOT, relative);
      if (!filePath.startsWith(ROOT + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      res.writeHead(200, { 'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function compareBakeToSource(source, bake) {
  requireCondition(bake.schema === 'westeros-g01-terrain3d-bake-v1', `unexpected bake schema ${bake.schema}`);
  requireCondition(bake.policyId === G01_TERRAIN3D_RUNTIME_PARITY.id, `unexpected bake policy ${bake.policyId}`);
  requireCondition(bake.sourceMapSha256 === EXPECTED_SOURCE_SHA, 'bake owner-map provenance mismatch');
  requireCondition(bake.width === SOURCE_SIZE && bake.height === SOURCE_SIZE, 'G01 bake dimensions changed');
  requireCondition(bake.regionCount >= 4, `257x257 import produced fewer than four regions: ${bake.regionCount}`);
  requireCondition(bake.savedRegionFiles >= 4, `Terrain3D persisted fewer than four regions: ${bake.savedRegionFiles}`);
  requireCondition(bake.bakedVertices > 0, 'Terrain3D LOD0 bake returned no vertices');
  requireCondition(bake.canonicalWaterCells === 88 && bake.canonicalLandCells === 8, 'bake lost G01 canonical 88/8 fingerprint');
  requireCondition(Number.isFinite(bake.boundaryProbeMaxHeightError) && bake.boundaryProbeMaxHeightError <= HEIGHT_TOLERANCE,
    `Terrain3D 255/256 boundary error ${bake.boundaryProbeMaxHeightError}`);
  requireCondition(bake.maxCanonicalWaterSnowWeight <= UNIT_TOLERANCE, `baked canonical-water snow leakage ${bake.maxCanonicalWaterSnowWeight}`);
  requireCondition(bake.maxCanonicalWaterTintDelta <= UNIT_TOLERANCE, `baked canonical-water tint leakage ${bake.maxCanonicalWaterTintDelta}`);
  requireCondition(bake.maxCanonicalWaterRoughnessDelta <= UNIT_TOLERANCE, `baked canonical-water roughness leakage ${bake.maxCanonicalWaterRoughnessDelta}`);
  let maxHeightError = 0;
  let maxSnowError = 0;
  let maxColorError = 0;
  let maxRoughnessError = 0;
  for (let i = 0; i < SOURCE_SIZE * SOURCE_SIZE; i += 1) {
    maxHeightError = Math.max(maxHeightError, Math.abs(bake.heights[i] - source.heights[i]));
    maxSnowError = Math.max(maxSnowError, Math.abs(bake.snowWeight[i] - source.snowWeight[i]));
    maxColorError = Math.max(maxColorError,
      Math.abs(bake.tintR[i] - source.tintR[i]), Math.abs(bake.tintG[i] - source.tintG[i]), Math.abs(bake.tintB[i] - source.tintB[i]));
    maxRoughnessError = Math.max(maxRoughnessError, Math.abs(bake.roughness[i] - source.roughness[i]));
  }
  requireCondition(maxHeightError <= HEIGHT_TOLERANCE, `Terrain3D height parity error ${maxHeightError}`);
  requireCondition(maxSnowError <= UNIT_TOLERANCE, `Terrain3D snow parity error ${maxSnowError}`);
  requireCondition(maxColorError <= UNIT_TOLERANCE, `Terrain3D tint parity error ${maxColorError}`);
  requireCondition(maxRoughnessError <= UNIT_TOLERANCE, `Terrain3D roughness parity error ${maxRoughnessError}`);
  return { maxHeightError, maxSnowError, maxColorError, maxRoughnessError };
}

async function verifyBrowserAdapter(bake) {
  const playwright = loadPlaywright();
  requireCondition(Boolean(playwright), 'Playwright is required for G01 Three.js runtime parity');
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const result = await page.evaluate(async (payload) => {
      const { G01_TERRAIN3D_RUNTIME_PARITY, createG01Terrain3DBakeSampler, createG01Terrain3DWorldSampler } = await import('/src/3d/world/worldReferenceTerrainAdapter.js');
      const { WORLD_SCALE } = await import('/src/3d/config.js');
      const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js');
      const sampleNormalized = createG01Terrain3DBakeSampler(payload);
      const sampleWorld = createG01Terrain3DWorldSampler(payload, { mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
      const b = G01_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
      let maxNodeError = 0;
      let maxWorldVsNormalizedError = 0;
      let finiteSamples = 0;
      let checksum = 2166136261;
      for (let y = 0; y < payload.height; y += 1) {
        const ny = b.yMin + (b.yMax - b.yMin) * (y / (payload.height - 1));
        for (let x = 0; x < payload.width; x += 1) {
          const nx = b.xMin + (b.xMax - b.xMin) * (x / (payload.width - 1));
          const world = normalizedReferenceToWorldXZ(nx, ny, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
          const worldSample = sampleWorld(world.x, world.z);
          const normalizedSample = sampleNormalized(nx, ny);
          const i = y * payload.width + x;
          const actual = [worldSample.heightMeters, worldSample.snowWeight, worldSample.tintR, worldSample.tintG, worldSample.tintB, worldSample.roughness];
          const direct = [normalizedSample.heightMeters, normalizedSample.snowWeight, normalizedSample.tintR, normalizedSample.tintG, normalizedSample.tintB, normalizedSample.roughness];
          const expected = [payload.heights[i], payload.snowWeight[i], payload.tintR[i], payload.tintG[i], payload.tintB[i], payload.roughness[i]];
          if (!actual.every(Number.isFinite)) return { error: `non-finite G01 browser sample at ${x},${y}` };
          for (let c = 0; c < actual.length; c += 1) {
            maxNodeError = Math.max(maxNodeError, Math.abs(actual[c] - expected[c]));
            maxWorldVsNormalizedError = Math.max(maxWorldVsNormalizedError, Math.abs(actual[c] - direct[c]));
          }
          for (const value of actual) {
            const q = Math.round(value * 10000);
            checksum ^= q & 0xff; checksum = Math.imul(checksum, 16777619) >>> 0;
          }
          finiteSamples += 1;
        }
      }
      let outsideRejected = false;
      try { sampleNormalized(b.xMax + 0.001, b.yMin); } catch { outsideRejected = true; }
      return { finiteSamples, maxNodeError, maxWorldVsNormalizedError, checksum, outsideRejected };
    }, bake);
    requireCondition(!result.error, result.error ?? 'unknown G01 browser adapter failure');
    requireCondition(errors.length === 0, `browser page errors: ${errors.join(' | ')}`);
    requireCondition(result.finiteSamples === SOURCE_SIZE * SOURCE_SIZE, `browser sampled ${result.finiteSamples} points`);
    requireCondition(result.maxNodeError <= 1e-7, `G01 browser exact-node error ${result.maxNodeError}`);
    requireCondition(result.maxWorldVsNormalizedError <= 1e-7, `world/normalized adapter mismatch ${result.maxWorldVsNormalizedError}`);
    requireCondition(result.outsideRejected === true, 'G01 runtime adapter accepted an out-of-domain sample');
    return result;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes('--verify')) {
  requireCondition(fs.existsSync(SOURCE_PATH), 'G01 runtime source proof missing');
  requireCondition(fs.existsSync(BAKE_PATH), 'G01 Terrain3D bake proof missing');
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
  const bake = JSON.parse(fs.readFileSync(BAKE_PATH, 'utf8'));
  const terrain3d = compareBakeToSource(source, bake);
  const browser = await verifyBrowserAdapter(bake);
  console.log(`G01_RUNTIME_PARITY_METRICS=${JSON.stringify({ ...terrain3d, ...browser, bakeChecksum: bake.bakeChecksum })}`);
  console.log('NW_G01_TERRAIN3D_RUNTIME_PARITY_OK');
} else {
  writeSource();
}
