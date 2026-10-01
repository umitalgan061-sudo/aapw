import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GEOGRAPHIC_AMBIENT_POLICY,
  AMBIENT_CHARACTER_ASSETS,
  geographicBiomeAtWorldXZ,
  buildAmbientSurfaceQuery,
  planGeographicAmbientPlacements,
  chooseAmbientCharacterProfile,
} from '../src/3d/world/geographicAmbientCharacterDirector.js';
import { REFERENCE_BIOME_ZONES, WORLD_REFERENCE_MAP } from '../src/3d/world/worldReferenceMap.js';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/3d/world/geographicAmbientCharacterDirector.js'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
const failures = [];
const check = (condition, message) => {
  try { assert.ok(condition, message); }
  catch (error) { failures.push(error.message); }
};
const equal = (actual, expected, message) => {
  try { assert.deepStrictEqual(actual, expected, message); }
  catch (error) { failures.push(error.message); }
};

function flatGroundSampler(height = 10) {
  return { getGroundHeight: () => height };
}

function slopedGroundSampler() {
  return { getGroundHeight: (x, z) => 10 + x * 0.75 + z * 0.45 };
}

function surfaceSample(overrides = {}) {
  return {
    height: 10,
    slopeDegrees: 4,
    waterDepth: 0,
    roadDistance: 40,
    settlementDistance: 140,
    biome: 'lush-grassland',
    biomeId: 'reach',
    biomeInfluence: 0.93,
    ...overrides,
  };
}

function makeRoadEdges() {
  return [
    { points: [{ x: -300, z: 0 }, { x: 300, z: 0 }] },
    { points: [{ x: 0, z: -300 }, { x: 0, z: 300 }] },
  ];
}

function assertSeededDeterminism() {
  const seats = [
    { id: 'alpha', x: 0, z: 0 },
    { id: 'beta', x: 700, z: 350 },
    { id: 'gamma', x: -800, z: 510 },
  ];
  const sampler = (x, z) => surfaceSample({ height: 12 + x * 0.001 + z * 0.0005 });
  const first = planGeographicAmbientPlacements({ settlementSeats: seats, surfaceQuery: sampler, seed: 123456, maxInstances: 12 });
  const second = planGeographicAmbientPlacements({ settlementSeats: seats, surfaceQuery: sampler, seed: 123456, maxInstances: 12 });
  equal(second, first, 'same seed must produce byte-equivalent ambient placement plans');
  check(first.accepted <= 12, 'desktop budget may not be exceeded');
  check(first.placements.length === first.accepted, 'accepted count must equal placement array length');
  check(first.rejected.length >= 0, 'rejection array must always be present');
}

function assertDifferentSeedsDiverge() {
  const seats = [{ id: 'seed-seat', x: 0, z: 0 }];
  const sampler = () => surfaceSample();
  const first = planGeographicAmbientPlacements({ settlementSeats: seats, surfaceQuery: sampler, seed: 101, maxInstances: 1 });
  const second = planGeographicAmbientPlacements({ settlementSeats: seats, surfaceQuery: sampler, seed: 202, maxInstances: 1 });
  check(JSON.stringify(first.placements) !== JSON.stringify(second.placements), 'different seeds should not collapse to one fixed ambient placement');
}

function assertSurfaceRejectionContract() {
  const seats = [{ id: 'reject-seat', x: 0, z: 0 }];
  const slope = planGeographicAmbientPlacements({ settlementSeats: seats, surfaceQuery: () => surfaceSample({ slopeDegrees: 31 }), seed: 7, maxInstances: 1 });
  const water = planGeographicAmbientPlacements({ settlementSeats: seats, surfaceQuery: () => surfaceSample({ waterDepth: 2 }), seed: 7, maxInstances: 1 });
  const road = planGeographicAmbientPlacements({ settlementSeats: seats, surfaceQuery: () => surfaceSample({ roadDistance: 1 }), seed: 7, maxInstances: 1 });
  const nearSeat = planGeographicAmbientPlacements({ settlementSeats: seats, surfaceQuery: () => surfaceSample({ settlementDistance: 20 }), seed: 7, maxInstances: 1 });
  const farSeat = planGeographicAmbientPlacements({ settlementSeats: seats, surfaceQuery: () => surfaceSample({ settlementDistance: 300 }), seed: 7, maxInstances: 1 });
  check(slope.accepted === 0 && slope.rejected.some(({ reason }) => reason === 'slope'), 'steep terrain must reject ambient character');
  check(water.accepted === 0 && water.rejected.some(({ reason }) => reason === 'water'), 'water surface must reject ambient character');
  check(road.accepted === 0 && road.rejected.some(({ reason }) => reason === 'road'), 'road corridor must reject ambient character');
  check(nearSeat.accepted === 0 && nearSeat.rejected.some(({ reason }) => reason === 'settlement-distance'), 'settlement core must reject ambient character');
  check(farSeat.accepted === 0 && farSeat.rejected.some(({ reason }) => reason === 'settlement-distance'), 'remote unbound candidate must reject ambient character');
}

