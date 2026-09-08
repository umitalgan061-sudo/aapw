import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolvePlayerEquipmentCombatProfile, buildPlayerMaterialAssignmentMetadata } from '../src/3d/gameplay/playerEquipmentCombatProfile.js';
import {
  buildPlayerEquipmentEvidenceManifest,
  validatePlayerEquipmentEvidenceManifest,
  comparePlayerEquipmentEvidenceManifests,
  buildPlayerEquipmentAcceptanceSummary,
} from '../src/3d/gameplay/playerEquipmentEvidenceManifest.js';

const finiteTree = (value, path = 'root') => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'number') assert.equal(Number.isFinite(child), true, `${path}.${key}`);
    else if (child && typeof child === 'object') finiteTree(child, `${path}.${key}`);
  }
};

const model = new THREE.Group();
model.name = 'PeasantGirl';
for (const name of ['Head', 'Chest', 'Back', 'RightHand', 'LeftHand']) {
  const node = new THREE.Object3D();
  node.name = name;
  model.add(node);
}
const equipment = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'longsword' },
  offHand: { id: 'shield' },
  chest: { id: 'brigandine' },
  head: { id: 'cloth' },
  back: { id: 'bow' },
});
const materialMetadata = buildPlayerMaterialAssignmentMetadata({ object: model, profile: equipment, textureSize: 512 });

