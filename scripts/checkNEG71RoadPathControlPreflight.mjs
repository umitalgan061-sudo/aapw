#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  G71_TERRAIN3D_ROAD_PATH_POLICY as P,
  findG71CrossingEdges,
  g71RoadGuardBounds,
  sampleG71RoadPath,
} from '../godot/terrain-authoring/geocells/ne/g71_road_path.mjs';
import { sampleG71RockSnow } from '../godot/terrain-authoring/geocells/ne/g71_rock_snow.mjs';

const N = 257, b = P.normalizedBounds;
let samples = 0, maxCoverage = 0, maxHeightDelta = 0, maxControlDelta = 0, maxMaterialDelta = 0;
let maxNeighborCoverageStep = 0, previous = null, checksum = 2166136261;
const hash = (value) => {
  const q = Math.round(value * 1e6) | 0;
  for (const shift of [0, 8, 16, 24]) checksum = Math.imul((checksum ^ (q >>> shift)) >>> 0, 16777619) >>> 0;
};
for (let y = 0; y < N; y += 1) {
  const ny = b.yMin + (b.yMax - b.yMin) * y / (N - 1), row = [];
  for (let x = 0; x < N; x += 1) {
    const nx = b.xMin + (b.xMax - b.xMin) * x / (N - 1);
    const s = sampleG71RoadPath(nx, ny), prior = sampleG71RockSnow(nx, ny);
    assert.equal(s.body, 'sea'); assert.equal(s.kind, 0);
    maxCoverage = Math.max(maxCoverage, Math.abs(s.coverage), Math.abs(s.roadCoverage), Math.abs(s.pathCoverage));
    maxHeightDelta = Math.max(maxHeightDelta, Math.abs(s.authoredHeight - prior.heightMeters));
    maxControlDelta = Math.max(maxControlDelta, Math.abs(s.roadPathControlBlend - prior.controlBlend));
    maxMaterialDelta = Math.max(maxMaterialDelta,
      Math.abs(s.rockWeight - prior.rockWeight), Math.abs(s.snowWeight - prior.snowWeight),
      ...s.color.map((v, i) => Math.abs(v - prior.color[i])), Math.abs(s.roughness - prior.roughness));
    if (x) maxNeighborCoverageStep = Math.max(maxNeighborCoverageStep, Math.abs(s.coverage - row[x - 1]));
    if (previous) maxNeighborCoverageStep = Math.max(maxNeighborCoverageStep, Math.abs(s.coverage - previous[x]));
    for (const value of [s.authoredHeight, s.coverage, s.roadPathControlBlend, ...s.color, s.roughness]) hash(value);
    row.push(s.coverage); samples += 1;
  }
  previous = row;
}
assert.equal(samples, N * N); assert.equal(maxCoverage, 0); assert.equal(maxNeighborCoverageStep, 0);
assert.equal(maxHeightDelta, 0); assert.equal(maxControlDelta, 0); assert.equal(maxMaterialDelta, 0);

const guard = g71RoadGuardBounds(), G = P.denseGuardSize;
let guardSamples = 0, guardMaxCoverage = 0, guardMaxHeightError = 0, eastBoundarySamples = 0;
for (let y = 0; y < G; y += 1) for (let x = 0; x < G; x += 1) {
  const nx = guard.xMin + (guard.xMax - guard.xMin) * x / (G - 1);
  const ny = guard.yMin + (guard.yMax - guard.yMin) * y / (G - 1);
  const s = sampleG71RoadPath(nx, ny), prior = sampleG71RockSnow(nx, ny);
  guardMaxCoverage = Math.max(guardMaxCoverage, Math.abs(s.coverage), Math.abs(s.roadPathControlBlend));
  guardMaxHeightError = Math.max(guardMaxHeightError, Math.abs(s.authoredHeight - prior.heightMeters));
  if (x === G - 1) { assert.equal(nx, 1); eastBoundarySamples += 1; }
  guardSamples += 1;
}
assert.equal(guardSamples, G * G); assert.equal(eastBoundarySamples, G);
assert.equal(guardMaxCoverage, 0); assert.equal(guardMaxHeightError, 0);
assert.throws(() => sampleG71RoadPath(1.000001, 0.1875), /east of owner world/);

const syntheticBounds = { minX: 0, maxX: 9000, minY: 0, maxY: 7000 }, metersPerMapUnit = 1;
const point = (nx, ny) => { const p = normalizedReferenceToWorldXZ(nx, ny, syntheticBounds, metersPerMapUnit); return { x: p.x, y: 0, z: p.z }; };
const network = (pairs) => ({ mapBounds: syntheticBounds, metersPerMapUnit,
  mainEdges: pairs.map(([a, c], i) => ({ fromId: `a${i}`, toId: `b${i}`, points: [point(...a), point(...c)] })), footpathEdges: [] });
for (const pair of [
  [[guard.xMin - .03, .18], [1, .18]],
  [[.94, guard.yMin - .03], [.94, guard.yMax + .03]],
  [[.82, .10], [1, .28]],
]) assert.equal(findG71CrossingEdges(network([pair])).length, 1, 'crossing segment escaped clipping');
for (const pair of [
  [[.60, .18], [guard.xMin - .01, .18]],
  [[.60, .05], [.80, .05]],
  [[.70, .32], [.84, .32]],
]) assert.equal(findG71CrossingEdges(network([pair])).length, 0, 'non-crossing segment falsely entered G71');

console.log(`NE_G71_ROAD_PATH_CONTROL_PREFLIGHT=${JSON.stringify({ samples, guardSamples, eastBoundarySamples,
  maxCoverage, maxNeighborCoverageStep, maxHeightDelta, maxControlDelta, maxMaterialDelta,
  guardMaxCoverage, guardMaxHeightError, checksum: checksum >>> 0 })}`);
console.log('NE_G71_ROAD_PATH_CONTROL_PREFLIGHT_OK');