function assertSurfaceQueryContract() {
  const query = buildAmbientSurfaceQuery({
    groundCollider: flatGroundSampler(22),
    roadEdges: makeRoadEdges(),
    settlementSeats: [{ id: 'seat', x: 100, z: 100 }],
    mapBounds: WORLD_SCALE.MAP_BOUNDS,
    metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
    waterLevelMeters: 0,
  });
  const sample = query(260, 170);
  check(sample.height === 22, 'surface query must use canonical ground height');
  check(Number.isFinite(sample.slopeDegrees), 'slope must be finite');
  check(Number.isFinite(sample.roadDistance), 'road distance must be finite when road edges exist');
  check(Number.isFinite(sample.settlementDistance), 'settlement distance must be finite when seats exist');
  check(sample.biome && sample.biomeId, 'geographic biome contract must always return a biome label and id');
  check(sample.waterDepth === 0, 'water depth must remain zero above water level');

  const rising = buildAmbientSurfaceQuery({
    groundCollider: slopedGroundSampler(),
    roadEdges: [],
    settlementSeats: [],
    mapBounds: WORLD_SCALE.MAP_BOUNDS,
    metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
    waterLevelMeters: 0,
  });
  const risingSample = rising(100, 100);
  check(risingSample.slopeDegrees > 0, 'finite-difference slope must detect terrain relief');
}

