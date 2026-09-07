import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  GEOGRAPHIC_VEGETATION_ASSETS,
  GEOGRAPHIC_VEGETATION_ASSET_POLICY,
  GEOGRAPHIC_VEGETATION_REGION_POLICY,
  chooseGeographicVegetationFamily,
  createGeographicVegetationNormalization,
  describeGeographicVegetationPlan,
  measureGeographicVegetationAsset,
  sourceVegetationMaterialEvidence,
  validateGeographicVegetationAsset,
  vegetationBiomeAtWorldXZ,
} from '../src/3d/world/geographicVegetationAsset.js';

assert.equal(GEOGRAPHIC_VEGETATION_ASSET_POLICY.deterministic, true);
assert.equal(GEOGRAPHIC_VEGETATION_ASSET_POLICY.preserveSourcePbr, true);
assert.equal(GEOGRAPHIC_VEGETATION_ASSET_POLICY.failClosedToProcedural, true);
assert.deepEqual(Object.keys(GEOGRAPHIC_VEGETATION_ASSETS).sort(), ['autumn', 'birch', 'canopy', 'dead']);
for (const [family, asset] of Object.entries(GEOGRAPHIC_VEGETATION_ASSETS)) {
  assert.match(asset.src, /^assets\/models\/vegetation\/.*\.glb$/);
  assert.ok(asset.regions.length >= 1, `${family} has no geographic regions`);
  assert.equal(asset.scale.length, 2);
  assert.ok(asset.scale[0] > 0 && asset.scale[1] > asset.scale[0]);
}

for (const [biome, policy] of Object.entries(GEOGRAPHIC_VEGETATION_REGION_POLICY)) {
  assert.ok(policy.families.length >= 1, `${biome} has no vegetation family`);
  assert.ok(policy.densityMultiplier > 0 && policy.densityMultiplier <= 1.2);
  assert.ok(policy.maxSlopeDegrees >= 20 && policy.maxSlopeDegrees <= 45);
  for (const family of policy.families) assert.ok(GEOGRAPHIC_VEGETATION_ASSETS[family]);
}

const plan = describeGeographicVegetationPlan();
assert.equal(plan.length, Object.keys(GEOGRAPHIC_VEGETATION_REGION_POLICY).length);
assert.ok(plan.some((entry) => entry.biomeKind === 'jungle' && entry.families.includes('canopy')));
assert.ok(plan.some((entry) => entry.biomeKind === 'desert' && entry.families.length === 1 && entry.families[0] === 'dead'));

assert.equal(chooseGeographicVegetationFamily({ biomeKind: 'desert', seed: 7 }), 'dead');
assert.equal(chooseGeographicVegetationFamily({ biomeKind: 'marsh', seed: 7 }), 'birch');
assert.equal(chooseGeographicVegetationFamily({ biomeKind: 'jungle', seed: 7 }), 'canopy');
assert.equal(chooseGeographicVegetationFamily({ biomeKind: 'cold-grassland', cryosphere: { permanentIce: 0.8 }, seed: 7 }), 'birch');
const repeated = Array.from({ length: 32 }, (_, index) => chooseGeographicVegetationFamily({ biomeKind: 'temperate', seed: 1234, index }));
assert.deepEqual(repeated, Array.from({ length: 32 }, (_, index) => chooseGeographicVegetationFamily({ biomeKind: 'temperate', seed: 1234, index })));
assert.ok(new Set(repeated).size >= 2);

const tree = new THREE.Group();
const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 6, 6), new THREE.MeshStandardMaterial({ color: 0x5b4028 }));
const crown = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), new THREE.MeshStandardMaterial({ color: 0x496a2e }));
crown.position.y = 5.2;
trunk.position.y = 3;
tree.add(trunk, crown);
tree.updateMatrixWorld(true);
const measurement = measureGeographicVegetationAsset(tree);
assert.ok(measurement);
assert.ok(measurement.size.y > 0);
assert.ok(measurement.horizontalToHeightRatio > 0);
const validation = validateGeographicVegetationAsset(tree);
assert.equal(validation.valid, true);
const normalization = createGeographicVegetationNormalization(measurement, 7.6);
const transformed = new THREE.Vector3(0, 0, 0).applyMatrix4(normalization);
assert.ok(Number.isFinite(transformed.x) && Number.isFinite(transformed.y) && Number.isFinite(transformed.z));

const textured = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }));
const texturedRoot = new THREE.Group();
texturedRoot.add(textured);
const evidence = sourceVegetationMaterialEvidence(texturedRoot);
assert.equal(evidence.meshCount, 1);
assert.equal(evidence.mappedMaterialCount, 1);
assert.equal(evidence.hasAuthoredPbr, true);

const placeholder = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff00ff }));
placeholder.userData.isPlaceholder = true;
assert.equal(validateGeographicVegetationAsset(placeholder).valid, false);
assert.equal(validateGeographicVegetationAsset(placeholder).reason, 'placeholder');

const huge = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshStandardMaterial({ color: 0xffffff }));
assert.equal(validateGeographicVegetationAsset(huge).valid, false);
assert.equal(validateGeographicVegetationAsset(huge).reason, 'source-too-large');

const biome = vegetationBiomeAtWorldXZ(0, 0);
assert.equal(typeof biome.biomeKind, 'string');
assert.ok(biome.nx >= 0 && biome.nx <= 1);
assert.ok(biome.ny >= 0 && biome.ny <= 1);

console.log(JSON.stringify({
  ok: true,
  policyId: GEOGRAPHIC_VEGETATION_ASSET_POLICY.id,
  assetFamilies: Object.keys(GEOGRAPHIC_VEGETATION_ASSETS).sort(),
  regionCount: plan.length,
  deterministicSamples: repeated.slice(0, 8),
  textureEvidence: evidence,
}));