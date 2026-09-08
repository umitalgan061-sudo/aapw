import assert from 'node:assert/strict';
import {
  GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY,
  classifyMoisture,
  classifySlope,
  chooseEnvironmentFamily,
  environmentFingerprint,
  environmentFitScore,
  familyEnvironmentCompatibility,
  familySnowSuitability,
  familyTerrainSuitability,
  familyWetnessSuitability,
  isStrongBiome,
  isTransitionBiome,
  normalizeEnvironmentSample,
  roleBiomeCompatibility,
  validateEnvironmentFitBatch,
} from '../src/3d/world/geographicSettlementPropEnvironment.js';
import {
  buildVisualSample,
  compareVisualSamples,
  terrainAssetEnvelope,
  validateVisualSample,
} from '../src/3d/world/terrainEnvironmentVisualSampling.js';

const EPSILON = 1e-9;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: expected ${expected}, got ${actual}`);

const temperateSample = buildVisualSample({
  worldX: 100,
  worldZ: 200,
  heightMeters: 66,
  heightAboveSeaMeters: 46,
  slopeDegrees: 5,
  rockWeight: 0.10,
  snowWeight: 0.02,
  waterWeight: 0.02,
  moisture: 0.52,
  biome: 'lush-grassland',
  waterDepth: 0,
  concavityMeters: 0,
});
const fertileSample = buildVisualSample({
  worldX: 210,
  worldZ: 120,
  heightMeters: 61,
  heightAboveSeaMeters: 41,
  slopeDegrees: 3,
  rockWeight: 0.08,
  snowWeight: 0,
  waterWeight: 0.18,
  moisture: 0.68,
  biome: 'marsh',
  waterDepth: 0.01,
  concavityMeters: 2,
});
const coldSample = buildVisualSample({
  worldX: -200,
  worldZ: -350,
  heightMeters: 310,
  heightAboveSeaMeters: 290,
  slopeDegrees: 10,
  rockWeight: 0.26,
  snowWeight: 0.82,
  waterWeight: 0,
  moisture: 0.32,
  biome: 'snow',
  waterDepth: 0,
  concavityMeters: 0,
});
const rockySample = buildVisualSample({
  worldX: 300,
  worldZ: -220,
  heightMeters: 160,
  heightAboveSeaMeters: 140,
  slopeDegrees: 26,
  rockWeight: 0.82,
  snowWeight: 0.05,
  waterWeight: 0,
  moisture: 0.18,
  biome: 'rocky-hills',
  waterDepth: 0,
  concavityMeters: 0,
});
const wetSample = buildVisualSample({
  worldX: -80,
  worldZ: 60,
  heightMeters: 48,
  heightAboveSeaMeters: 28,
  slopeDegrees: 2,
  rockWeight: 0.04,
  snowWeight: 0,
  waterWeight: 0.95,
  moisture: 0.94,
  biome: 'marsh',
  waterDepth: 0.18,
  concavityMeters: 6,
});

console.info(`[environment] policy=${GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.id}`);

// 1. Normalization is deterministic and clips all visual weights into the expected range.
const normalized = normalizeEnvironmentSample({
  worldX: 3,
  worldZ: 4,
  slopeDegrees: 120,
  waterDepth: -4,
  biome: 'snow',
  moisture: 2,
  snowWeight: -1,
  rockWeight: 4,
});
assert.equal(normalized.slopeDegrees, 90);
assert.equal(normalized.waterDepth, 0);
assert.equal(normalized.moisture, 1);
assert.equal(normalized.snowWeight, 0);
assert.equal(normalized.rockWeight, 1);

// 2. Slope classes expose placement realism tiers.
assert.equal(classifySlope(0), 'gentle');
assert.equal(classifySlope(8), 'gentle');
assert.equal(classifySlope(18), 'usable');
assert.equal(classifySlope(25), 'steep');
assert.equal(classifySlope(31), 'cliff');
assert.equal(classifySlope(90), 'cliff');

// 3. Moisture classes expose wet/dry ecological transitions.
assert.equal(classifyMoisture(0.05), 'dry');
assert.equal(classifyMoisture(0.35), 'balanced');
assert.equal(classifyMoisture(0.60), 'damp');
assert.equal(classifyMoisture(0.90), 'saturated');

// 4. Biome compatibility is role-aware, not simply “one prop everywhere”.
assert.equal(roleBiomeCompatibility('fertile', 'marsh'), 1);
assert.equal(roleBiomeCompatibility('fertile', 'lush-grassland'), 1);
assert.equal(roleBiomeCompatibility('cold', 'snow'), 1);
assert.equal(roleBiomeCompatibility('mountain', 'rocky-hills'), 1);
assert.equal(roleBiomeCompatibility('arid', 'desert'), 1);
assert.equal(roleBiomeCompatibility('temperate', 'snow'), 0);
assert.ok(roleBiomeCompatibility('unknown-role', 'snow') > 0);

// 5. Environment classification distinguishes strong biome anchors from transition zones.
assert.equal(isStrongBiome({ biomeInfluence: 0.62 }), true);
assert.equal(isStrongBiome({ biomeInfluence: 0.619 }), false);
assert.equal(isTransitionBiome({ biomeInfluence: 0.119 }), true);
assert.equal(isTransitionBiome({ biomeInfluence: 0.12 }), false);

// 6. Dry, level, temperate ground is friendly to field dirt and cargo.
const farmTemperate = environmentFitScore({ family: 'farmDirt', roleId: 'temperate', sample: temperateSample, roadDistance: 10 });
const barrelTemperate = environmentFitScore({ family: 'barrel', roleId: 'temperate', sample: temperateSample, roadDistance: 8 });
assert.ok(farmTemperate.accepted, `farm should fit temperate ground: ${farmTemperate.score}`);
assert.ok(barrelTemperate.accepted, `barrel should fit temperate ground: ${barrelTemperate.score}`);
assert.ok(farmTemperate.score > 0.65);
assert.ok(barrelTemperate.score > 0.70);

// 7. Fertile marsh may support agriculture, but deep standing water must reject ground props.
const farmFertile = environmentFitScore({ family: 'farmDirt', roleId: 'fertile', sample: fertileSample, roadDistance: 18 });
assert.ok(farmFertile.accepted, `fertile sample should accept farm dirt: ${farmFertile.score}`);
const farmFlooded = environmentFitScore({ family: 'farmDirt', roleId: 'fertile', sample: wetSample, roadDistance: 18 });
assert.equal(farmFlooded.accepted, false, `deep wet sample should reject farm dirt: ${farmFlooded.score}`);
assert.equal(familyWetnessSuitability('farmDirt', wetSample), 0);

// 8. Snow should be a positive contextual signal for hearth props but a strong penalty for farm dirt.
const hearthCold = environmentFitScore({ family: 'bonfire', roleId: 'cold', sample: coldSample, roadDistance: 20 });
const farmCold = environmentFitScore({ family: 'farmDirt', roleId: 'cold', sample: coldSample, roadDistance: 20 });
assert.ok(hearthCold.accepted, `snow hearth should fit: ${hearthCold.score}`);
assert.ok(farmCold.score < hearthCold.score);
assert.ok(familySnowSuitability('bonfire', coldSample) > familySnowSuitability('farmDirt', coldSample));

// 9. Rock-heavy steep terrain should favor cargo/bench only weakly and reject agriculture.
const farmRocky = environmentFitScore({ family: 'farmDirt', roleId: 'mountain', sample: rockySample, roadDistance: 24 });
const crateRocky = environmentFitScore({ family: 'crate', roleId: 'mountain', sample: rockySample, roadDistance: 24 });
assert.ok(farmRocky.score < crateRocky.score);
assert.equal(familyTerrainSuitability('farmDirt', rockySample), 0.18);
assert.ok(familyTerrainSuitability('crate', rockySample) >= 0.45);

// 10. Water depth is a hard environmental limit for families with exposed ground footprints.
for (const family of ['barrel', 'crate', 'bench', 'bonfire', 'farmDirt']) {
  const deepWater = familyEnvironmentCompatibility(family, wetSample);
  assert.ok(deepWater <= 0.01, `${family} should not be compatible with 18cm standing water: ${deepWater}`);
}

// 11. Road access contributes, but never dominates ecological fit.
const nearRoad = environmentFitScore({ family: 'barrel', roleId: 'temperate', sample: temperateSample, roadDistance: 5 });
const near30 = environmentFitScore({ family: 'barrel', roleId: 'temperate', sample: temperateSample, roadDistance: 25 });
const remote = environmentFitScore({ family: 'barrel', roleId: 'temperate', sample: temperateSample, roadDistance: 500 });
assert.ok(nearRoad.score > near30.score);
assert.ok(near30.score > remote.score);
assert.ok(nearRoad.components.access > near30.components.access);
assert.ok(near30.components.access > remote.components.access);

// 12. Family selector uses deterministic tie-breaking and returns ranked evidence.
const choice = chooseEnvironmentFamily({
  roleId: 'fertile',
  candidates: ['bench', 'farmDirt', 'crate', 'barrel'],
  sample: fertileSample,
  roadDistance: 9,
});
assert.equal(choice.winner, 'farmDirt');
assert.ok(choice.ranked.length === 4);
assert.equal(choice.ranked[0].family, choice.winner);
assert.ok(choice.ranked[0].score >= choice.ranked[1].score);

// 13. Field selection should not silently turn a strong dry field into a flooded ground prop.
const fieldChoiceWet = chooseEnvironmentFamily({
  roleId: 'fertile',
  candidates: ['farmDirt', 'bench', 'crate'],
  sample: wetSample,
  roadDistance: 9,
});
assert.notEqual(fieldChoiceWet.winner, 'farmDirt');

// 14. Fingerprints are stable, compact and sensitive to material/ecological changes.
const fpA = environmentFingerprint({ family: 'farmDirt', roleId: 'fertile', sample: fertileSample, roadDistance: 9 });
const fpB = environmentFingerprint({ family: 'farmDirt', roleId: 'fertile', sample: fertileSample, roadDistance: 9 });
const fpC = environmentFingerprint({ family: 'farmDirt', roleId: 'fertile', sample: wetSample, roadDistance: 9 });
assert.equal(fpA, fpB);
assert.notEqual(fpA, fpC);
assert.match(fpA, /^farmDirt\|fertile\|marsh\|/);

// 15. Batch validation produces fingerprints and rejects hard ecological mismatches.
const batch = validateEnvironmentFitBatch([
  { family: 'farmDirt', roleId: 'fertile', sample: fertileSample, roadDistance: 9 },
  { family: 'barrel', roleId: 'temperate', sample: temperateSample, roadDistance: 10 },
]);
assert.equal(batch.ok, true);
assert.equal(batch.errors.length, 0);
assert.equal(batch.fingerprints.length, 2);

const badBatch = validateEnvironmentFitBatch([
  { family: 'farmDirt', roleId: 'fertile', sample: wetSample, roadDistance: 9 },
]);
assert.equal(badBatch.ok, false);
assert.equal(badBatch.errors.length, 1);

// 16. Visual sampler evidence remains internally valid at every representative environment.
for (const [name, sample] of Object.entries({ temperate: temperateSample, fertile: fertileSample, cold: coldSample, rocky: rockySample, wet: wetSample })) {
  const report = validateVisualSample(sample);
  assert.equal(report.ok, true, `${name} visual sample should validate: ${report.errors.join(',')}`);
}

// 17. Snow edge/shelf signals remain monotonic enough to support the prop environment contract.
assert.ok(coldSample.snowEdge > 0.4);
assert.ok(coldSample.snowShelf > 0.4);
assert.ok(coldSample.snowEdge <= coldSample.snowWeight);
assert.ok(coldSample.snowShelf <= coldSample.snowWeight);

// 18. Environmental comparison remains stable and exposes expected deltas.
const coldVsTemperate = compareVisualSamples(coldSample, temperateSample);
assert.ok(coldVsTemperate.delta.snowWeight > 0.7);
assert.ok(coldVsTemperate.delta.heightMeters > 200);
assert.ok(coldVsTemperate.delta.snowEdge > 0.3);
assert.ok(coldVsTemperate.delta.surfaceContrast > 0.1);

// 19. Asset envelopes can carry the exact same sample without becoming a new placement authority.
const fieldEnvelope = terrainAssetEnvelope({
  sample: fertileSample,
  category: 'settlement-prop-ground',
  profile: {
    minSlopeDegrees: 0,
    maxSlopeDegrees: 18,
    minHeightMeters: -Infinity,
    maxHeightMeters: 180,
    maxWaterDepthMeters: 0.03,
    allowedBiomes: ['marsh', 'lush-grassland', 'temperate-coast'],
  },
  spatial: { densityMultiplier: 0.8, coreWeight: 0.8, ecotoneWeight: 0.4, groveOpeningWeight: 0.2 },
});
assert.equal(fieldEnvelope.allowed, true);
assert.equal(fieldEnvelope.category, 'settlement-prop-ground');
assert.ok(fieldEnvelope.surface.moisture > 0.5);

const floodedEnvelope = terrainAssetEnvelope({
  sample: wetSample,
  category: 'settlement-prop-ground',
  profile: { maxSlopeDegrees: 18, maxWaterDepthMeters: 0.03, allowedBiomes: ['marsh'] },
});
assert.equal(floodedEnvelope.allowed, false);

// 20. Deterministic repeat of the whole decision surface.
const repeatRecords = Array.from({ length: 25 }, () => ({
  family: 'farmDirt',
  roleId: 'fertile',
  sample: fertileSample,
  roadDistance: 9,
}));
const repeat = validateEnvironmentFitBatch(repeatRecords);
const firstFingerprint = repeat.fingerprints[0];
assert.ok(repeat.fingerprints.every((fingerprint) => fingerprint === firstFingerprint));
assert.equal(repeat.errors.length, 0);

// 21. The environment policy keeps the supported family set explicit.
assert.deepEqual(Object.keys(GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.family).sort(), ['barrel', 'bench', 'bonfire', 'crate', 'farmDirt']);
assert.equal(GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.transitionFloor, 0.12);
assert.equal(GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.strongBiomeThreshold, 0.62);

// 22. Ecological signals are visible in the explanation trail, not just hidden in the numeric score.
const explained = environmentFitScore({ family: 'farmDirt', roleId: 'fertile', sample: fertileSample, roadDistance: 8 });
assert.ok(explained.reasons.includes('role-biome-match'));
assert.ok(explained.reasons.includes('family-surface-match'));
assert.ok(explained.reasons.includes('terrain-usable'));
assert.ok(explained.reasons.includes('road-access'));

// 23. Transition biome receives an intentional penalty rather than an abrupt category switch.
const transition = buildVisualSample({ ...temperateSample, biome: 'lush-grassland' });
const strong = buildVisualSample({ ...temperateSample });
const transitionFit = environmentFitScore({ family: 'farmDirt', roleId: 'temperate', sample: { ...transition, biomeInfluence: 0.1 }, roadDistance: 8 });
const strongFit = environmentFitScore({ family: 'farmDirt', roleId: 'temperate', sample: { ...strong, biomeInfluence: 0.9 }, roadDistance: 8 });
assert.ok(strongFit.score > transitionFit.score);
assert.ok(transitionFit.score > 0);

// 24. Non-finite road distance receives a conservative but usable access contribution.
const unknownRoad = environmentFitScore({ family: 'crate', roleId: 'temperate', sample: temperateSample, roadDistance: Infinity });
assert.ok(Number.isFinite(unknownRoad.score));
assert.equal(unknownRoad.components.access, 0.7);

// 25. Exact score repeat remains bit-for-bit equivalent to guard against hidden state.
const scoreA = environmentFitScore({ family: 'barrel', roleId: 'temperate', sample: temperateSample, roadDistance: 13 });
const scoreB = environmentFitScore({ family: 'barrel', roleId: 'temperate', sample: temperateSample, roadDistance: 13 });
assert.equal(scoreA.score, scoreB.score);
assert.deepEqual(scoreA.components, scoreB.components);
assert.deepEqual(scoreA.reasons, scoreB.reasons);

close(scoreA.score, scoreB.score, 'deterministic score');
console.info(`[environment] PASS: representative settlement-fringe environments validated; ${batch.fingerprints.length} deterministic fingerprints emitted.`);
