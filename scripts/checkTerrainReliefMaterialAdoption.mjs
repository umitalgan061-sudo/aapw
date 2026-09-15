import assert from 'node:assert/strict';
import {
  applyTerrainReliefMaterialProfile,
  createTerrainReliefManifest,
  createTerrainReliefMaterialProfile,
  evaluateTerrainReliefAcceptance,
  TERRAIN_RELIEF_MATERIAL_POLICY_V35,
} from '../src/3d/world/terrainReliefMaterialAdoption.js';

const sample = {
  x: 125.25,
  z: -48.5,
  elevationMeters: 410,
  slopeDegrees: 47,
  moisture: 0.78,
  waterDistanceMeters: 8,
  waterDepthMeters: 0,
  biome: 'alpine',
  confidence: 1,
  roadDistanceMeters: 120,
  settlementDistanceMeters: 280,
};

const profileA = createTerrainReliefMaterialProfile({ sample, seed: 123 });
const profileB = createTerrainReliefMaterialProfile({ sample, seed: 123 });
assert.deepEqual(profileA, profileB, 'same input/seed must remain deterministic');
assert.equal(profileA.version, 'v35');
assert.ok(Object.isFrozen(profileA));
assert.ok(Object.isFrozen(profileA.surfaceWeights));
assert.equal(Object.values(profileA.surfaceWeights).reduce((a, b) => a + b, 0).toFixed(6), '1.000000');
assert.equal(profileA.reliefBand, 'snowline');
assert.ok(profileA.relief.rockExposure > 0);
assert.ok(profileA.relief.snowlineBlend > 0);
assert.ok(profileA.materials.normalEnergy >= 0.04 && profileA.materials.normalEnergy <= 0.82);
assert.equal(profileA.vegetation.eligible, false);
assert.ok(profileA.vegetation.blockedReasons.includes('permanent-snow'));

const shoreline = createTerrainReliefMaterialProfile({
  sample: { x: 0, z: 0, elevationMeters: -1, waterDepthMeters: 0.25, waterDistanceMeters: 1, moisture: 0.9 },
});
assert.equal(shoreline.reliefBand, 'shore');
assert.ok(shoreline.water.shallowWeight > 0);
assert.ok(shoreline.water.foamWeight > 0);
assert.equal(shoreline.vegetation.eligible, false);
assert.ok(shoreline.vegetation.blockedReasons.includes('water'));

const malformed = createTerrainReliefMaterialProfile({
  sample: { x: Number.NaN, z: Infinity, elevationMeters: NaN, slopeDegrees: Infinity, moisture: -4 },
});
assert.ok(Number.isFinite(malformed.sample.x));
assert.ok(Number.isFinite(malformed.sample.z));
assert.ok(Number.isFinite(malformed.materials.roughness));
assert.ok(Number.isFinite(malformed.materials.normalEnergy));

const material = { roughness: 0.9, normalScale: 0.2, aoMapIntensity: 0.3, clearcoat: 0.1, userData: { existing: true } };
applyTerrainReliefMaterialProfile(material, profileA);
assert.equal(material.userData.existing, true);
assert.equal(material.userData.terrainReliefMaterialAdoption.version, 'v35');
assert.equal(material.userData.terrainReliefMaterialAdoption.digest, profileA.digest);

const manifest = createTerrainReliefManifest([
  sample,
  { x: -10, z: 12, elevationMeters: 5, slopeDegrees: 8, moisture: 0.6, waterDistanceMeters: 80 },
  { x: 3, z: -8, elevationMeters: 0, waterDepthMeters: 0.4, waterDistanceMeters: 1 },
]);
assert.equal(manifest.summary.sampleCount, 3);
assert.ok(Object.isFrozen(manifest));
assert.equal(manifest.profiles[0].sample.z, -48.5, 'manifest must be ordered by z then x');
const acceptance = evaluateTerrainReliefAcceptance(manifest);
assert.equal(acceptance.pass, false, 'fixture intentionally contains visible water/parity risk');
assert.ok(acceptance.findings.some((finding) => finding.code === 'P0_WATER_MOIRE_RISK'));
assert.deepEqual(TERRAIN_RELIEF_MATERIAL_POLICY_V35.surfaces, [
  'grass', 'soil', 'mud', 'sand', 'rock', 'scree', 'snow', 'wetEdge', 'foam',
]);

console.log('terrain relief material adoption v35 checks passed');
