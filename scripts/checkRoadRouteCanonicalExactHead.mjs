#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } from '../src/3d/config.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } from '../src/3d/world/settlements.js';
import { buildRoadNetwork, computeSeatMST } from '../src/3d/world/roads.js';
import { ROAD_MAX_RIVER_ADJACENT_SAMPLES, ROAD_RETURN_GRADE_TARGET_DEGREES, ROAD_ROUTING_POLICY } from '../src/3d/world/roadPathfinder.js';
import { ROAD_PROFILE_POLICY, profileRoadPolyline } from '../src/3d/world/roadSurfaceProfile.js';
import { generateRiverPath } from '../src/3d/world/rivers.js';
import { routeMetrics, summarize, writeJsonArtifact, writeMarkdownArtifact } from './lib/roadRouteQa.mjs';

const startedAt = performance.now();
const baseSampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
const flattenPads = computeSettlementFlattenPads({ sampleHeightMeters: baseSampleHeightMeters, seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS, minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS, mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
const seats = KINGDOM_SEATS.map((seat) => {
  const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
  return Object.freeze({ id: seat.id, mapX: seat.mapX, mapY: seat.mapY, x, z, groundY: sampleHeightMeters(x, z) });
});
assert.equal(seats.length, 14, 'canonical kingdom-seat count drifted');
assert.equal(flattenPads.length, seats.length, 'flatten-pad count must match kingdom seats');
const topology = computeSeatMST(seats);
assert.equal(topology.length, seats.length - 1, 'canonical cart-road topology must remain a spanning tree');

const networkStarted = performance.now();
const network = buildRoadNetwork({ seats, sampleHeightMeters });
const networkBuildMs = performance.now() - networkStarted;
const unroutableEdges = network.unroutableEdges ?? [];
const expectedTransportGaps = [
  'jon->Night King',
  'robin->berkalp',
  'stannis->robin',
  'twin->balon',
  'umit->Xaro',
  'umit->doran',
];
assert.equal(network.edges.length + unroutableEdges.length, 13,
  `expected 13 canonical topology edges, got ${network.edges.length} routed + ${unroutableEdges.length} unroutable`);
assert.equal(network.edges.length, 7, `expected 7 land-safe rendered cart roads, got ${network.edges.length}`);
assert.equal(unroutableEdges.length, expectedTransportGaps.length,
  `expected ${expectedTransportGaps.length} explicit transport gaps, got ${unroutableEdges.length}`);
const seatIds = new Set(seats.map((seat) => seat.id));
const connectedIds = new Set();
const edgeRecords = [];
for (const edge of network.edges) {
  connectedIds.add(edge.fromId); connectedIds.add(edge.toId);
  assert(seatIds.has(edge.fromId), `road has unknown fromId ${edge.fromId}`);
  assert(seatIds.has(edge.toId), `road has unknown toId ${edge.toId}`);
  assert(edge.points.length >= 2, `${edge.fromId}->${edge.toId} returned <2 points`);
  const dense = profileRoadPolyline({ points: edge.points, sampleHeightMeters, maxSpacingMeters: 6 });
  if (dense.maxGradeDegrees > ROAD_RETURN_GRADE_TARGET_DEGREES + 0.05) {
    writeJsonArtifact('artifacts/road-route-exact-head/canonical-failing-edge.json', {
      exactHead: process.env.EXPECTED_HEAD_SHA ?? null,
      fromId: edge.fromId,
      toId: edge.toId,
      sourceMaxGradeDegrees: edge.maxGradeDegrees,
      denseMaxGradeDegrees: dense.maxGradeDegrees,
      targetGradeDegrees: ROAD_RETURN_GRADE_TARGET_DEGREES,
      pointCount: edge.points.length,
      points: edge.points,
    });
  }
  assert(dense.maxGradeDegrees <= ROAD_RETURN_GRADE_TARGET_DEGREES + 0.05, `${edge.fromId}->${edge.toId} dense grade ${dense.maxGradeDegrees.toFixed(3)}° exceeds ${ROAD_RETURN_GRADE_TARGET_DEGREES}°`);
  const diagnostics = edge.diagnostics ?? edge.routeDiagnostics ?? null;
  if (diagnostics) {
    assert.equal(diagnostics.fallback, false, `${edge.fromId}->${edge.toId} used fail-soft fallback`);
    assert(diagnostics.river.maxConsecutiveAdjacentSamples <= ROAD_MAX_RIVER_ADJACENT_SAMPLES, `${edge.fromId}->${edge.toId} ran along canonical river for ${diagnostics.river.maxConsecutiveAdjacentSamples} points`);
  }
  assert(edge.waterExposure?.maxSubmergedRunMeters <= edge.waterExposure?.maxAllowedRunMeters + 1e-9,
    `${edge.fromId}->${edge.toId} rendered through ${edge.waterExposure?.maxSubmergedRunMeters}m of canonical water`);
  let minimumGroundMarginMeters = Infinity, maximumGroundMarginMeters = -Infinity;
  for (const point of edge.points) {
    const ground = sampleHeightMeters(point.x, point.z), margin = ground - WORLD_DEFAULTS.WATER_LEVEL_METERS;
    minimumGroundMarginMeters = Math.min(minimumGroundMarginMeters, margin); maximumGroundMarginMeters = Math.max(maximumGroundMarginMeters, margin);
    assert(Math.abs(point.y - ground) < 1e-8, `${edge.fromId}->${edge.toId} road point no longer sits on authoritative terrain`);
  }
  const metrics = routeMetrics({ result: { points: edge.points, maxGradeDegrees: edge.maxGradeDegrees, diagnostics: diagnostics ?? {} }, sampleHeightMeters, start: edge.points[0], end: edge.points.at(-1), profileSpacingMeters: 6 });
  edgeRecords.push(Object.freeze({ fromId: edge.fromId, toId: edge.toId, sourceMaxGradeDegrees: edge.maxGradeDegrees, routeElapsedMs: edge.routeElapsedMs, minimumGroundMarginMeters, maximumGroundMarginMeters, diagnostics, ...metrics }));
}
const transportGapRecords = [];
for (const edge of unroutableEdges) {
  connectedIds.add(edge.fromId); connectedIds.add(edge.toId);
  assert(seatIds.has(edge.fromId), `transport gap has unknown fromId ${edge.fromId}`);
  assert(seatIds.has(edge.toId), `transport gap has unknown toId ${edge.toId}`);
  const dense = profileRoadPolyline({ points: edge.points, sampleHeightMeters, maxSpacingMeters: 6 });
  const reason = edge.diagnostics?.transportGapReason;
  assert.equal(edge.diagnostics?.transportGap, true,
    `${edge.fromId}->${edge.toId} transport gap lost its explicit topology marker`);
  if (reason === 'grade-fallback') {
    assert.equal(edge.diagnostics?.fallback, true,
      `${edge.fromId}->${edge.toId} grade gap must retain explicit fail-safe diagnostics`);
    assert(edge.diagnostics.directSubmergedSpanMeters >= 900,
      `${edge.fromId}->${edge.toId} fail-fast gap lacks measured submerged geography evidence`);
    assert.equal(edge.diagnostics.crossWaterEvidence, true,
      `${edge.fromId}->${edge.toId} fail-fast gap lost cross-water evidence`);
    assert(dense.maxGradeDegrees > ROAD_RETURN_GRADE_TARGET_DEGREES,
      `${edge.fromId}->${edge.toId} was rejected without measured over-cap terrain`);
  } else {
    assert.equal(reason, 'submerged-route', `${edge.fromId}->${edge.toId} has unknown transport-gap reason ${reason}`);
    assert.equal(edge.diagnostics?.fallback, false,
      `${edge.fromId}->${edge.toId} water gap unexpectedly claims a grade fallback`);
    assert(edge.waterExposure?.maxSubmergedRunMeters > edge.waterExposure?.maxAllowedRunMeters,
      `${edge.fromId}->${edge.toId} water gap lacks a measured submerged ribbon run`);
    assert(dense.maxGradeDegrees <= ROAD_RETURN_GRADE_TARGET_DEGREES + 0.05,
      `${edge.fromId}->${edge.toId} water-only gap unexpectedly exceeds the grade contract`);
  }
  transportGapRecords.push(Object.freeze({
    fromId: edge.fromId,
    toId: edge.toId,
    reason,
    denseMaxGradeDegrees: dense.maxGradeDegrees,
    directDistanceMeters: edge.lengthMeters,
    routeElapsedMs: edge.routeElapsedMs,
    attemptCount: edge.diagnostics.attempts?.length ?? 0,
    fallback: edge.diagnostics.fallback,
    maximumSubmergedRunMeters: edge.waterExposure?.maxSubmergedRunMeters ?? 0,
    totalSubmergedMeters: edge.waterExposure?.totalSubmergedMeters ?? 0,
  }));
}
assert.deepEqual(transportGapRecords.map(({ fromId, toId }) => `${fromId}->${toId}`).sort(), expectedTransportGaps,
  'canonical water/grade transport-gap set drifted');
assert.equal(connectedIds.size, seats.length, `only ${connectedIds.size}/${seats.length} seats are road-connected`);

const { points: riverPoints, endReason: riverEndReason } = generateRiverPath({ seed: WORLD_DEFAULTS.WORLD_SEED, sampleHeightMeters, seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS });
assert(riverPoints.length > 1, 'canonical river unexpectedly disappeared');
let worstLegacyRiverRun = 0, roadRiverContactCount = 0;
for (const edge of network.edges) {
  let run = 0;
  for (const point of edge.points) {
    let nearest = Infinity;
    for (const riverPoint of riverPoints) nearest = Math.min(nearest, Math.hypot(point.x - riverPoint.x, point.z - riverPoint.z));
    if (nearest < 25) { roadRiverContactCount += 1; run += 1; worstLegacyRiverRun = Math.max(worstLegacyRiverRun, run); } else run = 0;
  }
}
assert(worstLegacyRiverRun <= 3, `canonical road still reads as running alongside river: ${worstLegacyRiverRun} consecutive route points`);
const gradeValues = edgeRecords.map((record) => record.maxGradeDegrees);
const lengthValues = edgeRecords.map((record) => record.lengthMeters);
const detourValues = edgeRecords.map((record) => record.detourRatio);
const expansionValues = edgeRecords.map((record) => record.expandedNodes ?? 0);
const minGroundMargins = edgeRecords.map((record) => record.minimumGroundMarginMeters);
const totalElapsedMs = performance.now() - startedAt;
console.log('[checkRoadRouteCanonicalExactHead] edge timings');
console.log(JSON.stringify([
  ...edgeRecords.map(({ fromId, toId, routeElapsedMs, maxGradeDegrees, diagnostics }) => ({ fromId, toId, routeElapsedMs, maxGradeDegrees, attemptCount: diagnostics?.attempts?.length ?? 0, fallback: false })),
  ...transportGapRecords.map((gap) => ({ ...gap, maxGradeDegrees: gap.denseMaxGradeDegrees })),
], null, 2));
assert(Math.max(...gradeValues) < 19.5, `canonical network grade envelope too close to 20°: ${Math.max(...gradeValues)}`);
assert(network.totalLengthMeters > 6000 && network.totalLengthMeters < 15000, `canonical rendered land-road length drifted implausibly: ${network.totalLengthMeters}m`);
assert(networkBuildMs < 20000, `road network build exceeded 20s Node budget: ${networkBuildMs.toFixed(1)}ms`);
const report = Object.freeze({
  exactHead: process.env.EXPECTED_HEAD_SHA ?? null,
  policies: { routing: ROAD_ROUTING_POLICY, surfaceProfile: ROAD_PROFILE_POLICY },
  runtime: { seatCount: seats.length, topologyEdgeCount: network.edges.length + unroutableEdges.length, renderedRoadEdgeCount: network.edges.length, transportGapCount: unroutableEdges.length, connectedSeatCount: connectedIds.size, totalLengthMeters: network.totalLengthMeters, networkBuildMs, totalElapsedMs, riverPointCount: riverPoints.length, riverEndReason, roadRiverContactCount, worstLegacyRiverRun },
  distributions: { maxGradeDegrees: summarize(gradeValues), edgeLengthMeters: summarize(lengthValues), detourRatio: summarize(detourValues), expandedNodes: summarize(expansionValues, 2), minimumGroundMarginMeters: summarize(minGroundMargins) },
  seats,
  edges: edgeRecords,
  transportGaps: transportGapRecords,
});
writeJsonArtifact('artifacts/road-route-exact-head/canonical-network.json', report);
writeMarkdownArtifact('artifacts/road-route-exact-head/canonical-network.md', [
  '# Canonical road exact-head report', '', `- exact head: ${report.exactHead ?? 'local'}`, `- seats connected: ${connectedIds.size}/${seats.length}`,
  `- rendered cart-road edges: ${network.edges.length}`, `- non-rendered transport gaps: ${unroutableEdges.length}`, `- network length: ${(network.totalLengthMeters / 1000).toFixed(2)} km`, `- network build: ${networkBuildMs.toFixed(1)} ms`,
  `- dense max grade: ${Math.max(...gradeValues).toFixed(2)}°`, `- river point run: ${worstLegacyRiverRun} (limit 3)`, '',
  '| edge | km | dense max grade | detour | points |', '| --- | ---: | ---: | ---: | ---: |',
  ...edgeRecords.map((edge) => `| ${edge.fromId} → ${edge.toId} | ${(edge.lengthMeters / 1000).toFixed(2)} | ${edge.maxGradeDegrees.toFixed(2)}° | ${edge.detourRatio.toFixed(3)} | ${edge.pointCount} |`),
]);
console.log('[checkRoadRouteCanonicalExactHead] PASS');
console.log(JSON.stringify(report, null, 2));
