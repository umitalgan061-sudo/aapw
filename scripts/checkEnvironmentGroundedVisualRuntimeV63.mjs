import assert from 'node:assert/strict';
import {
  V63_CONTRACT,
  V63_WORLD_QUERY_API,
  createGroundedVisualRuntimeV63,
  validateGroundedVisualRuntimeV63,
  compareGroundedVisualRuntimeV63,
  createAcceptanceSampleMatrixV63,
  createTerrainBreakupFieldV63,
  createEcotonePlanV63,
  createWaterOpticalResponseV63,
  createPerformanceBudgetV63,
  validateAssetPlacementEvidenceV63,
  analyzeSeamContinuityV63,
  createRuntimeBatchPlanV63,
  createSceneAdoptionChecklistV63,
  createBeforeAfterComparisonV63,
  createMultiscaleMaterialFieldV63,
  interpretGeologyV63,
  createHabitatDensityV63,
  createNaturalTransformV63,
  createVegetationClusterPlanV63,
  createShorelineBandProfileV63,
  createAtmosphereWeatherPlanV63,
  createEnvironmentalSetDressingV63,
  createGroundDecalPlanV63,
  createStreamingPlanV63,
  createParityDiagnosticsV63,
  scoreEnvironmentQualityV63,
  createDeterministicEvidenceV63,
  getV63ContractSummary,
  normalizeV63ObservationForTests,
} from '../src/3d/world/environmentGroundedVisualRuntimeV63.js';

const baseObservation = (overrides = {}) => ({
  sampleId: 'terrain-near-0',
  seed: 'fixture-v63',
  terrain: {
    x: 4500,
    y: 116,
    z: 3500,
    height: 116,
    canonicalHeight: 116,
    colliderHeight: 116,
    slope: 12,
    moisture: 0.42,
    elevation01: 0.46,
    snowWeight: 0.08,
    roughness: 0.74,
    normal: { x: 0.1, y: 0.96, z: 0.12 },
    biome: 'temperate',
    surface: 'grass',
    canonicalSource: 'canonical-owner-map',
    terrainBackend: 'Terrain3D',
    regionId: 'center',
  },
  water: {
    waterClass: 'land',
    waterDistance: 120,
    depth: 0,
    shorelineWeight: 0,
    wetEdgeWeight: 0,
    foamWeight: 0,
    cyanRisk: 0,
    moireRisk: 0,
    tileLike: false,
    rectangular: false,
    repeatedStripe: false,
    seamRisk: 0,
  },
  material: {
    role: 'grass',
    multiSurface: true,
    placeholder: false,
    missing: false,
    roughness: 0.82,
    normalScale: 0.8,
    ao: 0.56,
    macroContrast: 0.7,
    microDetail: 0.68,
    textureRepeat: 1,
  },
  vegetation: [],
  camera: {
    profile: 'terrain-near',
    width: 1536,
    height: 1024,
    orthographicDegrees: 90,
    distance: 420,
    seed: 'fixture-camera',
    targetX: 4500,
    targetY: 116,
    targetZ: 3500,
  },
  renderedY: 116,
  colliderY: 116,
  postProcessed: false,
  editorRuntimeImported: false,
  primitiveGeometry: false,
  ...overrides,
});

function testBasicPlan() {
  const plan = createGroundedVisualRuntimeV63(baseObservation());
  assert.equal(plan.contract, V63_CONTRACT.id);
  assert.equal(plan.p1.parityPass, true);
  assert.equal(plan.shared.valid, true);
  assert.equal(plan.p0.seam, 0);
  assert.equal(plan.p0.rectangularWater, 0);
  assert.equal(plan.risks.P2.placeholder, 0);
  assert.equal(plan.risks.P3.invalidPlacement, 0);
  assert.equal(plan.p5.blackSky, 0);
  assert.ok(plan.fingerprint);
  assert.equal(validateGroundedVisualRuntimeV63(plan).valid, true);
}

function testDeterminism() {
  const input = baseObservation({
    vegetation: [
      {
        assetId: 'tree-b',
        category: 'tree',
        x: 4508,
        y: 116.8,
        z: 3511,
        scale: 1.1,
        slope: 8,
        moisture: 0.5,
        height01: 0.48,
        distanceToWater: 55,
        roadDistance: 40,
        settlementDistance: 90,
        grounded: true,
        groundConfidence: 0.94,
        instanceBatch: 'forest-a',
      },
      {
        assetId: 'tree-a',
        category: 'tree',
        x: 4493,
        y: 115.9,
        z: 3489,
        scale: 0.96,
        slope: 9,
        moisture: 0.48,
        height01: 0.45,
        distanceToWater: 51,
        roadDistance: 45,
        settlementDistance: 85,
        grounded: true,
        groundConfidence: 0.97,
        instanceBatch: 'forest-a',
      },
    ],
  });
  const reversed = { ...input, vegetation: [...input.vegetation].reverse() };
  const a = createGroundedVisualRuntimeV63(input);
  const b = createGroundedVisualRuntimeV63(reversed);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.riskScore, b.riskScore);
  assert.equal(compareGroundedVisualRuntimeV63(input, reversed).sameAcceptance, true);
}

