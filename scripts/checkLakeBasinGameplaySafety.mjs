#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import { KINGDOM_SEATS, mapToWorldXZ } from '../src/3d/world/settlements.js';
import { createHeightSampler, terrainLakeBasinDryScale } from '../src/3d/world/terrain.js';
import { sampleReferenceLakeDistanceNormalized } from '../src/3d/world/worldReferenceMountainRelief.js';
import {
  runNodeCheck,
  requireSuccessfulCheck,
  round,
  summarize,
  worldToNormalized,
  writeJsonArtifact,
} from './lib/lakeBasinQa.mjs';

assert.equal(KINGDOM_SEATS.length, 14, 'kingdom-seat gameplay contract changed');
const sampleHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);

const seatExposure = [];
for (const seat of KINGDOM_SEATS) {
  const world = mapToWorldXZ(
    seat.mapX,
    seat.mapY,
    WORLD_SCALE.MAP_BOUNDS,
    WORLD_SCALE.METERS_PER_MAP_UNIT,
  );
  const normalized = worldToNormalized(world.x, world.z, WORLD_SCALE);
  const dryScale = terrainLakeBasinDryScale(normalized.nx, normalized.ny);
  const lakeDistance = sampleReferenceLakeDistanceNormalized(normalized.nx, normalized.ny);
  const rawHeight = sampleHeight(world.x, world.z);
  seatExposure.push(Object.freeze({
    id: seat.id,
    mapX: seat.mapX,
    mapY: seat.mapY,
    worldX: round(world.x, 3),
    worldZ: round(world.z, 3),
    nx: round(normalized.nx, 6),
    ny: round(normalized.ny, 6),
    lakeDistance: round(lakeDistance, 6),
    dryScale: round(dryScale, 6),
    rawHeightMeters: round(rawHeight, 3),
    rawMarginAboveWaterMeters: round(rawHeight - WORLD_DEFAULTS.WATER_LEVEL_METERS, 3),
  }));
}

assert(seatExposure.every((seat) => Number.isFinite(seat.rawHeightMeters)));
assert(seatExposure.every((seat) => seat.rawMarginAboveWaterMeters > 0),
  'a kingdom seat is underwater before the dedicated gameplay safety check even runs');

const checks = [
  Object.freeze({
    id: 'terrain-seat-safety',
    script: 'scripts/terrainSeatSafetyCheck.js',
    timeoutMs: 240000,
    expectedPassText: '[terrainSeatSafetyCheck] PASS',
  }),
  Object.freeze({
    id: 'road-network-safety',
    script: 'scripts/roadNetworkSafetyCheck.js',
    timeoutMs: 300000,
    expectedPassText: '[roadNetworkSafetyCheck] PASS',
  }),
];

const executed = [];
for (const check of checks) {
  const started = performance.now();
  const result = runNodeCheck(check.script, { timeoutMs: check.timeoutMs });
  const elapsedMs = performance.now() - started;
  requireSuccessfulCheck(result);
  assert(result.stdout.includes(check.expectedPassText),
    `${check.id} exited zero but did not emit its authoritative PASS marker`);
  assert(!/\bFAIL\b/.test(result.stdout), `${check.id} output contains a FAIL marker despite exit zero`);
  executed.push(Object.freeze({
    id: check.id,
    script: check.script,
    elapsedMs: round(elapsedMs, 2),
    status: result.status,
    stdoutBytes: Buffer.byteLength(result.stdout, 'utf8'),
    stderrBytes: Buffer.byteLength(result.stderr, 'utf8'),
    passMarker: check.expectedPassText,
    stdoutTail: result.stdout.trim().split('\n').slice(-8),
    stderrTail: result.stderr.trim().split('\n').filter(Boolean).slice(-8),
  }));
}

const seatDryScales = seatExposure.map((seat) => seat.dryScale);
const seatLakeDistances = seatExposure.map((seat) => seat.lakeDistance);
const seatMargins = seatExposure.map((seat) => seat.rawMarginAboveWaterMeters);
const affectedSeats = seatExposure.filter((seat) => seat.dryScale < 0.999999);
const stronglyAffectedSeats = seatExposure.filter((seat) => seat.dryScale < 0.50);

assert(stronglyAffectedSeats.every((seat) => seat.dryScale >= 0.03),
  `kingdom seat entered an effectively flattened lake core: ${JSON.stringify(stronglyAffectedSeats)}`);

const report = Object.freeze({
  seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
  gameplayChecks: executed,
  seats: seatExposure,
  seatExposureSummary: {
    dryScale: summarize(seatDryScales, 6),
    lakeDistance: summarize(seatLakeDistances, 6),
    rawMarginAboveWaterMeters: summarize(seatMargins, 3),
    affectedSeatCount: affectedSeats.length,
    stronglyAffectedSeatCount: stronglyAffectedSeats.length,
    affectedSeatIds: affectedSeats.map((seat) => seat.id),
    stronglyAffectedSeatIds: stronglyAffectedSeats.map((seat) => seat.id),
  },
});

writeJsonArtifact('artifacts/lake-basin-exact-head/gameplay-safety.json', report);
console.log('[checkLakeBasinGameplaySafety] PASS');
console.log(JSON.stringify(report, null, 2));
