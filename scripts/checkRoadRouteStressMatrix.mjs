#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { ROAD_RETURN_GRADE_TARGET_DEGREES, ROAD_ROUTING_POLICY, findSlopeAwarePath } from '../src/3d/world/roadPathfinder.js';
import { assertRouteFinite, basinField, composeFields, mountainField, ridgeField, rollingField, routeMetrics, saddleField, seededRandom, summarize, terraceField, writeJsonArtifact } from './lib/roadRouteQa.mjs';

const rng = seededRandom(0x524f4144);
const scenarios = [];
function addScenario(name, sampleHeightMeters, start, end, extra = {}) { scenarios.push(Object.freeze({ name, sampleHeightMeters, start, end, ...extra })); }
for (let index = 0; index < 8; index += 1) {
  const angle = (index / 8) * Math.PI, radius = 900 + index * 35;
  const start = { x: Math.cos(angle) * -radius, z: Math.sin(angle) * -radius }, end = { x: -start.x, z: -start.z };
  const sample = (x, z) => mountainField(x, z, { radiusMeters: 500 + index * 22, heightMeters: 130 + index * 13, shoulderOffsetX: 140 + index * 17, shoulderOffsetZ: -220 + index * 21, seed: index + 1 });
  addScenario(`mountain-${index}`, sample, start, end, { family: 'mountain' });
}
for (let index = 0; index < 8; index += 1) {
  const angle = (index / 8) * Math.PI * 0.85 + 0.11;
  const start = { x: -950, z: -320 + index * 90 }, end = { x: 950, z: 250 - index * 65 };
  const sample = composeFields((x, z) => ridgeField(x, z, { widthMeters: 26 + index * 5, lengthMeters: 720 + index * 80, heightMeters: 70 + index * 9, angleRadians: angle }), (x, z) => rollingField(x, z, index) * 0.45);
  addScenario(`ridge-${index}`, sample, start, end, { family: 'ridge' });
}
for (let index = 0; index < 7; index += 1) {
  const angle = 0.2 + index * 0.31;
  const sample = composeFields((x, z) => saddleField(x, z, { separationMeters: 330 + index * 45, radiusMeters: 330 + index * 26, heightMeters: 95 + index * 13, angleRadians: angle }), (x, z) => rollingField(x, z, 20 + index) * 0.35);
  addScenario(`saddle-${index}`, sample, { x: -980 + index * 20, z: -520 + index * 75 }, { x: 950 - index * 18, z: 490 - index * 52 }, { family: 'saddle' });
}
for (let index = 0; index < 6; index += 1) {
  const sample = composeFields((x, z) => terraceField(x, z, { axis: index % 2 ? 'z' : 'x', stepMeters: 155 + index * 22, riseMeters: 8 + index * 1.7, blurMeters: 38 + index * 4 }), (x, z) => rollingField(x, z, 40 + index) * 0.28);
  addScenario(`terrace-${index}`, sample, { x: -820 + index * 28, z: -690 + index * 35 }, { x: 870 - index * 22, z: 720 - index * 42 }, { family: 'terrace' });
}
for (let index = 0; index < 7; index += 1) {
  const basinX = -150 + index * 55, basinZ = 120 - index * 42;
  const sample = composeFields((x, z) => basinField(x, z, { centerX: basinX, centerZ: basinZ, radiusMeters: 330 + index * 28, depthMeters: 35 + index * 4, rimHeightMeters: 25 + index * 3.2 }), (x, z) => mountainField(x, z, { centerX: basinX + 180, centerZ: basinZ - 210, radiusMeters: 520, heightMeters: 90 + index * 8, seed: 60 + index }) * 0.62);
  addScenario(`cirque-${index}`, sample, { x: -980, z: -430 + index * 45 }, { x: 960, z: 510 - index * 38 }, { family: 'cirque' });
}
for (let index = 0; index < 6; index += 1) {
  const centers = Array.from({ length: 4 }, () => ({ x: -500 + rng() * 1000, z: -500 + rng() * 1000, radius: 180 + rng() * 280, height: 30 + rng() * 90 }));
  const sample = (x, z) => { let height = rollingField(x, z, 80 + index) * 0.55; for (const feature of centers) height += mountainField(x, z, { centerX: feature.x, centerZ: feature.z, radiusMeters: feature.radius, heightMeters: feature.height, shoulderHeightMeters: feature.height * 0.18, seed: index + feature.x }); return height; };
  addScenario(`mixed-${index}`, sample, { x: -1050, z: -700 + index * 220 }, { x: 1050, z: 680 - index * 180 }, { family: 'mixed' });
}
assert(scenarios.length >= 40, `stress matrix unexpectedly small: ${scenarios.length}`);
const records = [], startTime = performance.now();
for (const scenario of scenarios) {
  const started = performance.now();
  const result = findSlopeAwarePath({ sampleHeightMeters: scenario.sampleHeightMeters, start: scenario.start, end: scenario.end });
  const elapsedMs = performance.now() - started;
  assertRouteFinite(result, scenario.name);
  const metrics = routeMetrics({ result, sampleHeightMeters: scenario.sampleHeightMeters, start: scenario.start, end: scenario.end, profileSpacingMeters: 6 });
  assert.equal(metrics.fallback, false, `${scenario.name} unexpectedly used fallback`);
  assert(metrics.maxGradeDegrees <= ROAD_RETURN_GRADE_TARGET_DEGREES + 0.05, `${scenario.name} dense grade ${metrics.maxGradeDegrees} exceeds ${ROAD_RETURN_GRADE_TARGET_DEGREES}`);
  assert(metrics.detourRatio >= 0.999 && metrics.detourRatio < 3.5, `${scenario.name} invalid detour ${metrics.detourRatio}`);
  assert(metrics.pointCount < 1600, `${scenario.name} returned too many presentation points: ${metrics.pointCount}`);
  records.push({ name: scenario.name, family: scenario.family, elapsedMs: Number(elapsedMs.toFixed(3)), ...metrics });
}
const elapsedMs = performance.now() - startTime;
const gradeValues = records.map((r) => r.maxGradeDegrees), detours = records.map((r) => r.detourRatio), expansionValues = records.map((r) => r.expandedNodes ?? 0), elapsedValues = records.map((r) => r.elapsedMs);
const refinedCount = records.filter((r) => r.cellMeters !== null && r.cellMeters < ROAD_ROUTING_POLICY.gridCellMeters).length;
const widenedCount = records.filter((r) => r.paddingMeters !== null && r.paddingMeters > ROAD_ROUTING_POLICY.baseCorridorPaddingMeters).length;
assert(Math.max(...gradeValues) < 19.4, `stress max grade too close to hard ceiling: ${Math.max(...gradeValues)}`); assert(elapsedMs < 12000, `synthetic stress matrix exceeded 12s: ${elapsedMs.toFixed(1)}ms`);
const report = Object.freeze({ policy: ROAD_ROUTING_POLICY, scenarioCount: scenarios.length, elapsedMs: Number(elapsedMs.toFixed(3)), refinedCount, widenedCount, distributions: { gradeDegrees: summarize(gradeValues), detourRatio: summarize(detours), expandedNodes: summarize(expansionValues, 2), elapsedMs: summarize(elapsedValues, 3) }, records });
writeJsonArtifact('artifacts/road-route-exact-head/stress-matrix.json', report);
console.log('[checkRoadRouteStressMatrix] PASS'); console.log(JSON.stringify(report, null, 2));
