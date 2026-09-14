import assert from 'node:assert/strict';
import {
  V63_CONTRACT,
  createGroundedVisualRuntimeV63,
  createTerrainBreakupFieldV63,
  createWaterOpticalResponseV63,
  createHabitatDensityV63,
  createStreamingPlanV63,
  createNaturalTransformV63,
  createParityDiagnosticsV63,
  createShorelineBandProfileV63,
} from '../src/3d/world/environmentGroundedVisualRuntimeV63.js';
import {
  createVisualEvidenceV63,
  createAcceptanceCameraManifestV63,
  compareMultipleRunsV63,
  buildTerrainEvidenceV63,
  buildWaterEvidenceV63,
  buildHabitatEvidenceV63,
  buildStreamingEvidenceV63,
  buildParityEvidenceV63,
  buildTransformEvidenceV63,
  createQualityGateV63,
  createDeterministicVisualEvidenceV63,
} from '../src/3d/world/environmentGroundedVisualEvidenceV63.js';

const make = (id, patch = {}) => ({
  sampleId: id,
  seed: 'v63-perf',
  terrain: { x: 1000, y: 80, z: 2000, height: 80, canonicalHeight: 80, colliderHeight: 80, slope: 18, moisture: 0.5, elevation01: 0.42, snowWeight: 0.05, roughness: 0.76, normal: { x: 0.1, y: 0.98, z: 0.08 }, biome: 'temperate', surface: 'grass', canonicalSource: 'canonical-owner-map', terrainBackend: 'Terrain3D', regionId: 'perf' },
  water: { waterClass: 'land', waterDistance: 90, depth: 0, shorelineWeight: 0, wetEdgeWeight: 0, foamWeight: 0, cyanRisk: 0, moireRisk: 0, seamRisk: 0, tileLike: false, rectangular: false, repeatedStripe: false },
  material: { role: 'grass', multiSurface: true, placeholder: false, missing: false, roughness: 0.8, normalScale: 0.82, ao: 0.55, macroContrast: 0.72, microDetail: 0.7, textureRepeat: 1 },
  vegetation: [],
  camera: { profile: 'terrain-near', width: 1536, height: 1024, orthographicDegrees: 90, distance: 420, seed: 'perf-camera' },
  renderedY: 80, colliderY: 80, postProcessed: false, editorRuntimeImported: false, primitiveGeometry: false,
  ...patch,
});

const scenarios = [];
for (let index = 0; index < 64; index += 1) {
  const slope = index % 8 === 0 ? 72 : 6 + (index % 7) * 5;
  const elevation = Math.min(0.98, 0.18 + (index % 9) * 0.09);
  const moisture = (index % 10) / 10;
  const biome = ['temperate', 'forest', 'taiga', 'alpine', 'wetland', 'grassland', 'coastal', 'tundra'][index % 8];
  const surface = slope > 55 ? 'rock' : biome === 'alpine' ? 'scree' : moisture > 0.75 ? 'mud' : 'grass';
  const waterClass = index % 7 === 0 ? 'sea' : index % 11 === 0 ? 'lake' : index % 13 === 0 ? 'river' : 'land';
  const waterDistance = waterClass === 'land' ? 80 + index : 1 + index % 12;
  const depth = waterClass === 'land' ? 0 : index % 4 < 2 ? 2 + index % 8 : 60 + index;
  scenarios.push(make(`scenario-${index}`, {
    terrain: { ...make('base').terrain, x: 1000 + index * 11, z: 2000 + index * 7, slope, moisture, elevation01: elevation, snowWeight: biome === 'alpine' || biome === 'tundra' ? 0.82 : 0.04, biome, surface },
    water: { ...make('base').water, waterClass, waterDistance, depth, wetEdgeWeight: waterClass === 'land' ? 0 : 0.7, foamWeight: waterClass === 'land' ? 0 : 0.2, cyanRisk: waterClass === 'land' ? 0 : index % 9 === 0 ? 0.8 : 0.1, moireRisk: index % 10 === 0 ? 0.8 : 0 },
    material: { ...make('base').material, role: surface, multiSurface: true, macroContrast: 0.55 + (index % 5) * 0.08, microDetail: 0.52 + (index % 6) * 0.07 },
    camera: { profile: index % 4 === 0 ? 'fullWorld' : index % 4 === 1 ? 'far' : 'terrain-near', width: 1536, height: 1024, orthographicDegrees: 90, distance: index % 4 === 0 ? 7000 : index % 4 === 1 ? 3600 : 420, seed: `camera-${index}` },
  }));
}

for (const scenario of scenarios) {
  const first = createGroundedVisualRuntimeV63(scenario);
  const second = createGroundedVisualRuntimeV63(scenario);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.acceptanceProfile.width, 1536);
  assert.equal(first.acceptanceProfile.height, 1024);
  assert.equal(first.acceptanceProfile.orthographicDegrees, 90);
}
console.log(`PASS deterministic scenario sweep ${scenarios.length}`);

