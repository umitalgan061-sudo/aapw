#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildG11NearDetailProbe, measureG11NearDetail } from '../godot/terrain-authoring/geocells/nw/g11_near_detail.mjs';

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

async function readLiveVegetation() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright is required to inspect the real runtime vegetation');
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    return await page.evaluate(async () => {
      const THREE = await import('three');
      const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
      const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG, CHUNK_CONFIG } = await import('/src/3d/config.js');
      const { createHeightSampler } = await import('/src/3d/world/terrain.js');
      const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
      const { createVegetation, disposeVegetation, distancePointToSegment2D } = await import('/src/3d/world/vegetation.js');

      const baseSample = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
      const flattenPads = computeSettlementFlattenPads({
        sampleHeightMeters: baseSample,
        seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
        mapBounds: WORLD_SCALE.MAP_BOUNDS,
        metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
      });
      const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
      const seats = KINGDOM_SEATS.map((seat) => {
        const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
        return { id: seat.id, x, z, groundY: sampleHeightMeters(x, z) };
      });
      const roads = buildRoadNetwork({ seats, sampleHeightMeters });
      const radiusMeters = CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS * CHUNK_CONFIG.CHUNK_SIZE_METERS;
      const vegetation = createVegetation({
        sampleHeightMeters,
        seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        seed: WORLD_DEFAULTS.WORLD_SEED,
        seats,
        roadEdges: roads.edges,
        radiusMeters,
      });

      const allRoadSegments = [];
      for (const edge of roads.edges) {
        for (let i = 1; i < edge.points.length; i += 1) allRoadSegments.push([edge.points[i - 1], edge.points[i]]);
      }
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const euler = new THREE.Euler(0, 0, 0, 'YXZ');
      const instances = [];
      const trunkIndices = [0, 2];
      const species = ['pine', 'round'];
      for (let s = 0; s < trunkIndices.length; s += 1) {
        const mesh = vegetation.group.children[trunkIndices[s]];
        for (let i = 0; i < mesh.count; i += 1) {
          mesh.getMatrixAt(i, matrix);
          matrix.decompose(position, quaternion, scale);
          euler.setFromQuaternion(quaternion, 'YXZ');
          let roadDistanceMeters = Infinity;
          for (const [a, b] of allRoadSegments) {
            roadDistanceMeters = Math.min(roadDistanceMeters, distancePointToSegment2D(position.x, position.z, a.x, a.z, b.x, b.z));
          }
          let seatDistanceMeters = Infinity;
          for (const seat of seats) seatDistanceMeters = Math.min(seatDistanceMeters, Math.hypot(position.x - seat.x, position.z - seat.z));
          instances.push({
            species: species[s],
            x: position.x, y: position.y, z: position.z,
            yaw: euler.y,
            scale: scale.x,
            roadDistanceMeters,
            seatDistanceMeters,
          });
        }
      }
      const result = {
        mapBounds: { ...WORLD_SCALE.MAP_BOUNDS },
        metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
        waterLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        radiusMeters,
        targetCount: vegetation.targetCount,
        placedCount: vegetation.placedCount,
        clusterSeatCount: vegetation.clusterSeatCount,
        instances,
      };
      disposeVegetation(vegetation.group);
      return result;
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const runtime = await readLiveVegetation();
const metrics = measureG11NearDetail(runtime);
if (runtime.radiusMeters !== 5500) throw new Error(`desktop vegetation radius drifted: ${runtime.radiusMeters}`);
if (metrics.hydrologyFingerprint.waterCells !== 38 || metrics.hydrologyFingerprint.landCells !== 58 || metrics.hydrologyFingerprint.boundaryEdges !== 39 || metrics.hydrologyFingerprint.centreMismatches !== 0) {
  throw new Error(`G11 hydrology fingerprint drifted: ${JSON.stringify(metrics.hydrologyFingerprint)}`);
}
if (metrics.coreInstanceCount < 12) throw new Error(`G11 has too few real runtime trees for near-detail proof: ${metrics.coreInstanceCount}`);
if (metrics.speciesCounts.pine < 1 || metrics.speciesCounts.round < 1) throw new Error(`G11 species variety disappeared: ${JSON.stringify(metrics.speciesCounts)}`);
if (metrics.minRoadDistanceMeters < 9.999) throw new Error(`G11 vegetation violates runtime road exclusion: ${metrics.minRoadDistanceMeters}`);
if (metrics.minSeatDistanceMeters < 89.999) throw new Error(`G11 vegetation violates runtime seat exclusion: ${metrics.minSeatDistanceMeters}`);
if (metrics.minHeightAboveWaterMeters < 1.499) throw new Error(`G11 vegetation violates runtime shore margin: ${metrics.minHeightAboveWaterMeters}`);
if (metrics.guardOnlyCount > Math.max(16, metrics.coreInstanceCount)) throw new Error(`G11 guard band density spike: ${metrics.guardOnlyCount}/${metrics.coreInstanceCount}`);

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(buildG11NearDetailProbe(runtime))}\n`);
}

console.log(`NW_G11_NEAR_DETAIL_METRICS=${JSON.stringify(metrics)}`);
console.log('NW_G11_NEAR_DETAIL_VALIDATION_OK');
