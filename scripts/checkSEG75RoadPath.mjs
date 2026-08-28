#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  G75_ROAD_PATH_POLICY,
  buildG75RoadPathProbe,
  canonicalRoadNetworkMaxNormalizedX,
  measureG75RoadPath,
} from '../godot/terrain-authoring/geocells/se/g75_road_path.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_SOURCE_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function fail(message) {
  console.error(`[checkSEG75RoadPath] FAIL: ${message}`);
  process.exit(1);
}
function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function loadPlaywright() {
  const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright'];
  for (const id of candidates) {
    try {
      return require(id);
    } catch {
      // Try next supported runner location.
    }
  }
  return null;
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
      if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function readCanonicalRoadEnvelopeContract() {
  const settlements = fs.readFileSync(path.join(ROOT, 'src/3d/world/settlements.js'), 'utf8');
  const seatXs = [...settlements.matchAll(/mapX:\s*([0-9]+(?:\.[0-9]+)?)/g)].map((match) => Number(match[1]));
  requireCondition(seatXs.length >= 14, `expected at least 14 numeric KINGDOM_SEATS mapX values, got ${seatXs.length}`);
  const maxSeatMapX = Math.max(...seatXs);
  const pathfinder = fs.readFileSync(path.join(ROOT, 'src/3d/world/roadPathfinder.js'), 'utf8');
  const paddingMatch = pathfinder.match(/const\s+CORRIDOR_PADDING_METERS\s*=\s*([0-9]+(?:\.[0-9]+)?)/);
  requireCondition(Boolean(paddingMatch), 'could not read roadPathfinder CORRIDOR_PADDING_METERS');
  return { maxSeatMapX, corridorPaddingMeters: Number(paddingMatch[1]) };
}

async function buildRuntimeNetwork() {
  const playwright = loadPlaywright();
  requireCondition(Boolean(playwright), 'Playwright is required for the real runtime road projection proof');
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    return await page.evaluate(async () => {
      const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
      const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
      const { createHeightSampler } = await import('/src/3d/world/terrain.js');
      const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
      const natural = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
      const pads = computeSettlementFlattenPads({
        sampleHeightMeters: natural,
        seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
        mapBounds: WORLD_SCALE.MAP_BOUNDS,
        metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
      });
      const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
      const seats = KINGDOM_SEATS.map((seat) => {
        const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
        return { id: seat.id, x, z, groundY: sampleHeightMeters(x, z) };
      });
      const network = buildRoadNetwork({ seats, sampleHeightMeters });
      const serialize = (edges) => edges.map((edge) => ({
        fromId: edge.fromId,
        toId: edge.toId,
        points: edge.points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
      }));
      return {
        mapBounds: { ...WORLD_SCALE.MAP_BOUNDS },
        metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
        mainEdges: serialize(network.edges),
        footpathEdges: serialize(network.footpathEdges ?? []),
      };
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const contract = readCanonicalRoadEnvelopeContract();
requireCondition(contract.maxSeatMapX === G75_ROAD_PATH_POLICY.canonicalMaxSeatMapX, `KINGDOM_SEATS eastern envelope changed: ${contract.maxSeatMapX}`);
requireCondition(contract.corridorPaddingMeters === G75_ROAD_PATH_POLICY.canonicalRouteCorridorPaddingMeters, `roadPathfinder corridor padding changed: ${contract.corridorPaddingMeters}`);
requireCondition(G75_ROAD_PATH_POLICY.sourceMapSha256 === EXPECTED_SOURCE_SHA, 'canonical map SHA changed');
requireCondition(canonicalRoadNetworkMaxNormalizedX() < G75_ROAD_PATH_POLICY.normalizedBounds.xMin, 'full-reference canonical road search envelope now reaches G75');

const runtimeNetwork = await buildRuntimeNetwork();
requireCondition(runtimeNetwork.mainEdges.length === 13, `runtime road backbone changed from 13 MST edges to ${runtimeNetwork.mainEdges.length}`);
const metrics = measureG75RoadPath(runtimeNetwork);
requireCondition(metrics.crossingEdges.length === 0, `real runtime road/path now intersects G75: ${JSON.stringify(metrics.crossingEdges)}`);
requireCondition(metrics.runtimeRoadReferenceEnvelope.maxX < G75_ROAD_PATH_POLICY.normalizedBounds.xMin, 'runtime road envelope reaches G75 east boundary');
requireCondition(metrics.canonicalWaterCells === 0 && metrics.canonicalLandCells === 96, 'G75 canonical 96-cell dry-land contract changed');
requireCondition(metrics.activeRoadSamples === 0, 'phantom cart-road paint appeared in road-free G75');
requireCondition(metrics.activePathSamples === 0, 'phantom footpath paint appeared in road-free G75');
requireCondition(metrics.maxAdjacentCoverageStep === 0, 'road-free G75 developed local coverage steps');
requireCondition(metrics.maxGuardBandCoverageDelta === 0, 'road/path guard-band discontinuity appeared');
requireCondition(metrics.maxHeightDeltaMeters === 0, 'Road/Path altered merged Relief height without a real road');
requireCondition(metrics.maxSurfaceDelta === 0, 'Road/Path altered merged Rock/Snow surface without a real road');
requireCondition(metrics.canonicalRoadExclusionMarginMeters > 1000, `canonical road exclusion margin unexpectedly small: ${metrics.canonicalRoadExclusionMarginMeters}m`);
requireCondition(metrics.sourceSamples === 257 * 257, 'expected deterministic 257x257 road-coverage qualification grid');

const summary = {
  policyId: metrics.policyId,
  sourceMapSha256: metrics.sourceMapSha256,
  geoCell: metrics.geoCell,
  layer: metrics.layer,
  runtimeMainEdges: runtimeNetwork.mainEdges.length,
  runtimeFootpathEdges: runtimeNetwork.footpathEdges.length,
  runtimeRoadPoints: metrics.runtimeRoadReferenceEnvelope.points,
  runtimeRoadEnvelopeMaxX: metrics.runtimeRoadReferenceEnvelope.maxX,
  canonicalMaxSeatMapX: contract.maxSeatMapX,
  canonicalRouteCorridorPaddingMeters: contract.corridorPaddingMeters,
  canonicalRoadNetworkMaxNormalizedX: metrics.canonicalRoadNetworkMaxNormalizedX,
  g75NormalizedXMin: G75_ROAD_PATH_POLICY.normalizedBounds.xMin,
  canonicalRoadExclusionMarginMeters: metrics.canonicalRoadExclusionMarginMeters,
  canonicalLandCells: metrics.canonicalLandCells,
  canonicalWaterCells: metrics.canonicalWaterCells,
  crossingEdges: metrics.crossingEdges.length,
  sourceSamples: metrics.sourceSamples,
  activeRoadSamples: metrics.activeRoadSamples,
  activePathSamples: metrics.activePathSamples,
  maxHeightDeltaMeters: metrics.maxHeightDeltaMeters,
  maxSurfaceDelta: metrics.maxSurfaceDelta,
  maxGuardBandCoverageDelta: metrics.maxGuardBandCoverageDelta,
  coverageChecksum: metrics.coverageChecksum,
};
console.log(`G75_ROAD_PATH_METRICS=${JSON.stringify(summary)}`);
console.log('SE_G75_ROAD_PATH_VALIDATION_OK');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const destination = emitArg.slice('--emit-probe='.length);
  const absolute = path.resolve(ROOT, destination);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(buildG75RoadPathProbe(runtimeNetwork))}\n`, 'utf8');
}
