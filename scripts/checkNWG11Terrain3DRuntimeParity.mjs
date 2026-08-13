#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');
const mode = process.argv.includes('--verify') ? 'verify' : 'emit';
const probePath = 'godot/terrain-authoring/.terrain3d-proof/g11-runtime-source.json';
const bakePath = 'godot/terrain-authoring/.terrain3d-proof/g11-runtime-bake.json';
const W = 65, H = 65;
const SOURCE_MAP_SHA256 = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const bounds = { minX: 1 / 8, maxX: 2 / 8, minY: 1 / 8, maxY: 2 / 8 };
function checksum(values) { const h = crypto.createHash('sha256'); for (const v of values) { const b = Buffer.allocUnsafe(4); b.writeFloatLE(v); h.update(b); } return h.digest('hex'); }
function assertFiniteArray(values, label) { for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) throw new Error(`${label}[${i}] is not finite`); }
async function emit() {
  const playwright = loadPlaywright(); if (!playwright) throw new Error('Playwright unavailable');
  const server = await startStaticServer(); const { port } = server.address(); const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const payload = await page.evaluate(async ({ W, H, bounds }) => {
      const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
      const { computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
      const { createHeightSampler } = await import('/src/3d/world/terrain.js');
      const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js');
      const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
      const pads = computeSettlementFlattenPads({ sampleHeightMeters: base, seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS, minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS, mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
      const sample = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads); const heights = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const nx = bounds.minX + (bounds.maxX - bounds.minX) * x / (W - 1); const ny = bounds.minY + (bounds.maxY - bounds.minY) * y / (H - 1); const p = normalizedReferenceToWorldXZ(nx, ny, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT); heights.push(sample(p.x, p.z)); }
      return { heights, seed: WORLD_DEFAULTS.WORLD_SEED };
    }, { W, H, bounds });
    assertFiniteArray(payload.heights, 'Three.js source height');
    fs.mkdirSync('godot/terrain-authoring/.terrain3d-proof', { recursive: true });
    const out = { schema: 'westeros-g11-runtime-source-v1', width: W, height: H, normalizedBounds: bounds, sourceMapSha256: SOURCE_MAP_SHA256, ...payload };
    fs.writeFileSync(probePath, JSON.stringify(out)); console.log(`NW_G11_PARITY_SOURCE_OK checksum=${checksum(out.heights)}`);
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
}
async function verify() {
  const source = JSON.parse(fs.readFileSync(probePath, 'utf8')); const bake = JSON.parse(fs.readFileSync(bakePath, 'utf8'));
  if (bake.schema !== 'westeros-g11-terrain3d-bake-v1') throw new Error('unexpected bake schema');
  if (source.sourceMapSha256 !== SOURCE_MAP_SHA256 || bake.sourceMapSha256 !== SOURCE_MAP_SHA256) throw new Error('map.png provenance mismatch');
  if (source.width !== bake.width || source.height !== bake.height) throw new Error('dimension mismatch');
  assertFiniteArray(source.heights, 'source height'); assertFiniteArray(bake.heights, 'bake height');
  let max = 0, sum = 0; for (let i = 0; i < source.heights.length; i++) { const d = Math.abs(source.heights[i] - bake.heights[i]); max = Math.max(max, d); sum += d; }
  const mean = sum / source.heights.length;
  if (max > 0.01 || mean > 0.0025) throw new Error(`parity error max=${max} mean=${mean}`);
  if (!Number.isFinite(bake.maxRoundtripError) || bake.maxRoundtripError > 0.01) throw new Error(`Terrain3D roundtrip error ${bake.maxRoundtripError}`);
  if (!Number.isFinite(bake.meanRoundtripError) || bake.meanRoundtripError > 0.0025) throw new Error(`Terrain3D roundtrip mean error ${bake.meanRoundtripError}`);
  if (!Number.isFinite(bake.maxContinuousProbeError) || bake.maxContinuousProbeError > 0.01) throw new Error(`Terrain3D continuous probe error ${bake.maxContinuousProbeError}`);
  if (bake.importWidth !== 257 || bake.importHeight !== 257 || bake.sourceVertexStride !== 4) throw new Error('Terrain3D guard-backed import geometry mismatch');
  if (!(bake.regionCount >= 4 && bake.boundaryGuardRegions >= 3 && bake.bakedSurfaces >= 1 && bake.bakedVertices > 0 && bake.savedRegionFiles >= 4 && bake.regionPersistenceNonEmpty === true)) throw new Error('Terrain3D provenance incomplete');
  const { createG11Terrain3DBakeSampler } = await import('../src/3d/world/worldReferenceTerrainAdapter.js');
  const sampleBake = createG11Terrain3DBakeSampler(bake);
  let runtimeMax = 0, runtimeSum = 0;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const nx = bounds.minX + (bounds.maxX - bounds.minX) * x / (source.width - 1);
    const ny = bounds.minY + (bounds.maxY - bounds.minY) * y / (source.height - 1);
    const actual = sampleBake(nx, ny);
    const d = Math.abs(actual - source.heights[y * source.width + x]);
    runtimeMax = Math.max(runtimeMax, d); runtimeSum += d;
  }
  const runtimeMean = runtimeSum / source.heights.length;
  if (runtimeMax > 0.01 || runtimeMean > 0.0025) throw new Error(`runtime adapter parity error max=${runtimeMax} mean=${runtimeMean}`);
  console.log(`NW_G11_TERRAIN3D_RUNTIME_PARITY_OK max=${max.toFixed(6)} mean=${mean.toFixed(6)} runtimeMax=${runtimeMax.toFixed(6)} runtimeMean=${runtimeMean.toFixed(6)} continuous=${bake.maxContinuousProbeError.toFixed(6)} source=${checksum(source.heights)} bake=${checksum(bake.heights)}`);
}
(mode === 'emit' ? emit() : Promise.resolve(verify())).catch(e => { console.error(e.stack || e); process.exit(1); });
