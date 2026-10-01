import assert from 'node:assert/strict';
import {
  V64_CONTRACT,
  createEnvironmentDressingRuntimeV64,
  validateEnvironmentDressingRuntimeV64,
  createV64AcceptanceProfiles,
  compareV64AcceptanceBeforeAfter,
  createV64WorldQueryCapabilities,
} from '../src/3d/world/environmentDressingRuntimeV64.js';
import {
  createV64VisualQualityLedger,
  createV64CameraEvidence,
  createV64BeforeAfterEvidence,
  createV64PlacementManifest,
  validateV64PlacementManifest,
  createV64SceneEvidence,
  createV64HydrologyMatrix,
  createV64BiomeMatrix,
  createV64DeterminismRecord,
  summarizeV64,
} from '../src/3d/world/environmentDressingEvidenceV64.js';

const base = (overrides = {}) => ({
  sampleId: 'terrain-near-center',
  seed: 'v64-fixture',
  terrain: {
    x: 4500,
    y: 116,
    z: 3500,
    height: 116,
    canonicalHeight: 116,
    colliderHeight: 116,
    slope: 12,
    moisture: 0.52,
    elevation01: 0.44,
    snowWeight: 0.04,
    relief: 0.64,
    curvature: 0.08,
    biome: 'forest',
    surface: 'grass',
    canonicalSource: 'canonical-owner-map',
    terrainBackend: 'Terrain3D',
    regionId: 'center',
  },
  water: {
    waterClass: 'land',
    waterDistance: 140,
    depth: 0,
    shorelineWeight: 0,
    wetEdgeWeight: 0,
    foamWeight: 0,
    cyanRisk: 0,
    moireRisk: 0,
    rectangular: false,
    repeatedStripe: false,
    seamRisk: 0,
  },
  material: {
    role: 'grass',
    multiSurface: true,
    placeholder: false,
    missing: false,
    roughness: 0.84,
    macroContrast: 0.74,
    microDetail: 0.7,
  },
  vegetation: [],
  camera: {
    profile: 'terrain-near',
    width: 1536,
    height: 1024,
    orthographicDegrees: 90,
    distance: 420,
    targetX: 4500,
    targetY: 116,
    targetZ: 3500,
    seed: 'camera-v64',
  },
  renderedY: 116,
  colliderY: 116,
  postProcessed: false,
  editorRuntimeImported: false,
  primitiveGeometry: false,
  ...overrides,
});

function testBaseline() {
  const plan = createEnvironmentDressingRuntimeV64(base());
  assert.equal(plan.contract, V64_CONTRACT.id);
  assert.equal(plan.p1.parity.pass, true);
  assert.equal(plan.p0.seam, 0);
  assert.equal(plan.p0.rectangularWater, 0);
  assert.equal(plan.p0.moire, 0);
  assert.equal(plan.quality.placeholder, 0);
  assert.equal(plan.quality.primitiveGeometry, 0);
  assert.equal(validateEnvironmentDressingRuntimeV64(plan).valid, true);
  assert.ok(plan.fingerprint);
}

function testForestClustering() {
  const vegetation = Array.from({ length: 12 }, (_, index) => ({
    assetId: `tree-${index % 4}`,
    category: 'tree',
    x: 4400 + index * 9,
    y: 114 + index * 0.1,
    z: 3420 + (index % 4) * 11,
    slope: 7 + (index % 3),
    moisture: 0.66,
    height01: 0.42,
    scale: 0.9 + index * 0.02,
    grounded: true,
    groundConfidence: 0.95,
    distanceToWater: 80,
    roadDistance: 46,
    settlementDistance: 120,
    instanceBatch: 'forest-center',
  }));
  const plan = createEnvironmentDressingRuntimeV64(base({ vegetation }));
  assert.equal(plan.p3.eligibleCount, 12);
  assert.ok(plan.p3.clusters.length > 0);
  assert.ok(plan.p3.batches.some((batch) => batch.instanced));
  const scales = new Set(plan.p3.dressing.map((item) => item.transform.scale));
  assert.ok(scales.size > 1);
}

