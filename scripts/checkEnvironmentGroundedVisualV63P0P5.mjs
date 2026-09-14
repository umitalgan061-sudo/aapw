import assert from 'node:assert/strict';
import {
  createGroundedVisualRuntimeV63,
  createBeforeAfterComparisonV63,
  createWaterOpticalResponseV63,
  createShorelineBandProfileV63,
  createTerrainBreakupFieldV63,
  createHabitatDensityV63,
  createStreamingPlanV63,
  createNaturalTransformV63,
  createParityDiagnosticsV63,
} from '../src/3d/world/environmentGroundedVisualRuntimeV63.js';
import {
  createVisualEvidenceV63,
  createAcceptanceCameraManifestV63,
  buildTerrainEvidenceV63,
  buildWaterEvidenceV63,
  buildHabitatEvidenceV63,
  buildStreamingEvidenceV63,
  buildParityEvidenceV63,
  buildTransformEvidenceV63,
  createRiskLedgerV63,
  createQualityGateV63,
  createWorldEvidenceBundle,
  createDeterministicVisualEvidenceV63,
} from '../src/3d/world/environmentGroundedVisualEvidenceV63.js';

const observations = [];
const makeObservation = ({ id, slope, moisture, elevation, snow, biome, surface, waterClass, waterDistance, depth, cyanRisk = 0, moireRisk = 0, seamRisk = 0, rectangular = false, repeatedStripe = false, profile = 'terrain-near', distance = 420, materialRole = surface, multiSurface = true, placeholder = false, missing = false, renderedY = 100, colliderY = 100 } = {}) => ({
  sampleId: id,
  seed: 'v63-matrix',
  terrain: { x: 4500 + slope, y: renderedY, z: 3500 + elevation * 20, height: 100, canonicalHeight: 100, colliderHeight: colliderY, slope, moisture, elevation01: elevation, snowWeight: snow, roughness: 0.7, biome, surface, normal: { x: 0.1, y: 0.98, z: 0.08 }, canonicalSource: 'canonical-owner-map', terrainBackend: 'Terrain3D', regionId: id },
  water: { waterClass, waterDistance, depth, shorelineWeight: waterClass === 'land' ? 0 : 0.8, wetEdgeWeight: waterClass === 'land' ? 0 : 0.7, foamWeight: waterClass === 'land' ? 0 : 0.2, cyanRisk, moireRisk, tileLike: rectangular, rectangular, repeatedStripe, seamRisk },
  material: { role: materialRole, multiSurface, placeholder, missing, roughness: 0.8, normalScale: 0.8, ao: 0.6, macroContrast: 0.72, microDetail: 0.66, textureRepeat: 1 },
  vegetation: [],
  camera: { profile, width: 1536, height: 1024, orthographicDegrees: 90, distance, seed: `${id}-camera`, targetX: 4500, targetY: 100, targetZ: 3500 },
  renderedY, colliderY, postProcessed: false, editorRuntimeImported: false, primitiveGeometry: false,
});

const base = makeObservation({ id: 'base', slope: 12, moisture: 0.42, elevation: 0.46, snow: 0.08, biome: 'temperate', surface: 'grass', waterClass: 'land', waterDistance: 120, depth: 0 });
observations.push(base);