function testP0() {
  const plan = createGroundedVisualRuntimeV63(baseObservation({
    water: {
      waterClass: 'sea',
      waterDistance: 0.5,
      depth: 3,
      shorelineWeight: 0.9,
      wetEdgeWeight: 0.9,
      foamWeight: 0.2,
      cyanRisk: 0.8,
      moireRisk: 0.8,
      tileLike: true,
      rectangular: true,
      repeatedStripe: true,
      seamRisk: 0.8,
    },
  }));
  assert.equal(plan.p0.rectangularWater, 1);
  assert.equal(plan.p0.moire, 1);
  assert.equal(plan.p0.cyan, 1);
  assert.equal(plan.p0.seam, 1);
}

function testUnknownWaterFailsClosed() {
  const plan = createGroundedVisualRuntimeV63(baseObservation({
    water: { waterClass: 'canal', waterDistance: 0.2 },
  }));
  assert.equal(plan.normalized.water.class, 'unknown');
  assert.equal(plan.vegetation.invalid, 0);
  const placement = createGroundedVisualRuntimeV63(baseObservation({
    water: { waterClass: 'canal', waterDistance: 0.2 },
    vegetation: [{
      assetId: 'tree-x', category: 'tree', x: 4500, y: 116, z: 3500,
      grounded: true, groundConfidence: 1, slope: 5, moisture: 0.5,
      height01: 0.5, distanceToWater: 10, roadDistance: 50,
      settlementDistance: 50,
    }],
  }));
  assert.equal(placement.vegetation.invalid, 1);
  assert.equal(placement.vegetation.results[0].reason, 'unknown-water-class');
}

function testPlacementExclusions() {
  const plan = createGroundedVisualRuntimeV63(baseObservation({
    vegetation: [
      { assetId: 'float', category: 'tree', x: 0, z: 0, grounded: false, groundConfidence: 1, slope: 4 },
      { assetId: 'cliff', category: 'tree', x: 1, z: 1, grounded: true, groundConfidence: 1, slope: 80 },
      { assetId: 'snow', category: 'tree', x: 2, z: 2, grounded: true, groundConfidence: 1, slope: 5, permanentSnow: true },
    ],
  }));
  assert.equal(plan.vegetation.invalid, 3);
  assert.ok(plan.vegetation.results.every((item) => !item.eligible));
}

function testP1() {
  const plan = createGroundedVisualRuntimeV63(baseObservation({
    terrain: { ...baseObservation().terrain, slope: 78, roughness: 0.2 },
    renderedY: 120,
    colliderY: 120,
  }));
  assert.equal(plan.p1.cliffWall, 1);
  assert.equal(plan.p1.parityPass, false);
}

function testSurfaceWeights() {
  const plan = createGroundedVisualRuntimeV63(baseObservation({
    terrain: {
      ...baseObservation().terrain,
      slope: 61,
      moisture: 0.82,
      elevation01: 0.88,
      snowWeight: 0.72,
      surface: 'scree',
      biome: 'alpine',
    },
    water: {
      ...baseObservation().water,
      waterClass: 'river',
      waterDistance: 4,
      depth: 9,
      wetEdgeWeight: 0.7,
    },
    material: { ...baseObservation().material, role: 'scree' },
  }));
  const sum = Object.values(plan.material.weights).reduce((acc, value) => acc + value, 0);
  assert.ok(sum > 0.99 && sum < 1.01);
  assert.ok(plan.material.weights.rock > 0);
  assert.ok(plan.material.weights.scree > 0);
  assert.ok(plan.material.triplanarEquivalent);
}

function testWaterOptics() {
  const water = createWaterOpticalResponseV63({
    waterClass: 'lake', depth: 4, distance: 3, foam: 0.3,
    wetEdge: 0.9, cyanRisk: 0.8, moireRisk: 0.7,
  });
  assert.equal(water.recognized, true);
  assert.ok(water.albedoMix.shallow > 0);
  assert.ok(water.cyanSuppression > 0);
  assert.ok(water.moireSuppression > 0);
  assert.ok(water.shorelineBlendMeters > 0);
}

function testAcceptanceMatrix() {
  const matrix = createAcceptanceSampleMatrixV63('matrix');
  assert.equal(matrix.length, 48);
  assert.equal(new Set(matrix.map((item) => item.sampleId)).size, matrix.length);
  assert.equal(new Set(matrix.map((item) => item.water.waterClass)).size, 4);
  assert.ok(matrix.some((item) => item.terrain.surface === 'rock'));
  assert.ok(matrix.some((item) => item.terrain.surface === 'snow'));
  assert.ok(matrix.some((item) => item.terrain.surface === 'shore'));
}

function testTerrainBreakup() {
  const fieldA = createTerrainBreakupFieldV63({ seed: 'same', radius: 24, spacing: 8 });
  const fieldB = createTerrainBreakupFieldV63({ seed: 'same', radius: 24, spacing: 8 });
  assert.deepEqual(fieldA, fieldB);
  assert.ok(fieldA.count > 0);
  assert.ok(fieldA.cells.some((cell) => cell.microRelief !== 0));
}

