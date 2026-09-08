import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PLAYER_WEAPON_PROFILES,
  PLAYER_ARMOR_PROFILES,
  SLOT_ALIASES,
  SOCKET_CANDIDATES,
  resolvePlayerEquipmentCombatProfile,
  resolvePlayerAttackTuning,
  resolvePlayerAnimationPlan,
  buildPlayerEquipmentSocketPlan,
  buildPlayerMaterialAssignmentMetadata,
  buildPlayerEquipmentRuntimeSnapshot,
  auditPlayerEquipmentProfile,
} from '../src/3d/gameplay/playerEquipmentCombatProfile.js';
import {
  PLAYER_EQUIPMENT_COMBAT_FRAME_EVENT,
  PLAYER_EQUIPMENT_COMBAT_PHASES,
  createPlayerEquipmentCombatRuntime,
  composePlayerEquipmentCombatFrame,
  isPlayerEquipmentCombatPhase,
} from '../src/3d/gameplay/playerEquipmentCombatRuntime.js';

function assertFiniteTree(value, path = 'root') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'number') assert.equal(Number.isFinite(child), true, `${path}.${key}`);
    else if (child && typeof child === 'object') assertFiniteTree(child, `${path}.${key}`);
  }
}

function makeTarget() {
  const listeners = new Map();
  const events = [];
  return {
    events,
    listeners,
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.detail = init.detail; }
    },
    addEventListener(type, handler) {
      const set = listeners.get(type) || new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event) {
      events.push(event);
      for (const handler of listeners.get(event.type) || []) handler(event);
      return true;
    },
  };
}

assert.deepEqual(Object.keys(SLOT_ALIASES), ['head', 'chest', 'back', 'mainHand', 'offHand']);
assert.deepEqual(PLAYER_EQUIPMENT_COMBAT_PHASES, ['idle', 'windup', 'active', 'recovery', 'defense', 'dodge', 'hit-stagger']);
for (const phase of PLAYER_EQUIPMENT_COMBAT_PHASES) assert.equal(isPlayerEquipmentCombatPhase(phase), true);
assert.equal(isPlayerEquipmentCombatPhase('bogus'), false);
assert.ok(Object.keys(PLAYER_WEAPON_PROFILES).length >= 12);
assert.ok(Object.keys(PLAYER_ARMOR_PROFILES).length >= 8);

const canonicalIds = Object.values(PLAYER_WEAPON_PROFILES).map((profile) => profile.id);
const canonicalArmorIds = Object.values(PLAYER_ARMOR_PROFILES).map((profile) => profile.id);
assert.ok(canonicalIds.includes('arming-sword'));
assert.ok(canonicalIds.includes('battle-axe'));
assert.ok(canonicalArmorIds.includes('royal-plate'));

const baseline = resolvePlayerEquipmentCombatProfile();
assert.equal(baseline.mainHand.id, 'unarmed');
assert.equal(baseline.armor.id, 'unarmored');
assert.equal(baseline.shieldEquipped, false);
assert.equal(baseline.ranged, false);
assert.equal(baseline.twoHanded, false);
assertFiniteTree(baseline);

for (const id of canonicalIds) {
  const profile = resolvePlayerEquipmentCombatProfile({ mainHand: { id } });
  assert.equal(profile.mainHand.id, id);
  assert.ok(profile.mainHand.damageMultiplier > 0);
  assert.ok(profile.mainHand.reachMultiplier > 0);
  assert.ok(profile.mainHand.staminaMultiplier > 0);
  assert.ok(profile.mainHand.durationMultiplier > 0);
  assertFiniteTree(profile, `weapon:${id}`);
}

for (const id of canonicalArmorIds) {
  const profile = resolvePlayerEquipmentCombatProfile({ chest: { id } });
  assert.equal(profile.armor.id, id);
  assert.ok(profile.armor.movementMultiplier > 0);
  assert.ok(profile.armor.staminaDrainMultiplier > 0);
  assert.ok(profile.armor.staminaRegenMultiplier > 0);
  assert.ok(profile.armor.poiseBonus >= 0);
  assertFiniteTree(profile, `armor:${id}`);
}

