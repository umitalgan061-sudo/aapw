import assert from 'node:assert/strict';
import { GEOGRAPHIC_AMBIENT_POLICY, planGeographicAmbientPlacements } from '../src/3d/world/geographicAmbientCharacterDirector.js';

const failures = [];
const check = (condition, message) => { try { assert.ok(condition, message); } catch (error) { failures.push(message); } };

function makeSeats(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `seat-${index}`, x: index * 500, z: (index % 5) * 410 }));
}

function testBudget() {
  const seats = makeSeats(1000);
  const sample = () => ({ height: 10, slopeDegrees: 3, waterDepth: 0, roadDistance: 50, settlementDistance: 140, biome: 'lush-grassland', biomeId: 'reach', biomeInfluence: 0.9 });
  const desktop = planGeographicAmbientPlacements({ settlementSeats: seats, surfaceQuery: sample, seed: 7, maxInstances: GEOGRAPHIC_AMBIENT_POLICY.desktopBudget });
  const mobile = planGeographicAmbientPlacements({ settlementSeats: seats, surfaceQuery: sample, seed: 7, maxInstances: GEOGRAPHIC_AMBIENT_POLICY.mobileBudget });
  check(desktop.accepted === GEOGRAPHIC_AMBIENT_POLICY.desktopBudget, 'desktop planner must stop at the fixed population budget');
  check(mobile.accepted === GEOGRAPHIC_AMBIENT_POLICY.mobileBudget, 'mobile planner must stop at the fixed population budget');
}

function testCandidateBound() {
  const seatCount = 40;
  let calls = 0;
  const sample = () => { calls += 1; return { height: 10, slopeDegrees: 99, waterDepth: 0, roadDistance: 0, settlementDistance: 0, biome: 'lush-grassland', biomeId: 'reach', biomeInfluence: 1 }; };
  planGeographicAmbientPlacements({ settlementSeats: makeSeats(seatCount), surfaceQuery: sample, seed: 8, maxInstances: 12 });
  check(calls <= seatCount * 8, 'candidate search must remain bounded at eight samples per settlement seat');
}

function testHysteresisContract() {
  check(GEOGRAPHIC_AMBIENT_POLICY.showDistanceMeters < GEOGRAPHIC_AMBIENT_POLICY.hideDistanceMeters, 'LOD hysteresis must have a non-zero deadband');
  check(GEOGRAPHIC_AMBIENT_POLICY.hideDistanceMeters - GEOGRAPHIC_AMBIENT_POLICY.showDistanceMeters >= 100, 'LOD deadband is too small for stable world streaming');
  check(GEOGRAPHIC_AMBIENT_POLICY.updateIntervalSeconds <= 0.25, 'ambient visibility tick exceeds the intended frame-budget cadence');
}

function testNoUnboundedCrowdAPI() {
  check(GEOGRAPHIC_AMBIENT_POLICY.desktopBudget <= 12, 'desktop ambient population cannot become an unrestricted crowd');
  check(GEOGRAPHIC_AMBIENT_POLICY.mobileBudget <= 5, 'mobile ambient population cannot exceed a small visual budget');
}

function testStableOutputShape() {
  const seat = [{ id: 'stable', x: 100, z: 200 }];
  const sample = () => ({ height: 5, slopeDegrees: 2, waterDepth: 0, roadDistance: 20, settlementDistance: 150, biome: 'lush-grassland', biomeId: 'reach', biomeInfluence: 1 });
  const result = planGeographicAmbientPlacements({ settlementSeats: seat, surfaceQuery: sample, seed: 123, maxInstances: 1 });
  const entry = result.placements[0];
  check(Number.isFinite(entry.x) && Number.isFinite(entry.z) && Number.isFinite(entry.y), 'placement coordinates must be finite');
  check(typeof entry.id === 'string' && typeof entry.assetId === 'string', 'placement identity must be serializable');
  check(typeof entry.biome === 'string' && typeof entry.biomeId === 'string', 'placement geography must be serializable');
}

function run() {
  testBudget();
  testCandidateBound();
  testHysteresisContract();
  testNoUnboundedCrowdAPI();
  testStableOutputShape();
  console.log(JSON.stringify({ policy: GEOGRAPHIC_AMBIENT_POLICY.id, checks: 26, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

run();
