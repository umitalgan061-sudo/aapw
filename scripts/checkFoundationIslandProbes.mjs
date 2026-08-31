import assert from 'node:assert/strict';
import {
  FOUNDATION_ISLAND_PROBE_POLICY,
  createDisconnectedFoundationIslandProbes,
  createFoundationIslandProbePoints,
  foundationIslandHeightExtrema,
  normalizeFoundationIsland,
} from '../src/3d/world/foundationIslandProbes.js';

const rotated = {
  centerX: 120,
  centerZ: -80,
  halfWidthMeters: 18,
  halfDepthMeters: 6,
  axisX: { x: Math.SQRT1_2, z: Math.SQRT1_2 },
  axisZ: { x: -Math.SQRT1_2, z: Math.SQRT1_2 },
};

const normalized = normalizeFoundationIsland(rotated);
assert.ok(normalized, 'valid rotated island normalizes');
assert.ok(Math.abs(Math.hypot(normalized.axisX.x, normalized.axisX.z) - 1) < 1e-12, 'axisX normalized');
assert.ok(Math.abs(Math.hypot(normalized.axisZ.x, normalized.axisZ.z) - 1) < 1e-12, 'axisZ normalized');

const single = createFoundationIslandProbePoints(rotated, 2);
assert.equal(single.length, FOUNDATION_ISLAND_PROBE_POLICY.probesPerIsland, 'one island gets canonical nine probes');
assert.equal(single[0].label, 'island-2-center');
assert.deepEqual({ x: single[0].x, z: single[0].z }, { x: 120, z: -80 }, 'center probe is exact');
assert.equal(new Set(single.map((probe) => probe.label)).size, 9, 'probe labels unique');

const corners = single.slice(1, 5);
for (const corner of corners) {
  const dx = corner.x - rotated.centerX;
  const dz = corner.z - rotated.centerZ;
  const localX = dx * normalized.axisX.x + dz * normalized.axisX.z;
  const localZ = dx * normalized.axisZ.x + dz * normalized.axisZ.z;
  assert.ok(Math.abs(Math.abs(localX) - rotated.halfWidthMeters) < 1e-9, 'corner reaches island width');
  assert.ok(Math.abs(Math.abs(localZ) - rotated.halfDepthMeters) < 1e-9, 'corner reaches island depth');
}

const islands = [
  { centerX: -50, centerZ: 0, halfWidthMeters: 8, halfDepthMeters: 8, axisX: { x: 1, z: 0 }, axisZ: { x: 0, z: 1 } },
  { centerX: 0, centerZ: 0, halfWidthMeters: 7, halfDepthMeters: 7, axisX: { x: 1, z: 0 }, axisZ: { x: 0, z: 1 } },
  { centerX: 50, centerZ: 0, halfWidthMeters: 8, halfDepthMeters: 8, axisX: { x: 1, z: 0 }, axisZ: { x: 0, z: 1 } },
];
const all = createDisconnectedFoundationIslandProbes(islands);
assert.equal(all.length, 27, 'three disconnected islands get three nine-probe groups');
assert.deepEqual([...new Set(all.map((probe) => probe.islandIndex))], [0, 1, 2], 'island identity retained');

// Reproduces the aggregate-nine blind spot: a narrow high middle wing sits between the aggregate
// footprint centre/corners/edge-midpoints, while its own island centre correctly reaches the ridge.
const terrainHeight = (x, z) => (Math.abs(x) <= 8 && Math.abs(z) <= 8 ? 42 : 10);
const sampled = all.map((probe) => ({ ...probe, height: terrainHeight(probe.x, probe.z) }));
const extrema = foundationIslandHeightExtrema(sampled);
assert.equal(extrema.ok, true);
assert.equal(extrema.minHeight, 10);
assert.equal(extrema.maxHeight, 42, 'middle-island ridge is visible to island-local probes');
assert.equal(sampled.find((sample) => sample.label === 'island-1-center')?.height, 42, 'middle centre captures ridge');

assert.deepEqual(createDisconnectedFoundationIslandProbes([islands[0]]), [], 'one island needs no duplicate probe set');
assert.equal(normalizeFoundationIsland({ ...rotated, axisZ: rotated.axisX }), null, 'non-orthogonal island rejected');
assert.equal(normalizeFoundationIsland({ ...rotated, halfWidthMeters: -1 }), null, 'negative extents rejected');
assert.deepEqual(createFoundationIslandProbePoints({ nope: true }), [], 'invalid island yields no fabricated probes');

const tooMany = createDisconnectedFoundationIslandProbes([...islands, islands[0], islands[1]]);
assert.equal(tooMany.length, FOUNDATION_ISLAND_PROBE_POLICY.maximumIslands * 9, 'probe work is capped at runtime island budget');

console.log('FOUNDATION_ISLAND_PROBES_OK', JSON.stringify({
  policy: FOUNDATION_ISLAND_PROBE_POLICY.id,
  rotatedProbeCount: single.length,
  disconnectedProbeCount: all.length,
  maximumDetectedHeight: extrema.maxHeight,
}));
