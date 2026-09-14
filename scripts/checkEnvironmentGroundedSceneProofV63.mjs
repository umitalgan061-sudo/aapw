import assert from 'node:assert/strict';
import {
  createSceneCameraV63,
  createDeterministicSceneProofPlanV63,
  createSceneSampleGridV63,
  classifySceneSampleV63,
  createSceneProofManifestV63,
  createBeforeAfterSceneManifestV63,
  validateSceneProofManifestV63,
  createSceneAcceptanceSummaryV63,
  createSceneEvidenceFixtureV63,
} from '../src/3d/world/environmentGroundedSceneProofV63.js';
import { createGroundedVisualRuntimeV63 } from '../src/3d/world/environmentGroundedVisualRuntimeV63.js';
import { createEnvironmentDoctorReportV63 } from '../src/3d/world/environmentGroundedVisualRuntimeV63Diagnostics.js';

const fixture = createSceneEvidenceFixtureV63();
assert.equal(fixture.camera.width, 1536);
assert.equal(fixture.camera.height, 1024);
assert.equal(fixture.camera.orthographicDegrees, 90);
console.log('PASS scene evidence fixture');

const expectedProfiles = ['fullWorld', 'far', 'terrain-near', 'coast-near', 'mountain-near', 'forest-near', 'settlement-near', 'northwest-near'];
for (const profile of expectedProfiles) {
  const a = createSceneCameraV63(profile, 'same');
  const b = createSceneCameraV63(profile, 'same');
  assert.deepEqual(a, b);
  assert.equal(a.width, 1536);
  assert.equal(a.height, 1024);
  assert.equal(a.orthographicDegrees, 90);
  assert.ok(a.distance > 0);
  assert.ok(typeof a.seed === 'string');
}
console.log('PASS deterministic camera profiles');

const proofPlan = createDeterministicSceneProofPlanV63({ seed: 'proof-seed' });
assert.equal(proofPlan.cameras.length, 8);
assert.equal(proofPlan.output.width, 1536);
assert.equal(proofPlan.output.height, 1024);
assert.equal(proofPlan.output.orthographicDegrees, 90);
assert.equal(proofPlan.postProcess, false);
assert.equal(proofPlan.sameCoordinateBeforeAfter, true);
console.log('PASS proof plan');

const grid = createSceneSampleGridV63({ centerX: 4500, centerZ: 3500, extentX: 720, extentZ: 540, columns: 7, rows: 5, seed: 'grid' });
assert.equal(grid.samples.length, 35);
assert.equal(new Set(grid.samples.map((sample) => sample.sampleId)).size, 35);
assert.equal(grid.samples[0].x, 4140);
assert.equal(grid.samples[6].x, 4860);
assert.equal(grid.samples[0].z, 3230);
assert.equal(grid.samples[34].z, 3770);
console.log('PASS deterministic sample grid');

const grid2 = createSceneSampleGridV63({ centerX: 4500, centerZ: 3500, extentX: 720, extentZ: 540, columns: 7, rows: 5, seed: 'grid' });
assert.deepEqual(grid, grid2);
console.log('PASS grid repeatability');

const classified = classifySceneSampleV63(fixture);
assert.equal(classified.sampleId, 'scene-fixture');
assert.equal(classified.p0VisibleFailures, 0);
assert.equal(classified.p1GeometryFailures, 0);
assert.equal(classified.p3PlacementFailures, 0);
assert.equal(classified.p5AtmosphereFailures, 0);
assert.ok(typeof classified.fingerprint === 'string');
console.log('PASS clean sample classification');

const risky = {
  ...fixture,
  sampleId: 'risky',
  terrain: { ...fixture.terrain, slope: 80, roughness: 0.12, biome: 'alpine', surface: 'rock', snowWeight: 0.96 },
  water: { ...fixture.water, waterClass: 'sea', waterDistance: 0.2, rectangular: true, repeatedStripe: true, cyanRisk: 1, moireRisk: 1, seamRisk: 1 },
  material: { ...fixture.material, role: 'rock', multiSurface: false, placeholder: true, missing: true },
  renderedY: 102,
  colliderY: 100,
};
const riskyClassified = classifySceneSampleV63(risky);
assert.ok(riskyClassified.p0VisibleFailures > 0);
assert.ok(riskyClassified.p1GeometryFailures > 0);
assert.ok(riskyClassified.p2MaterialFailures > 0);
assert.ok(riskyClassified.p4WaterFailures > 0);
console.log('PASS deliberate failure classification');

