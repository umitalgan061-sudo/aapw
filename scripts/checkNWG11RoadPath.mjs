#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  buildG11RoadPathProbe,
  findG11CrossingEdges,
  measureG11RoadPath,
  sampleG11RoadPath,
  worldToNormalized,
} from '../godot/terrain-authoring/geocells/nw/g11_road_path.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch { /* next */ }
  }
  return null;
}

function startStaticServer() {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
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
        return {
          id: seat.id,
          x,
          z,
          rawHeight: baseSampleHeightMeters(x, z),
          groundY: sampleHeightMeters(x, z),
        };
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
          x: pad.x,
          z: pad.z,
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
const metrics = measureG11RoadPath(runtimeNetwork);
const crossings = findG11CrossingEdges(runtimeNetwork);
const crossingKeys = new Set(crossings.filter((edge) => edge.tier === 'road').map((edge) => [edge.fromId, edge.toId].sort().join('|')));

for (const expected of [['berkalp', 'jon'], ['jon', 'Night King']]) {
  const key = [...expected].sort().join('|');
  if (!crossingKeys.has(key)) throw new Error(`real runtime road ${key} no longer crosses G11`);
}
if (metrics.hydrologyFingerprint.waterCells !== 38 || metrics.hydrologyFingerprint.landCells !== 58 || metrics.hydrologyFingerprint.boundaryEdges !== 39 || metrics.hydrologyFingerprint.centreMismatches !== 0) {
  throw new Error(`G11 hydrology fingerprint drifted: ${JSON.stringify(metrics.hydrologyFingerprint)}`);
}
if (metrics.sourceSamples !== 66049) throw new Error(`expected 257x257 road authoring grid, got ${metrics.sourceSamples}`);
if (metrics.activeRoadSamples < 20) throw new Error(`real G11 road corridor is undersampled: ${metrics.activeRoadSamples}`);
if (metrics.maxAdjacentCoverageStep > 0.82) throw new Error(`road corridor has an abrupt adjacent coverage jump: ${metrics.maxAdjacentCoverageStep}`);
if (metrics.maxGuardBandCoverageDelta > 0.82) throw new Error(`road corridor has an abrupt guard-band jump: ${metrics.maxGuardBandCoverageDelta}`);
if (metrics.maxCanonicalWaterCoverageOutsideSettlement > 0.000001) {
  throw new Error(`road surface leaked onto canonical water outside settlement-safe pads: ${metrics.maxCanonicalWaterCoverageOutsideSettlement}`);
}

const jon = runtimeNetwork.seats.find((seat) => seat.id === 'jon');
if (!jon) throw new Error('Jon Snow seat missing from runtime network');
if (!(jon.rawHeight > runtimeNetwork.waterLevelMeters)) {
  throw new Error(`Jon raw runtime terrain is not above sea level: ${jon.rawHeight} <= ${runtimeNetwork.waterLevelMeters}`);
}
const jonNormalized = worldToNormalized(jon.x, jon.z, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
const jonSample = sampleG11RoadPath(jonNormalized.x, jonNormalized.y, runtimeNetwork);
if (jonSample.settlementLandSupport < 0.99) {
  throw new Error(`existing settlement flatten-pad contract does not fully protect Jon: ${jonSample.settlementLandSupport}`);
}
if (jonSample.roadCoverage < 0.9) throw new Error(`runtime Jon road hub lost surface coverage: ${jonSample.roadCoverage}`);

const jonEvidence = Object.freeze({
  rawHeight: Number(jon.rawHeight.toFixed(8)),
  flattenedGroundY: Number(jon.groundY.toFixed(8)),
  waterLevelMeters: runtimeNetwork.waterLevelMeters,
  canonicalWaterConfidence: Number(jonSample.waterConfidence.toFixed(8)),
  settlementLandSupport: Number(jonSample.settlementLandSupport.toFixed(8)),
  roadCoverage: Number(jonSample.roadCoverage.toFixed(8)),
});

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const probe = buildG11RoadPathProbe(runtimeNetwork);
  fs.writeFileSync(output, `${JSON.stringify({ ...probe, jonEvidence, metrics })}\n`);
}

console.log(`NW_G11_ROAD_PATH_METRICS=${JSON.stringify({ ...metrics, jonEvidence })}`);
console.log('NW_G11_ROAD_PATH_VALIDATION_OK');