function testEcotone() {
  const plan = createEcotonePlanV63({
    biome: 'forest', moisture: 0.7, elevation01: 0.42,
    points: [
      { assetId: 'tree-1', category: 'tree', x: 0, z: 0, scale: 1, slope: 8, moisture: 0.7, height01: 0.42, distanceToWater: 30, roadDistance: 40, settlementDistance: 50, grounded: true, groundConfidence: 0.95 },
      { assetId: 'shrub-1', category: 'shrub', x: 10, z: 7, scale: 0.9, slope: 6, moisture: 0.74, height01: 0.45, distanceToWater: 36, roadDistance: 41, settlementDistance: 48, grounded: true, groundConfidence: 0.93 },
    ],
  });
  assert.equal(plan.points.length, 2);
  assert.ok(plan.points[0].score >= 0);
  assert.ok(plan.habitatBias.canopy > plan.habitatBias.rock);
}

function testPerformance() {
  const mobile = createPerformanceBudgetV63({ cameraDistance: 140, vegetationInstances: 900, textureMemoryMb: 600, fps: 47 });
  assert.equal(mobile.overBudget, true);
  assert.equal(mobile.recommendation.reduceLOD, true);
  const far = createPerformanceBudgetV63({ cameraDistance: 4000, vegetationInstances: 800, textureMemoryMb: 300, fps: 60 });
  assert.equal(far.overBudget, false);
}

function testSharedAssetEvidence() {
  const good = validateAssetPlacementEvidenceV63({ assetId: 'rock-001', loaded: true, materialValidated: true, groundResolved: true, manifestCreated: true, sceneAttached: true });
  assert.equal(good.valid, true);
  const bad = validateAssetPlacementEvidenceV63({ assetId: 'rock-002', loaded: true, materialValidated: true, groundResolved: true, manifestCreated: true, sceneAttached: true, editorImported: true });
  assert.equal(bad.valid, false);
}

function testSeams() {
  const result = analyzeSeamContinuityV63([
    baseObservation({ sampleId: 'a', terrain: { ...baseObservation().terrain, x: 0, z: 0, canonicalHeight: 100 } }),
    baseObservation({ sampleId: 'b', terrain: { ...baseObservation().terrain, x: 5, z: 4, canonicalHeight: 115 } }),
    baseObservation({ sampleId: 'c', terrain: { ...baseObservation().terrain, x: 80, z: 80, canonicalHeight: 116 } }),
  ]);
  assert.equal(result.pairCount, 1);
  assert.equal(result.seamFailures, 1);
}

function testBatchPlan() {
  const samples = ['a','b','c','d'].map((id, index) => baseObservation({ sampleId: id, terrain: { ...baseObservation().terrain, x: index * 4, z: index * 4 } }));
  const plan = createRuntimeBatchPlanV63(samples, { maxBatchSize: 2 });
  assert.equal(plan.sourceCount, 4);
  assert.equal(plan.batchCount, 1);
  assert.equal(plan.batches[0].count, 4);
}

function testChecklist() {
  const checklist = createSceneAdoptionChecklistV63(baseObservation());
  assert.equal(checklist.p0VisibleFailure, 0);
  assert.equal(checklist.p1GeometryFailure, 0);
  assert.equal(checklist.p5AtmosphereFailure, 0);
  assert.ok(checklist.fingerprint);
}

function testBeforeAfter() {
  const before = baseObservation({ seed: 'same-seed' });
  const after = baseObservation({ seed: 'same-seed', material: { ...baseObservation().material, macroContrast: 0.9, microDetail: 0.88 } });
  const comparison = createBeforeAfterComparisonV63(before, after);
  assert.equal(comparison.cameraComparable, true);
  assert.equal(comparison.sameSeed, true);
  assert.ok(comparison.fingerprintBefore);
  assert.ok(comparison.fingerprintAfter);
}

function testMultiscale() {
  const field = createMultiscaleMaterialFieldV63({ sample: baseObservation(), seed: 'field' });
  assert.ok(field.combinedContrast >= 0);
  assert.ok(field.tilingSuppression >= 0);
}

function testGeology() {
  const geology = interpretGeologyV63({ slope: 70, curvature: 0.8, elevation01: 0.84, roughness: 0.83, snowWeight: 0.3, moisture: 0.5 });
  assert.equal(geology.dominant, 'cliff');
  assert.ok(geology.talus > 0);
  assert.ok(geology.rockExposure > 0);
}

function testHabitat() {
  const habitat = createHabitatDensityV63({ biome: 'forest', slope: 14, moisture: 0.68, elevation01: 0.5, waterDistance: 28, roadDistance: 100, settlementDistance: 100 });
  assert.ok(habitat.density > 0.5);
  assert.ok(habitat.canopy > habitat.groundDetail * 0.8);
}