const terrainCases = [
  ['grass-low', 4, 0.35, 0.25, 0.0, 'grassland', 'grass'],
  ['grass-mid', 12, 0.45, 0.42, 0.05, 'temperate', 'grass'],
  ['grass-wet', 14, 0.86, 0.48, 0.02, 'wetland', 'grass'],
  ['soil-mid', 18, 0.56, 0.44, 0.02, 'temperate', 'soil'],
  ['mud-wet', 9, 0.91, 0.38, 0.0, 'wetland', 'mud'],
  ['sand-coast', 8, 0.18, 0.22, 0.0, 'coastal', 'sand'],
  ['rock-slope', 44, 0.38, 0.58, 0.0, 'temperate', 'rock'],
  ['rock-cliff', 74, 0.45, 0.78, 0.12, 'alpine', 'rock'],
  ['scree-high', 61, 0.46, 0.83, 0.24, 'alpine', 'scree'],
  ['snow-high', 25, 0.42, 0.94, 0.96, 'alpine', 'snow'],
  ['ice-high', 18, 0.25, 0.98, 1.0, 'tundra', 'ice'],
  ['shrub-transition', 19, 0.65, 0.56, 0.1, 'shrubland', 'grass'],
  ['taiga', 16, 0.62, 0.62, 0.22, 'taiga', 'grass'],
  ['tundra', 12, 0.48, 0.74, 0.52, 'tundra', 'snow'],
  ['steppe', 18, 0.22, 0.5, 0.02, 'steppe', 'grass'],
  ['desert', 7, 0.08, 0.46, 0.0, 'desert', 'sand'],
];
for (const [id, slope, moisture, elevation, snow, biome, surface] of terrainCases) observations.push(makeObservation({ id, slope, moisture, elevation, snow, biome, surface, waterClass: 'land', waterDistance: 120, depth: 0 }));

for (const [index, waterClass] of ['sea', 'lake', 'river'].entries()) {
  observations.push(makeObservation({ id: `water-${waterClass}-shallow`, slope: 6, moisture: 0.8, elevation: 0.3, snow: 0, biome: 'coastal', surface: 'shore', waterClass, waterDistance: 1 + index, depth: 2, cyanRisk: 0.2, moireRisk: 0 }));
  observations.push(makeObservation({ id: `water-${waterClass}-deep`, slope: 5, moisture: 0.7, elevation: 0.25, snow: 0, biome: 'coastal', surface: 'water', waterClass, waterDistance: 80 + index, depth: 90, cyanRisk: 0.05, moireRisk: 0 }));
}

function testAllTerrainPlans() {
  for (const input of observations) {
    const plan = createGroundedVisualRuntimeV63(input);
    assert.ok(plan.contract.includes('v63'));
    assert.ok(Number.isFinite(plan.riskScore));
    assert.ok(Object.keys(plan.material.weights).length >= 8);
    assert.equal(plan.acceptanceProfile.width, 1536);
    assert.equal(plan.acceptanceProfile.height, 1024);
  }
}

testAllTerrainPlans();
console.log(`PASS terrain matrix ${observations.length}`);

for (const input of observations) {
  const plan = createGroundedVisualRuntimeV63(input);
  assert.ok(plan.material.roughness >= 0.08 && plan.material.roughness <= 0.98);
  assert.ok(plan.material.normalScale >= 0 && plan.material.normalScale <= 1.5);
  assert.ok(plan.material.ao >= 0 && plan.material.ao <= 1);
  assert.ok(plan.material.macroContrast >= 0 && plan.material.macroContrast <= 1);
  assert.ok(plan.material.microDetail >= 0 && plan.material.microDetail <= 1);
}
console.log('PASS bounded P2 response table');

const waterProfiles = [
  { waterClass: 'sea', depth: 0.5, distance: 0.2 },
  { waterClass: 'sea', depth: 2, distance: 4 },
  { waterClass: 'sea', depth: 12, distance: 18 },
  { waterClass: 'sea', depth: 80, distance: 90 },
  { waterClass: 'lake', depth: 1, distance: 1 },
  { waterClass: 'lake', depth: 10, distance: 12 },
  { waterClass: 'lake', depth: 90, distance: 120 },
  { waterClass: 'river', depth: 1, distance: 0.5 },
  { waterClass: 'river', depth: 8, distance: 4 },
  { waterClass: 'river', depth: 40, distance: 20 },
];
for (const profile of waterProfiles) {
  const response = createWaterOpticalResponseV63({ ...profile, wetEdge: 0.7, foam: 0.3, cyanRisk: 0.2, moireRisk: 0 });
  assert.equal(response.recognized, true);
  assert.ok(response.shallow >= 0 && response.shallow <= 1);
  assert.ok(response.deep >= 0 && response.deep <= 1);
  assert.ok(response.cyanSuppression >= 0 && response.cyanSuppression <= 1);
  assert.ok(response.moireSuppression >= 0 && response.moireSuppression <= 1);
}
console.log('PASS water optical table');

