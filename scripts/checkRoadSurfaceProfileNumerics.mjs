#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ROAD_PROFILE_POLICY,
  checksumProfile,
  gradeDegrees,
  pathIsGradeSafe,
  profileRoadPolyline,
  profileTerrainSegment,
  segmentSampleCount,
  summarizePolylineCurvature,
} from '../src/3d/world/roadSurfaceProfile.js';

const DEG = Math.PI / 180;
const approx = (actual, expected, epsilon, label) => {
  assert(Number.isFinite(actual), `${label} must be finite`);
  assert(Math.abs(actual - expected) <= epsilon,
    `${label}: expected ${expected} ± ${epsilon}, got ${actual}`);
};

assert.equal(ROAD_PROFILE_POLICY.maxSampleSpacingMeters, 4);
assert.equal(ROAD_PROFILE_POLICY.presentationSampleSpacingMeters, 6);
assert.equal(ROAD_PROFILE_POLICY.deterministic, true);
assert.equal(ROAD_PROFILE_POLICY.geographyAuthorityUnchanged, true);
assert.equal(ROAD_PROFILE_POLICY.heightAuthority, 'world/terrain.js');

// Basic grade algebra.
approx(gradeDegrees(0, 10), 0, 1e-12, 'flat grade');
approx(gradeDegrees(Math.tan(10 * DEG) * 100, 100), 10, 1e-10, '10 degree grade');
approx(gradeDegrees(-Math.tan(17 * DEG) * 75, 75), 17, 1e-10, 'signed rise uses absolute grade');
assert.equal(gradeDegrees(2, 0), 90);
assert.equal(gradeDegrees(0, 0), 0);
assert.throws(() => gradeDegrees(Number.NaN, 10), /finite/);
assert.throws(() => gradeDegrees(1, -1), />= 0/);

// Sampling count always respects the live requested maximum spacing.
const liveSpacing = ROAD_PROFILE_POLICY.maxSampleSpacingMeters;
for (const length of [0, 0.1, 5.9, 6, 6.1, 7.9, 8, 8.1, 59.9, 60, 600]) {
  const count = segmentSampleCount(length, liveSpacing);
  assert(Number.isInteger(count) && count >= 1);
  if (length > 0) assert(length / count <= liveSpacing + 1e-12, `spacing cap broken at ${length}m`);
}
assert.throws(() => segmentSampleCount(10, 0), /> 0/);
assert.throws(() => segmentSampleCount(-1, liveSpacing), />= 0/);

// Exact flat segment.
{
  const profile = profileTerrainSegment({
    start: { x: -100, z: 25 },
    end: { x: 140, z: 25 },
    sampleHeightMeters: () => 33.5,
  });
  assert(profile.sampleCount > 2);
  assert.equal(profile.maxGradeDegrees, 0);
  assert.equal(profile.totalAscentMeters, 0);
  assert.equal(profile.totalDescentMeters, 0);
  assert.equal(profile.elevationRangeMeters, 0);
  assert.equal(profile.startHeightMeters, 33.5);
  assert.equal(profile.endHeightMeters, 33.5);
  assert(profile.maxSpacingMeters <= liveSpacing + 1e-12);
}

// Constant analytical 10 degree ramp should remain exactly 10 degrees after densification.
{
  const slope = Math.tan(10 * DEG);
  const sampler = (x) => 8 + x * slope;
  const profile = profileTerrainSegment({
    start: { x: 0, z: 0 },
    end: { x: 240, z: 0 },
    sampleHeightMeters: sampler,
    maxSpacingMeters: 7,
  });
  approx(profile.maxGradeDegrees, 10, 1e-9, 'constant-ramp max grade');
  approx(profile.meanGradeDegrees, 10, 1e-9, 'constant-ramp mean grade');
  approx(profile.directGradeDegrees, 10, 1e-9, 'constant-ramp direct grade');
  approx(profile.totalAscentMeters, 240 * slope, 1e-9, 'constant-ramp ascent');
  assert.equal(profile.totalDescentMeters, 0);
}

// Hidden ridge: endpoint-only grade is almost flat, dense grade is intentionally dangerous.
{
  const ridge = (x, z) => 70 * Math.exp(-((x / 13) ** 2)) * Math.exp(-((z / 300) ** 8));
  const profile = profileTerrainSegment({
    start: { x: -90, z: 0 },
    end: { x: 90, z: 0 },
    sampleHeightMeters: ridge,
    maxSpacingMeters: 6,
  });
  assert(profile.directGradeDegrees < 0.01, `ridge endpoint grade should look deceptively flat: ${profile.directGradeDegrees}`);
  assert(profile.maxGradeDegrees > 60, `dense profile failed to detect hidden ridge: ${profile.maxGradeDegrees}`);
  assert(profile.elevationRangeMeters > 65);
  assert(profile.maxRiseMeters > 20);
}