function assertReferenceGeography() {
  check(WORLD_REFERENCE_MAP.sha256.length === 64, 'canonical reference-map SHA must remain pinned');
  check(WORLD_REFERENCE_MAP.orientation.x === 'west-to-east', 'reference X orientation drifted');
  check(WORLD_REFERENCE_MAP.orientation.y === 'north-to-south', 'reference Y orientation drifted');
  check(REFERENCE_BIOME_ZONES.length >= 10, 'canonical biome coverage unexpectedly shrank');

  for (const zone of REFERENCE_BIOME_ZONES) {
    const world = normalizedReferenceToWorldXZ(zone.center[0], zone.center[1], WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
    const resolved = geographicBiomeAtWorldXZ(world.x, world.z, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
    check(resolved.kind === zone.kind, `zone ${zone.id} must resolve to its authored biome kind at its center`);
    check(resolved.influence > 0, `zone ${zone.id} must have positive influence at its center`);
  }
}

function assertBiomeAssetMapping() {
  const expected = {
    snow: 'knight',
    'cold-grassland': 'knight',
    mountain: 'knight',
    'rocky-hills': 'knight',
    marsh: 'peasant',
    'lush-grassland': 'peasant',
    'temperate-coast': 'peasant',
    jungle: 'peasant',
    desert: 'ranger',
    arid: 'ranger',
    steppe: 'ranger',
  };
  for (const [kind, assetKey] of Object.entries(expected)) {
    const selected = chooseAmbientCharacterProfile(kind, 33);
    check(selected.key === assetKey, `${kind} should resolve to ${assetKey}`);
    check(selected.src === AMBIENT_CHARACTER_ASSETS[assetKey].src, `${kind} profile must use the real authored asset path`);
  }
}

function assertPolicyBoundaries() {
  check(GEOGRAPHIC_AMBIENT_POLICY.sourceMapId === WORLD_REFERENCE_MAP.id, 'director must pin the canonical source map id');
  check(GEOGRAPHIC_AMBIENT_POLICY.sourceMapSha256 === WORLD_REFERENCE_MAP.sha256, 'director must pin the canonical source map hash');
  check(GEOGRAPHIC_AMBIENT_POLICY.placementRadiusMeters.min >= 80, 'ambient ring is too close to settlement geometry');
  check(GEOGRAPHIC_AMBIENT_POLICY.placementRadiusMeters.max <= 300, 'ambient ring is too broad for local geographic identity');
  check(GEOGRAPHIC_AMBIENT_POLICY.maxSlopeDegrees <= 24, 'ambient slope policy must remain conservative');
  check(GEOGRAPHIC_AMBIENT_POLICY.maxWaterDepthMeters <= 0.05, 'ambient water policy must fail closed');
  check(GEOGRAPHIC_AMBIENT_POLICY.desktopBudget <= 12, 'desktop population budget exceeded');
  check(GEOGRAPHIC_AMBIENT_POLICY.mobileBudget <= 5, 'mobile population budget exceeded');
  check(GEOGRAPHIC_AMBIENT_POLICY.showDistanceMeters < GEOGRAPHIC_AMBIENT_POLICY.hideDistanceMeters, 'LOD hysteresis interval is inverted');
}

function assertAssetFirstContract() {
  for (const profile of Object.values(AMBIENT_CHARACTER_ASSETS)) {
    check(profile.src.startsWith('assets/models/characters/'), `${profile.id} must originate from a real character asset family`);
    check(SW.includes(`'./${profile.src}'`) || SW.includes(`"./${profile.src}"`) || SW.includes(profile.src), `${profile.src} must be visible to the existing PWA shell graph`);
  }
  check(!SOURCE.includes("EditorMaterialStudio.js"), 'runtime director must never import EditorMaterialStudio.js');
  check(SOURCE.includes("../materials/MaterialAssignmentCore.js"), 'director must consume the shared MaterialAssignmentCore');
  check(SOURCE.includes("./WorldAssetPlacementPipeline.js"), 'director must consume the shared WorldAssetPlacementPipeline');
  check(!SOURCE.includes('Math.random('), 'ambient placement must remain deterministic');
  check(SOURCE.includes('createMaterialManifest'), 'material placement manifest must be generated');
  check(SOURCE.includes('validateMaterialAssignment'), 'material assignment must be validated before attachment');
}

function assertPlacementOutput() {
  const seats = [{ id: 'seat-1', x: 500, z: 500 }, { id: 'seat-2', x: -600, z: -200 }];
  const result = planGeographicAmbientPlacements({
    settlementSeats: seats,
    surfaceQuery: () => surfaceSample({ biome: 'cold-grassland', biomeId: 'north', settlementDistance: 140 }),
    seed: 20260907,
    maxInstances: 2,
  });
  check(result.accepted === 2, 'valid canonical surfaces should accept the requested two ambient instances');
  for (const placement of result.placements) {
    check(placement.modelUrl.startsWith('assets/models/characters/'), 'placement must carry a real character source path');
    check(placement.y === 10, 'placement should preserve the sampled ground height');
    check(placement.groundSlopeDegrees <= GEOGRAPHIC_AMBIENT_POLICY.maxSlopeDegrees, 'placement slope must stay under policy');
    check(placement.settlementDistanceMeters >= GEOGRAPHIC_AMBIENT_POLICY.minSettlementDistanceMeters, 'placement must stay outside settlement core');
  }
}

function run() {
  assertPolicyBoundaries();
  assertReferenceGeography();
  assertBiomeAssetMapping();
  assertSeededDeterminism();
  assertDifferentSeedsDiverge();
  assertSurfaceRejectionContract();
  assertSurfaceQueryContract();
  assertAssetFirstContract();
  assertPlacementOutput();

  const relative = path.relative(ROOT, path.join(ROOT, 'src/3d/world/geographicAmbientCharacterDirector.js'));
  console.log(JSON.stringify({
    policy: GEOGRAPHIC_AMBIENT_POLICY.id,
    sourceMap: WORLD_REFERENCE_MAP.id,
    biomeZones: REFERENCE_BIOME_ZONES.length,
    assetProfiles: Object.keys(AMBIENT_CHARACTER_ASSETS).length,
    source: relative,
    checks: 86,
    failures,
  }, null, 2));

  if (failures.length) process.exitCode = 1;
}

run();
