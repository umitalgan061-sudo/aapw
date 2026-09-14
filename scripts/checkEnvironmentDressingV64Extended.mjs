import assert from 'node:assert/strict';
import {
  createGroundDecalPlanV64,
  createAtmosphereWeatherPlanV64,
  createStreamingCullingPlanV64,
  createEnvironmentWindFieldV64,
  createEnvironmentalAudioZonesV64,
  createV64AtmosphereSummary,
} from '../src/3d/world/environmentDressingAtmosphereV64.js';
import {
  createGroundQueryV64,
  createWaterQueryV64,
  createBiomeQueryV64,
  createPlacementQueryV64,
  createNavigationQueryV64,
  createV64QuerySnapshot,
  compareV64QuerySnapshots,
} from '../src/3d/world/environmentDressingGroundQueryV64.js';
import {
  createMultiscaleSurfaceMaterialResponseV64,
  validateMultiscaleSurfaceMaterialResponseV64,
  compareSurfaceMaterialResponseV64,
} from '../src/3d/world/environmentSurfaceMaterialResponseV64.js';
import {
  createEnvironmentDressingAssetHandoffV64,
  validateEnvironmentDressingAssetHandoffV64,
  createV64DressingPlacementReplay,
  createV64DressingCoveragePlan,
} from '../src/3d/world/environmentDressingAssetHandoffV64.js';

const sample = {
  x: 4500,
  y: 116,
  z: 3500,
  canonicalHeight: 116,
  colliderHeight: 116,
  slope: 11,
  moisture: 0.58,
  elevation01: 0.43,
  snowWeight: 0.05,
  relief: 0.67,
  curvature: 0.12,
  biome: 'forest',
  surface: 'grass',
  waterClass: 'land',
  waterDistance: 160,
  waterDepth: 0,
  roadDistance: 40,
  settlementDistance: 100,
  groundConfidence: 0.94,
  normal: { x: 0.08, y: 0.98, z: 0.05 },
  canonicalSource: 'canonical-owner-map',
};

function testGroundAndNavigation() {
  const ground = createGroundQueryV64(sample);
  assert.equal(ground.parityPass, true);
  assert.equal(ground.safeForPlayer, true);
  assert.equal(ground.safeForTree, true);
  assert.equal(createNavigationQueryV64(sample).walkable, true);
}

function testWaterBlocking() {
  const waterSample = { ...sample, waterClass: 'lake', waterDistance: 2, waterDepth: 3 };
  const water = createWaterQueryV64(waterSample);
  assert.equal(water.isWater, true);
  assert.equal(water.placementBlocked, true);
  const placement = createPlacementQueryV64(waterSample, { type: 'tree' });
  assert.equal(placement.eligible, false);
  assert.ok(placement.reasons.includes('water'));
}

function testReservedBuffers() {
  const road = createPlacementQueryV64({ ...sample, roadDistance: 1 }, { type: 'tree' });
  assert.equal(road.eligible, false);
  const settlement = createPlacementQueryV64({ ...sample, settlementDistance: 2 }, { type: 'shrub' });
  assert.equal(settlement.eligible, false);
  const reserved = createPlacementQueryV64({ ...sample, surface: 'road' }, { type: 'grass' });
  assert.equal(reserved.eligible, false);
}

function testBiomeAndSnapshotDeterminism() {
  const biome = createBiomeQueryV64(sample);
  assert.equal(biome.biome, 'forest');
  assert.equal(biome.wet, false);
  const first = createV64QuerySnapshot(sample, { type: 'tree' });
  const second = createV64QuerySnapshot({ ...sample }, { type: 'tree' });
  assert.equal(compareV64QuerySnapshots(first, second).same, true);
}

function testAtmosphere() {
  const atmosphere = createAtmosphereWeatherPlanV64({
    camera: { distance: 420 },
    terrain: { y: 260, height: 260 },
    weather: { visibilityMeters: 1800, precipitation: 0.45, wind: 0.35, backgroundLuminance: 0.12, phase: 'twilight' },
  });
  assert.equal(atmosphere.fog.ordered, true);
  assert.equal(atmosphere.sky.blackSky, 0);
  assert.equal(atmosphere.sky.cameraRelative, true);
  const summary = createV64AtmosphereSummary({
    seed: 'summary',
    camera: { distance: 420 },
    terrain: { moisture: 0.64, elevation01: 0.52, biome: 'forest' },
    water: { waterClass: 'river', waterDistance: 30 },
    visibleObjects: 500,
    residentBatches: 12,
  });
  assert.equal(summary.readable, true);
  assert.ok(summary.fingerprint);
}

function testDecalsAndWindAudio() {
  const decals = createGroundDecalPlanV64({ terrain: { ...sample }, water: sample, cameraDistance: 160, seed: 'decal-seed' });
  assert.ok(decals.selected.length > 0);
  assert.equal(decals.regularGrid, false);
  const windA = createEnvironmentWindFieldV64({ seed: 'wind', sampleCount: 16, moisture: 0.5, elevation01: 0.6 });
  const windB = createEnvironmentWindFieldV64({ seed: 'wind', sampleCount: 16, moisture: 0.5, elevation01: 0.6 });
  assert.deepEqual(windA, windB);
  const audio = createEnvironmentalAudioZonesV64({ terrain: sample, water: { waterClass: 'river', waterDistance: 25 } });
  assert.ok(audio.zones.some((zone) => zone.id === 'water' && zone.intensity > 0));
}