function testPlacementFailures() {
  const vegetation = [
    { assetId: 'tree-float', category: 'tree', grounded: false, groundConfidence: 1, slope: 5, distanceToWater: 50, roadDistance: 40, settlementDistance: 80 },
    { assetId: 'tree-cliff', category: 'tree', grounded: true, groundConfidence: 1, slope: 81, distanceToWater: 50, roadDistance: 40, settlementDistance: 80 },
    { assetId: 'tree-snow', category: 'tree', grounded: true, groundConfidence: 1, slope: 6, permanentSnow: true, distanceToWater: 50, roadDistance: 40, settlementDistance: 80 },
    { assetId: 'tree-water', category: 'tree', grounded: true, groundConfidence: 1, slope: 6, distanceToWater: 1, roadDistance: 40, settlementDistance: 80 },
  ];
  const plan = createEnvironmentDressingRuntimeV64(base({ vegetation }));
  assert.equal(plan.p3.eligibleCount, 0);
  assert.equal(plan.p3.rejectedCount, 4);
  assert.ok(plan.p3.batches.length === 0);
  const ledger = createV64VisualQualityLedger(plan);
  assert.ok(ledger.breaches.includes('P3.invalidPlacement'));
}

function testP0WaterFailures() {
  const plan = createEnvironmentDressingRuntimeV64(base({
    water: {
      waterClass: 'sea',
      waterDistance: 1,
      depth: 3,
      shorelineWeight: 0.9,
      wetEdgeWeight: 0.8,
      foamWeight: 0.4,
      cyanRisk: 0.8,
      moireRisk: 0.9,
      rectangular: true,
      repeatedStripe: true,
      seamRisk: 0.7,
    },
  }));
  assert.equal(plan.p0.rectangularWater, 1);
  assert.equal(plan.p0.moire, 1);
  assert.equal(plan.p0.cyan, 1);
  assert.equal(plan.p0.seam, 1);
  assert.equal(plan.p4.water.rectangularRisk, 1);
  assert.equal(plan.p4.water.stripeRisk, 1);
  assert.ok(validateEnvironmentDressingRuntimeV64(plan).errors.length > 0);
}

function testAlpineResponse() {
  const plan = createEnvironmentDressingRuntimeV64(base({
    terrain: {
      ...base().terrain,
      biome: 'alpine',
      slope: 58,
      elevation01: 0.91,
      snowWeight: 0.76,
      relief: 0.82,
      surface: 'scree',
    },
    material: { ...base().material, role: 'scree' },
  }));
  assert.ok(plan.p1.geology.rockExposure > 0);
  assert.ok(plan.p1.geology.talus > 0);
  assert.ok(plan.p2.surfaces.scree > 0);
  assert.ok(plan.p2.surfaces.snow > 0);
  assert.ok(plan.p3.habitat.scree > plan.p3.habitat.canopy);
}

function testHydrologyMatrix() {
  const matrix = createV64HydrologyMatrix('water-test');
  assert.equal(matrix.length, 4);
  assert.deepEqual(matrix.map((row) => row.waterClass), ['sea', 'lake', 'river', 'land']);
  assert.ok(matrix.slice(0, 3).every((row) => row.requiresDeepShallowBlend));
  assert.equal(matrix[3].requiresWetEdge, false);
}

function testBiomeMatrix() {
  const matrix = createV64BiomeMatrix();
  assert.ok(matrix.some((row) => row.biome === 'forest'));
  assert.ok(matrix.some((row) => row.biome === 'alpine' && row.snowWeight > 0.7));
  assert.ok(matrix.some((row) => row.biome === 'desert' && row.moisture < 0.1));
}

function testCameraEvidence() {
  const profiles = createV64AcceptanceProfiles('camera-test');
  assert.equal(profiles.length, 4);
  assert.ok(profiles.every((item) => item.width === 1536 && item.height === 1024 && item.orthographicDegrees === 90));
  const camera = createV64CameraEvidence('full-world', {
    width: 1536,
    height: 1024,
    orthographicDegrees: 90,
    seed: 'camera-test',
  });
  assert.equal(camera.valid, true);
  assert.equal(camera.deterministic, true);
}

