#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WORLD_REFERENCE_ALIGNMENT, normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  G77_ROAD_PATH_POLICY,
  buildG77RoadPathProbe,
  findG77CrossingEdges,
  measureG77RoadPath,
  normalizedToWorld,
  sampleG77RoadPath,
  worldToNormalized,
} from '../godot/terrain-authoring/geocells/se/g77_road_path.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} }
  throw new Error('Playwright is required for the shipped Road/Path proof');
}
function server() {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
  const s = http.createServer((req, res) => {
    const requestPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, requestPath === '/' ? '/index.html' : requestPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(s)));
}
async function readLiveRoadNetwork() {
  const s = await server(), browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${s.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return await page.evaluate(async () => {
      const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
      const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
      const { createHeightSampler } = await import('/src/3d/world/terrain.js');
      const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
      const raw = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
      const pads = computeSettlementFlattenPads({ sampleHeightMeters: raw, seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS, mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
      const height = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
      const seats = KINGDOM_SEATS.map((seat) => { const p = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT); return { id: seat.id, x: p.x, z: p.z, groundY: height(p.x, p.z) }; });
      const network = buildRoadNetwork({ seats, sampleHeightMeters: height });
      const pack = (edge) => ({ fromId: edge.fromId, toId: edge.toId, points: edge.points.map((p) => ({ x: p.x, z: p.z })), lengthMeters: edge.lengthMeters, maxGradeDegrees: edge.maxGradeDegrees });
      return { mapBounds: { ...WORLD_SCALE.MAP_BOUNDS }, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT, waterLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        settlementPads: pads.map((p) => ({ x: p.x, z: p.z, innerRadiusMeters: p.innerRadiusMeters, outerRadiusMeters: p.outerRadiusMeters, anchorHeightMeters: p.anchorHeightMeters })),
        mainEdges: network.edges.map(pack), footpathEdges: network.footpathEdges.map(pack), seats };
    });
  } finally { await browser.close(); await new Promise((resolve) => s.close(resolve)); }
}

const runtime = await readLiveRoadNetwork();
if (runtime.mainEdges.length < 13 || runtime.footpathEdges.length < 1) throw new Error(`live Road/Path graph incomplete: ${runtime.mainEdges.length}/${runtime.footpathEdges.length}`);
const b = G77_ROAD_PATH_POLICY.normalizedBounds;
for (const [nx, ny] of [[b.xMin, b.yMin], [b.xMax, b.yMax], [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2]]) {
  const actual = normalizedToWorld(nx, ny, runtime), expected = normalizedReferenceToWorldXZ(nx, ny, runtime.mapBounds, runtime.metersPerMapUnit);
  if (Math.abs(actual.x - expected.x) > 1e-9 || Math.abs(actual.z - expected.z) > 1e-9) throw new Error('G77 owner-map alignment drifted');
  const inverse = worldToNormalized(actual.x, actual.z, runtime);
  if (Math.abs(inverse.x - nx) > 1e-12 || Math.abs(inverse.y - ny) > 1e-12) throw new Error('G77 owner-map roundtrip drifted');
  const mapX = actual.x / runtime.metersPerMapUnit + (runtime.mapBounds.minX + runtime.mapBounds.maxX) / 2;
  const mapY = actual.z / runtime.metersPerMapUnit + (runtime.mapBounds.minY + runtime.mapBounds.maxY) / 2;
  if (Math.abs(mapX - nx * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits) > 1e-9 || Math.abs(mapY - ny * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits) > 1e-9) throw new Error('G77 canonical canvas alignment drifted');
}
for (const [nx, ny] of [[1 + 1e-6, .95], [.95, 1 + 1e-6]]) {
  let rejected = false; try { sampleG77RoadPath(nx, ny, runtime); } catch (e) { rejected = e instanceof RangeError; }
  if (!rejected) throw new Error(`G77 accepted sample beyond owner boundary: ${nx},${ny}`);
}

const metrics = measureG77RoadPath(runtime), crossings = findG77CrossingEdges(runtime);
if (metrics.canonicalWaterCells !== 44 || metrics.canonicalLandCells !== 52) throw new Error(`G77 canonical 44/52 fingerprint drifted: ${metrics.canonicalWaterCells}/${metrics.canonicalLandCells}`);
if (metrics.sourceSamples !== 66049) throw new Error(`expected 66,049 G77 Road/Path samples, got ${metrics.sourceSamples}`);
if (metrics.maxAdjacentCoverageStep > 0.82 || metrics.maxNorthWestGuardDelta > 0.82) throw new Error(`G77 Road/Path continuity failed: ${metrics.maxAdjacentCoverageStep}/${metrics.maxNorthWestGuardDelta}`);
if (metrics.maxCanonicalWaterCoverageOutsideSettlement > 0.000001) throw new Error(`G77 Road/Path leaked onto canonical water: ${metrics.maxCanonicalWaterCoverageOutsideSettlement}`);
if (metrics.maxHeightDeltaMeters > 0.000001 || metrics.maxSubstrateDeltaOffRoute > 0.000001) throw new Error(`G77 Road/Path changed predecessor surface: ${metrics.maxHeightDeltaMeters}/${metrics.maxSubstrateDeltaOffRoute}`);
const roadCross = crossings.some((e) => e.tier === 'road'), pathCross = crossings.some((e) => e.tier === 'path');
if ((metrics.activeRoadSamples > 0) !== roadCross) throw new Error(`G77 live road crossing/material mismatch: crossings=${roadCross} samples=${metrics.activeRoadSamples}`);
if ((metrics.activePathSamples > 0) !== pathCross) throw new Error(`G77 live path crossing/material mismatch: crossings=${pathCross} samples=${metrics.activePathSamples}`);

const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) { const out = emit.slice('--emit-probe='.length); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify(buildG77RoadPathProbe(runtime))}\n`); }
console.log(`SE_G77_ROAD_PATH_METRICS=${JSON.stringify({ ...metrics, mainEdges: runtime.mainEdges.length, footpathEdges: runtime.footpathEdges.length })}`);
console.log('SE_G77_ROAD_PATH_VALIDATION_OK');
