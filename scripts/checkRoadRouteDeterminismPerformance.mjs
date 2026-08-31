#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  ROAD_RETURN_GRADE_TARGET_DEGREES,
  ROAD_ROUTING_POLICY,
  findSlopeAwarePath,
} from '../src/3d/world/roadPathfinder.js';
import {
  composeFields,
  mountainField,
  ridgeField,
  rollingField,
  routeMetrics,
  seededRandom,
  summarize,
  writeJsonArtifact,
} from './lib/roadRouteQa.mjs';

const rng = seededRandom(0x5afe2026);
const routeSpecs = Array.from({ length: 24 }, (_, index) => {
  const startAngle = rng() * Math.PI * 2;
  const endAngle = startAngle + Math.PI * (0.65 + rng() * 0.7);
  const startRadius = 700 + rng() * 550;
  const endRadius = 700 + rng() * 550;
  const start = { x: Math.cos(startAngle) * startRadius, z: Math.sin(startAngle) * startRadius };
  const end = { x: Math.cos(endAngle) * endRadius, z: Math.sin(endAngle) * endRadius };
  const terrainSeed = 100 + index;
  const mountain = Object.freeze({
    centerX: -220 + rng() * 440,
    centerZ: -220 + rng() * 440,
    radiusMeters: 380 + rng() * 300,
    heightMeters: 65 + rng() * 75,
    seed: terrainSeed,
  });
  const ridge = Object.freeze({
    centerX: -160 + rng() * 320,
    centerZ: -160 + rng() * 320,
    widthMeters: 35 + rng() * 70,
    lengthMeters: 550 + rng() * 550,
    heightMeters: 20 + rng() * 38,
    angleRadians: rng() * Math.PI,
  });
  const sampleHeightMeters = composeFields(
    (x, z) => mountainField(x, z, mountain),
    (x, z) => ridgeField(x, z, ridge) * 0.65,
    (x, z) => rollingField(x, z, terrainSeed) * 0.35,
  );
  return { name: `det-${index.toString().padStart(2, '0')}`, start, end, sampleHeightMeters };
});

function runMatrix() {
  const records = [];
  const started = performance.now();
  for (const spec of routeSpecs) {
    const routeStarted = performance.now();
    const result = findSlopeAwarePath({ sampleHeightMeters: spec.sampleHeightMeters, start: spec.start, end: spec.end });
    const routeElapsedMs = performance.now() - routeStarted;
    const metrics = routeMetrics({ result, sampleHeightMeters: spec.sampleHeightMeters, start: spec.start, end: spec.end, profileSpacingMeters: 6 });
    records.push({ name: spec.name, routeElapsedMs: Number(routeElapsedMs.toFixed(3)), ...metrics });
  }
  return { elapsedMs: performance.now() - started, records };
}

const warmup = runMatrix();
const first = runMatrix();
const second = runMatrix();
assert.equal(first.records.length, routeSpecs.length);
assert.equal(second.records.length, routeSpecs.length);
for (let index = 0; index < first.records.length; index += 1) {
  const a = first.records[index]; const b = second.records[index];
  assert.equal(a.name, b.name);
  assert.equal(a.checksum, b.checksum, `${a.name} checksum drifted between identical runs`);
  assert.equal(a.pointCount, b.pointCount, `${a.name} point count drifted`);
  assert.equal(a.maxGradeDegrees, b.maxGradeDegrees, `${a.name} grade drifted`);
  assert.equal(a.detourRatio, b.detourRatio, `${a.name} detour drifted`);
  assert.equal(a.cellMeters, b.cellMeters, `${a.name} refinement stage drifted`);
  assert.equal(a.paddingMeters, b.paddingMeters, `${a.name} padding stage drifted`);
  assert.equal(a.smoothingIterations, b.smoothingIterations, `${a.name} smoothing choice drifted`);
  assert.equal(a.expandedNodes, b.expandedNodes, `${a.name} A* expansion count drifted`);
  if (!a.fallback) assert(a.maxGradeDegrees <= ROAD_RETURN_GRADE_TARGET_DEGREES + 0.05, `${a.name} unsafe accepted grade ${a.maxGradeDegrees}`);
  else assert(a.maxGradeDegrees > ROAD_RETURN_GRADE_TARGET_DEGREES, `${a.name} fallback hid a route that was already grade-safe`);
}
const checksums = first.records.map((record) => record.checksum);
assert(new Set(checksums).size >= 20, 'route checksum diversity collapsed unexpectedly');
const routeTimes = first.records.map((record) => record.routeElapsedMs);
const expandedNodes = first.records.map((record) => record.expandedNodes ?? 0);
const pointCounts = first.records.map((record) => record.pointCount);
const grades = first.records.map((record) => record.maxGradeDegrees);
const attemptCounts = first.records.map((record) => record.attemptCount);
const fallbackCount = first.records.filter((record) => record.fallback).length;
assert(fallbackCount <= 5, `too many synthetic routes became physically unroutable: ${fallbackCount}`);
assert(first.elapsedMs < 5000, `24-route profiled pass exceeded 5s: ${first.elapsedMs.toFixed(1)}ms`);
assert(Math.max(...routeTimes) < 1000, `single route exceeded 1s: ${Math.max(...routeTimes)}ms`);
assert(Math.max(...expandedNodes) < 25000, `expanded node count exploded: ${Math.max(...expandedNodes)}`);
assert(Math.max(...pointCounts) < 2000, `densified presentation count exploded: ${Math.max(...pointCounts)}`);
const report = Object.freeze({
  policy: ROAD_ROUTING_POLICY,
  routeCount: routeSpecs.length,
  warmupElapsedMs: Number(warmup.elapsedMs.toFixed(3)),
  firstElapsedMs: Number(first.elapsedMs.toFixed(3)),
  secondElapsedMs: Number(second.elapsedMs.toFixed(3)),
  checksumUniqueCount: new Set(checksums).size,
  fallbackCount,
  distributions: {
    routeElapsedMs: summarize(routeTimes, 3),
    expandedNodes: summarize(expandedNodes, 2),
    pointCount: summarize(pointCounts, 2),
    maxGradeDegrees: summarize(grades),
    attemptCount: summarize(attemptCounts, 2),
  },
  routes: first.records,
});
writeJsonArtifact('artifacts/road-route-exact-head/determinism-performance.json', report);
console.log('[checkRoadRouteDeterminismPerformance] PASS');
console.log(JSON.stringify(report, null, 2));