function testTransform() {
  const a = createNaturalTransformV63({ assetId: 'oak', x: 10, z: 12, seed: 'x' });
  const b = createNaturalTransformV63({ assetId: 'oak', x: 10, z: 12, seed: 'x' });
  assert.deepEqual(a, b);
  assert.ok(a.scale >= 0.82 && a.scale <= 1.18);
}

function testClusters() {
  const plan = createVegetationClusterPlanV63({
    clusterRadius: 20,
    samples: [
      { assetId: 'a', category: 'tree', x: 0, y: 0, z: 0, grounded: true, groundConfidence: 1, instanceBatch: 'forest' },
      { assetId: 'b', category: 'tree', x: 10, y: 0, z: 10, grounded: true, groundConfidence: 1, instanceBatch: 'forest' },
      { assetId: 'c', category: 'tree', x: 100, y: 0, z: 100, grounded: true, groundConfidence: 1, instanceBatch: 'forest' },
    ],
  });
  assert.equal(plan.clusterCount, 2);
  assert.equal(plan.totalMembers, 3);
}

function testShoreline() {
  const profile = createShorelineBandProfileV63({ waterClass: 'sea', distance: 4, depth: 3, wetEdge: 0.8, foam: 0.4 });
  assert.equal(profile.recognized, true);
  assert.equal(profile.bands.length, 4);
  assert.ok(profile.shallowWeight > 0);
  assert.ok(profile.antiHalo > 0);
}

function testAtmosphere() {
  const plan = createAtmosphereWeatherPlanV63({ sunElevationDegrees: 12, cloudCover: 0.45, precipitation: 0.3, windSpeed: 11, humidity: 0.8, cameraDistance: 3000 });
  assert.ok(plan.daylight > 0);
  assert.ok(plan.groundWetness > 0);
  assert.ok(plan.fogDensity > 0);
  assert.equal(plan.blackSkyGuard, true);
}

function testSetDressing() {
  const dressing = createEnvironmentalSetDressingV63({ terrain: baseObservation().terrain, water: baseObservation().water, density: 0.7, roadDistance: 80, settlementDistance: 90 });
  assert.ok(dressing.grass >= 0);
  assert.ok(dressing.canopy >= 0);
  assert.ok(dressing.clearingRadius >= 0);
}

function testDecal() {
  const decal = createGroundDecalPlanV63({ kind: 'snow-breakup', width: 2, length: 5, slope: 14, wetness: 0.6, x: 10, z: 11 });
  assert.equal(decal.kind, 'snow-breakup');
  assert.equal(decal.avoidWaterHalo, true);
  assert.ok(decal.length > 0);
}

function testStreaming() {
  const plan = createStreamingPlanV63({ cameraDistance: 180, visibleChunks: 28, residentChunks: 30, vegetationInstances: 1200, textureMemoryMb: 650, mobile: true });
  assert.equal(plan.lodBand, 'near');
  assert.equal(plan.chunkCulling, true);
  assert.equal(plan.overBudget, true);
  assert.ok(plan.actions.includes('reduce-vegetation-batch'));
}

function testParity() {
  const parity = createParityDiagnosticsV63({ canonicalHeight: 100, renderedHeight: 100.1, colliderHeight: 100.04, canonicalX: 10, canonicalZ: 20, renderedX: 10.08, renderedZ: 19.96, colliderX: 10.02, colliderZ: 20.01 });
  assert.equal(parity.sameCoordinate, true);
}

function testQuality() {
  const good = scoreEnvironmentQualityV63(baseObservation());
  const bad = scoreEnvironmentQualityV63(baseObservation({
    water: { ...baseObservation().water, waterClass: 'sea', waterDistance: 0.5, rectangular: true, repeatedStripe: true, cyanRisk: 1, moireRisk: 1 },
    material: { ...baseObservation().material, placeholder: true, missing: true, multiSurface: false },
  }));
  assert.ok(good.score > bad.score);
  assert.ok(['acceptance','near-acceptance'].includes(good.band));
  assert.equal(bad.band, 'blocked');
}

function testEvidence() {
  const samples = [baseObservation({ sampleId: 'z' }), baseObservation({ sampleId: 'a' }), baseObservation({ sampleId: 'm' })];
  const evidence = createDeterministicEvidenceV63(samples, 'evidence');
  assert.equal(evidence.sampleCount, 3);
  assert.ok(evidence.digest);
  assert.ok(evidence.averageQuality >= 0);
}

function testApiManifest() {
  const summary = getV63ContractSummary();
  assert.equal(summary.id, V63_CONTRACT.id);
  assert.equal(summary.acceptanceResolution, '1536x1024');
  assert.equal(summary.domFree, true);
  assert.equal(summary.createsGeometry, false);
  assert.equal(typeof V63_WORLD_QUERY_API.getGround, 'function');
}

function testNormalization() {
  const observation = normalizeV63ObservationForTests(baseObservation({ water: { waterClass: 'CANAL', waterDistance: 2 }, terrain: { ...baseObservation().terrain, biome: 'unknown-biome', surface: 'moss' } }));
  assert.equal(observation.water.class, 'unknown');
  assert.equal(observation.terrain.biome, 'unknown');
  assert.equal(observation.terrain.surface, 'unknown');
}