function testStreaming() {
  const near = createStreamingCullingPlanV64({ cameraDistance: 120, visibleObjects: 900, residentBatches: 10, mobile: false });
  assert.equal(near.tier, 'near');
  assert.ok(near.cullCount > 0);
  const far = createStreamingCullingPlanV64({ cameraDistance: 5200, visibleObjects: 900, residentBatches: 10, mobile: true });
  assert.equal(far.tier, 'impostor');
  assert.ok(far.desiredVisible < near.desiredVisible);
}

function testSurfaceMaterials() {
  const response = createMultiscaleSurfaceMaterialResponseV64({
    terrain: { ...sample, slope: 52, relief: 0.82, snowWeight: 0.35 },
    water: { waterClass: 'river', waterDistance: 4, waterDepth: 7 },
    material: { roughness: 0.82, macroContrast: 0.75, microDetail: 0.72 },
    cameraDistance: 260,
    seed: 'material',
  });
  assert.ok(Math.abs(Object.values(response.weights).reduce((a, b) => a + b, 0) - 1) < 0.02);
  assert.equal(validateMultiscaleSurfaceMaterialResponseV64(response).valid, true);
  const responseFar = createMultiscaleSurfaceMaterialResponseV64({
    terrain: { ...sample, slope: 52, relief: 0.82, snowWeight: 0.35 },
    water: { waterClass: 'river', waterDistance: 4, waterDepth: 7 },
    material: { roughness: 0.82, macroContrast: 0.75, microDetail: 0.72 },
    cameraDistance: 5200,
    seed: 'material',
  });
  const delta = compareSurfaceMaterialResponseV64(response, responseFar);
  assert.equal(delta.sameFingerprint, false);
  assert.ok(response.distanceFade > responseFar.distanceFade);
}

function testPlannerHandoff() {
  const handoff = createEnvironmentDressingAssetHandoffV64({
    anchor: { x: 4500, z: 3500, id: 'center' },
    context: {
      biome: 'forest', moisture: 0.66, slopeDegrees: 9, elevationMeters: 320,
      waterDepth: 0, shorelineDistanceMeters: 180, roadDistanceMeters: 44,
      settlementDistanceMeters: 190, localRelief: 0.6, isWater: false,
    },
    seed: 'handoff',
    mobile: false,
  });
  assert.equal(handoff.plannerInvoked, true);
  assert.equal(handoff.policy.regularGridDistribution, false);
  assert.equal(validateEnvironmentDressingAssetHandoffV64(handoff).valid, true);
  const replay = createV64DressingPlacementReplay({
    anchor: { x: 4500, z: 3500, id: 'center' },
    context: {
      biome: 'forest', moisture: 0.66, slopeDegrees: 9, elevationMeters: 320,
      waterDepth: 0, shorelineDistanceMeters: 180, roadDistanceMeters: 44,
      settlementDistanceMeters: 190, localRelief: 0.6, isWater: false,
    },
    seed: 'handoff',
  });
  assert.equal(replay.equal, true);
}

function testCoverageAndWaterFailClosed() {
  const coverage = createV64DressingCoveragePlan([
    { seed: 'a', anchor: { x: 0, z: 0 }, context: { biome: 'forest', moisture: 0.5, slopeDegrees: 7, elevationMeters: 200, waterDepth: 0, shorelineDistanceMeters: 120, roadDistanceMeters: 30, settlementDistanceMeters: 90, localRelief: 0.4 } },
    { seed: 'b', anchor: { x: 400, z: 240 }, context: { biome: 'alpine', moisture: 0.4, slopeDegrees: 45, elevationMeters: 2200, waterDepth: 0, shorelineDistanceMeters: 800, roadDistanceMeters: 60, settlementDistanceMeters: 200, localRelief: 0.78 } },
    { seed: 'c', anchor: { x: 800, z: 600 }, context: { biome: 'wetland', moisture: 0.84, slopeDegrees: 4, elevationMeters: 90, waterDepth: 2, shorelineDistanceMeters: 8, roadDistanceMeters: 55, settlementDistanceMeters: 120, localRelief: 0.24, isWater: true } },
  ]);
  assert.equal(coverage.sampleCount, 3);
  assert.ok(coverage.rows[0].plannerInvoked);
  assert.equal(coverage.rows[2].plannerInvoked, false);
}

const tests = [
  testGroundAndNavigation,
  testWaterBlocking,
  testReservedBuffers,
  testBiomeAndSnapshotDeterminism,
  testAtmosphere,
  testDecalsAndWindAudio,
  testStreaming,
  testSurfaceMaterials,
  testPlannerHandoff,
  testCoverageAndWaterFailClosed,
];

for (const test of tests) test();
console.log(JSON.stringify({ ok: true, tests: tests.length }, null, 2));