const cleanManifest = createSceneProofManifestV63([fixture], 'clean-manifest');
assert.equal(cleanManifest.sampleCount, 1);
assert.equal(cleanManifest.pass, true);
assert.equal(cleanManifest.visibleFailureTotal, 0);
assert.equal(validateSceneProofManifestV63(cleanManifest).valid, true);
console.log('PASS clean proof manifest');

const blockedManifest = createSceneProofManifestV63([risky], 'blocked-manifest');
assert.equal(blockedManifest.pass, false);
assert.ok(blockedManifest.visibleFailureTotal > 0);
assert.equal(validateSceneProofManifestV63(blockedManifest).valid, false);
console.log('PASS blocked proof manifest');

const summary = createSceneAcceptanceSummaryV63([fixture, risky], 'summary');
assert.equal(summary.sampleCount, 2);
assert.ok(summary.visibleFailureTotal > 0);
assert.ok(Object.keys(summary.priorityHistogram).length > 0);
console.log('PASS scene acceptance summary');

const before = {
  ...risky,
  seed: 'comparison',
  sampleId: 'comparison-before',
  camera: { ...fixture.camera, seed: 'comparison-camera' },
};
const after = {
  ...fixture,
  seed: 'comparison',
  sampleId: 'comparison-after',
  camera: { ...fixture.camera, seed: 'comparison-camera' },
};
const comparison = createBeforeAfterSceneManifestV63([before], [after], 'comparison');
assert.equal(comparison.count, 1);
assert.equal(comparison.comparable, true);
assert.equal(comparison.improved, 1);
assert.equal(comparison.regressed, 0);
assert.ok(comparison.rows[0].riskDelta < 0);
console.log('PASS before/after scene manifest');

const doctorClean = createEnvironmentDoctorReportV63(fixture);
assert.equal(doctorClean.mergeEligible, true);
assert.equal(doctorClean.priority.topPriority, null);
assert.equal(doctorClean.water.recognized, false);
assert.equal(doctorClean.performance.overBudget, false);
console.log('PASS clean environment doctor report');

const doctorRisk = createEnvironmentDoctorReportV63(risky);
assert.equal(doctorRisk.mergeEligible, false);
assert.ok(doctorRisk.priority.topPriority.startsWith('P0:'));
assert.ok(doctorRisk.actionPlan.actions.length >= 4);
assert.equal(doctorRisk.water.recognized, true);
console.log('PASS risky environment doctor report');

const riskPlan = createGroundedVisualRuntimeV63(risky);
assert.equal(riskPlan.acceptance.mergeEligible, false);
assert.ok(riskPlan.riskScore > 0);
console.log('PASS runtime risk gate');

for (const profile of expectedProfiles) {
  const observation = {
    ...fixture,
    sampleId: `profile-${profile}`,
    seed: `profile-${profile}`,
    camera: createSceneCameraV63(profile, 'profiles'),
  };
  const classifiedProfile = classifySceneSampleV63(observation);
  assert.equal(classifiedProfile.profile, profile);
  assert.equal(observation.camera.width, 1536);
  assert.equal(observation.camera.height, 1024);
}
console.log('PASS eight-profile sample sweep');

const coastal = {
  ...fixture,
  sampleId: 'coast-near',
  terrain: { ...fixture.terrain, surface: 'shore', biome: 'coastal', moisture: 0.82, elevation01: 0.28 },
  water: { ...fixture.water, waterClass: 'sea', waterDistance: 2.5, depth: 2.4, shorelineWeight: 0.9, wetEdgeWeight: 0.88, foamWeight: 0.32 },
  camera: createSceneCameraV63('coast-near', 'coast'),
};
const coastalReport = classifySceneSampleV63(coastal);
assert.equal(coastalReport.p0VisibleFailures, 0);
assert.equal(coastalReport.p4WaterFailures, 0);
console.log('PASS coastal near evidence');

const mountain = {
  ...fixture,
  sampleId: 'mountain-near',
  terrain: { ...fixture.terrain, surface: 'scree', biome: 'alpine', moisture: 0.42, elevation01: 0.88, snowWeight: 0.72, slope: 48, roughness: 0.82 },
  material: { ...fixture.material, role: 'scree' },
  camera: createSceneCameraV63('mountain-near', 'mountain'),
};
const mountainPlan = createGroundedVisualRuntimeV63(mountain);
assert.ok(mountainPlan.material.weights.rock > 0);
assert.ok(mountainPlan.material.weights.scree > 0);
assert.ok(mountainPlan.geometry.rockExposure > 0);
console.log('PASS mountain near evidence');