function testManifest() {
  const plan = createEnvironmentDressingRuntimeV64(base({
    vegetation: [{
      assetId: 'tree-a', category: 'tree', x: 4510, y: 116, z: 3510,
      scale: 1, grounded: true, groundConfidence: 0.94, slope: 8,
      distanceToWater: 70, roadDistance: 32, settlementDistance: 80,
      instanceBatch: 'forest',
    }],
  }));
  const manifest = createV64PlacementManifest(plan);
  assert.equal(manifest.count, 1);
  assert.equal(validateV64PlacementManifest(manifest).valid, true);
  assert.equal(manifest.sharedMaterialCore, 'src/3d/materials/MaterialAssignmentCore.js');
  assert.equal(manifest.sharedPlacementPipeline, 'src/3d/world/WorldAssetPlacementPipeline.js');
  assert.equal(manifest.geometryCreated, false);
  assert.equal(manifest.editorRuntimeImported, false);
}

function testBeforeAfter() {
  const before = base({ material: { ...base().material, macroContrast: 0.38, microDetail: 0.35 } });
  const after = base({ material: { ...base().material, macroContrast: 0.82, microDetail: 0.76 } });
  const a = createEnvironmentDressingRuntimeV64(before);
  const b = createEnvironmentDressingRuntimeV64(after);
  const comparison = compareV64AcceptanceBeforeAfter(before, after);
  assert.equal(comparison.sameSeed, true);
  assert.equal(comparison.sameCoordinate, true);
  assert.ok(comparison.materialImprovement > 0);
  const evidence = createV64BeforeAfterEvidence(a, b);
  assert.ok(evidence.visualDetailDelta > 0);
  assert.equal(evidence.improved, true);
}

function testQueriesAndSceneEvidence() {
  const plan = createEnvironmentDressingRuntimeV64(base());
  const queries = createV64WorldQueryCapabilities();
  assert.ok(queries.ground.includes('colliderParity'));
  assert.ok(queries.water.includes('wetEdgeWeight'));
  assert.ok(queries.biome.includes('moisture'));
  assert.ok(queries.placement.includes('eligible'));
  const scene = createV64SceneEvidence(plan);
  assert.equal(scene.contract, plan.contract);
  assert.equal(scene.acceptance.parity, true);
  assert.equal(scene.acceptance.atmosphericReadability, true);
  const summary = summarizeV64(plan);
  assert.ok(summary.fingerprint);
  return scene;
}

function testDeterminism() {
  const observation = base({
    vegetation: [
      { assetId: 'tree-b', category: 'tree', x: 4510, y: 116, z: 3510, grounded: true, groundConfidence: 0.92, slope: 9, distanceToWater: 60, roadDistance: 30, settlementDistance: 100, instanceBatch: 'forest' },
      { assetId: 'tree-a', category: 'tree', x: 4490, y: 116, z: 3490, grounded: true, groundConfidence: 0.91, slope: 8, distanceToWater: 58, roadDistance: 31, settlementDistance: 98, instanceBatch: 'forest' },
    ],
  });
  const reversed = { ...observation, vegetation: [...observation.vegetation].reverse() };
  const a = createEnvironmentDressingRuntimeV64(observation);
  const b = createEnvironmentDressingRuntimeV64(reversed);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.deepEqual(createV64DeterminismRecord(a, b), {
    equal: true,
    firstFingerprint: a.fingerprint,
    secondFingerprint: b.fingerprint,
    mismatch: null,
  });
}

function testPostProcessAndPrimitiveGuards() {
  const post = createEnvironmentDressingRuntimeV64(base({ postProcessed: true }));
  assert.equal(post.p0.postProcessed, 1);
  assert.equal(validateEnvironmentDressingRuntimeV64(post).valid, false);
  const primitive = createEnvironmentDressingRuntimeV64(base({ primitiveGeometry: true }));
  assert.equal(primitive.quality.primitiveGeometry, 1);
  assert.equal(validateEnvironmentDressingRuntimeV64(primitive).valid, false);
}

const tests = [
  testBaseline,
  testForestClustering,
  testPlacementFailures,
  testP0WaterFailures,
  testAlpineResponse,
  testHydrologyMatrix,
  testBiomeMatrix,
  testCameraEvidence,
  testManifest,
  testBeforeAfter,
  testQueriesAndSceneEvidence,
  testDeterminism,
  testPostProcessAndPrimitiveGuards,
];

for (const test of tests) test();
console.log(JSON.stringify({ ok: true, contract: V64_CONTRACT.id, tests: tests.length }, null, 2));
