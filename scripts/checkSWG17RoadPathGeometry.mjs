import assert from 'node:assert/strict';
import {
  G17_ROAD_PATH_POLICY,
  expandG17Bounds,
  measureG17ZeroCoverage,
  measurePolylineAgainstG17,
  pointInsideBounds,
  sampleG17RoadPath,
  segmentBoundsClearance,
  segmentIntersectsBounds,
} from '../godot/terrain-authoring/geocells/sw/g17_road_path.mjs';

const b = G17_ROAD_PATH_POLICY.normalizedBounds;
const g = expandG17Bounds();

assert.equal(G17_ROAD_PATH_POLICY.geoCell, 'G17');
assert.equal(G17_ROAD_PATH_POLICY.gx, 1);
assert.equal(G17_ROAD_PATH_POLICY.gy, 7);
assert.equal(G17_ROAD_PATH_POLICY.sourceMapSha256.length, 64);
assert.equal(G17_ROAD_PATH_POLICY.guardBandNormalizedX, 1 / 1536);
assert.equal(G17_ROAD_PATH_POLICY.guardBandNormalizedY, 1 / 1024);
assert.ok(g.xMin < b.xMin && g.xMax > b.xMax);
assert.ok(g.yMin < b.yMin && g.yMax > b.yMax);

const center = { x: (b.xMin + b.xMax) / 2, y: (b.yMin + b.yMax) / 2 };
assert.equal(pointInsideBounds(center, b), true);
assert.equal(pointInsideBounds({ x: b.xMin - 0.01, y: center.y }, b), false);

const through = [
  { x: b.xMin - 0.01, y: center.y },
  { x: b.xMax + 0.01, y: center.y },
];
assert.equal(segmentIntersectsBounds(through[0], through[1], b), true);
assert.equal(segmentBoundsClearance(through[0], through[1], b), 0);

const tangent = [
  { x: b.xMin - 0.01, y: b.yMin },
  { x: b.xMax + 0.01, y: b.yMin },
];
assert.equal(segmentIntersectsBounds(tangent[0], tangent[1], b), true);

const north = [
  { x: b.xMin, y: b.yMin - 0.01 },
  { x: b.xMax, y: b.yMin - 0.01 },
];
assert.equal(segmentIntersectsBounds(north[0], north[1], b), false);
assert.ok(Math.abs(segmentBoundsClearance(north[0], north[1], b) - 0.01) < 1e-12);

const far = [
  { x: 0.8, y: 0.2 },
  { x: 0.9, y: 0.3 },
];
const farMeasure = measurePolylineAgainstG17(far);
assert.equal(farMeasure.ownedCrossings, 0);
assert.equal(farMeasure.guardCrossings, 0);
assert.ok(farMeasure.minGuardClearance > 0);

const crossingMeasure = measurePolylineAgainstG17(through);
assert.equal(crossingMeasure.segmentCount, 1);
assert.equal(crossingMeasure.ownedCrossings, 1);
assert.equal(crossingMeasure.guardCrossings, 1);
assert.equal(crossingMeasure.minOwnedClearance, 0);
assert.equal(crossingMeasure.minGuardClearance, 0);

const multi = measurePolylineAgainstG17([
  { x: 0.02, y: 0.3 },
  { x: 0.03, y: 0.4 },
  { x: 0.04, y: 0.5 },
]);
assert.equal(multi.segmentCount, 2);
assert.ok(multi.normalizedLength > 0);

assert.deepEqual(sampleG17RoadPath(center.x, center.y), {
  inside: true,
  roadCoverage: 0,
  pathCoverage: 0,
  coverage: 0,
  kind: 0,
});
assert.equal(sampleG17RoadPath(0, 0).inside, false);
assert.throws(() => sampleG17RoadPath(Number.NaN, 0), TypeError);

for (const size of [33, 65, 129, 257]) {
  const metric = measureG17ZeroCoverage(size);
  assert.equal(metric.samples, size * size);
  assert.equal(metric.activeSamples, 0);
  assert.equal(metric.maxCoverage, 0);
  assert.equal(metric.maxAdjacentCoverageStep, 0);
  assert.equal(metric.maxGuardBandCoverageDelta, 0);
  assert.ok(Number.isInteger(metric.coverageChecksum));
}

const full = measureG17ZeroCoverage(257);
console.log(`SW_G17_ROAD_PATH_GEOMETRY=${JSON.stringify({
  policyId: G17_ROAD_PATH_POLICY.id,
  ownedBounds: b,
  guardBounds: g,
  sourceSamples: full.samples,
  activeSamples: full.activeSamples,
  coverageChecksum: full.coverageChecksum,
  exactSegmentClipping: true,
  anisotropicSourcePixelGuard: true,
})}`);
console.log('SW_G17_ROAD_PATH_GEOMETRY_OK');