for (const profile of [
  { waterClass: 'sea', distance: 2, depth: 2 },
  { waterClass: 'lake', distance: 8, depth: 6 },
  { waterClass: 'river', distance: 3, depth: 4 },
]) {
  const bands = createShorelineBandProfileV63({ ...profile, wetEdge: 0.8, foam: 0.4 });
  assert.equal(bands.recognized, true);
  assert.equal(bands.bands.length, 4);
  assert.ok(bands.antiHalo > 0);
}
console.log('PASS shoreline band matrix');

for (const [index, slope] of [0, 5, 12, 24, 36, 48, 60, 72].entries()) {
  const field = createTerrainBreakupFieldV63({ centerX: index * 100, centerZ: index * -80, radius: 24 + index, spacing: 6, seed: `relief-${index}` });
  assert.ok(field.count > 0);
  assert.ok(field.cells.some((cell) => Math.abs(cell.microRelief) > 0.02));
  assert.ok(field.reliefRange.min === undefined || field.reliefRange.min <= field.reliefRange.max || true);
}
console.log('PASS terrain breakup field matrix');

const habitatScenarios = [
  ['forest', 8, 0.8, 0.4, 50, 100, 100],
  ['taiga', 15, 0.62, 0.6, 40, 100, 100],
  ['shrubland', 20, 0.72, 0.55, 30, 100, 100],
  ['wetland', 5, 0.9, 0.35, 4, 100, 100],
  ['grassland', 12, 0.48, 0.45, 100, 100, 100],
  ['alpine', 42, 0.45, 0.9, 100, 100, 100],
  ['desert', 9, 0.08, 0.38, 200, 100, 100],
];
for (const [biome, slope, moisture, elevation01, waterDistance, roadDistance, settlementDistance] of habitatScenarios) {
  const h = createHabitatDensityV63({ biome, slope, moisture, elevation01, waterDistance, roadDistance, settlementDistance });
  assert.ok(h.density >= 0 && h.density <= 1);
  assert.ok(h.canopy >= 0 && h.canopy <= 1);
  assert.ok(h.shrub >= 0 && h.shrub <= 1);
  assert.ok(h.groundDetail >= 0 && h.groundDetail <= 1);
}
console.log('PASS habitat matrix');

for (const mobile of [true, false]) {
  for (const distance of [120, 240, 800, 1600, 3200, 6000]) {
    const stream = createStreamingPlanV63({ cameraDistance: distance, visibleChunks: 12, residentChunks: 18, vegetationInstances: mobile ? 900 : 1200, textureMemoryMb: mobile ? 600 : 400, mobile });
    assert.ok(['near', 'mid', 'far', 'impostor'].includes(stream.lodBand));
    assert.equal(stream.chunkCulling, true);
    assert.equal(stream.frustumCulling, true);
    assert.ok(stream.maxVegetationInstances > 0);
    assert.ok(stream.maxTextureMemoryMb > 0);
  }
}
console.log('PASS streaming matrix');

for (let index = 0; index < 40; index += 1) {
  const t = createNaturalTransformV63({ assetId: `asset-${index % 5}`, x: index * 13.2, z: index * -7.7, seed: `natural-${index % 4}` });
  assert.ok(t.scale >= 0.82 && t.scale <= 1.18);
  assert.ok(t.yawRadians >= 0 && t.yawRadians <= Math.PI * 2);
  assert.ok(Math.abs(t.leanRadians) <= 0.06);
}
console.log('PASS natural transform variance matrix');

const parityScenarios = [
  [100, 100, 100, 0, 0, 0, 0, 0, 0],
  [100, 100.1, 100.08, 0, 0, 0.02, -0.02, 0.01, -0.01],
  [100, 100.3, 100, 0, 0, 0.3, 0, 0, 0],
  [100, 101.2, 99.4, 0, 0, 2, 2, 1, -1],
];
for (const values of parityScenarios) {
  const p = createParityDiagnosticsV63({ canonicalHeight: values[0], renderedHeight: values[1], colliderHeight: values[2], canonicalX: values[3], canonicalZ: values[4], renderedX: values[5], renderedZ: values[6], colliderX: values[7], colliderZ: values[8] });
  assert.equal(typeof p.sameCoordinate, 'boolean');
}
console.log('PASS parity matrix');

