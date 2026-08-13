#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  buildG75RoadPathProbe,
  measureG75RoadPath,
} from '../godot/terrain-authoring/geocells/se/g75_road_path.mjs';

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
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
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
  if (!playwright) throw new Error('Playwright is required to inspect the shipped runtime road network');
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

      const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
      const pads = computeSettlementFlattenPads({
        sampleHeightMeters: base,
        seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
        mapBounds: WORLD_SCALE.MAP_BOUNDS,
        metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
      });
      const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
      const seats = KINGDOM_SEATS.map((seat) => {
        const p = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
        return { id: seat.id, x: p.x, z: p.z, groundY: sampleHeightMeters(p.x, p.z) };
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
        mainEdges: network.edges.map(pack),
        footpathEdges: network.footpathEdges.map(pack),
        seatCount: seats.length,
      };
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const runtimeNetwork = await readLiveRoadNetwork();
const a = measureG75RoadPath(runtimeNetwork);
const b = measureG75RoadPath(runtimeNetwork);

if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('G75 Road/Path field is not deterministic');
if (runtimeNetwork.seatCount !== 14) throw new Error(`runtime seat count drifted: ${runtimeNetwork.seatCount}`);
if (a.canonicalWaterCells !== 0 || a.canonicalLandCells !== 96) {
  throw new Error(`G75 canonical hydrology drifted: ${a.canonicalWaterCells} water / ${a.canonicalLandCells} land`);
}
if (a.runtimeRoadReferenceEnvelope.points <= 0) throw new Error('runtime road network produced no polyline points');
if (a.crossingEdges.length !== 0) {
  throw new Error(`live runtime road/path entered owner-map G75: ${JSON.stringify(a.crossingEdges)}`);
}
if (a.activeRoadSamples !== 0 || a.activePathSamples !== 0) throw new Error('G75 invented road/path surface coverage');
if (a.maxAdjacentCoverageStep !== 0 || a.maxGuardBandCoverageDelta !== 0) {
  throw new Error('G75 zero road/path field gained an internal or guard-band seam');
}
if (a.sourceSamples !== 66049) throw new Error(`expected 257x257 source field, got ${a.sourceSamples}`);
if (a.heightGridSize !== 65) throw new Error(`expected 65x65 merged-relief source, got ${a.heightGridSize}`);

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(buildG75RoadPathProbe(runtimeNetwork))}\n`);
}

console.log(`SE_G75_ROAD_PATH_METRICS=${JSON.stringify(a)}`);
console.log('SE_G75_ROAD_PATH_VALIDATION_OK');