const tests = [
  testBasicPlan, testDeterminism, testP0, testUnknownWaterFailsClosed,
  testPlacementExclusions, testP1, testSurfaceWeights, testWaterOptics,
  testAcceptanceMatrix, testTerrainBreakup, testEcotone, testPerformance,
  testSharedAssetEvidence, testSeams, testBatchPlan, testChecklist,
  testBeforeAfter, testMultiscale, testGeology, testHabitat, testTransform,
  testClusters, testShoreline, testAtmosphere, testSetDressing, testDecal,
  testStreaming, testParity, testQuality, testEvidence, testApiManifest,
  testNormalization,
];

function testMalformedFiniteFallback() {
  const plan = createGroundedVisualRuntimeV63(baseObservation({
    terrain: { ...baseObservation().terrain, height: Number.NaN, canonicalHeight: Number.POSITIVE_INFINITY, slope: Number.NaN, moisture: Number.NaN },
    water: { ...baseObservation().water, waterDistance: Number.NaN, depth: Number.POSITIVE_INFINITY },
    camera: { profile: 'terrain-near', width: Number.NaN, height: Number.POSITIVE_INFINITY, distance: Number.NaN, seed: 'malformed' },
  }));
  assert.equal(Number.isFinite(plan.normalized.terrain.height), true);
  assert.equal(Number.isFinite(plan.normalized.water.distance), true);
  assert.equal(Number.isFinite(plan.normalized.camera.width), true);
  assert.equal(Number.isFinite(plan.normalized.camera.height), true);
  assert.equal(Number.isFinite(plan.normalized.camera.distance), true);
}

function testDeepFreeze() {
  const plan = createGroundedVisualRuntimeV63(baseObservation());
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.material), true);
  assert.equal(Object.isFrozen(plan.material.weights), true);
  assert.equal(Object.isFrozen(plan.acceptance), true);
  assert.equal(Object.isFrozen(plan.shared.sequence), true);
  assert.throws(() => { plan.material.roughness = 0.1; }, TypeError);
}

function testResolutionFallback() {
  const plan = createGroundedVisualRuntimeV63(baseObservation({ camera: { profile: 'fullWorld', width: undefined, height: undefined, orthographicDegrees: undefined, distance: undefined, seed: 'fallback' } }));
  assert.equal(plan.normalized.camera.width, 1536);
  assert.equal(plan.normalized.camera.height, 1024);
  assert.equal(plan.normalized.camera.orthographicDegrees, 90);
  assert.equal(plan.normalized.camera.distance, 7000);
}

function testCameraClamping() {
  const plan = createGroundedVisualRuntimeV63(baseObservation({ camera: { profile: 'terrain-near', width: 9, height: 9000, orthographicDegrees: 200, distance: -4 } }));
  assert.equal(plan.normalized.camera.width, 256);
  assert.equal(plan.normalized.camera.height, 4096);
  assert.equal(plan.normalized.camera.orthographicDegrees, 120);
  assert.ok(plan.normalized.camera.distance >= 0.1);
}

function testP2WetEdge() {
  const wet = createGroundedVisualRuntimeV63(baseObservation({
    terrain: { ...baseObservation().terrain, moisture: 0.92, surface: 'mud' },
    water: { ...baseObservation().water, waterClass: 'river', waterDistance: 2, wetEdgeWeight: 0.95, depth: 8 },
    material: { ...baseObservation().material, role: 'wet' },
  }));
  assert.ok(wet.material.weights.mud > 0);
  assert.ok(wet.material.weights.wet > 0);
  assert.ok(wet.water.wetEdge > 0);
}

function testP2SnowlineBreakup() {
  const alpine = createGroundedVisualRuntimeV63(baseObservation({
    terrain: { ...baseObservation().terrain, slope: 31, moisture: 0.36, elevation01: 0.92, snowWeight: 0.94, surface: 'snow', biome: 'alpine' },
    material: { ...baseObservation().material, role: 'snow', macroContrast: 0.76, microDetail: 0.72 },
  }));
  assert.ok(alpine.material.weights.snow > alpine.material.weights.grass);
  assert.ok(alpine.material.snowBreakup > 0);
  assert.ok(alpine.p1.rockExposure > 0);
}

function testP3NaturalScaleVariation() {
  const values = new Set();
  for (let index = 0; index < 24; index += 1) {
    const transform = createNaturalTransformV63({ assetId: `tree-${index}`, x: 10 + index * 2, z: 20 + index, seed: 'variance' });
    values.add(transform.scale);
    assert.ok(transform.yawRadians >= 0);
    assert.ok(transform.yawRadians <= Math.PI * 2);
  }
  assert.ok(values.size > 8);
}

function testP3ClearingNearRoad() {
  const clear = createHabitatDensityV63({ biome: 'forest', slope: 11, moisture: 0.62, elevation01: 0.42, waterDistance: 100, roadDistance: 2, settlementDistance: 100 });
  const wild = createHabitatDensityV63({ biome: 'forest', slope: 11, moisture: 0.62, elevation01: 0.42, waterDistance: 100, roadDistance: 100, settlementDistance: 100 });
  assert.ok(clear.density < wild.density);
  assert.ok(clear.clearingRadius > wild.clearingRadius);
}