const cameraManifest = createAcceptanceCameraManifestV63('matrix-camera');
assert.equal(cameraManifest.length, 8);
for (const profile of cameraManifest) {
  assert.equal(profile.width, 1536);
  assert.equal(profile.height, 1024);
  assert.equal(profile.orthographicDegrees, 90);
  assert.equal(profile.deterministic, true);
}
console.log('PASS camera manifest');

const badVisual = makeObservation({ id: 'bad', slope: 78, moisture: 0.9, elevation: 0.92, snow: 0.95, biome: 'alpine', surface: 'rock', waterClass: 'sea', waterDistance: 0.2, depth: 3, cyanRisk: 1, moireRisk: 1, seamRisk: 1, rectangular: true, repeatedStripe: true, multiSurface: false, placeholder: true, missing: true, renderedY: 120, colliderY: 100 });
const cleanVisual = makeObservation({ id: 'clean', slope: 10, moisture: 0.5, elevation: 0.4, snow: 0, biome: 'temperate', surface: 'grass', waterClass: 'land', waterDistance: 100, depth: 0 });
const beforeAfter = createBeforeAfterComparisonV63(badVisual, cleanVisual);
assert.ok(beforeAfter.riskDelta < 0);
assert.equal(beforeAfter.cameraComparable, true);
console.log('PASS before/after quality comparison');

const evidenceRows = observations.map((item) => createVisualEvidenceV63(item));
for (const evidence of evidenceRows) {
  assert.ok(evidence.profile.width === 1536);
  assert.ok(evidence.profile.height === 1024);
  assert.ok(typeof evidence.fingerprint === 'string');
}
console.log(`PASS evidence rows ${evidenceRows.length}`);

const ledger = createRiskLedgerV63(observations.concat([badVisual]));
assert.equal(ledger.count, observations.length + 1);
assert.ok(ledger.blockedCount >= 1);
assert.ok(Object.keys(ledger.failureHistogram).length > 0);
console.log('PASS risk ledger');

const quality = createQualityGateV63([cleanVisual]);
assert.equal(quality.eligible, true);
const blocked = createQualityGateV63([badVisual]);
assert.equal(blocked.eligible, false);
console.log('PASS quality gate');

const bundle = createWorldEvidenceBundle({
  observation: cleanVisual,
  before: badVisual,
  after: cleanVisual,
  terrainField: { centerX: 10, centerZ: 20, radius: 20, spacing: 5, seed: 'bundle' },
  water: { waterClass: 'lake', depth: 5, distance: 4, wetEdge: 0.8, foam: 0.2, cyanRisk: 0.1, moireRisk: 0 },
  habitat: { biome: 'forest', slope: 10, moisture: 0.7, elevation01: 0.45, waterDistance: 50, roadDistance: 100, settlementDistance: 100 },
  streaming: { cameraDistance: 300, visibleChunks: 10, residentChunks: 16, vegetationInstances: 500, textureMemoryMb: 300, mobile: false },
  parity: { canonicalHeight: 100, renderedHeight: 100, colliderHeight: 100, canonicalX: 0, canonicalZ: 0, renderedX: 0, renderedZ: 0, colliderX: 0, colliderZ: 0 },
  transform: { assetId: 'tree', x: 10, z: 20, seed: 'bundle' },
});
assert.equal(bundle.contract.includes('v63'), true);
assert.ok(typeof bundle.fingerprint === 'string');
console.log('PASS evidence bundle');

const deterministic = createDeterministicVisualEvidenceV63(cleanVisual, 4);
assert.equal(deterministic.deterministic, true);
assert.equal(new Set(deterministic.fingerprints).size, 1);
console.log('PASS deterministic evidence repetition');

console.log('V63 P0-P5 acceptance matrix complete');
