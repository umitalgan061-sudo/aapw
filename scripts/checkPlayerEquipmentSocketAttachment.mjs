import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolvePlayerEquipmentCombatProfile } from '../src/3d/gameplay/playerEquipmentCombatProfile.js';
import {
  PLAYER_SOCKET_DEFAULTS,
  PLAYER_SOCKET_LIMITS,
  normalizePlayerSocketOverrides,
  resolvePlayerSocketAttachment,
  buildPlayerSocketAttachmentPlan,
  applyPlayerSocketAttachment,
  auditPlayerSocketAttachmentPlan,
  buildSocketPlacementEvidence,
} from '../src/3d/gameplay/playerEquipmentSocketAttachment.js';

function finiteTree(value, path = 'root') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'number') assert.equal(Number.isFinite(child), true, `${path}.${key}`);
    else if (child && typeof child === 'object') finiteTree(child, `${path}.${key}`);
  }
}

const profile = resolvePlayerEquipmentCombatProfile({
  head: { id: 'cloth' },
  chest: { id: 'brigandine' },
  back: { id: 'bow' },
  mainHand: { id: 'longsword' },
  offHand: { id: 'shield' },
});

const defaults = normalizePlayerSocketOverrides({});
assert.deepEqual(Object.keys(defaults), []);
for (const slot of Object.keys(PLAYER_SOCKET_DEFAULTS)) {
  const resolved = resolvePlayerSocketAttachment(slot, profile.slots[slot] || { id: 'none' });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.slot, slot);
  finiteTree(resolved);
}

const aliases = normalizePlayerSocketOverrides({
  helmet: { position: { x: 0.2, y: 0.1, z: -0.1 }, rotation: { x: 0.1, y: 0.2, z: 0.3 }, scale: 1.2 },
  weapon: { position: { x: 2, y: -2, z: 3 }, rotation: { x: 99, y: -99, z: 5 }, scale: { x: 0.01, y: 9, z: 1.5 } },
  'left-hand': { position: { x: 0, y: 0, z: 0 } },
  nonsense: { position: { x: 0 } },
});
assert.ok(aliases.head);
assert.ok(aliases.mainHand);
assert.ok(aliases.offHand);
assert.equal(aliases.nonsense, undefined);
assert.ok(Math.abs(aliases.mainHand.position.x) <= PLAYER_SOCKET_LIMITS.positionMeters);
assert.ok(aliases.mainHand.scale.x >= PLAYER_SOCKET_LIMITS.scale.min);
assert.ok(aliases.mainHand.scale.y <= PLAYER_SOCKET_LIMITS.scale.max);
assert.ok(Math.abs(aliases.mainHand.rotation.x) <= Math.PI * 2);
finiteTree(aliases);

const itemTransform = resolvePlayerSocketAttachment('mainHand', {
  id: 'longsword',
  attachment: { position: { x: 0.03, y: 0.01, z: -0.04 }, rotation: { x: 0.2, y: 0.3, z: 0.4 }, scale: 1.15 },
});
assert.equal(itemTransform.ok, true);
approx(itemTransform.transform.position.x, 0.03);
approx(itemTransform.transform.position.y, 0.01);
approx(itemTransform.transform.position.z, -0.04);
approx(itemTransform.transform.rotation.z, 0.4);
approx(itemTransform.transform.scale.x, 1.15);
assert.equal(itemTransform.visible, true);
assert.equal(itemTransform.inheritScale, true);

const hidden = resolvePlayerSocketAttachment('back', { id: 'bow', visible: false, inheritScale: false });
assert.equal(hidden.visible, false);
assert.equal(hidden.inheritScale, false);

const mirrored = resolvePlayerSocketAttachment('main-hand', { id: 'sword', attachment: { position: { x: 0.3, y: 0.1, z: 0 }, rotation: { x: 0.2, y: 0.4, z: -0.5 }, scale: 1 } }, { mirrored: true });
assert.equal(mirrored.ok, true);
approx(mirrored.transform.position.x, -0.3);
approx(mirrored.transform.rotation.y, -0.4);
approx(mirrored.transform.rotation.z, 0.5);

const invalid = resolvePlayerSocketAttachment('foot', { id: 'shoe' });
assert.equal(invalid.ok, false);
assert.equal(invalid.error, 'unsupported-socket');