const forest = {
  ...fixture,
  sampleId: 'forest-near',
  terrain: { ...fixture.terrain, biome: 'forest', moisture: 0.74, elevation01: 0.44, slope: 12 },
  camera: createSceneCameraV63('forest-near', 'forest'),
  vegetation: [
    { assetId: 'tree-a', category: 'tree', x: 0, y: 100, z: 0, scale: 1, slope: 8, moisture: 0.72, height01: 0.44, distanceToWater: 50, roadDistance: 90, settlementDistance: 100, grounded: true, groundConfidence: 0.92, instanceBatch: 'forest' },
    { assetId: 'tree-b', category: 'tree', x: 10, y: 100, z: 12, scale: 1.04, slope: 9, moisture: 0.7, height01: 0.45, distanceToWater: 52, roadDistance: 92, settlementDistance: 102, grounded: true, groundConfidence: 0.95, instanceBatch: 'forest' },
    { assetId: 'shrub-a', category: 'shrub', x: 18, y: 100, z: 15, scale: 0.9, slope: 7, moisture: 0.75, height01: 0.46, distanceToWater: 54, roadDistance: 93, settlementDistance: 105, grounded: true, groundConfidence: 0.93, instanceBatch: 'understory' },
  ],
};
const forestPlan = createGroundedVisualRuntimeV63(forest);
assert.equal(forestPlan.vegetation.invalid, 0);
assert.equal(forestPlan.vegetation.batches.length, 2);
assert.ok(forestPlan.vegetation.batches.some((batch) => batch.instanced));
console.log('PASS forest near evidence');

const allSamples = [fixture, coastal, mountain, forest];
const allManifest = createSceneProofManifestV63(allSamples, 'all-categories');
assert.equal(allManifest.sampleCount, 4);
assert.equal(allManifest.pass, true);
assert.equal(allManifest.visibleFailureTotal, 0);
console.log('PASS all-category scene proof');

const matrixRows = [];
for (const [index, surface] of ['grass', 'soil', 'mud', 'sand', 'rock', 'scree', 'snow', 'ice', 'wet', 'shore'].entries()) {
  matrixRows.push({
    ...fixture,
    sampleId: `surface-${surface}`,
    terrain: { ...fixture.terrain, surface, biome: surface === 'snow' || surface === 'ice' ? 'alpine' : 'temperate', elevation01: surface === 'snow' || surface === 'ice' ? 0.92 : 0.35, snowWeight: surface === 'snow' ? 0.9 : surface === 'ice' ? 1 : 0.04, slope: surface === 'rock' || surface === 'scree' ? 45 + index * 2 : 8 + index },
    material: { ...fixture.material, role: surface },
  });
}
for (const row of matrixRows) {
  const result = classifySceneSampleV63(row);
  assert.equal(typeof result.p2MaterialFailures, 'number');
  assert.equal(result.p0VisibleFailures, 0);
  assert.equal(result.p5AtmosphereFailures, 0);
}
console.log('PASS material surface matrix');

const malformed = {
  ...fixture,
  sampleId: 'malformed',
  terrain: { ...fixture.terrain, height: NaN, slope: Infinity, moisture: NaN, elevation01: NaN, snowWeight: NaN },
  water: { ...fixture.water, waterDistance: NaN, depth: Infinity, cyanRisk: NaN, moireRisk: NaN },
  camera: { ...fixture.camera, width: NaN, height: Infinity, distance: NaN },
};
const malformedPlan = createGroundedVisualRuntimeV63(malformed);
assert.ok(Number.isFinite(malformedPlan.input.terrain.height));
assert.ok(Number.isFinite(malformedPlan.input.terrain.slope));
assert.ok(Number.isFinite(malformedPlan.input.water.distance));
assert.ok(Number.isFinite(malformedPlan.input.camera.width));
console.log('PASS malformed observation fallback');

const proofPlan2 = createDeterministicSceneProofPlanV63({ seed: 'proof-seed', profiles: expectedProfiles });
assert.deepEqual(proofPlan2, proofPlan);
console.log('PASS proof plan deterministic equivalence');

console.log('V63 shipped-scene proof suite complete');
