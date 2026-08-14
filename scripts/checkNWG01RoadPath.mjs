#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  G01_ROAD_PATH_POLICY,
  buildG01RoadPathProbe,
  findG01InfluencingEdges,
  measureG01RoadPath,
  worldToNormalized,
} from '../godot/terrain-authoring/geocells/nw/g01_road_path.mjs';

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
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
  };
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
const first = measureG01RoadPath(runtimeNetwork);
const second = measureG01RoadPath(runtimeNetwork);
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G01 live road/path metrics must be deterministic');
const influencingEdges = findG01InfluencingEdges(runtimeNetwork);
if (JSON.stringify(influencingEdges) !== JSON.stringify(first.influencingEdges)) throw new Error('G01 influencing-edge discovery drifted');

const fingerprint = first.hydrologyFingerprint;
if (fingerprint.waterCells !== 88 || fingerprint.landCells !== 8 || fingerprint.centreMismatches !== 0) {
  throw new Error(`G01 relief/hydrology fingerprint drifted: ${JSON.stringify(fingerprint)}`);
}
if (first.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') {
  throw new Error(`map.png provenance drifted: ${first.sourceMapSha256}`);
}
if (first.sourceSamples !== 66049) throw new Error(`expected 257x257 road authoring grid, got ${first.sourceSamples}`);
if (first.maxAdjacentCoverageStep > 0.82) throw new Error(`G01 road/path corridor has abrupt adjacent coverage: ${first.maxAdjacentCoverageStep}`);
if (first.maxGuardBandCoverageDelta > 0.82) throw new Error(`G01 road/path guard-band seam is abrupt: ${first.maxGuardBandCoverageDelta}`);
if (first.maxCanonicalWaterCoverageOutsideSettlement > 0.000001) {
  throw new Error(`G01 road/path surface leaked onto canonical water outside settlement-safe pads: ${first.maxCanonicalWaterCoverageOutsideSettlement}`);
}
if (first.maxNoRoadHeightDelta > 0.0000001 || first.maxNoRoadSubstrateDelta > 0.0000001) {
  throw new Error(`G01 road-free substrate was modified: height=${first.maxNoRoadHeightDelta} surface=${first.maxNoRoadSubstrateDelta}`);
}
const hasRoadInfluence = influencingEdges.some((edge) => edge.tier === 'road');
const hasPathInfluence = influencingEdges.some((edge) => edge.tier === 'path');
if (first.activeRoadSamples > 0 && !hasRoadInfluence) throw new Error('active G01 road material exists without a live runtime road corridor influence');
if (first.activePathSamples > 0 && !hasPathInfluence) throw new Error('active G01 path material exists without a live runtime footpath corridor influence');
if (!hasRoadInfluence && first.activeRoadSamples !== 0) throw new Error('G01 invented road coverage without a live influencing road');
if (!hasPathInfluence && first.activePathSamples !== 0) throw new Error('G01 invented path coverage without a live influencing footpath');
if (influencingEdges.length === 0 && (first.activeRoadSamples !== 0 || first.activePathSamples !== 0)) {
  throw new Error('road-free G01 must preserve its substrate without phantom corridor samples');
}

const bounds = G01_ROAD_PATH_POLICY.normalizedBounds;
const seatsInCell = runtimeNetwork.seats.flatMap((seat) => {
  const normalized = worldToNormalized(seat.x, seat.z, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
  return normalized.x >= bounds.xMin && normalized.x <= bounds.xMax && normalized.y >= bounds.yMin && normalized.y <= bounds.yMax
    ? [{
      id: seat.id,
      x: Number(normalized.x.toFixed(8)),
      y: Number(normalized.y.toFixed(8)),
      rawHeight: Number(seat.rawHeight.toFixed(8)),
      groundY: Number(seat.groundY.toFixed(8)),
    }]
    : [];
});

const probeA = buildG01RoadPathProbe(runtimeNetwork);
const probeB = buildG01RoadPathProbe(runtimeNetwork);
if (JSON.stringify(probeA) !== JSON.stringify(probeB)) throw new Error('G01 road/path probe must be deterministic');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = path.resolve(emitArg.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ ...probeA, seatsInCell })}\n`, 'utf8');
  console.log(`NW_G01_ROAD_PATH_PROBE=${output}`);
}
console.log(`NW_G01_ROAD_PATH_METRICS=${JSON.stringify({ ...first, seatsInCell })}`);
console.log('NW_G01_ROAD_PATH_VALIDATION_OK');
