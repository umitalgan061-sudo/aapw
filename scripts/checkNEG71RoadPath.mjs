#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import {
  G71_TERRAIN3D_ROAD_PATH_POLICY,
  buildG71Terrain3DRoadPathProbe,
  canonicalRoadNetworkMaxNormalizedX,
  g71RoadGuardBounds,
  measureG71Terrain3DRoadPath,
  sampleG71RoadPath,
} from '../godot/terrain-authoring/geocells/ne/g71_road_path.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const P = G71_TERRAIN3D_ROAD_PATH_POLICY;
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

async function buildRuntimeNetwork(guardBounds) {
  const playwright = devServerHelper.loadPlaywright();
  requireOk(Boolean(playwright), 'Playwright is required for runtime road proof');
  const server = await devServerHelper.startStaticServer();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`page:${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const result = await page.evaluate(async (guard) => {
      const THREE = await import('/src/3d/vendor/three/three.module.js');
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
        const { x, z } = mapToWorldXZ(
          seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT,
        );
        return { id: seat.id, x, z, groundY: sampleHeightMeters(x, z) };
      });
      const network = buildRoadNetwork({ seats, sampleHeightMeters });
      const serialize = (edges) => edges.map((edge) => ({
        fromId: edge.fromId,
        toId: edge.toId,
        points: edge.points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
      }));
      const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
      const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
      const worldToRef = (x, z) => ({
        x: (x / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapX) / 9000,
        y: (z / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapY) / 7000,
      });
      network.group.updateMatrixWorld(true);
      let renderedMeshes = 0, renderedVertices = 0, renderedVerticesInsideGuard = 0;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const vertex = new THREE.Vector3();
      network.group.traverse((object) => {
        const positions = object.geometry?.getAttribute?.('position');
        if (!positions) return;
        renderedMeshes += 1;
        for (let i = 0; i < positions.count; i += 1) {
          vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
          const n = worldToRef(vertex.x, vertex.z);
          minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
          minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
          if (n.x >= guard.xMin && n.x <= guard.xMax && n.y >= guard.yMin && n.y <= guard.yMax) {
            renderedVerticesInsideGuard += 1;
          }
          renderedVertices += 1;
        }
      });
      const renderedRoadEnvelope = {
        renderedMeshes, renderedVertices, renderedVerticesInsideGuard,
        minX: Number(minX.toFixed(8)), maxX: Number(maxX.toFixed(8)),
        minY: Number(minY.toFixed(8)), maxY: Number(maxY.toFixed(8)),
      };
      network.group.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose?.());
        else object.material?.dispose?.();
      });
      return {
        mapBounds: { ...WORLD_SCALE.MAP_BOUNDS },
        metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
        mainEdges: serialize(network.edges),
        footpathEdges: serialize(network.footpathEdges ?? []),
        renderedRoadEnvelope,
      };
    }, guardBounds);
    requireOk(errors.length === 0, `runtime road proof errors: ${errors.join(' | ')}`);
    await page.close();
    return result;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const contract = readCanonicalRoadContract();
assert.equal(P.sourceMapSha256, MAP_SHA, 'map.png provenance drifted');
assert.equal(contract.maxSeatMapX, P.canonicalMaxSeatMapX, 'KINGDOM_SEATS eastern envelope changed');
assert.equal(contract.corridorPaddingMeters, P.canonicalRouteCorridorPaddingMeters, 'road corridor padding changed');
const guard = g71RoadGuardBounds();
assert.equal(guard.xMax, 1, 'east owner-world boundary drifted');
assert.ok(canonicalRoadNetworkMaxNormalizedX() < guard.xMin, 'canonical road search envelope reaches G71 guard');
assert.throws(() => sampleG71RoadPath(1 + 1e-6, 0.1875), /east of owner world/);

const runtime = await buildRuntimeNetwork(guard);
assert.equal(runtime.mainEdges.length, 13, `runtime road backbone changed: ${runtime.mainEdges.length}`);
assert.ok(runtime.renderedRoadEnvelope.renderedMeshes >= 1, 'runtime road renderer produced no meshes');
assert.ok(runtime.renderedRoadEnvelope.renderedVertices > 100, 'runtime road renderer produced too few vertices');
assert.equal(runtime.renderedRoadEnvelope.renderedVerticesInsideGuard, 0, 'rendered road/path ribbon entered G71 guard');
assert.ok(runtime.renderedRoadEnvelope.maxX < guard.xMin, `rendered road/path envelope reaches G71 guard: ${runtime.renderedRoadEnvelope.maxX}`);

const first = measureG71Terrain3DRoadPath(runtime);
const second = measureG71Terrain3DRoadPath(runtime);
assert.deepEqual(first, second, 'G71 Road/Path metrics must be deterministic');
assert.equal(first.geoCell, 'G71'); assert.equal(first.layer, 'Road/Path');
assert.equal(first.canonicalWaterCells, 96); assert.equal(first.canonicalLandCells, 0);
assert.equal(first.qualificationSamples, 257 * 257); assert.equal(first.nonSeaSamples, 0);
assert.equal(first.crossingEdges.length, 0, `live route intersects G71 guard: ${JSON.stringify(first.crossingEdges)}`);
assert.ok(first.runtimeRoadReferenceEnvelope.points > 0, 'runtime road network had no projected points');
assert.ok(first.runtimeRoadReferenceEnvelope.maxX < guard.xMin, `runtime centerline reaches G71 guard: ${first.runtimeRoadReferenceEnvelope.maxX}`);
assert.ok(first.canonicalRoadGuardMarginMeters > 50, `canonical road guard margin too small: ${first.canonicalRoadGuardMarginMeters}`);
assert.equal(first.activeRoadSamples, 0); assert.equal(first.activePathSamples, 0);
assert.equal(first.maxCoverage, 0); assert.equal(first.maxAdjacentCoverageStep, 0);
assert.equal(first.maxHeightDelta, 0, 'Road/Path changed merged Relief height');
assert.equal(first.maxSurfaceDelta, 0, 'Road/Path changed merged Rock/Snow/Biome substrate');

const probeA = buildG71Terrain3DRoadPathProbe(runtime);
const probeB = buildG71Terrain3DRoadPathProbe(runtime);
assert.deepEqual(probeA, probeB, 'G71 Road/Path probe must be deterministic');
assert.equal(probeA.schema, 'westeros-g71-terrain3d-road-path-probe-v1');
assert.equal(probeA.rows.length, 65); assert.ok(probeA.rows.every((row) => row.length === 65));
for (const row of probeA.rows) for (const sample of row) {
  assert.equal(sample.length, 9); assert.equal(sample[0], -8);
  assert.equal(sample[1], 0); assert.equal(sample[2], 0); assert.equal(sample[3], 0); assert.equal(sample[4], 0);
  assert.ok(sample.slice(5, 8).every((v) => v >= 0 && v <= 1)); assert.ok(sample[8] >= 0 && sample[8] <= 1);
}
const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) {
  const output = path.resolve(emit.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(probeA)}\n`, 'utf8');
}
console.log(`NE_G71_ROAD_PATH_METRICS=${JSON.stringify({
  ...first,
  runtimeMainEdges: runtime.mainEdges.length,
  runtimeFootpathEdges: runtime.footpathEdges.length,
  renderedRoadEnvelope: runtime.renderedRoadEnvelope,
  canonicalMaxSeatMapX: contract.maxSeatMapX,
  corridorPaddingMeters: contract.corridorPaddingMeters,
})}`);
console.log('NE_G71_ROAD_PATH_VALIDATION_OK');