for (const scenario of scenarios) {
  const evidence = createVisualEvidenceV63(scenario);
  assert.ok(Number.isFinite(evidence.qualityScore));
  assert.ok(Array.isArray(evidence.failureCodes));
  assert.ok(typeof evidence.fingerprint === 'string');
}
console.log('PASS evidence quality sweep');

const orderA = scenarios.slice(0, 16);
const orderB = [...orderA].reverse();
const digestsA = orderA.map((item) => createVisualEvidenceV63(item)).map((item) => `${item.sampleId}:${item.fingerprint}`).sort().join('|');
const digestsB = orderB.map((item) => createVisualEvidenceV63(item)).map((item) => `${item.sampleId}:${item.fingerprint}`).sort().join('|');
assert.equal(digestsA, digestsB);
console.log('PASS order-independent evidence digest');

const cameraManifest = createAcceptanceCameraManifestV63('perf-cameras');
for (const profile of cameraManifest) {
  assert.equal(profile.width, 1536);
  assert.equal(profile.height, 1024);
  assert.equal(profile.orthographicDegrees, 90);
  assert.equal(profile.deterministic, true);
}
console.log('PASS camera profiles');

for (const radius of [12, 24, 48, 96]) {
  for (const spacing of [4, 6, 8, 12]) {
    const fieldA = createTerrainBreakupFieldV63({ centerX: 100, centerZ: 200, radius, spacing, seed: `field-${radius}-${spacing}` });
    const fieldB = createTerrainBreakupFieldV63({ centerX: 100, centerZ: 200, radius, spacing, seed: `field-${radius}-${spacing}` });
    assert.deepEqual(fieldA, fieldB);
    assert.ok(fieldA.count > 0);
    assert.ok(fieldA.cells.every((cell) => Number.isFinite(cell.microRelief)));
  }
}
console.log('PASS breakup parameter grid');

for (const waterClass of ['sea', 'lake', 'river', 'canal']) {
  for (const distance of [0, 0.5, 2, 6, 12, 24, 48, 100]) {
    const optical = createWaterOpticalResponseV63({ waterClass, depth: distance < 6 ? 2 : 60, distance, wetEdge: 0.8, foam: 0.3, cyanRisk: 0.2, moireRisk: distance === 0.5 ? 0.9 : 0 });
    assert.equal(typeof optical.recognized, 'boolean');
    assert.ok(optical.cyanSuppression >= 0 && optical.cyanSuppression <= 1);
    assert.ok(optical.moireSuppression >= 0 && optical.moireSuppression <= 1);
  }
}
console.log('PASS optical parameter grid');

for (const biome of ['forest', 'taiga', 'wetland', 'grassland', 'temperate', 'alpine', 'tundra', 'desert', 'coastal']) {
  for (const slope of [2, 10, 20, 35, 50, 65]) {
    const h = createHabitatDensityV63({ biome, slope, moisture: 0.55, elevation01: slope > 45 ? 0.82 : 0.45, waterDistance: 50, roadDistance: 100, settlementDistance: 100 });
    assert.ok(h.density >= 0 && h.density <= 1);
    assert.ok(h.clearingRadius >= 2);
  }
}
console.log('PASS habitat parameter grid');

for (const mobile of [true, false]) {
  for (const distance of [80, 180, 400, 800, 1600, 2600, 5000, 9000]) {
    const p = createStreamingPlanV63({ cameraDistance: distance, visibleChunks: 20, residentChunks: 24, vegetationInstances: mobile ? 820 : 1400, textureMemoryMb: mobile ? 600 : 700, mobile });
    assert.ok(['near', 'mid', 'far', 'impostor'].includes(p.lodBand));
    assert.ok(p.actions.every((action) => typeof action === 'string'));
  }
}
console.log('PASS streaming budget grid');

for (let index = 0; index < 100; index += 1) {
  const parity = createParityDiagnosticsV63({
    canonicalHeight: 100,
    renderedHeight: 100 + ((index % 5) * 0.05),
    colliderHeight: 100 + ((index % 4) * 0.04),
    canonicalX: index,
    canonicalZ: -index,
    renderedX: index + ((index % 3) * 0.04),
    renderedZ: -index + ((index % 3) * 0.04),
    colliderX: index + ((index % 2) * 0.02),
    colliderZ: -index + ((index % 2) * 0.02),
  });
  assert.equal(typeof parity.sameCoordinate, 'boolean');
}
console.log('PASS parity sweep');

