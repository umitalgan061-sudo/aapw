#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  G00_TERRAIN3D_RUNTIME_PARITY,
} from '../src/3d/world/worldReferenceTerrainAdapter.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_DIR = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const NEAR_PROBE_PATH = path.join(PROOF_DIR, 'g00-near-detail-probe.json');
const SOURCE_PATH = path.join(PROOF_DIR, 'g00-runtime-source.json');
const BAKE_PATH = path.join(PROOF_DIR, 'g00-runtime-bake.json');
const EXPECTED_SOURCE_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const SOURCE_SIZE = 257;
const ROAD_ACTIVE_EPS = 0.002;
const HEIGHT_TOLERANCE = 0.012;
const UNIT_TOLERANCE = 0.006;

function fail(message) {
  console.error(`[checkNWG00Terrain3DRuntimeParity] FAIL: ${message}`);
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

function buildSourceFromNearProbe(probe) {
  requireCondition(probe?.policyId === 'buzul-muhafizi-g00-terrain3d-near-detail-2026-08-13-v1', `unexpected Near Detail policy ${probe?.policyId}`);
  requireCondition(probe?.sourceMapSha256 === EXPECTED_SOURCE_SHA, 'Near Detail owner-map provenance changed');
  requireCondition(probe?.sourceGridSize === SOURCE_SIZE && probe?.terrain3dRegionSize === 256, 'G00 Near Detail source/region dimensions changed');
  requireCondition(Array.isArray(probe.rows) && probe.rows.length === SOURCE_SIZE, 'G00 Near Detail rows missing');
  const payload = {
    schema: 'westeros-g00-terrain3d-source-v1',
    policyId: G00_TERRAIN3D_RUNTIME_PARITY.id,
    sourceMapSha256: EXPECTED_SOURCE_SHA,
    terrain3dVersion: G00_TERRAIN3D_RUNTIME_PARITY.terrain3dVersion,
    width: SOURCE_SIZE,
    height: SOURCE_SIZE,
    normalizedBounds: G00_TERRAIN3D_RUNTIME_PARITY.normalizedBounds,
    rockTextureId: probe.rockTextureId,
    snowTextureId: probe.snowTextureId,
    roadTextureId: probe.roadTextureId,
    pathTextureId: probe.pathTextureId,
    heights: [],
    roadCoverage: [],
    pathCoverage: [],
    snowSurface: [],
    tintR: [],
    tintG: [],
    tintB: [],
    roughness: [],
  };
  let activeRoadSurfaceSamples = 0;
  let activePathSurfaceSamples = 0;
  let neutralSurfaceSamples = 0;
  for (let y = 0; y < SOURCE_SIZE; y += 1) {
    const row = probe.rows[y];
    requireCondition(Array.isArray(row) && row.length === SOURCE_SIZE, `invalid Near Detail row ${y}`);
    for (let x = 0; x < SOURCE_SIZE; x += 1) {
      const sample = row[x];
      requireCondition(Array.isArray(sample) && sample.length >= 11, `invalid Near Detail sample ${x},${y}`);
      const [rawRoad, rawPath, kind, height, substrateSnowWeight, , , tintR, tintG, tintB, roughness] = sample;
      requireCondition([rawRoad, rawPath, height, substrateSnowWeight, tintR, tintG, tintB, roughness].every(Number.isFinite), `non-finite Near Detail sample ${x},${y}`);
      const coverage = Math.max(rawRoad, rawPath);
      const active = coverage > ROAD_ACTIVE_EPS;
      const roadCoverage = active && kind === 1 ? coverage : 0;
      const pathCoverage = active && kind === 2 ? coverage : 0;
      const snowSurface = active ? (substrateSnowWeight >= 0.5 ? 1 : 0) : substrateSnowWeight;
      if (roadCoverage > ROAD_ACTIVE_EPS) activeRoadSurfaceSamples += 1;
      if (pathCoverage > ROAD_ACTIVE_EPS) activePathSurfaceSamples += 1;
      if (!active) neutralSurfaceSamples += 1;
      payload.heights.push(round(height, 6));
      payload.roadCoverage.push(round(roadCoverage));
      payload.pathCoverage.push(round(pathCoverage));
      payload.snowSurface.push(round(snowSurface));
      payload.tintR.push(round(tintR));
      payload.tintG.push(round(tintG));
      payload.tintB.push(round(tintB));
      payload.roughness.push(round(roughness));
    }
  }
  const roadFingerprint = probe.roadPathFingerprint ?? {};
  if ((roadFingerprint.activeRoadSamples ?? 0) > 0) requireCondition(activeRoadSurfaceSamples > 0, 'qualified G00 road coverage vanished from Terrain3D runtime source');
  if ((roadFingerprint.activePathSamples ?? 0) > 0) requireCondition(activePathSurfaceSamples > 0, 'qualified G00 path coverage vanished from Terrain3D runtime source');
  requireCondition(neutralSurfaceSamples > 0, 'G00 runtime source unexpectedly contains no neutral substrate samples');
  payload.semanticMetrics = {
    activeRoadSurfaceSamples,
    activePathSurfaceSamples,
    neutralSurfaceSamples,
    nearDetailChecksum: probe.detailChecksum,
    roadCoverageChecksum: roadFingerprint.coverageChecksum,
    vegetationCoreInstances: probe.vegetation?.coreInstanceCount ?? 0,
  };
  payload.sourceChecksum = checksumNumbers([
    ...payload.heights,
    ...payload.roadCoverage,
    ...payload.pathCoverage,
    ...payload.snowSurface,
    ...payload.tintR,
    ...payload.tintG,
    ...payload.tintB,
    ...payload.roughness,
  ]);
  return payload;
}

function writeSource() {
  requireCondition(fs.existsSync(NEAR_PROBE_PATH), 'merged G00 Near Detail probe missing; run checkNWG00NearDetail.mjs --emit-probe first');
  const probe = JSON.parse(fs.readFileSync(NEAR_PROBE_PATH, 'utf8'));
  const source = buildSourceFromNearProbe(probe);
  fs.mkdirSync(PROOF_DIR, { recursive: true });
  fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(source)}\n`, 'utf8');
  console.log(`G00_RUNTIME_SOURCE_METRICS=${JSON.stringify({
    samples: source.width * source.height,
    sourceChecksum: source.sourceChecksum,
    minHeight: Math.min(...source.heights),
    maxHeight: Math.max(...source.heights),
    minSnowSurface: Math.min(...source.snowSurface),
    maxSnowSurface: Math.max(...source.snowSurface),
    ...source.semanticMetrics,
  })}`);
  console.log('NW_G00_RUNTIME_PARITY_SOURCE_OK');
}

function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch { /* try next supported runner location */ }
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
  requireCondition(bake.schema === 'westeros-g00-terrain3d-bake-v1', `unexpected bake schema ${bake.schema}`);
  requireCondition(bake.sourceMapSha256 === EXPECTED_SOURCE_SHA, 'bake owner-map provenance mismatch');
  requireCondition(bake.width === SOURCE_SIZE && bake.height === SOURCE_SIZE, 'G00 bake dimensions changed');
  requireCondition(bake.regionCount >= 4, `257x257 G00 import did not create four Terrain3D regions: ${bake.regionCount}`);
  requireCondition(bake.savedRegionFiles >= 4, `Terrain3D persisted fewer than four G00 regions: ${bake.savedRegionFiles}`);
  requireCondition(bake.bakedVertices > 0, 'Terrain3D G00 LOD0 bake returned no vertices');
  requireCondition(Number.isFinite(bake.boundaryProbeMaxHeightError) && bake.boundaryProbeMaxHeightError <= HEIGHT_TOLERANCE,
    `Terrain3D G00 255/256 boundary error ${bake.boundaryProbeMaxHeightError}`);
  let maxHeightError = 0;
  let maxRoadError = 0;
  let maxPathError = 0;
  let maxSnowError = 0;
  let maxColorError = 0;
  let maxRoughnessError = 0;
  const count = SOURCE_SIZE * SOURCE_SIZE;
  for (let i = 0; i < count; i += 1) {
    maxHeightError = Math.max(maxHeightError, Math.abs(bake.heights[i] - source.heights[i]));
    maxRoadError = Math.max(maxRoadError, Math.abs(bake.roadCoverage[i] - source.roadCoverage[i]));
    maxPathError = Math.max(maxPathError, Math.abs(bake.pathCoverage[i] - source.pathCoverage[i]));
    maxSnowError = Math.max(maxSnowError, Math.abs(bake.snowSurface[i] - source.snowSurface[i]));
    maxColorError = Math.max(maxColorError,
      Math.abs(bake.tintR[i] - source.tintR[i]), Math.abs(bake.tintG[i] - source.tintG[i]), Math.abs(bake.tintB[i] - source.tintB[i]));
    maxRoughnessError = Math.max(maxRoughnessError, Math.abs(bake.roughness[i] - source.roughness[i]));
  }
  requireCondition(maxHeightError <= HEIGHT_TOLERANCE, `Terrain3D G00 height parity error ${maxHeightError}`);
  requireCondition(maxRoadError <= UNIT_TOLERANCE, `Terrain3D G00 road parity error ${maxRoadError}`);
  requireCondition(maxPathError <= UNIT_TOLERANCE, `Terrain3D G00 path parity error ${maxPathError}`);
  requireCondition(maxSnowError <= UNIT_TOLERANCE, `Terrain3D G00 substrate parity error ${maxSnowError}`);
  requireCondition(maxColorError <= UNIT_TOLERANCE, `Terrain3D G00 tint parity error ${maxColorError}`);
  requireCondition(maxRoughnessError <= UNIT_TOLERANCE, `Terrain3D G00 roughness parity error ${maxRoughnessError}`);
  return { maxHeightError, maxRoadError, maxPathError, maxSnowError, maxColorError, maxRoughnessError };
}

async function verifyBrowserAdapter(bake) {
  const playwright = loadPlaywright();
  requireCondition(Boolean(playwright), 'Playwright is required for G00 Three.js runtime parity verification');
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const result = await page.evaluate(async (payload) => {
      const { G00_TERRAIN3D_RUNTIME_PARITY, createG00Terrain3DWorldSampler } = await import('/src/3d/world/worldReferenceTerrainAdapter.js');
      const { WORLD_SCALE } = await import('/src/3d/config.js');
      const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js');
      const sampler = createG00Terrain3DWorldSampler(payload, { mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
      const bounds = G00_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
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
          const actual = [sample.heightMeters, sample.roadCoverage, sample.pathCoverage, sample.snowSurface, sample.tintR, sample.tintG, sample.tintB, sample.roughness];
          const expected = [payload.heights[i], payload.roadCoverage[i], payload.pathCoverage[i], payload.snowSurface[i], payload.tintR[i], payload.tintG[i], payload.tintB[i], payload.roughness[i]];
          if (!actual.every(Number.isFinite)) return { error: `non-finite G00 browser sample at ${x},${y}` };
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
    requireCondition(!result.error, result.error ?? 'unknown G00 browser adapter failure');
    requireCondition(errors.length === 0, `browser page errors: ${errors.join(' | ')}`);
    requireCondition(result.finiteSamples === SOURCE_SIZE * SOURCE_SIZE, `G00 browser sampled ${result.finiteSamples} points`);
    requireCondition(result.maxNodeError <= 1e-7, `G00 browser bake adapter exact-node error ${result.maxNodeError}`);
    return result;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes('--verify')) {
  requireCondition(fs.existsSync(SOURCE_PATH), 'G00 runtime source proof missing');
  requireCondition(fs.existsSync(BAKE_PATH), 'G00 Terrain3D bake proof missing');
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
  const bake = JSON.parse(fs.readFileSync(BAKE_PATH, 'utf8'));
  const terrain3d = compareBakeToSource(source, bake);
  const browser = await verifyBrowserAdapter(bake);
  console.log(`G00_RUNTIME_PARITY_METRICS=${JSON.stringify({ ...terrain3d, ...browser, bakeChecksum: bake.bakeChecksum })}`);
  console.log('NW_G00_TERRAIN3D_RUNTIME_PARITY_OK');
} else {
  writeSource();
}