function testP4UnknownShoreline() {
  const profile = createShorelineBandProfileV63({ waterClass: 'canal', distance: 1, depth: 2 });
  assert.equal(profile.recognized, false);
  assert.equal(profile.bands.length, 0);
  assert.equal(profile.failure, 'unrecognized-hydrology');
}

function testP5NightWeather() {
  const plan = createAtmosphereWeatherPlanV63({ sunElevationDegrees: -10, cloudCover: 0.2, precipitation: 0.05, windSpeed: 6, humidity: 0.52, cameraDistance: 1800 });
  assert.ok(plan.daylight < 0.1);
  assert.ok(plan.ambientStrength >= 0.08);
  assert.equal(plan.blackSkyGuard, true);
}

function testStreamingPreloadMargin() {
  const plan = createStreamingPlanV63({ cameraDistance: 800, visibleChunks: 12, residentChunks: 14, vegetationInstances: 300, textureMemoryMb: 256, mobile: false });
  assert.equal(plan.lodBand, 'mid');
  assert.ok(plan.actions.includes('increase-prefetch-margin'));
  assert.equal(plan.chunkCulling, true);
}

function testParityFailure() {
  const parity = createParityDiagnosticsV63({ canonicalHeight: 100, renderedHeight: 101, colliderHeight: 99.6, canonicalX: 10, canonicalZ: 20, renderedX: 11, renderedZ: 20, colliderX: 10, colliderZ: 20.8 });
  assert.equal(parity.visualPass, false);
  assert.equal(parity.colliderPass, false);
  assert.equal(parity.sameCoordinate, false);
}

function testBatchCaps() {
  const samples = [];
  for (let index = 0; index < 18; index += 1) {
    samples.push(baseObservation({ sampleId: `sample-${index}`, terrain: { ...baseObservation().terrain, x: index * 3, z: index * 2 }, material: { ...baseObservation().material, role: index % 2 ? 'grass' : 'rock' } }));
  }
  const plan = createRuntimeBatchPlanV63(samples, { maxBatchSize: 5, seed: 'cap' });
  assert.equal(plan.sourceCount, 18);
  assert.ok(plan.batchCount >= 4);
  assert.ok(plan.batches.every((batch) => batch.count <= 5));
}

function testMatrixProfileSeeds() {
  const matrix = createAcceptanceSampleMatrixV63('seeded');
  const cameraSeeds = matrix.map((item) => item.camera.seed);
  assert.equal(new Set(cameraSeeds).size, cameraSeeds.length);
  assert.ok(matrix.every((item) => item.terrain.canonicalSource === 'canonical-owner-map'));
}

function testEvidenceOrderIndependence() {
  const source = [baseObservation({ sampleId: 'b' }), baseObservation({ sampleId: 'a' }), baseObservation({ sampleId: 'c' })];
  const reversed = [...source].reverse();
  const one = createDeterministicEvidenceV63(source, 'same');
  const two = createDeterministicEvidenceV63(reversed, 'same');
  assert.equal(one.digest, two.digest);
  assert.deepEqual(one.reports, two.reports);
}

function testManifestBoundaries() {
  const summary = getV63ContractSummary();
  assert.equal(summary.sharedPlacementAuthority.mergedSuccessor, 590);
  assert.equal(summary.readOnly, true);
  assert.equal(summary.hydratesAssets, false);
  assert.equal(summary.importsEditorUi, false);
}

function testEditorBoundaryFailure() {
  const plan = createGroundedVisualRuntimeV63(baseObservation({ editorRuntimeImported: true }));
  assert.equal(plan.shared.valid, false);
  assert.ok(plan.acceptance.releaseBlockers.includes('shared-contract-boundary'));
}

function testPrimitiveBoundaryFailure() {
  const plan = createGroundedVisualRuntimeV63(baseObservation({ primitiveGeometry: true }));
  assert.equal(plan.shared.valid, false);
  assert.ok(plan.acceptance.releaseBlockers.includes('shared-contract-boundary'));
}

function testPostProcessFailure() {
  const plan = createGroundedVisualRuntimeV63(baseObservation({ postProcessed: true }));
  assert.equal(plan.p5.blackSkyFailure, 1);
  assert.equal(plan.acceptance.mergeEligible, false);
}

function testRoadAndSettlementPlacementGates() {
  const result = createGroundedVisualRuntimeV63(baseObservation({
    vegetation: [{ assetId: 'road-tree', category: 'tree', x: 0, y: 0, z: 0, scale: 1, slope: 6, moisture: 0.5, height01: 0.45, distanceToWater: 100, roadDistance: 1, settlementDistance: 1, grounded: true, groundConfidence: 0.9, instanceBatch: 'roadside' }],
  }));
  assert.equal(result.vegetation.invalid, 0);
  const dressing = createEnvironmentalSetDressingV63({ terrain: baseObservation().terrain, water: baseObservation().water, roadDistance: 1, settlementDistance: 1 });
  assert.ok(dressing.clearingRadius > 2);
}

