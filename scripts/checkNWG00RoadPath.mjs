#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  WORLD_REFERENCE_ALIGNMENT,
  normalizedReferenceToWorldXZ,
  worldXZToNormalizedReference,
} from '../src/3d/world/worldReferenceAlignment.js';
import {
  G00_ROAD_PATH_POLICY,
  buildG00RoadPathProbe,
  findG00CrossingEdges,
  measureG00RoadPath,
  normalizedToWorld,
  worldToNormalized,
} from '../godot/terrain-authoring/geocells/nw/g00_road_path.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch { /* next candidate */ }
  }
  return null;
}

function startStaticServer() {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
      if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      res.writeHead(200, { 'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500); res.end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function readLiveRoadNetwork() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright is required to inspect the real live road network');
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    return await page.evaluate(async () => {
      const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
      const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
      const { createHeightSampler } = await import('/src/3d/world/terrain.js');
      const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
      const baseSampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
      const flattenPads = computeSettlementFlattenPads({
        sampleHeightMeters: baseSampleHeightMeters,
        seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
        mapBounds: WORLD_SCALE.MAP_BOUNDS,
        metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
      });
      const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
      const seats = KINGDOM_SEATS.map((seat) => {
        const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
        return { id: seat.id, x, z, rawHeight: baseSampleHeightMeters(x, z), groundY: sampleHeightMeters(x, z) };
      });
      const network = buildRoadNetwork({ seats, sampleHeightMeters });
      const pack = (edge) => ({
        fromId: edge.fromId,
        toId: edge.toId,
        points: edge.points.map((p) => ({ x: p.x, z: p.z })),
        lengthMeters: edge.lengthMeters,
        maxGradeDegrees: edge.maxGradeDegrees,
      });
      return {
        mapBounds: { ...WORLD_SCALE.MAP_BOUNDS },
        metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
        waterLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        settlementPads: flattenPads.map((pad) => ({
          x: pad.x, z: pad.z,
          innerRadiusMeters: pad.innerRadiusMeters,
          outerRadiusMeters: pad.outerRadiusMeters,
          anchorHeightMeters: pad.anchorHeightMeters,
        })),
        mainEdges: network.edges.map(pack),
        footpathEdges: network.footpathEdges.map(pack),
        seats,
      };
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const runtimeNetwork = await readLiveRoadNetwork();
const bounds = G00_ROAD_PATH_POLICY.normalizedBounds;
const centerMapX = (runtimeNetwork.mapBounds.minX + runtimeNetwork.mapBounds.maxX) * 0.5;
const centerMapY = (runtimeNetwork.mapBounds.minY + runtimeNetwork.mapBounds.maxY) * 0.5;
for (const [nx, ny] of [
  [bounds.xMin, bounds.yMin],
  [bounds.xMax, bounds.yMax],
  [(bounds.xMin + bounds.xMax) * 0.5, (bounds.yMin + bounds.yMax) * 0.5],
]) {
  const actual = normalizedToWorld(nx, ny, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
  const canonical = normalizedReferenceToWorldXZ(nx, ny, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
  if (Math.abs(actual.x - canonical.x) > 1e-9 || Math.abs(actual.z - canonical.z) > 1e-9) {
    throw new Error(`G00 normalized→world escaped canonical owner-map transform at ${nx}/${ny}`);
  }
  const ownerMapX = actual.x / runtimeNetwork.metersPerMapUnit + centerMapX;
  const ownerMapY = actual.z / runtimeNetwork.metersPerMapUnit + centerMapY;
  const expectedMapX = nx * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
  const expectedMapY = ny * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
  if (Math.abs(ownerMapX - expectedMapX) > 1e-9 || Math.abs(ownerMapY - expectedMapY) > 1e-9) {
    throw new Error(`G00 owner-map canvas alignment drifted: ${ownerMapX}/${ownerMapY} != ${expectedMapX}/${expectedMapY}`);
  }
  const inverse = worldToNormalized(actual.x, actual.z, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
  const canonicalInverse = worldXZToNormalizedReference(actual.x, actual.z, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
  if (Math.abs(inverse.x - nx) > 1e-12 || Math.abs(inverse.y - ny) > 1e-12 || Math.abs(inverse.x - canonicalInverse.x) > 1e-12 || Math.abs(inverse.y - canonicalInverse.y) > 1e-12) {
    throw new Error(`G00 world→normalized owner-map roundtrip drifted at ${nx}/${ny}`);
  }
}

const metrics = measureG00RoadPath(runtimeNetwork);
const crossings = findG00CrossingEdges(runtimeNetwork);
const fingerprint = metrics.hydrologyFingerprint;

if (fingerprint.waterCells !== 60 || fingerprint.landCells !== 36 || fingerprint.centreMismatches !== 0) {
  throw new Error(`G00 hydrology fingerprint drifted: ${JSON.stringify(fingerprint)}`);
}
if (metrics.sourceSamples !== 66049) throw new Error(`expected 257x257 road authoring grid, got ${metrics.sourceSamples}`);
if (metrics.maxAdjacentCoverageStep > 0.82) throw new Error(`road/path corridor has abrupt adjacent coverage: ${metrics.maxAdjacentCoverageStep}`);
if (metrics.maxGuardBandCoverageDelta > 0.82) throw new Error(`road/path guard-band seam is abrupt: ${metrics.maxGuardBandCoverageDelta}`);
if (metrics.maxCanonicalWaterCoverageOutsideSettlement > 0.000001) {
  throw new Error(`road/path surface leaked onto canonical water outside settlement-safe pads: ${metrics.maxCanonicalWaterCoverageOutsideSettlement}`);
}
if (metrics.activeRoadSamples > 0 && !crossings.some((edge) => edge.tier === 'road')) {
  throw new Error('active G00 road material exists without a live runtime road crossing');
}
if (metrics.activePathSamples > 0 && !crossings.some((edge) => edge.tier === 'path')) {
  throw new Error('active G00 path material exists without a live runtime footpath crossing');
}
if (crossings.some((edge) => edge.tier === 'road') && metrics.activeRoadSamples === 0) {
  throw new Error('live runtime road crosses G00 but no road material was authored');
}
if (crossings.some((edge) => edge.tier === 'path') && metrics.activePathSamples === 0) {
  throw new Error('live runtime footpath crosses G00 but no path material was authored');
}

const seatsInCell = runtimeNetwork.seats.flatMap((seat) => {
  const normalized = worldToNormalized(seat.x, seat.z, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
  return normalized.x >= bounds.xMin && normalized.x <= bounds.xMax && normalized.y >= bounds.yMin && normalized.y <= bounds.yMax
    ? [{ id: seat.id, x: Number(normalized.x.toFixed(8)), y: Number(normalized.y.toFixed(8)), rawHeight: Number(seat.rawHeight.toFixed(8)), groundY: Number(seat.groundY.toFixed(8)) }]
    : [];
});

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ ...buildG00RoadPathProbe(runtimeNetwork), seatsInCell })}\n`);
}

console.log(`NW_G00_ROAD_PATH_METRICS=${JSON.stringify({ ...metrics, seatsInCell })}`);
console.log('NW_G00_ROAD_PATH_VALIDATION_OK');
