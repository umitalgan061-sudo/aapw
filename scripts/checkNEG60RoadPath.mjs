#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import {
  G60_TERRAIN3D_ROAD_PATH_POLICY,
  buildG60Terrain3DRoadPathProbe,
  canonicalRoadNetworkMaxNormalizedX,
  g60RoadGuardBounds,
  measureG60Terrain3DRoadPath,
} from '../godot/terrain-authoring/geocells/ne/g60_road_path.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const p = G60_TERRAIN3D_ROAD_PATH_POLICY;
const requireOk = (ok, message) => { if (!ok) throw new Error(message); };

function readCanonicalRoadContract() {
  const settlements = fs.readFileSync(path.join(ROOT, 'src/3d/world/settlements.js'), 'utf8');
  const seatXs = [...settlements.matchAll(/mapX:\s*([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1]));
  assert.ok(seatXs.length >= 14, `expected >=14 kingdom seats, got ${seatXs.length}`);
  const pathfinder = fs.readFileSync(path.join(ROOT, 'src/3d/world/roadPathfinder.js'), 'utf8');
  const padding = pathfinder.match(/const\s+CORRIDOR_PADDING_METERS\s*=\s*([0-9]+(?:\.[0-9]+)?)/);
  assert.ok(padding, 'could not read canonical road corridor padding');
  return { maxSeatMapX: Math.max(...seatXs), corridorPaddingMeters: Number(padding[1]) };
}

async function buildRuntimeNetwork() {
  const playwright = devServerHelper.loadPlaywright();
  requireOk(Boolean(playwright), 'Playwright is required for runtime road proof');
  const server = await devServerHelper.startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const result = await page.evaluate(async () => {
      const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
      const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
      const { createHeightSampler } = await import('/src/3d/world/terrain.js');
      const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
      const natural = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
      const pads = computeSettlementFlattenPads({ sampleHeightMeters: natural,
        seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
        mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
      const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
      const seats = KINGDOM_SEATS.map((seat) => {
        const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
        return { id: seat.id, x, z, groundY: sampleHeightMeters(x, z) };
      });
      const network = buildRoadNetwork({ seats, sampleHeightMeters });
      const serialize = (edges) => edges.map((edge) => ({ fromId: edge.fromId, toId: edge.toId,
        points: edge.points.map((point) => ({ x: point.x, y: point.y, z: point.z })) }));
      return { mapBounds: { ...WORLD_SCALE.MAP_BOUNDS }, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
        mainEdges: serialize(network.edges), footpathEdges: serialize(network.footpathEdges ?? []) };
    });
    requireOk(errors.length === 0, `runtime road proof page errors: ${errors.join(' | ')}`);
    return result;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const contract = readCanonicalRoadContract();
assert.equal(p.sourceMapSha256, MAP_SHA, 'map.png provenance drifted');
assert.equal(contract.maxSeatMapX, p.canonicalMaxSeatMapX, 'KINGDOM_SEATS eastern envelope changed');
assert.equal(contract.corridorPaddingMeters, p.canonicalRouteCorridorPaddingMeters, 'canonical road padding changed');
const guard = g60RoadGuardBounds();
assert.ok(canonicalRoadNetworkMaxNormalizedX() < guard.xMin, 'canonical road search envelope reaches G60 guard band');

const runtime = await buildRuntimeNetwork();
assert.equal(runtime.mainEdges.length, 13, `runtime road backbone changed: ${runtime.mainEdges.length}`);
const first = measureG60Terrain3DRoadPath(runtime);
const second = measureG60Terrain3DRoadPath(runtime);
assert.deepEqual(first, second, 'G60 Road/Path metrics must be deterministic');
assert.equal(first.geoCell, 'G60'); assert.equal(first.layer, 'Road/Path');
assert.equal(first.canonicalWaterCells, 96); assert.equal(first.canonicalLandCells, 0);
assert.equal(first.qualificationSamples, 257 * 257); assert.equal(first.nonSeaSamples, 0);
assert.equal(first.crossingEdges.length, 0, `live road/path intersects G60 guard: ${JSON.stringify(first.crossingEdges)}`);
assert.ok(first.runtimeRoadReferenceEnvelope.points > 0, 'runtime road network had no projected points');
assert.ok(first.runtimeRoadReferenceEnvelope.maxX < guard.xMin, `runtime road envelope reaches G60 guard: ${first.runtimeRoadReferenceEnvelope.maxX}`);
assert.ok(first.canonicalRoadGuardMarginMeters > 50, `canonical road guard margin too small: ${first.canonicalRoadGuardMarginMeters}`);
assert.equal(first.activeRoadSamples, 0); assert.equal(first.activePathSamples, 0); assert.equal(first.maxCoverage, 0);
assert.equal(first.maxAdjacentCoverageStep, 0, 'road-free G60 developed a coverage edge');
assert.equal(first.maxHeightDelta, 0, 'Road/Path changed merged G60 Relief height');
assert.equal(first.maxSurfaceDelta, 0, 'Road/Path changed merged G60 Rock/Snow/biome surface');
assert.equal(first.terrain3dImportSize, 257); assert.equal(first.terrain3dRegionSize, 256);

const probeA = buildG60Terrain3DRoadPathProbe(runtime), probeB = buildG60Terrain3DRoadPathProbe(runtime);
assert.deepEqual(probeA, probeB, 'G60 Road/Path probe must be deterministic');
assert.equal(probeA.rows.length, 65); assert.ok(probeA.rows.every((row) => row.length === 65));
for (const row of probeA.rows) for (const sample of row) {
  assert.equal(sample.length, 9); assert.equal(sample[0], -8, 'Road/Path changed qualified seafloor height');
  assert.equal(sample[1], 0, 'probe invented road'); assert.equal(sample[2], 0, 'probe invented path');
  assert.equal(sample[3], 0, 'probe changed substrate control blend'); assert.equal(sample[4], 0, 'probe invented route kind');
  assert.ok(sample[5] >= 0 && sample[5] <= 1 && sample[6] >= 0 && sample[6] <= 1 && sample[7] >= 0 && sample[7] <= 1);
  assert.ok(sample[8] >= 0 && sample[8] <= 1, 'roughness out of range');
}

// Guard stress at west/east/south edges; the north edge is the world boundary.
for (let i = 0; i <= 256; i += 1) {
  const t = i / 256;
  const nx = p.normalizedBounds.xMin + (p.normalizedBounds.xMax - p.normalizedBounds.xMin) * t;
  const ny = p.normalizedBounds.yMin + (p.normalizedBounds.yMax - p.normalizedBounds.yMin) * t;
  for (const [x, y] of [
    [p.normalizedBounds.xMin - p.guardNormalized, ny], [p.normalizedBounds.xMin, ny],
    [p.normalizedBounds.xMax, ny], [p.normalizedBounds.xMax + p.guardNormalized, ny],
    [nx, p.normalizedBounds.yMax], [nx, p.normalizedBounds.yMax + p.guardNormalized],
  ]) {
    const s = (await import('../godot/terrain-authoring/geocells/ne/g60_road_path.mjs')).sampleG60RoadPath(x, y);
    assert.equal(s.coverage, 0); assert.equal(s.roadPathControlBlend, 0); assert.equal(s.authoredHeight, -8);
  }
}

const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) {
  const output = path.resolve(emit.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(probeA)}\n`, 'utf8');
}
console.log(`NE_G60_ROAD_PATH_METRICS=${JSON.stringify({ ...first, runtimeMainEdges: runtime.mainEdges.length,
  runtimeFootpathEdges: runtime.footpathEdges.length, canonicalMaxSeatMapX: contract.maxSeatMapX,
  corridorPaddingMeters: contract.corridorPaddingMeters })}`);
console.log('NE_G60_ROAD_PATH_VALIDATION_OK');