const manifestA = buildPlayerEquipmentEvidenceManifest({
  equipment,
  object3D: model,
  asset: { id: 'player-peasant', src: 'assets/models/characters/peasant_girl.fbx', hydrated: true, missing: false, sourceFormat: 'fbx', sourceBytes: 4962784, lfs: { pointer: true, oid: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', size: 4962784 } },
  surfaces: [
    { meshName: 'Body', materialName: 'cloth', semantic: 'cloth', textureWidth: 1024, textureHeight: 1024, uv: true },
    { meshName: 'Head', materialName: 'skin', semantic: 'skin', textureWidth: 1024, textureHeight: 1024, uv: true },
    { meshName: 'Hair', materialName: 'hair', semantic: 'hair', textureWidth: 512, textureHeight: 512, uv: true },
    { meshName: 'Sword', materialName: 'metal', semantic: 'weapon', textureWidth: 512, textureHeight: 512, uv: true },
    { meshName: 'Shield', materialName: 'wood-metal', semantic: 'shield', textureWidth: 1024, textureHeight: 1024, uv: true },
  ],
  materialManifest: { version: 1, validation: { ok: true } },
  materialValidation: { ok: true },
  placement: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, grounded: true, colliderAligned: true },
  runtime: { sceneBound: true, spawnVerified: true, eventChainVerified: true, consoleErrors: 0, pageErrors: 0, textureSize: materialMetadata.textureSize, rootScale: 1 },
  timestamp: 100,
});
finiteTree(manifestA);
assert.equal(manifestA.version, 1);
assert.equal(manifestA.asset.src, 'assets/models/characters/peasant_girl.fbx');
assert.equal(manifestA.asset.lfs.pointer, true);
assert.equal(manifestA.asset.lfs.size, 4962784);
assert.equal(manifestA.acceptance.missingAssetCount, 0);
assert.equal(manifestA.acceptance.materialValidationOk, true);
assert.equal(manifestA.acceptance.socketValidationOk, true);
assert.equal(manifestA.acceptance.grounded, true);
assert.equal(manifestA.acceptance.colliderAligned, true);
assert.equal(manifestA.runtime.consoleErrors, 0);
assert.equal(manifestA.runtime.pageErrors, 0);
assert.ok(manifestA.acceptance.surfaceCount >= 5);
assert.equal(validatePlayerEquipmentEvidenceManifest(manifestA).ok, true);
const summaryA = buildPlayerEquipmentAcceptanceSummary(manifestA);
assert.equal(summaryA.ok, true);
assert.equal(summaryA.missingAssetCount, 0);
assert.equal(summaryA.materialValidationOk, true);
assert.equal(summaryA.grounded, true);
assert.equal(summaryA.colliderAligned, true);
assert.equal(summaryA.errors.length, 0);

const manifestB = buildPlayerEquipmentEvidenceManifest({
  equipment,
  object3D: model,
  asset: { id: 'player-peasant', src: 'assets/models/characters/peasant_girl.fbx', hydrated: true, missing: false, sourceFormat: 'fbx', sourceBytes: 4962784, lfs: { pointer: true, oid: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', size: 4962784 } },
  surfaces: [
    { meshName: 'Shield', materialName: 'wood-metal', semantic: 'shield', textureWidth: 1024, textureHeight: 1024, uv: true },
    { meshName: 'Sword', materialName: 'metal', semantic: 'weapon', textureWidth: 512, textureHeight: 512, uv: true },
    { meshName: 'Hair', materialName: 'hair', semantic: 'hair', textureWidth: 512, textureHeight: 512, uv: true },
    { meshName: 'Head', materialName: 'skin', semantic: 'skin', textureWidth: 1024, textureHeight: 1024, uv: true },
    { meshName: 'Body', materialName: 'cloth', semantic: 'cloth', textureWidth: 1024, textureHeight: 1024, uv: true },
  ],
  materialManifest: { version: 1, validation: { ok: true } },
  materialValidation: { ok: true },
  placement: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, grounded: true, colliderAligned: true },
  runtime: { sceneBound: true, spawnVerified: true, eventChainVerified: true, consoleErrors: 0, pageErrors: 0, textureSize: 512, rootScale: 1 },
  timestamp: 100,
});
assert.equal(comparePlayerEquipmentEvidenceManifests(manifestA, manifestB).equal, false);
const sameComparison = comparePlayerEquipmentEvidenceManifests(manifestA, manifestA);
assert.equal(sameComparison.equal, true);
assert.equal(sameComparison.changed, false);
assert.equal(sameComparison.leftKey, sameComparison.rightKey);

const noAsset = buildPlayerEquipmentEvidenceManifest({ equipment, object3D: model, asset: { src: 'assets/models/characters/peasant_girl.fbx', hydrated: false, missing: true }, materialValidation: { ok: true }, materialManifest: { validation: { ok: true } }, placement: { grounded: true, colliderAligned: true }, runtime: { sceneBound: true, spawnVerified: true, eventChainVerified: true, consoleErrors: 0, pageErrors: 0 } });
const noAssetValidation = validatePlayerEquipmentEvidenceManifest(noAsset);
assert.equal(noAssetValidation.ok, false);
assert.ok(noAssetValidation.errors.includes('missing-asset'));

const materialFailure = buildPlayerEquipmentEvidenceManifest({ equipment, object3D: model, asset: { hydrated: true, missing: false }, materialValidation: { ok: false }, materialManifest: { validation: { ok: false } }, placement: { grounded: true, colliderAligned: true }, runtime: { sceneBound: true, spawnVerified: true, eventChainVerified: true, consoleErrors: 0, pageErrors: 0 } });
assert.equal(validatePlayerEquipmentEvidenceManifest(materialFailure).ok, false);
assert.ok(validatePlayerEquipmentEvidenceManifest(materialFailure).errors.includes('material-validation'));

const badPlacement = buildPlayerEquipmentEvidenceManifest({ equipment, object3D: model, asset: { hydrated: true, missing: false }, materialValidation: { ok: true }, materialManifest: { validation: { ok: true } }, placement: { grounded: false, colliderAligned: false }, runtime: { sceneBound: true, spawnVerified: true, eventChainVerified: true, consoleErrors: 0, pageErrors: 0 } });
const badPlacementValidation = validatePlayerEquipmentEvidenceManifest(badPlacement);
assert.equal(badPlacementValidation.ok, false);
assert.ok(badPlacementValidation.errors.includes('not-grounded'));
assert.ok(badPlacementValidation.errors.includes('collider-misaligned'));

const runtimeFailure = buildPlayerEquipmentEvidenceManifest({ equipment, object3D: model, asset: { hydrated: true, missing: false }, materialValidation: { ok: true }, materialManifest: { validation: { ok: true } }, placement: { grounded: true, colliderAligned: true }, runtime: { sceneBound: true, spawnVerified: true, eventChainVerified: true, consoleErrors: 1, pageErrors: 2 } });
const runtimeValidation = validatePlayerEquipmentEvidenceManifest(runtimeFailure);
assert.equal(runtimeValidation.ok, false);
assert.ok(runtimeValidation.errors.includes('console-errors'));
assert.ok(runtimeValidation.errors.includes('page-errors'));

for (let i = 0; i < 30; i += 1) {
  const variantEquipment = resolvePlayerEquipmentCombatProfile({ mainHand: { id: Object.keys({ unarmed: 1, dagger: 1, 'arming-sword': 1, longsword: 1, greatsword: 1, spear: 1, 'battle-axe': 1, mace: 1, staff: 1, bow: 1, crossbow: 1, shield: 1, buckler: 1 })[i % 13] }, chest: { id: Object.keys({ unarmored: 1, cloth: 1, leather: 1, chain: 1, brigandine: 1, plate: 1, 'royal-plate': 1, ranger: 1 })[i % 8] } });
  const manifest = buildPlayerEquipmentEvidenceManifest({ equipment: variantEquipment, object3D: model, asset: { id: `player-${i}`, src: 'assets/models/characters/peasant_girl.fbx', hydrated: true, missing: false }, surfaces: [{ meshName: 'Body', materialName: 'cloth', semantic: 'cloth', uv: true }, { meshName: 'Head', materialName: 'skin', semantic: 'skin', uv: true }], materialValidation: { ok: true }, materialManifest: { validation: { ok: true } }, placement: { grounded: true, colliderAligned: true }, runtime: { sceneBound: true, spawnVerified: true, eventChainVerified: true, consoleErrors: 0, pageErrors: 0 }, timestamp: i });
  assert.equal(validatePlayerEquipmentEvidenceManifest(manifest).ok, true);
  assert.ok(manifest.deterministicKey.length === 8);
  finiteTree(manifest);
}

console.log('[checkPlayerEquipmentEvidenceManifest] PASS deterministic evidence manifest, missing-asset/material/runtime/grounding fail-closed validation, surface proof, socket audit composition and 30-profile repeatability');
