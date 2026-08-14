#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import {
  G70_TERRAIN3D_ROAD_PATH_POLICY,
  buildG70Terrain3DRoadPathProbe,
  canonicalRoadNetworkMaxNormalizedX,
  measureG70Terrain3DRoadPath,
} from '../godot/terrain-authoring/geocells/ne/g70_road_path.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const p = G70_TERRAIN3D_ROAD_PATH_POLICY;
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
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
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

const contract = readCanonicalRoadContract();
assert.equal(contract.maxSeatMapX, p.canonicalMaxSeatMapX, 'KINGDOM_SEATS eastern envelope changed');
assert.equal(contract.corridorPaddingMeters, p.canonicalRouteCorridorPaddingMeters, 'road corridor padding changed');
assert.equal(p.sourceMapSha256, MAP_SHA, 'map.png provenance drifted');
assert.ok(canonicalRoadNetworkMaxNormalizedX() < p.normalizedBounds.xMin, 'canonical road search envelope reaches G70');

const runtime = await buildRuntimeNetwork();
assert.equal(runtime.mainEdges.length, 13, `runtime road backbone changed: ${runtime.mainEdges.length}`);
const first = measureG70Terrain3DRoadPath(runtime);
const second = measureG70Terrain3DRoadPath(runtime);
assert.deepEqual(first, second, 'G70 Road/Path metrics must be deterministic');
assert.equal(first.geoCell, 'G70');
assert.equal(first.layer, 'Road/Path');
assert.equal(first.canonicalWaterCells, 96);
assert.equal(first.canonicalLandCells, 0);
assert.equal(first.qualificationSamples, 257 * 257);
assert.equal(first.nonSeaSamples, 0);
assert.equal(first.crossingEdges.length, 0, `real runtime road/path intersects G70: ${JSON.stringify(first.crossingEdges)}`);
assert.ok(first.runtimeRoadReferenceEnvelope.points > 0, 'runtime road network had no projected points');
assert.ok(first.runtimeRoadReferenceEnvelope.maxX < p.normalizedBounds.xMin, 'runtime road envelope reaches G70 east cell');
assert.ok(first.canonicalRoadExclusionMarginMeters > 100, `road exclusion margin too small: ${first.canonicalRoadExclusionMarginMeters}`);
assert.equal(first.activeRoadSamples, 0, 'phantom cart-road coverage appeared in G70 sea');
assert.equal(first.activePathSamples, 0, 'phantom footpath coverage appeared in G70 sea');
assert.equal(first.maxAdjacentCoverageStep, 0, 'road-free G70 developed a local coverage edge');
assert.equal(first.maxHeightDelta, 0, 'Road/Path changed merged G70 Relief height');
assert.equal(first.maxSurfaceDelta, 0, 'Road/Path changed merged G70 Rock/Snow surface');
assert.equal(first.terrain3dImportSize, 257);
assert.equal(first.terrain3dRegionSize, 256);

const probeA = buildG70Terrain3DRoadPathProbe(runtime);
const probeB = buildG70Terrain3DRoadPathProbe(runtime);
assert.deepEqual(probeA, probeB, 'G70 Road/Path probe must be deterministic');
assert.equal(probeA.rows.length, 65);
assert.ok(probeA.rows.every((row) => row.length === 65));
for (const row of probeA.rows) for (const sample of row) {
  assert.ok(sample[0] < 0, 'G70 Road/Path height escaped submerged contract');
  assert.equal(sample[1], 0, 'probe invented road coverage');
  assert.equal(sample[2], 0, 'probe invented path coverage');
  assert.equal(sample[3], 0, 'probe invented road/path control blend');
  assert.equal(sample[4], 0, 'probe invented road/path kind');
}

// Explicit world-edge stress: no route rim may appear at the NE map boundary.
for (let i = 0; i <= 256; i += 1) {
  const t = i / 256;
  for (const sample of [probeA.rows[0][i % 65], probeA.rows[i % 65][64]]) {
    assert.equal(sample[1], 0); assert.equal(sample[2], 0); assert.equal(sample[3], 0);
  }
}

const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) {
  const output = path.resolve(emit.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(probeA)}\n`, 'utf8');
}
const summary = {
  ...first,
  runtimeMainEdges: runtime.mainEdges.length,
  runtimeFootpathEdges: runtime.footpathEdges.length,
  canonicalMaxSeatMapX: contract.maxSeatMapX,
  corridorPaddingMeters: contract.corridorPaddingMeters,
};
console.log(`NE_G70_ROAD_PATH_METRICS=${JSON.stringify(summary)}`);
console.log('NE_G70_ROAD_PATH_VALIDATION_OK');
