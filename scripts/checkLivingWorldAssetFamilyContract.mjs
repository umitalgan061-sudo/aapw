import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  LIVING_WORLD_ROLE_SURFACES,
  inspectLivingWorldAssetVisual,
  prepareLivingWorldAssetVisual,
  shouldPreserveAuthoredVisuals,
} from '../src/3d/gameplay/livingWorldAssetVisualAdapter.js';

function texture(size = 512) {
  const data = new Uint8Array(size * size * 4);
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.needsUpdate = true;
  return map;
}
function addPart(group, name, { normal = false, roughness = false, metalness = false } = {}) {
  const material = new THREE.MeshStandardMaterial({ name, map: texture(), ...(normal ? { normalMap: texture() } : {}), ...(roughness ? { roughnessMap: texture() } : {}), ...(metalness ? { metalnessMap: texture() } : {}) });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = name;
  group.add(mesh);
  return mesh;
}
function completeFamily(parts) {
  const group = new THREE.Group();
  for (const [name, opts] of parts) addPart(group, name, opts);
  return group;
}

assert.deepEqual(LIVING_WORLD_ROLE_SURFACES.horse, ['coat','mane','tail','hoof','saddle','harness']);
assert.deepEqual(LIVING_WORLD_ROLE_SURFACES.wildlife, ['fur','eye','claw','tooth']);
assert.deepEqual(LIVING_WORLD_ROLE_SURFACES.dragon, ['scale','wing','eye','horn','claw']);

const horse = completeFamily([
  ['Horse-Coat', { normal: true }], ['Horse-Mane'], ['Horse-Tail'], ['Horse-Hoof'], ['Horse-Saddle', { roughness: true }], ['Horse-Harness', { metalness: true }],
]);
const horseAudit = inspectLivingWorldAssetVisual(horse, { role: 'wildlife', speciesId: 'horse', region: 'reach', assetId: 'horse-regression', sourcePath: 'assets/models/animals/white_horse_bEdE4rmZy9.glb' });
assert.equal(horseAudit.ok, true);
assert.equal(horseAudit.missingRoles.length, 0);
assert.equal(horseAudit.texturedMaterialRatio, 1);
assert.equal(shouldPreserveAuthoredVisuals(horseAudit), true);

const wolf = completeFamily([
  ['Wolf-Fur', { normal: true }], ['Wolf-Eye'], ['Wolf-Claw'], ['Wolf-Tooth'],
]);
const wolfAudit = inspectLivingWorldAssetVisual(wolf, { role: 'wildlife', speciesId: 'wolf', region: 'north', assetId: 'wolf-regression', sourcePath: 'assets/models/animals/wolf/Wolf-Blender-2.82a.glb' });
assert.equal(wolfAudit.missingRoles.length, 0);
assert.ok(wolfAudit.semanticCoverage >= 0.99);

const dragon = completeFamily([
  ['Dragon-Scale', { normal: true, roughness: true }], ['Dragon-Wing', { normal: true }], ['Dragon-Eye'], ['Dragon-Horn'], ['Dragon-Claw', { metalness: true }],
]);
const dragonAudit = inspectLivingWorldAssetVisual(dragon, { role: 'wildlife', speciesId: 'dragon', region: 'valyria', assetId: 'dragon-regression', sourcePath: 'assets/models/creatures/dragons/verdant_wyrm.glb' });
assert.equal(dragonAudit.missingRoles.length, 0);
assert.ok(dragonAudit.normalMappedMaterialRatio >= 0.4);
assert.equal(dragonAudit.region, 'valyria');

const singleSurface = new THREE.Group();
addPart(singleSurface, 'CreatureBody');
const singleAudit = inspectLivingWorldAssetVisual(singleSurface, { role: 'wildlife', speciesId: 'dragon', region: 'valyria' });
assert.ok(singleAudit.missingRoles.length > 0);
assert.equal(singleAudit.fallbackReason, 'semantic-under-specification');
const refused = prepareLivingWorldAssetVisual(singleSurface, { role: 'wildlife', speciesId: 'dragon', region: 'valyria', allowLayeredFallback: false });
assert.equal(refused.ok, false);
assert.equal(refused.changed, false);

const layeredCandidate = new THREE.Group();
addPart(layeredCandidate, 'Body');
const layeredResult = prepareLivingWorldAssetVisual(layeredCandidate, { role: 'wildlife', speciesId: 'wolf', region: 'north', allowLayeredFallback: true, metadata: { id: 'wolf-single', src: 'assets/models/animals/wolf/Wolf-Blender-2.82a.glb' } });
assert.equal(layeredResult.changed, true);
assert.equal(layeredResult.status, 'shared-layered-fallback');

const human = completeFamily([
  ['Human-Skin'], ['Human-Hair'], ['Human-Eyes'], ['Human-Clothing', { roughness: true }], ['Human-Boots'], ['Human-Gear', { metalness: true }],
]);
const humanAudit = inspectLivingWorldAssetVisual(human, { role: 'guard', region: 'reach', assetId: 'human-regression', sourcePath: 'assets/models/characters/dreyar.fbx' });
assert.equal(humanAudit.missingRoles.length, 0);
assert.equal(humanAudit.texturedMaterialRatio, 1);

const matrices = [
  ['human', humanAudit], ['horse', horseAudit], ['wolf', wolfAudit], ['dragon', dragonAudit],
];
for (const [family, audit] of matrices) {
  assert.ok(audit.meshCount >= LIVING_WORLD_ROLE_SURFACES[family].length - 1, `${family} mesh count unexpectedly low`);
  assert.equal(audit.warnings.length, 0, `${family} warnings: ${audit.warnings.join(',')}`);
  assert.equal(audit.errors.length, 0, `${family} errors: ${audit.errors.join(',')}`);
}

console.log(JSON.stringify({
  ok: true,
  families: matrices.map(([family, audit]) => ({ family, semanticCoverage: audit.semanticCoverage, texturedMaterialRatio: audit.texturedMaterialRatio, normalMappedMaterialRatio: audit.normalMappedMaterialRatio })),
  layeredFallback: layeredResult.status,
}));
console.log('LIVING_WORLD_ASSET_FAMILY_CONTRACT_PASS');