const plan = buildPlayerSocketAttachmentPlan(profile, {
  rootScale: 5,
  overrides: {
    mainHand: { position: { x: 0.04, y: 0, z: -0.03 }, scale: 1.1 },
    chest: { scale: { x: 1, y: 0.96, z: 1.02 } },
  },
});
assert.equal(plan.version, 1);
assert.equal(plan.rootScale, 2.5);
for (const slot of ['head', 'chest', 'back', 'mainHand', 'offHand']) assert.ok(plan.bindings[slot]);
assert.ok(Math.abs(plan.bindings.mainHand.transform.position.x) <= PLAYER_SOCKET_LIMITS.positionMeters);
assert.ok(plan.bindings.chest.transform.scale.y >= PLAYER_SOCKET_LIMITS.scale.min);
finiteTree(plan);

const emptyProfile = resolvePlayerEquipmentCombatProfile();
const emptyPlan = buildPlayerSocketAttachmentPlan(emptyProfile);
assert.deepEqual(emptyPlan.bindings, { head: null, chest: null, back: null, mainHand: null, offHand: null });
assert.equal(auditPlayerSocketAttachmentPlan(emptyPlan).ok, true);

const evidence = buildSocketPlacementEvidence(profile, { rootScale: 1, overrides: { mainHand: { position: { x: 0.01, y: 0, z: 0 } } } });
assert.equal(evidence.audit.ok, true);
assert.equal(evidence.attachmentCount, 5);
assert.deepEqual(evidence.populatedSlots, ['head', 'chest', 'back', 'mainHand', 'offHand']);
finiteTree(evidence);

const object = new THREE.Object3D();
const applied = applyPlayerSocketAttachment(object, plan.bindings.mainHand);
assert.equal(applied.ok, true);
assert.equal(object.userData.playerSocketAttachment.slot, 'mainHand');
approx(object.position.x, plan.bindings.mainHand.transform.position.x);
approx(object.position.y, plan.bindings.mainHand.transform.position.y);
approx(object.position.z, plan.bindings.mainHand.transform.position.z);
approx(object.rotation.y, plan.bindings.mainHand.transform.rotation.y);
approx(object.scale.x, plan.bindings.mainHand.transform.scale.x);

const preservedScale = new THREE.Object3D();
preservedScale.scale.set(3, 3, 3);
const appliedPreserved = applyPlayerSocketAttachment(preservedScale, plan.bindings.offHand, { preserveExistingScale: true });
assert.equal(appliedPreserved.ok, true);
approx(preservedScale.scale.x, 3);
approx(preservedScale.scale.y, 3);
approx(preservedScale.scale.z, 3);

const badApply = applyPlayerSocketAttachment(null, plan.bindings.mainHand);
assert.equal(badApply.ok, false);
const badAudit = auditPlayerSocketAttachmentPlan({ version: 9, bindings: { mainHand: { ok: false, transform: {} } } });
assert.equal(badAudit.ok, false);
assert.ok(badAudit.errors.includes('invalid-plan-version'));

const custom = buildPlayerSocketAttachmentPlan(profile, {
  rootScale: 0,
  overrides: {
    head: { uniformScale: 0.4 },
    mainHand: { position: { x: -0.12, y: 0.03, z: 0.06 }, rotation: { x: -0.2, y: Math.PI / 2, z: 0 }, scale: { x: 0.8, y: 1.2, z: 0.9 } },
    offHand: { position: { x: 0.12, y: 0.03, z: 0.06 }, rotation: { x: -0.2, y: -Math.PI / 2, z: 0 }, scale: 0.95 },
  },
});
assert.equal(custom.rootScale, 1);
assert.ok(custom.bindings.head.transform.scale.x >= 0.15);
assert.ok(custom.bindings.mainHand.transform.position.x < 0);
assert.ok(custom.bindings.offHand.transform.position.x > 0);
finiteTree(custom);
assert.equal(auditPlayerSocketAttachmentPlan(custom).ok, true);

function approx(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !== ${expected}`);
}

console.log('[checkPlayerEquipmentSocketAttachment] PASS deterministic socket aliases, bounded transforms, mirror handling, attachment application, empty-loadout behavior, audit/evidence and preservation semantics');