// A polyline with ascent then descent must account both signed directions and preserve endpoints.
{
  const sampler = (x, z) => 0.015 * x + 18 * Math.exp(-(((x - 100) / 75) ** 2)) + 2 * Math.sin(z / 40);
  const points = [
    { x: 0, z: 0 },
    { x: 100, z: 20 },
    { x: 220, z: -10 },
    { x: 360, z: 30 },
  ];
  const profile = profileRoadPolyline({ points, sampleHeightMeters: sampler, maxSpacingMeters: 8 });
  assert.equal(profile.sourcePointCount, points.length);
  assert(profile.densifiedPointCount > points.length);
  assert(profile.totalAscentMeters > 0);
  assert(profile.totalDescentMeters > 0);
  assert(profile.lengthMeters > Math.hypot(360, 30));
  assert(profile.roughnessRmsMeters > 0);
  assert(Number.isFinite(profile.maxGradeDegrees));
  const first = profile.points[0];
  const last = profile.points.at(-1);
  approx(first.x, points[0].x, 1e-12, 'polyline first x');
  approx(first.z, points[0].z, 1e-12, 'polyline first z');
  approx(last.x, points.at(-1).x, 1e-12, 'polyline last x');
  approx(last.z, points.at(-1).z, 1e-12, 'polyline last z');
}

// Single point is a valid zero-length road profile.
{
  const profile = profileRoadPolyline({
    points: [{ x: 4, z: 9 }],
    sampleHeightMeters: () => 12,
  });
  assert.equal(profile.lengthMeters, 0);
  assert.equal(profile.maxGradeDegrees, 0);
  assert.equal(profile.densifiedPointCount, 1);
  assert.equal(profile.points[0].y, 12);
}

// Safety predicate is exact at the cap and rejects non-finite profiles.
assert.equal(pathIsGradeSafe({ maxGradeDegrees: 19.25 }, 19.25), true);
assert.equal(pathIsGradeSafe({ maxGradeDegrees: 19.25001 }, 19.25), false);
assert.equal(pathIsGradeSafe({ maxGradeDegrees: Number.NaN }, 19.25), false);
assert.throws(() => pathIsGradeSafe({ maxGradeDegrees: 2 }, 91), /between 0 and 90/);

// Curvature diagnostics.
{
  const straight = summarizePolylineCurvature([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }]);
  assert.equal(straight.turnCount, 0);
  assert.equal(straight.totalTurnDegrees, 0);
  const rightAngle = summarizePolylineCurvature([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }]);
  assert.equal(rightAngle.turnCount, 1);
  approx(rightAngle.maxTurnDegrees, 90, 1e-12, 'right-angle curvature');
  approx(rightAngle.totalTurnDegrees, 90, 1e-12, 'right-angle total curvature');
}

// Deterministic checksums must be coordinate/height sensitive but repeat exactly.
{
  const sampler = (x, z) => 4 * Math.sin(x / 50) + 3 * Math.cos(z / 70);
  const points = [{ x: -120, z: -40 }, { x: 0, z: 20 }, { x: 140, z: 75 }];
  const a = profileRoadPolyline({ points, sampleHeightMeters: sampler });
  const b = profileRoadPolyline({ points, sampleHeightMeters: sampler });
  const aHash = checksumProfile(a);
  const bHash = checksumProfile(b);
  assert.equal(aHash, bHash);
  assert.match(aHash, /^[0-9a-f]{8}$/);
  const changed = profileRoadPolyline({ points: [...points.slice(0, 2), { x: 141, z: 75 }], sampleHeightMeters: sampler });
  assert.notEqual(checksumProfile(changed), aHash, 'checksum failed to notice a changed route endpoint');
}

// Invalid inputs must fail loudly instead of propagating NaN into A* diagnostics.
assert.throws(() => profileTerrainSegment({ start: null, end: { x: 1, z: 1 }, sampleHeightMeters: () => 0 }), /point/);
assert.throws(() => profileTerrainSegment({ start: { x: 0, z: 0 }, end: { x: 1, z: 1 }, sampleHeightMeters: null }), /function/);
assert.throws(() => profileRoadPolyline({ points: [], sampleHeightMeters: () => 0 }), /non-empty/);
assert.throws(() => profileRoadPolyline({ points: [{ x: Number.NaN, z: 0 }], sampleHeightMeters: () => 0 }), /finite/);

console.log('[checkRoadSurfaceProfileNumerics] PASS');
console.log(JSON.stringify({
  policy: ROAD_PROFILE_POLICY,
  gradeCapsVerified: [0, 10, 17, 19.25],
  hiddenSubedgeDetection: true,
  ascentDescentAccounting: true,
  deterministicChecksum: true,
  curvatureDiagnostics: true,
  invalidInputGuards: true,
}, null, 2));
