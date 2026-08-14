#!/usr/bin/env node
import assert from 'node:assert/strict';
import { G70_TERRAIN3D_ROAD_PATH_POLICY, sampleG70RoadPath } from '../godot/terrain-authoring/geocells/ne/g70_road_path.mjs';
import { sampleG70RockSnow } from '../godot/terrain-authoring/geocells/ne/g70_rock_snow.mjs';

const p = G70_TERRAIN3D_ROAD_PATH_POLICY;
const b = p.normalizedBounds;
const g = p.guardBandNormalized;
const envelope = { xMin: b.xMin - g, xMax: b.xMax, yMin: b.yMin, yMax: b.yMax + g };
const N = 193;
let samples = 0, nonSea = 0;
let maxRoad = 0, maxPath = 0, maxCoverage = 0, maxControl = 0;
let maxHeightMismatch = 0, maxRockMismatch = 0, maxSnowMismatch = 0, maxMassMismatch = 0;
let minHeight = Infinity, maxHeight = -Infinity;
for (let y = 0; y < N; y += 1) {
  const ny = envelope.yMin + (envelope.yMax - envelope.yMin) * y / (N - 1);
  for (let x = 0; x < N; x += 1) {
    const nx = envelope.xMin + (envelope.xMax - envelope.xMin) * x / (N - 1);
    const s = sampleG70RoadPath(nx, ny), base = sampleG70RockSnow(nx, ny);
    samples += 1; if (!s.water || s.body !== 'sea') nonSea += 1;
    maxRoad = Math.max(maxRoad, Math.abs(s.roadCoverage)); maxPath = Math.max(maxPath, Math.abs(s.pathCoverage));
    maxCoverage = Math.max(maxCoverage, Math.abs(s.coverage)); maxControl = Math.max(maxControl, Math.abs(s.roadPathControlBlend));
    maxHeightMismatch = Math.max(maxHeightMismatch, Math.abs(s.authoredHeight - base.heightMeters));
    maxRockMismatch = Math.max(maxRockMismatch, Math.abs(s.rockWeight - base.rockWeight));
    maxSnowMismatch = Math.max(maxSnowMismatch, Math.abs(s.snowWeight - base.snowWeight));
    maxMassMismatch = Math.max(maxMassMismatch, Math.abs(s.terrestrialSurfaceMass - base.terrestrialSurfaceMass));
    minHeight = Math.min(minHeight, s.authoredHeight); maxHeight = Math.max(maxHeight, s.authoredHeight);
  }
}
assert.equal(samples, N * N); assert.equal(nonSea, 0);
assert.equal(maxRoad, 0); assert.equal(maxPath, 0); assert.equal(maxCoverage, 0); assert.equal(maxControl, 0);
assert.equal(maxHeightMismatch, 0); assert.equal(maxRockMismatch, 0); assert.equal(maxSnowMismatch, 0); assert.equal(maxMassMismatch, 0);
assert.ok(maxHeight < 0 && maxHeight - minHeight <= 0.000001, 'Road/Path envelope changed flat submerged height');

let edgeSamples = 0, maxEdgeCoverage = 0, maxEdgeControl = 0, maxEdgeHeightMismatch = 0;
for (let i = 0; i <= 256; i += 1) {
  const t = i / 256;
  const x = b.xMin + (b.xMax - b.xMin) * t, y = b.yMin + (b.yMax - b.yMin) * t;
  const points = [
    [b.xMin, y], [b.xMin - g, y],
    [x, b.yMax], [x, b.yMax + g],
    [b.xMax, y], [b.xMax - g, y],
    [x, b.yMin], [x, b.yMin + g],
  ];
  for (const [nx, ny] of points) {
    const s = sampleG70RoadPath(nx, ny), base = sampleG70RockSnow(nx, ny);
    maxEdgeCoverage = Math.max(maxEdgeCoverage, Math.abs(s.coverage));
    maxEdgeControl = Math.max(maxEdgeControl, Math.abs(s.roadPathControlBlend));
    maxEdgeHeightMismatch = Math.max(maxEdgeHeightMismatch, Math.abs(s.authoredHeight - base.heightMeters)); edgeSamples += 1;
  }
}
assert.equal(edgeSamples, 2056); assert.equal(maxEdgeCoverage, 0); assert.equal(maxEdgeControl, 0); assert.equal(maxEdgeHeightMismatch, 0);
const corners = [[1,0],[1-g,0],[1,g],[1-g,g],[b.xMin,0],[b.xMin-g,0],[1,b.yMax],[1,b.yMax+g]];
for (const [nx, ny] of corners) {
  const s = sampleG70RoadPath(nx, ny); assert.equal(s.body, 'sea'); assert.equal(s.roadCoverage, 0); assert.equal(s.pathCoverage, 0); assert.equal(s.roadPathControlBlend, 0);
}
const metrics = { samples, edgeSamples, cornerSamples:corners.length, minHeight, maxHeight, maxRoad, maxPath, maxCoverage, maxControl, maxHeightMismatch, maxRockMismatch, maxSnowMismatch, maxMassMismatch, maxEdgeCoverage, maxEdgeControl, maxEdgeHeightMismatch };
console.log(`NE_G70_ROAD_PATH_ENVELOPE=${JSON.stringify(metrics)}`); console.log('NE_G70_ROAD_PATH_ENVELOPE_OK');
