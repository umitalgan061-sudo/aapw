import assert from 'node:assert/strict';
import {
  applyWaterShorelineAdoptionToMaterial,
  createWaterShorelineAdoptionProfile,
  summarizeWaterShorelineAdoption,
} from '../src/3d/world/waterShorelineAdoption.js';

const samples = [
  { worldX: 10, worldZ: 20, depth: 0.04, coverage: 1, shorelineGradient: 0.9, distanceMeters: 120, microCarrierRisk: 0.1 },
  { worldX: 410, worldZ: 220, depth: 0.92, coverage: 1, shorelineGradient: 0.03, distanceMeters: 9000, microCarrierRisk: 0.15 },
  { worldX: 900, worldZ: 700, depth: 0.8, coverage: 0, shorelineGradient: 0.4, distanceMeters: 100, microCarrierRisk: 0 },
];

const first = createWaterShorelineAdoptionProfile(samples);
const second = createWaterShorelineAdoptionProfile(samples);
assert.deepEqual(first, second, 'profile must be deterministic');
assert.equal(first.visibleWaterArtifactTarget, 0);
assert.equal(first.visibleMoireTarget, 0);
assert.equal(first.samples[0].wet, true);
assert.equal(first.samples[2].wet, false);
assert.ok(first.samples[0].shore > first.samples[1].shore, 'shore response should follow edge context');
assert.ok(first.samples[1].normalEnergy < first.samples[0].normalEnergy, 'far water detail must fade');

const material = { roughness: 0, userData: {} };
assert.equal(applyWaterShorelineAdoptionToMaterial(material, first), true);
assert.ok(material.roughness >= 0.22 && material.roughness <= 0.86);
assert.equal(material.userData.waterShorelineAdoption.visibleMoireTarget, 0);

const malformed = createWaterShorelineAdoptionProfile([null, { depth: 'bad', coverage: NaN }]);
for (const sample of malformed.samples) {
  for (const value of Object.values(sample)) {
    if (typeof value === 'number') assert.equal(Number.isFinite(value), true);
  }
}
assert.deepEqual(
  summarizeWaterShorelineAdoption(first),
  {
    policyId: 'water-shoreline-adoption-v24',
    sampleCount: 3,
    rectangularWaterRiskCount: 0,
    hardCoverageRiskCount: 0,
    visibleWaterArtifactTarget: 0,
    visibleMoireTarget: 0,
  },
);
console.log('checkWaterShorelineAdoption: PASS');