const aliasLoadout = resolvePlayerEquipmentCombatProfile({
  weapon: { id: 'longsword' },
  shield: { id: 'buckler' },
  torso: { id: 'leather' },
  helmet: { id: 'cloth' },
  quiver: { id: 'bow' },
});
assert.equal(aliasLoadout.mainHand.id, 'longsword');
assert.equal(aliasLoadout.offHand.id, 'buckler');
assert.equal(aliasLoadout.armor.id, 'leather');
assert.equal(aliasLoadout.slots.back.id, 'bow');
assert.equal(aliasLoadout.shieldEquipped, true);

const ranged = resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'bow' } });
assert.equal(ranged.ranged, true);
assert.equal(ranged.twoHanded, true);
assert.equal(ranged.mainHand.projectile, true);
const crossbow = resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'crossbow' } });
assert.equal(crossbow.ranged, true);
assert.equal(crossbow.mainHand.projectile, true);

const malformed = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'greatsword', stats: { staminaMultiplier: -999, damageMultiplier: 999, reachMultiplier: 999, durationMultiplier: 0, commitMultiplier: 999 } },
  chest: { id: 'plate', armorStats: { movementMultiplier: -4, staminaDrainMultiplier: 99, staminaRegenMultiplier: -4, poiseBonus: Infinity, guardDamageMultiplier: -4, dodgeDistanceMultiplier: 99 } },
});
assert.ok(malformed.mainHand.staminaMultiplier >= 0.35 && malformed.mainHand.staminaMultiplier <= 3);
assert.ok(malformed.mainHand.damageMultiplier <= 4);
assert.ok(malformed.mainHand.reachMultiplier <= 6);
assert.ok(malformed.mainHand.durationMultiplier >= 0.5);
assert.ok(malformed.armor.movementMultiplier >= 0.55);
assert.ok(malformed.armor.staminaDrainMultiplier <= 1.8);
assert.ok(malformed.armor.staminaRegenMultiplier >= 0.55);
assert.ok(malformed.armor.guardDamageMultiplier >= 0.35);
assert.ok(malformed.armor.dodgeDistanceMultiplier <= 1.1);
assertFiniteTree(malformed);

const lightBase = { staminaCost: 12, duration: 0.44, activeStart: 0.14, activeEnd: 0.26, reach: 1.65, damageScale: 1, commitMeters: 0.58 };
const heavyBase = { staminaCost: 24, duration: 0.72, activeStart: 0.28, activeEnd: 0.46, reach: 2.05, damageScale: 1.65, commitMeters: 0.9 };
for (const id of canonicalIds) {
  const profile = resolvePlayerEquipmentCombatProfile({ mainHand: { id } });
  for (const [kind, base] of [['light', lightBase], ['heavy', heavyBase]]) {
    const tuning = resolvePlayerAttackTuning(base, profile, kind);
    assert.ok(tuning.cost >= 2 && tuning.cost <= 80);
    assert.ok(tuning.duration >= 0.18 && tuning.duration <= 2.5);
    assert.ok(tuning.activeStart < tuning.activeEnd);
    assert.ok(tuning.activeEnd <= tuning.duration);
    assert.ok(tuning.reach >= 0.35 && tuning.reach <= 12);
    assert.ok(tuning.damageScale >= 0.1 && tuning.damageScale <= 6);
    assert.ok(tuning.commitMeters >= 0.05 && tuning.commitMeters <= 2.8);
    assert.equal(tuning.isRanged, id === 'bow' || id === 'crossbow');
    assertFiniteTree(tuning, `${id}:${kind}`);
  }
}

const expectedAnimation = [
  ['idle', 'none', 0, 'idle'],
  ['move', 'none', 1, 'walking'],
  ['move', 'none', 6, 'running'],
  ['dodge', 'none', 0, 'running'],
  ['parry', 'none', 0, 'idle'],
  ['guard', 'none', 0, 'idle'],
  ['hit-stagger', 'none', 0, 'idle'],
  ['guard-break', 'none', 0, 'idle'],
];
for (const [state, attackKind, speedMps, expected] of expectedAnimation) {
  const plan = resolvePlayerAnimationPlan(resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'greatsword' } }), { movementState: state, attackKind, comboStep: 0, speedMps, grounded: true });
  assert.equal(plan.action, expected);
  assert.ok(plan.weight >= 0 && plan.weight <= 1);
  assert.ok(plan.timeScale > 0);
  assertFiniteTree(plan);
}
for (const comboStep of [0, 1, 2, 3, 4, 99, -10]) {
  const plan = resolvePlayerAnimationPlan(resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'dagger' } }), { movementState: 'attack-light', attackKind: 'light', comboStep, speedMps: 2, grounded: true });
  assert.ok(plan.comboStep >= 0 && plan.comboStep <= 3);
  assert.ok(plan.weight >= 0 && plan.weight <= 1);
}

