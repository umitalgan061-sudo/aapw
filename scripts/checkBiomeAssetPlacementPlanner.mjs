#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBiomeAssetPlacementPlan, createRegionalArchitectureRing, validatePlacementPlan, deterministicPlacementDigest } from '../src/3d/world/biomeAssetPlacementPlanner.js';

const height = () => 20;
const base = { normalizedX: 0.5, normalizedY: 0.5, worldX: 480, worldZ: -360, seed: 'planner', sampleHeightMeters: height, seaLevelMeters: 6, seats: [], roadEdges: [], radiusMeters: 240, baseDensityPerKm2: 36, sampleCount: 28, minSpacingMeters: 5, minSeatDistanceMeters: 20, minRoadDistanceMeters: 10 };
const first = createBiomeAssetPlacementPlan(base);
const second = createBiomeAssetPlacementPlan(base);
assert.deepEqual(second, first);
assert.equal(deterministicPlacementDigest(second), deterministicPlacementDigest(first));
assert.ok(first.placedCount > 0, 'local radius anchoring must allow placements away from global origin');
assert.equal(validatePlacementPlan(first).ok, true);
for (const item of first.placements) {
  assert.ok(Math.hypot(item.x - first.worldOrigin.x, item.z - first.worldOrigin.z) <= 260.001);
  assert.ok(item.slopeDegrees <= 45);
  assert.ok(item.roadDistance >= 10);
  assert.ok(item.seatDistance >= 20);
}
const road = createBiomeAssetPlacementPlan({ ...base, worldX: 0, worldZ: 0, radiusMeters: 350, roadEdges: [{ points: [{ x: 100, z: -250 }, { x: 100, z: 250 }] }], minRoadDistanceMeters: 16, seed: 'road' });
for (const item of road.placements) assert.ok(item.roadDistance >= 16);
const seats = createBiomeAssetPlacementPlan({ ...base, worldX: 120, worldZ: 100, radiusMeters: 420, seats: [{ x: 40, z: -30 }, { x: 220, z: 180 }], minSeatDistanceMeters: 125, seed: 'seats' });
for (const item of seats.placements) for (const seat of [{ x: 40, z: -30 }, { x: 220, z: 180 }]) assert.ok(Math.hypot(item.x - seat.x, item.z - seat.z) >= 125);
const water = createBiomeAssetPlacementPlan({ ...base, radiusMeters: 120, sampleHeightMeters: () => 2, seed: 'water' });
assert.equal(water.placedCount, 0);
const architecture = createRegionalArchitectureRing({ ...base, radiusMeters: 120, seed: 'architecture' });
assert.equal(architecture.category, 'architecture');
assert.equal(validatePlacementPlan(architecture).ok, true);
assert.ok(architecture.placements.every((item) => item.family === 'architecture'));
console.log(JSON.stringify({ ok: true, placed: first.placedCount, architecturePlaced: architecture.placedCount }));
console.log('BIOME_ASSET_PLACEMENT_PLANNER_OK');
