import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  LIVING_WORLD_ROLE_SURFACES,
  LIVING_WORLD_VISUAL_POLICY,
  chooseVisualPaletteHint,
  deterministicVisualVariant,
  geographicVisualClimate,
  geographicVisualTags,
  inspectLivingWorldAssetVisual,
  listAssetCandidatesWithSurfaceExpectations,
  prepareLivingWorldAssetVisual,
  shouldPreserveAuthoredVisuals,
  visualDistributionWeight,
  visualSurfaceRoleReport,
} from '../src/3d/gameplay/livingWorldAssetVisualAdapter.js';

function texture(size = 512) {
  const data = new Uint8Array(size * size * 4);
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

function mesh(name, material) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(48), 2));
  const node = new THREE.Mesh(geometry, material);
  node.name = name;
  return node;
}

const human = new THREE.Group();
human.add(mesh('Skin', new THREE.MeshStandardMaterial({ name: 'skin', map: texture(), normalMap: texture() })));
human.add(mesh('Hair', new THREE.MeshStandardMaterial({ name: 'hair', map: texture() })));
human.add(mesh('Eyes', new THREE.MeshStandardMaterial({ name: 'eyes', map: texture() })));
human.add(mesh('Clothing', new THREE.MeshStandardMaterial({ name: 'clothing', map: texture(), roughnessMap: texture() })));
human.add(mesh('Boots', new THREE.MeshStandardMaterial({ name: 'boots', map: texture() })));
human.add(mesh('Gear', new THREE.MeshStandardMaterial({ name: 'gear', map: texture(), metalnessMap: texture() })));

const audit = inspectLivingWorldAssetVisual(human, { role: 'guard', region: 'north', assetId: 'guard-test', sourcePath: 'assets/models/characters/erika_archer.fbx' });
assert.equal(audit.ok, true);
assert.equal(audit.missingRoles.length, 0);
assert.ok(audit.semanticCoverage >= 0.99);
assert.equal(audit.texturedMaterialRatio, 1);
assert.equal(shouldPreserveAuthoredVisuals(audit), true);
assert.equal(visualSurfaceRoleReport(audit).filter((entry) => entry.present).length, LIVING_WORLD_ROLE_SURFACES.guard.length);

const horse = new THREE.Group();
horse.add(mesh('HorseBody', new THREE.MeshStandardMaterial({ name: 'horse-body' })));
const horseAudit = inspectLivingWorldAssetVisual(horse, { role: 'wildlife', speciesId: 'horse', region: 'reach' });
assert.equal(horseAudit.ok, true);
assert.ok(horseAudit.fallbackReason);
assert.ok(horseAudit.semanticCoverage < 0.55);

const climateA = geographicVisualClimate('snow', { moisture: 0.5, slopeDegrees: 20 });
const climateB = geographicVisualClimate('snow', { moisture: 0.5, slopeDegrees: 20 });
assert.deepEqual(climateA, climateB);
assert.ok(climateA.cold > 0.7);
assert.ok(climateA.wet > 0.4);
assert.ok(geographicVisualTags({ region: 'valyria', role: 'dragon', speciesId: 'dragon' }).includes('volcanic-exposure'));

const variantA = deterministicVisualVariant({ assetId: 'a', speciesId: 'wolf', region: 'north', worldSeed: 42 });
const variantB = deterministicVisualVariant({ assetId: 'a', speciesId: 'wolf', region: 'north', worldSeed: 42 });
assert.equal(variantA, variantB);
assert.notEqual(variantA, deterministicVisualVariant({ assetId: 'a', speciesId: 'wolf', region: 'snow', worldSeed: 42 }));

assert.equal(chooseVisualPaletteHint({ region: 'snow', speciesId: 'wolf' }).paletteHint, 'snow');
assert.equal(visualDistributionWeight({ region: 'valyria', speciesId: 'dragon', role: 'wildlife' }) > visualDistributionWeight({ region: 'reach', speciesId: 'dragon', role: 'wildlife' }), true);

const candidates = listAssetCandidatesWithSurfaceExpectations({ worldX: 0, worldZ: 0, role: 'guard' });
assert.ok(candidates.length > 0);
assert.ok(candidates.every((entry) => entry.sourcePath.startsWith('assets/models/')));
assert.ok(candidates.every((entry) => entry.expectedSurfaces.includes('skin')));

const metadata = prepareLivingWorldAssetVisual(human, {
  role: 'guard', region: 'north', allowLayeredFallback: false,
  metadata: { id: 'guard-test', src: 'assets/models/characters/erika_archer.fbx' },
});
assert.equal(metadata.ok, true);
assert.equal(metadata.changed, false);

assert.equal(LIVING_WORLD_VISUAL_POLICY.materialAuthority, 'MaterialAssignmentCore.js');
assert.equal(LIVING_WORLD_VISUAL_POLICY.placementAuthority, 'WorldAssetPlacementPipeline.js');
assert.equal(LIVING_WORLD_VISUAL_POLICY.editorMaterialStudioRuntimeImport, false);

console.log(JSON.stringify({
  ok: true,
  policy: LIVING_WORLD_VISUAL_POLICY.id,
  humanMeshes: audit.meshCount,
  humanSemanticCoverage: audit.semanticCoverage,
  horseFallback: horseAudit.fallbackReason,
  candidateCount: candidates.length,
}));
console.log('LIVING_WORLD_ASSET_VISUAL_ADAPTER_PASS');