const model = new THREE.Group();
model.name = 'PeasantGirl';
for (const candidate of ['Head', 'Chest', 'Back', 'RightHand', 'LeftHand']) {
  const bone = new THREE.Object3D();
  bone.name = candidate;
  model.add(bone);
}
const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.7, 0.35), new THREE.MeshStandardMaterial({ roughness: 0.72 }));
mesh.name = 'Body';
model.add(mesh);
const socketProfile = resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'longsword' }, offHand: { id: 'shield' }, chest: { id: 'brigandine' }, head: { id: 'cloth' }, back: { id: 'bow' } });
const sockets = buildPlayerEquipmentSocketPlan(model, socketProfile);
assert.equal(sockets.bindings.mainHand.socket, 'RightHand');
assert.equal(sockets.bindings.offHand.socket, 'LeftHand');
assert.equal(sockets.bindings.chest.socket, 'Chest');
assert.equal(sockets.bindings.head.socket, 'Head');
assert.equal(sockets.bindings.back.socket, 'Back');
assertFiniteTree(sockets);

const metadata = buildPlayerMaterialAssignmentMetadata({ object: model, metadata: { id: 'player-peasant', name: 'Peasant Girl', category: 'character' }, profile: socketProfile, textureSize: 1024 });
assert.equal(metadata.id, 'player-peasant');
assert.equal(metadata.category, 'character');
assert.equal(metadata.textureSize, 512);
assert.equal(metadata.materialContract, 'MaterialAssignmentCore');
assert.equal(metadata.placementContract, 'WorldAssetPlacementPipeline');
assert.equal(metadata.editorUiImportForbidden, true);
assert.equal(metadata.importedMaterialsPreferred, true);
assert.equal(metadata.layeredFallbackAllowed, true);
assertFiniteTree(metadata);

const snapshot = buildPlayerEquipmentRuntimeSnapshot({ object: model, equipment: { mainHand: { id: 'spear' }, chest: { id: 'chain' } }, now: () => 42 });
assert.equal(snapshot.timestamp, 42);
assert.equal(snapshot.profile.mainHand.id, 'spear');
assert.equal(snapshot.profile.armor.id, 'chain');
assert.equal(snapshot.animation.family, 'spear');
assert.equal(snapshot.audit.ok, true);
assertFiniteTree(snapshot);
assert.equal(auditPlayerEquipmentProfile(snapshot.profile, { socketPlan: snapshot.socketPlan }).ok, true);

const target = makeTarget();
const player = {
  object3D: model,
  getMotionState: () => ({ state: 'idle', stamina: 100, staminaRatio: 1, poise: 100, poiseRatio: 1, isGrounded: true, speedMps: 0, attackKind: 'none', attackActive: false, attackComboStep: 0, guarding: false, defenseResult: 'none' }),
};
let equipmentState = { mainHand: { id: 'longsword' }, offHand: { id: 'shield' }, chest: { id: 'plate' } };
const runtime = createPlayerEquipmentCombatRuntime({ player, target, equipmentProvider: () => equipmentState, now: () => 100, emitFrames: true });
assert.equal(runtime.read().equipment.mainHandId, 'longsword');
assert.equal(runtime.read().equipment.offHandId, 'shield');
assert.equal(runtime.read().equipment.chestId, 'plate');
assert.equal(runtime.read().phase, 'idle');