function testQueryApiGround() {
  const query = V63_WORLD_QUERY_API.getGround(baseObservation());
  assert.equal(query.terrain.biome, 'temperate');
  assert.equal(query.terrain.surface, 'grass');
  assert.equal(query.water.class, 'land');
  assert.equal(Number.isFinite(query.point.y), true);
}

function testQueryApiBreakup() {
  const field = V63_WORLD_QUERY_API.createTerrainBreakupField({ centerX: 100, centerZ: 200, radius: 12, spacing: 4, seed: 'api' });
  assert.ok(field.cells.length > 0);
  assert.equal(field.seed, 'api');
}

function testQueryApiWater() {
  const water = V63_WORLD_QUERY_API.createWaterOpticalResponse({ waterClass: 'river', depth: 8, distance: 4, wetEdge: 0.8, foam: 0.3 });
  assert.equal(water.class, 'river');
  assert.equal(water.recognized, true);
}

function testQualityBandTransitions() {
  const near = scoreEnvironmentQualityV63(baseObservation());
  const blocked = scoreEnvironmentQualityV63(baseObservation({ editorRuntimeImported: true, primitiveGeometry: true, postProcessed: true }));
  assert.ok(near.score > blocked.score);
  assert.equal(blocked.band, 'blocked');
}

function testWaterClassNormalizationTable() {
  const cases = [['sea','sea'], ['SEA','sea'], ['lake','lake'], ['river','river'], ['land','land'], ['canal','unknown'], ['', 'unknown'], [null,'unknown']];
  for (const [input, expected] of cases) {
    const normalized = normalizeV63ObservationForTests(baseObservation({ water: { waterClass: input, waterDistance: 20 } }));
    assert.equal(normalized.water.class, expected);
  }
}

function testBiomeNormalizationTable() {
  const cases = [['forest','forest'], ['TAIGA','taiga'], ['alpine','alpine'], ['coastal','coastal'], ['bog','unknown']];
  for (const [input, expected] of cases) {
    const normalized = normalizeV63ObservationForTests(baseObservation({ terrain: { ...baseObservation().terrain, biome: input } }));
    assert.equal(normalized.terrain.biome, expected);
  }
}

function testSurfaceNormalizationTable() {
  const cases = [['grass','grass'], ['snow','snow'], ['rock','rock'], ['scree','scree'], ['moss','unknown']];
  for (const [input, expected] of cases) {
    const normalized = normalizeV63ObservationForTests(baseObservation({ terrain: { ...baseObservation().terrain, surface: input } }));
    assert.equal(normalized.terrain.surface, expected);
  }
}

function testContractThresholds() {
  assert.equal(V63_CONTRACT.thresholds.seamVisibility, 0);
  assert.equal(V63_CONTRACT.thresholds.rectangularWaterVisibility, 0);
  assert.equal(V63_CONTRACT.thresholds.waterMoireVisibility, 0);
  assert.equal(V63_CONTRACT.thresholds.floatingPlacement, 0);
  assert.equal(V63_CONTRACT.thresholds.interpenetration, 0);
  assert.equal(V63_CONTRACT.thresholds.blackSkyFailures, 0);
}

function testAcceptanceProfiles() {
  const plan = createGroundedVisualRuntimeV63(baseObservation());
  assert.equal(plan.acceptanceProfiles.length, 8);
  assert.ok(plan.acceptanceProfiles.some((profile) => profile.id === 'coast-near'));
  assert.ok(plan.acceptanceProfiles.some((profile) => profile.id === 'mountain-near'));
  assert.ok(plan.acceptanceProfiles.some((profile) => profile.id === 'forest-near'));
  assert.ok(plan.acceptanceProfiles.some((profile) => profile.id === 'settlement-near'));
}

function testWorldExtent() {
  assert.equal(V63_CONTRACT.map.canonicalWidth, 9000);
  assert.equal(V63_CONTRACT.map.canonicalHeight, 7000);
  assert.equal(V63_CONTRACT.map.cameraWidth, 1536);
  assert.equal(V63_CONTRACT.map.cameraHeight, 1024);
  assert.equal(V63_CONTRACT.map.orthographicDegrees, 90);
}

function testNoGeometryClaims() {
  const summary = getV63ContractSummary();
  assert.equal(summary.createsGeometry, false);
  assert.equal(summary.hydratesAssets, false);
  assert.equal(summary.importsEditorUi, false);
}

function testAssetSourceNormalization() {
  const evidence = validateAssetPlacementEvidenceV63({ assetId: 'tree', loaded: true, materialValidated: true, groundResolved: true, manifestCreated: true, sceneAttached: true, source: '' });
  assert.equal(evidence.source, 'asset-library');
}

function testNaturalTransformBounds() {
  for (let index = 0; index < 50; index += 1) {
    const transform = createNaturalTransformV63({ assetId: `rock-${index}`, x: index * 11, z: index * -7, seed: 'bounds', minScale: 0.75, maxScale: 1.25 });
    assert.ok(transform.scale >= 0.75);
    assert.ok(transform.scale <= 1.25);
    assert.ok(Number.isFinite(transform.leanRadians));
  }
}

