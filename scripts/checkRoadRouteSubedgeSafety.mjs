#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ROAD_MAX_GRADE_DEGREES,
  ROAD_RETURN_GRADE_TARGET_DEGREES,
  ROAD_ROUTING_POLICY,
  findSlopeAwarePath,
} from '../src/3d/world/roadPathfinder.js';
import {
  ROAD_PROFILE_POLICY,
  checksumProfile,
  pathIsGradeSafe,
  profileRoadPolyline,
  profileTerrainSegment,
} from '../src/3d/world/roadSurfaceProfile.js';
import { writeJsonArtifact } from './lib/roadRouteQa.mjs';

const round = (value, digits = 4) => Number(value.toFixed(digits));
function hiddenKnifeRidge(x, z) { return 68 * Math.exp(-(((x - 30) / 12) ** 2)) * Math.exp(-((z / 560) ** 8)) + 3.5 * Math.sin(x / 210) + 2.1 * Math.cos(z / 185); }
function broadMountain(x, z) { const radius = Math.hypot(x, z); return 175 * Math.exp(-((radius / 520) ** 2)) + 36 * Math.exp(-((((x - 180) / 330) ** 2) + (((z + 120) / 420) ** 2))) + 2.8 * Math.sin(x / 190) * Math.cos(z / 160); }
function steepPadWithRamp(x, z) { const plateau = x > -120 && x < 160 && Math.abs(z) < 260 ? 95 : 0; const ramp = Math.max(0, Math.min(1, (z + 500) / 240)) * 95; if (x > -120 && x < 160 && z >= -500 && z < -260) return ramp; return plateau; }
function impossibleCliff(x) { return x >= 0 ? 110 : 0; }

const fixtures = [];
{
  const start = { x: -460, z: 0 }, end = { x: 460, z: 0 };
  const direct = profileTerrainSegment({ start, end, sampleHeightMeters: hiddenKnifeRidge, maxSpacingMeters: 8 });
  assert(direct.maxGradeDegrees > 55, `knife ridge fixture is not actually dangerous: ${direct.maxGradeDegrees}`);
  const result = findSlopeAwarePath({ sampleHeightMeters: hiddenKnifeRidge, start, end });
  const dense = profileRoadPolyline({ points: result.points, sampleHeightMeters: hiddenKnifeRidge, maxSpacingMeters: 8 });
  assert.equal(result.diagnostics.fallback, false, 'knife-ridge route unexpectedly fell back');
  assert(pathIsGradeSafe(dense, ROAD_RETURN_GRADE_TARGET_DEGREES), `knife-ridge route remains unsafe: ${dense.maxGradeDegrees}`);
  assert(Math.max(...result.points.map((point) => Math.abs(point.z))) > 90, 'knife-ridge route did not visibly detour');
  fixtures.push({ name: 'hidden-knife-ridge', directMaxGrade: round(direct.maxGradeDegrees), routedMaxGrade: round(dense.maxGradeDegrees), maxAbsZ: round(Math.max(...result.points.map((point) => Math.abs(point.z)))), cellMeters: result.diagnostics.cellMeters, paddingMeters: result.diagnostics.paddingMeters, attemptCount: result.diagnostics.attempts.length });
}
{
  const start = { x: -900, z: 0 }, end = { x: 900, z: 0 };
  const result = findSlopeAwarePath({ sampleHeightMeters: broadMountain, start, end });
  const dense = profileRoadPolyline({ points: result.points, sampleHeightMeters: broadMountain, maxSpacingMeters: 10 });
  assert.equal(result.diagnostics.fallback, false); assert(dense.maxGradeDegrees <= ROAD_RETURN_GRADE_TARGET_DEGREES + 1e-9);
  assert(Math.max(...result.points.map((point) => Math.abs(point.z))) > 250, 'mountain path did not form a real detour');
  fixtures.push({ name: 'broad-mountain-detour', routedMaxGrade: round(dense.maxGradeDegrees), maxAbsZ: round(Math.max(...result.points.map((point) => Math.abs(point.z)))), smoothingIterations: result.diagnostics.smoothingIterations, expandedNodes: result.diagnostics.expandedNodes });
}
{
  const start = { x: -420, z: -40 }, end = { x: 420, z: 40 };
  const result = findSlopeAwarePath({ sampleHeightMeters: steepPadWithRamp, start, end, corridorPaddingMeters: 720 });
  const dense = profileRoadPolyline({ points: result.points, sampleHeightMeters: steepPadWithRamp, maxSpacingMeters: 8 });
  assert.equal(result.diagnostics.fallback, false, 'ramp fixture should have a legal approach'); assert(dense.maxGradeDegrees <= ROAD_RETURN_GRADE_TARGET_DEGREES + 1e-9);
  fixtures.push({ name: 'endpoint-ramp', routedMaxGrade: round(dense.maxGradeDegrees), paddingMeters: result.diagnostics.paddingMeters, cellMeters: result.diagnostics.cellMeters });
}
{
  const start = { x: -120, z: 0 }, end = { x: 120, z: 0 };
  const result = findSlopeAwarePath({ sampleHeightMeters: impossibleCliff, start, end, corridorPaddingMeters: 180 });
  assert.equal(result.diagnostics.fallback, true, 'physically impossible wall should report fallback rather than hide it'); assert(result.maxGradeDegrees > 60, `fallback must expose dangerous grade, got ${result.maxGradeDegrees}`);
  fixtures.push({ name: 'impossible-cliff-fail-soft', fallback: result.diagnostics.fallback, maxGradeDegrees: round(result.maxGradeDegrees), attemptCount: result.diagnostics.attempts.length });
}
{
  const sample = (x, z) => 8 * Math.sin(x / 170) + 6 * Math.cos(z / 150) + 3 * Math.sin((x + z) / 90);
  const start = { x: -720, z: -410 }, end = { x: 830, z: 520 };
  const first = findSlopeAwarePath({ sampleHeightMeters: sample, start, end }), second = findSlopeAwarePath({ sampleHeightMeters: sample, start, end });
  const firstProfile = profileRoadPolyline({ points: first.points, sampleHeightMeters: sample }), secondProfile = profileRoadPolyline({ points: second.points, sampleHeightMeters: sample });
  assert.deepEqual(first.points, second.points, 'same deterministic input produced different route coordinates'); assert.equal(checksumProfile(firstProfile), checksumProfile(secondProfile)); assert.equal(first.diagnostics.checksum, second.diagnostics.checksum);
  fixtures.push({ name: 'deterministic-repeat', checksum: first.diagnostics.checksum, pointCount: first.points.length, maxGradeDegrees: round(first.maxGradeDegrees) });
}
assert.equal(ROAD_PROFILE_POLICY.geographyAuthorityUnchanged, true); assert.equal(ROAD_ROUTING_POLICY.geographyAuthorityUnchanged, true); assert(ROAD_MAX_GRADE_DEGREES < ROAD_RETURN_GRADE_TARGET_DEGREES); assert(ROAD_RETURN_GRADE_TARGET_DEGREES < 20);
const report = Object.freeze({ policy: ROAD_ROUTING_POLICY, profilePolicy: ROAD_PROFILE_POLICY, fixtures });
writeJsonArtifact('artifacts/road-route-exact-head/subedge-safety.json', report);
console.log('[checkRoadRouteSubedgeSafety] PASS'); console.log(JSON.stringify(report, null, 2));