const events = [
  ['motion', { state: 'move', speedMps: 5, staminaRatio: 0.86, poiseRatio: 0.9, isGrounded: true, guarding: false }],
  ['attack', { kind: 'heavy', phase: 'windup', active: false, comboStep: 1, serial: 1 }],
  ['attack', { kind: 'heavy', phase: 'active', active: true, comboStep: 1, serial: 1 }],
  ['feedback', { outcome: 'hit', serial: 1, rawAmount: 24, appliedAmount: 18, blockedAmount: 6 }],
  ['attack', { kind: 'heavy', phase: 'recovery', active: false, comboStep: 1, serial: 1 }],
  ['motion', { state: 'dodge', speedMps: 9, staminaRatio: 0.55, poiseRatio: 0.8, isGrounded: true, guarding: false }],
  ['feedback', { outcome: 'dodge', serial: 2, rawAmount: 20, appliedAmount: 0, blockedAmount: 20 }],
  ['motion', { state: 'parry', speedMps: 0, staminaRatio: 0.42, poiseRatio: 0.7, isGrounded: true, guarding: false, defenseResult: 'parry' }],
  ['feedback', { outcome: 'parry', serial: 3, rawAmount: 30, appliedAmount: 0, blockedAmount: 30 }],
  ['motion', { state: 'hit-stagger', speedMps: 0, staminaRatio: 0.4, poiseRatio: 0.05, isGrounded: true, guarding: false, defenseResult: 'hit-stagger' }],
];
for (const [kind, detail] of events) {
  const type = kind === 'motion' ? 'aapw:player-motion' : kind === 'attack' ? 'aapw:player-attack-window' : 'aapw:player-combat-feedback';
  target.dispatchEvent(new target.CustomEvent(type, { detail }));
  const frame = runtime.read();
  assertFiniteTree(frame);
  assert.equal(frame.audit.ok, true);
}
assert.ok(target.events.some((event) => event.type === PLAYER_EQUIPMENT_COMBAT_FRAME_EVENT));
assert.ok(runtime.readHistory().length >= events.length);
assert.equal(runtime.read().equipment.mainHandId, 'longsword');
assert.equal(runtime.read().equipment.offHandId, 'shield');
assert.equal(runtime.read().phase, 'hit-stagger');

 equipmentState = { mainHand: { id: 'bow' }, chest: { id: 'ranger' } };
const refreshed = runtime.refreshEquipment(250);
assert.equal(refreshed.timestamp, 250);
assert.equal(refreshed.equipment.mainHandId, 'bow');
assert.equal(refreshed.equipment.chestId, 'ranger');
assert.equal(refreshed.attack.ranged, true);
assert.equal(refreshed.equipment.twoHanded, true);
assert.equal(refreshed.animation.family, 'archery');
assert.ok(refreshed.revision >= 1);
assertFiniteTree(refreshed);

const history = runtime.readHistory();
assert.ok(history.length <= 32);
for (const item of history) assert.equal(item.audit.ok, true);
const beforeDisposeEvents = target.events.length;
runtime.dispose();
target.dispatchEvent(new target.CustomEvent('aapw:player-motion', { detail: { state: 'dodge', speedMps: 10, staminaRatio: 0.2, poiseRatio: 0.1, isGrounded: true } }));
assert.equal(target.events.length, beforeDisposeEvents + 1);
assert.equal(runtime.read().animation.action, 'running');

const composed = composePlayerEquipmentCombatFrame({
  playerObject: model,
  equipment: { mainHand: { id: 'bow' }, chest: { id: 'leather' } },
  motion: { state: 'attack-heavy', speedMps: 0, isGrounded: true, guarding: false },
  attack: { kind: 'heavy', phase: 'recovery', comboStep: 3, active: false, serial: 12 },
  outcome: { outcome: 'hit', serial: 12, rawAmount: 31, appliedAmount: 31, blockedAmount: 0 },
  timestamp: 99,
  revision: 4,
});
assert.equal(composed.revision, 4);
assert.equal(composed.equipment.mainHandId, 'bow');
assert.equal(composed.attack.ranged, true);
assert.equal(composed.phase, 'recovery');
assert.equal(composed.outcome.outcome, 'hit');
assertFiniteTree(composed);

for (const armorId of canonicalArmorIds) {
  for (const weaponId of canonicalIds) {
    const profile = resolvePlayerEquipmentCombatProfile({ mainHand: { id: weaponId }, chest: { id: armorId } });
    const plan = resolvePlayerAnimationPlan(profile, { movementState: 'move', attackKind: 'none', comboStep: 0, speedMps: 2, grounded: true });
    assert.equal(profile.mainHand.id, weaponId);
    assert.equal(profile.armor.id, armorId);
    assert.ok(plan.action === 'walking' || plan.action === 'running' || plan.action === 'idle');
    assert.ok(plan.timeScale > 0);
  }
}

console.log('[checkPlayerEquipmentCombatRuntime] PASS: exhaustive canonical weapon/armour matrix, bounds, animation phases, socket plan, shared-material metadata, LFS-linked player contract assumptions, live event composition and lifecycle');
