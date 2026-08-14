#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sampleG70NearDetail } from '../godot/terrain-authoring/geocells/ne/g70_near_detail.mjs';
import {
  G70_TERRAIN3D_RUNTIME_PARITY,
} from '../src/3d/world/g70Terrain3dRuntimeAdapter.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_DIR = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const SOURCE_PATH = path.join(PROOF_DIR, 'g70-runtime-source.json');
const BAKE_PATH = path.join(PROOF_DIR, 'g70-runtime-bake.json');
const SOURCE_SIZE = G70_TERRAIN3D_RUNTIME_PARITY.sourceSize;
const HEIGHT_TOLERANCE = 0.012;
const UNIT_TOLERANCE = 0.006;

function fail(message) {
  console.error(`[checkNEG70Terrain3DRuntimeParity] FAIL: ${message}`);
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
  const bounds = G70_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
  const payload = {
    schema: 'westeros-g70-terrain3d-source-v1',
    policyId: G70_TERRAIN3D_RUNTIME_PARITY.id,
    sourceMapSha256: G70_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256,
    terrain3dVersion: G70_TERRAIN3D_RUNTIME_PARITY.terrain3dVersion,
    width: SOURCE_SIZE,
    height: SOURCE_SIZE,
    normalizedBounds: bounds,
    heights: [],
    snowWeight: [],
    tintR: [], tintG: [], tintB: [], roughness: [],
  };
  let canonicalSeaSamples = 0;
  let maxSnowWeight = 0;
  let maxRoadCoverage = 0;
  let maxFoliageDensity = 0;
  for (let y = 0; y < SOURCE_SIZE; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / (SOURCE_SIZE - 1);
    for (let x = 0; x < SOURCE_SIZE; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / (SOURCE_SIZE - 1);
      const sample = sampleG70NearDetail(nx, ny);
      const fields = [sample.authoredHeight, sample.snowWeight, sample.tintR, sample.tintG, sample.tintB, sample.roughness];
      requireCondition(fields.every(Number.isFinite), `non-finite G70 source at ${x},${y}`);
      requireCondition(sample.water === true && sample.body === 'sea', `G70 invented non-sea geography at ${x},${y}`);
      canonicalSeaSamples += 1;
      maxSnowWeight = Math.max(maxSnowWeight, Math.abs(sample.snowWeight));
      maxRoadCoverage = Math.max(maxRoadCoverage, Math.abs(sample.coverage), Math.abs(sample.roadPathControlBlend));
      maxFoliageDensity = Math.max(maxFoliageDensity, Math.abs(sample.foliageDensity));
      payload.heights.push(round(sample.authoredHeight, 6));
      payload.snowWeight.push(round(sample.snowWeight));
      payload.tintR.push(round(sample.tintR));
      payload.tintG.push(round(sample.tintG));
      payload.tintB.push(round(sample.tintB));
      payload.roughness.push(round(sample.roughness));
    }
  }
  requireCondition(canonicalSeaSamples === SOURCE_SIZE * SOURCE_SIZE, 'G70 source is not full canonical sea');
  requireCondition(maxSnowWeight <= 1e-8, `G70 open-sea snow leakage ${maxSnowWeight}`);
  requireCondition(maxRoadCoverage <= 1e-8, `G70 open-sea road/path leakage ${maxRoadCoverage}`);
  requireCondition(maxFoliageDensity <= 1e-8, `G70 open-sea foliage leakage ${maxFoliageDensity}`);
  payload.semanticMetrics = { canonicalSeaSamples, maxSnowWeight, maxRoadCoverage, maxFoliageDensity };
  payload.sourceChecksum = checksumNumbers([
    ...payload.heights, ...payload.snowWeight,
    ...payload.tintR, ...payload.tintG, ...payload.tintB, ...payload.roughness,
  ]);
  return payload;
}