for (let index = 0; index < 120; index += 1) {
  const t = createNaturalTransformV63({ assetId: `asset-${index % 12}`, x: index * 7.5, z: index * -4.2, seed: `seed-${index % 9}` });
  assert.ok(t.scale >= 0.82 && t.scale <= 1.18);
  assert.ok(t.yawRadians >= 0 && t.yawRadians <= Math.PI * 2);
  assert.ok(Math.abs(t.leanRadians) <= 0.06);
}
console.log('PASS natural transform sweep');

for (const className of ['sea', 'lake', 'river']) {
  const band = createShorelineBandProfileV63({ waterClass: className, distance: 4, depth: 2, wetEdge: 0.8, foam: 0.3 });
  assert.equal(band.recognized, true);
  assert.equal(band.bands.length, 4);
  assert.ok(band.antiHalo > 0);
}
console.log('PASS shoreline bands');

const clean = scenarios.find((scenario) => scenario.sampleId === 'scenario-1');
const repeated = [clean, clean, clean];
const deterministic = createDeterministicVisualEvidenceV63(clean, 6);
assert.equal(deterministic.deterministic, true);
assert.equal(deterministic.fingerprints.length, 6);
assert.equal(new Set(deterministic.fingerprints).size, 1);
console.log('PASS repeated deterministic evidence');

const qualityClean = createQualityGateV63([clean]);
assert.equal(qualityClean.eligible, true);

const blocked = make('blocked', {
  terrain: { ...make('base').terrain, slope: 82, roughness: 0.1, biome: 'alpine', surface: 'rock', snowWeight: 0.98 },
  water: { ...make('base').water, waterClass: 'sea', waterDistance: 0.1, depth: 2, rectangular: true, repeatedStripe: true, cyanRisk: 1, moireRisk: 1, seamRisk: 1 },
  material: { ...make('base').material, role: 'rock', multiSurface: false, placeholder: true, missing: true },
  camera: { profile: 'terrain-near', width: 1536, height: 1024, orthographicDegrees: 90, distance: 420, seed: 'blocked-camera' },
  renderedY: 105, colliderY: 100,
});
const qualityBlocked = createQualityGateV63([blocked]);
assert.equal(qualityBlocked.eligible, false);
console.log('PASS blocked quality gate');

const comparison = compareMultipleRunsV63(clean, clean);
assert.equal(comparison.identical, true);
assert.equal(comparison.sameFingerprint, true);
console.log('PASS multiple-run comparison');

const terrainEvidence = buildTerrainEvidenceV63({ centerX: 100, centerZ: 100, radius: 40, spacing: 8, seed: 'evidence' });
assert.equal(terrainEvidence.count > 0, true);
assert.equal(terrainEvidence.microVariationPresent, true);
console.log('PASS terrain evidence');

const waterEvidence = buildWaterEvidenceV63({ waterClass: 'river', depth: 7, distance: 4, wetEdge: 0.9, foam: 0.4, cyanRisk: 0.1, moireRisk: 0 });
assert.equal(waterEvidence.optical.recognized, true);
assert.equal(waterEvidence.bands.recognized, true);
console.log('PASS water evidence');

const habitatEvidence = buildHabitatEvidenceV63({ biome: 'forest', slope: 10, moisture: 0.72, elevation01: 0.45, waterDistance: 50, roadDistance: 100, settlementDistance: 100 });
assert.equal(habitatEvidence.forestBias, true);
console.log('PASS habitat evidence');

const streamEvidence = buildStreamingEvidenceV63({ cameraDistance: 800, visibleChunks: 12, residentChunks: 18, vegetationInstances: 400, textureMemoryMb: 256, mobile: false });
assert.equal(streamEvidence.cullingReady, true);
console.log('PASS streaming evidence');

const parityEvidence = buildParityEvidenceV63({ canonicalHeight: 20, renderedHeight: 20.1, colliderHeight: 20.08, canonicalX: 1, canonicalZ: 2, renderedX: 1.05, renderedZ: 1.96, colliderX: 1.01, colliderZ: 2.02 });
assert.equal(parityEvidence.sameWorldCoordinate, true);
console.log('PASS parity evidence');

const transformEvidence = buildTransformEvidenceV63({ assetId: 'tree-a', x: 20, z: 30, seed: 'proof' });
assert.equal(transformEvidence.deterministic, true);
assert.equal(transformEvidence.physicallyBounded, true);
console.log('PASS transform evidence');

assert.equal(V63_CONTRACT.thresholds.seamVisibility, 0);
assert.equal(V63_CONTRACT.thresholds.rectangularWaterVisibility, 0);
assert.equal(V63_CONTRACT.thresholds.moireVisibility, 0);
assert.equal(V63_CONTRACT.thresholds.floatingPlacement, 0);
assert.equal(V63_CONTRACT.thresholds.interpenetration, 0);
assert.equal(V63_CONTRACT.thresholds.blackSkyFailures, 0);
console.log('PASS release thresholds');

console.log('V63 performance/determinism acceptance suite complete');
