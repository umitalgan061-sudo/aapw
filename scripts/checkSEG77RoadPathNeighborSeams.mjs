#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import { G77_ROAD_PATH_POLICY as P, findG77CrossingEdges, sampleG77RoadPath } from '../godot/terrain-authoring/geocells/se/g77_road_path.mjs';

const mapBounds = { minX: 0, maxX: 9000, minY: 0, maxY: 7000 }, metersPerMapUnit = 1, b = P.normalizedBounds;
const world = (nx, ny) => { const p = normalizedReferenceToWorldXZ(nx, ny, mapBounds, metersPerMapUnit); return { x: p.x, y: 0, z: p.z }; };
function network(tier, axis) {
  const center = axis === 'west' ? [b.xMin, (b.yMin + b.yMax) / 2] : [(b.xMin + b.xMax) / 2, b.yMin];
  const a = axis === 'west' ? world(b.xMin - .012, center[1]) : world(center[0], b.yMin - .012);
  const c = axis === 'west' ? world(b.xMin + .012, center[1]) : world(center[0], b.yMin + .012);
  const pad = world(center[0], center[1]);
  const edge = { fromId: `${tier}-${axis}-a`, toId: `${tier}-${axis}-b`, points: [a, c] };
  return { mapBounds, metersPerMapUnit, waterLevelMeters: 0, settlementPads: [{ x: pad.x, z: pad.z, innerRadiusMeters: 3000, outerRadiusMeters: 3500, anchorHeightMeters: 100 }], mainEdges: tier === 'road' ? [edge] : [], footpathEdges: tier === 'path' ? [edge] : [] };
}

let samples = 0, maxStep = 0, maxMirrorDelta = 0, checksum = 2166136261;
for (const tier of ['road', 'path']) for (const axis of ['west', 'north']) {
  const runtime = network(tier, axis); assert.equal(findG77CrossingEdges(runtime).length, 1);
  const center = axis === 'west' ? [b.xMin, (b.yMin + b.yMax) / 2] : [(b.xMin + b.xMax) / 2, b.yMin];
  const values = [], span = .004, N = 513;
  for (let i = 0; i < N; i += 1) {
    const offset = -span + 2 * span * i / (N - 1), nx = axis === 'west' ? center[0] + offset : center[0], ny = axis === 'north' ? center[1] + offset : center[1];
    const s = sampleG77RoadPath(nx, ny, runtime), value = tier === 'road' ? s.roadCoverage : s.pathCoverage;
    assert.ok(Number.isFinite(value)); values.push(value); if (i) maxStep = Math.max(maxStep, Math.abs(value - values[i - 1]));
    checksum = Math.imul((checksum ^ Math.round(value * 255)) >>> 0, 16777619) >>> 0; samples += 1;
  }
  assert.ok(values[Math.floor(N / 2)] > .95, `${tier}/${axis} synthetic corridor did not survive seam`);
  for (let i = 0; i < Math.floor(N / 2); i += 1) maxMirrorDelta = Math.max(maxMirrorDelta, Math.abs(values[i] - values[N - 1 - i]));
}
assert.equal(samples, 2052); assert.ok(maxStep <= .05, `Road/Path seam transition too abrupt: ${maxStep}`); assert.ok(maxMirrorDelta <= .02, `Road/Path seam lost symmetric distance field: ${maxMirrorDelta}`);

const east = network('road', 'west'); east.mainEdges[0].points = [world(.988, .95), world(1, .95)];
const south = network('path', 'north'); south.footpathEdges[0].points = [world(.95, .988), world(.95, 1)];
assert.doesNotThrow(() => sampleG77RoadPath(1, .95, east)); assert.doesNotThrow(() => sampleG77RoadPath(.95, 1, south));
assert.throws(() => sampleG77RoadPath(1.000001, .95, east), /escaped owner map/); assert.throws(() => sampleG77RoadPath(.95, 1.000001, south), /escaped owner map/);
console.log(`SE_G77_ROAD_PATH_NEIGHBOR_SEAMS=${JSON.stringify({ samples, maxStep: Number(maxStep.toFixed(8)), maxMirrorDelta: Number(maxMirrorDelta.toFixed(8)), checksum: checksum >>> 0 })}`);
console.log('SE_G77_ROAD_PATH_NEIGHBOR_SEAMS_OK');