function writeSource() {
  fs.mkdirSync(PROOF_DIR, { recursive: true });
  const source = buildSource();
  fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(source)}\n`, 'utf8');
  console.log(`G70_RUNTIME_SOURCE_METRICS=${JSON.stringify({
    samples: source.width * source.height,
    sourceChecksum: source.sourceChecksum,
    minHeight: Math.min(...source.heights), maxHeight: Math.max(...source.heights),
    minRoughness: Math.min(...source.roughness), maxRoughness: Math.max(...source.roughness),
    ...source.semanticMetrics,
  })}`);
  console.log('NE_G70_RUNTIME_PARITY_SOURCE_OK');
}

function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch { /* try next runner location */ }
  }
  return null;
}

function startStaticServer() {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };
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
  requireCondition(bake.schema === 'westeros-g70-terrain3d-bake-v1', `unexpected bake schema ${bake.schema}`);
  requireCondition(bake.policyId === G70_TERRAIN3D_RUNTIME_PARITY.id, 'bake parity policy mismatch');
  requireCondition(bake.sourceMapSha256 === G70_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256, 'bake map.png provenance mismatch');
  requireCondition(bake.width === SOURCE_SIZE && bake.height === SOURCE_SIZE, 'bake dimensions changed');
  requireCondition(bake.regionCount >= 4, `257x257 import created only ${bake.regionCount} Terrain3D regions`);
  requireCondition(bake.savedRegionFiles >= 4, `Terrain3D persisted only ${bake.savedRegionFiles} region files`);
  requireCondition(bake.bakedVertices > 0, 'Terrain3D LOD0 bake returned no vertices');
  requireCondition(bake.boundaryProbeMaxHeightError <= HEIGHT_TOLERANCE, `255/256 height error ${bake.boundaryProbeMaxHeightError}`);
  let maxHeightError = 0, maxSnowError = 0, maxColorError = 0, maxRoughnessError = 0;
  for (let i = 0; i < SOURCE_SIZE * SOURCE_SIZE; i += 1) {
    maxHeightError = Math.max(maxHeightError, Math.abs(bake.heights[i] - source.heights[i]));
    maxSnowError = Math.max(maxSnowError, Math.abs(bake.snowWeight[i] - source.snowWeight[i]));
    maxColorError = Math.max(maxColorError, Math.abs(bake.tintR[i] - source.tintR[i]), Math.abs(bake.tintG[i] - source.tintG[i]), Math.abs(bake.tintB[i] - source.tintB[i]));
    maxRoughnessError = Math.max(maxRoughnessError, Math.abs(bake.roughness[i] - source.roughness[i]));
  }
  requireCondition(maxHeightError <= HEIGHT_TOLERANCE, `Terrain3D height parity error ${maxHeightError}`);
  requireCondition(maxSnowError <= UNIT_TOLERANCE, `Terrain3D snow parity error ${maxSnowError}`);
  requireCondition(maxColorError <= UNIT_TOLERANCE, `Terrain3D color parity error ${maxColorError}`);
  requireCondition(maxRoughnessError <= UNIT_TOLERANCE, `Terrain3D roughness parity error ${maxRoughnessError}`);
  return { maxHeightError, maxSnowError, maxColorError, maxRoughnessError };
}

async function verifyBrowserAdapter(bake) {
  const playwright = loadPlaywright();
  requireCondition(Boolean(playwright), 'Playwright is required for Three.js runtime parity');
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const result = await page.evaluate(async (payload) => {
      const { G70_TERRAIN3D_RUNTIME_PARITY, createG70Terrain3DWorldSampler } = await import('/src/3d/world/g70Terrain3dRuntimeAdapter.js');
      const { WORLD_SCALE } = await import('/src/3d/config.js');
      const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js');
      const sampler = createG70Terrain3DWorldSampler(payload, { mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
      const b = G70_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
      let maxNodeError = 0, finiteSamples = 0, checksum = 2166136261;
      for (let y = 0; y < payload.height; y += 1) for (let x = 0; x < payload.width; x += 1) {
        const nx = b.xMin + (b.xMax - b.xMin) * x / (payload.width - 1);
        const ny = b.yMin + (b.yMax - b.yMin) * y / (payload.height - 1);
        const world = normalizedReferenceToWorldXZ(nx, ny, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
        const sample = sampler(world.x, world.z);
        const i = y * payload.width + x;
        const fields = [sample.heightMeters, sample.snowWeight, sample.tintR, sample.tintG, sample.tintB, sample.roughness];
        if (!fields.every(Number.isFinite)) return { error: `non-finite browser sample at ${x},${y}` };
        maxNodeError = Math.max(maxNodeError,
          Math.abs(sample.heightMeters - payload.heights[i]), Math.abs(sample.snowWeight - payload.snowWeight[i]),
          Math.abs(sample.tintR - payload.tintR[i]), Math.abs(sample.tintG - payload.tintG[i]),
          Math.abs(sample.tintB - payload.tintB[i]), Math.abs(sample.roughness - payload.roughness[i]));
        for (const value of fields) { const q = Math.round(value * 10000); checksum ^= q & 0xff; checksum = Math.imul(checksum, 16777619) >>> 0; }
        finiteSamples += 1;
      }
      return { finiteSamples, maxNodeError, checksum };
    }, bake);
    requireCondition(!result.error, result.error ?? 'unknown browser adapter failure');
    requireCondition(errors.length === 0, `browser page errors: ${errors.join(' | ')}`);
    requireCondition(result.finiteSamples === SOURCE_SIZE * SOURCE_SIZE, `browser sampled ${result.finiteSamples} points`);
    requireCondition(result.maxNodeError <= 1e-7, `browser exact-node error ${result.maxNodeError}`);
    return result;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes('--verify')) {
  requireCondition(fs.existsSync(SOURCE_PATH), 'runtime source proof missing');
  requireCondition(fs.existsSync(BAKE_PATH), 'Terrain3D bake proof missing');
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
  const bake = JSON.parse(fs.readFileSync(BAKE_PATH, 'utf8'));
  const terrain3d = compareBakeToSource(source, bake);
  const browser = await verifyBrowserAdapter(bake);
  console.log(`G70_RUNTIME_PARITY_METRICS=${JSON.stringify({ ...terrain3d, ...browser, bakeChecksum: bake.bakeChecksum })}`);
  console.log('NE_G70_TERRAIN3D_RUNTIME_PARITY_OK');
} else {
  writeSource();
}