function testWaterOpticalBoundsTable() {
  const classes = ['sea', 'lake', 'river'];
  for (const waterClass of classes) {
    const shallow = createWaterOpticalResponseV63({ waterClass, depth: 2, distance: 1, foam: 1, wetEdge: 1, cyanRisk: 1, moireRisk: 1 });
    const deep = createWaterOpticalResponseV63({ waterClass, depth: 80, distance: 100, foam: 0, wetEdge: 0, cyanRisk: 0, moireRisk: 0 });
    assert.ok(shallow.shorelineBlendMeters > deep.shorelineBlendMeters);
    assert.ok(shallow.albedoMix.shallow >= deep.albedoMix.shallow);
    assert.ok(shallow.cyanSuppression >= deep.cyanSuppression);
  }
}

function testSetDressingBiomeSensitivity() {
  const forest = createEnvironmentalSetDressingV63({ terrain: { ...baseObservation().terrain, biome: 'forest', moisture: 0.7 }, water: baseObservation().water, roadDistance: 100, settlementDistance: 100 });
  const desert = createEnvironmentalSetDressingV63({ terrain: { ...baseObservation().terrain, biome: 'desert', moisture: 0.2 }, water: baseObservation().water, roadDistance: 100, settlementDistance: 100 });
  assert.ok(forest.canopy > desert.canopy);
  assert.ok(forest.grass > desert.grass);
}

function testGeologySensitivity() {
  const gentle = interpretGeologyV63({ slope: 8, curvature: 0.1, elevation01: 0.2, roughness: 0.6, snowWeight: 0, moisture: 0.4 });
  const severe = interpretGeologyV63({ slope: 82, curvature: 0.8, elevation01: 0.9, roughness: 0.9, snowWeight: 0.2, moisture: 0.5 });
  assert.ok(severe.cliff > gentle.cliff);
  assert.ok(severe.rockExposure > gentle.rockExposure);
  assert.ok(severe.talus > gentle.talus);
}

function testStreamingMobileCaps() {
  const plan = createStreamingPlanV63({ cameraDistance: 5000, visibleChunks: 20, residentChunks: 50, vegetationInstances: 700, textureMemoryMb: 550, mobile: true });
  assert.equal(plan.lodBand, 'impostor');
  assert.equal(plan.maxVegetationInstances, 640);
  assert.equal(plan.maxTextureMemoryMb, 512);
  assert.equal(plan.overBudget, true);
}

function testEvidenceDigestChangesOnRisk() {
  const clean = createDeterministicEvidenceV63([baseObservation()], 'risk');
  const risky = createDeterministicEvidenceV63([baseObservation({ water: { ...baseObservation().water, waterClass: 'sea', waterDistance: 0.4, rectangular: true } })], 'risk');
  assert.notEqual(clean.digest, risky.digest);
}

function testBeforeAfterRiskImprovement() {
  const before = baseObservation({ water: { ...baseObservation().water, waterClass: 'sea', waterDistance: 0.5, rectangular: true, repeatedStripe: true, cyanRisk: 1, moireRisk: 1 } });
  const after = baseObservation({ seed: 'same-seed', water: { ...baseObservation().water, waterClass: 'sea', waterDistance: 12, rectangular: false, repeatedStripe: false, cyanRisk: 0.1, moireRisk: 0 } });
  const comparison = createBeforeAfterComparisonV63(before, after);
  assert.ok(comparison.riskDelta < 0);
}

const moreTests = [
  testMalformedFiniteFallback, testDeepFreeze, testResolutionFallback, testCameraClamping,
  testP2WetEdge, testP2SnowlineBreakup, testP3NaturalScaleVariation, testP3ClearingNearRoad,
  testP4UnknownShoreline, testP5NightWeather, testStreamingPreloadMargin, testParityFailure,
  testBatchCaps, testMatrixProfileSeeds, testEvidenceOrderIndependence, testManifestBoundaries,
  testEditorBoundaryFailure, testPrimitiveBoundaryFailure, testPostProcessFailure,
  testRoadAndSettlementPlacementGates, testQueryApiGround, testQueryApiBreakup, testQueryApiWater,
  testQualityBandTransitions, testWaterClassNormalizationTable, testBiomeNormalizationTable,
  testSurfaceNormalizationTable, testContractThresholds, testAcceptanceProfiles, testWorldExtent,
  testNoGeometryClaims, testAssetSourceNormalization, testNaturalTransformBounds,
  testWaterOpticalBoundsTable, testSetDressingBiomeSensitivity, testGeologySensitivity,
  testStreamingMobileCaps, testEvidenceDigestChangesOnRisk, testBeforeAfterRiskImprovement,
];

for (const test of tests) {
  test();
  console.log(`PASS ${test.name}`);
}
for (const test of moreTests) {
  test();
  console.log(`PASS ${test.name}`);
}

console.log(`V63 environment grounded visual runtime: ${tests.length + moreTests.length} tests passed`);
