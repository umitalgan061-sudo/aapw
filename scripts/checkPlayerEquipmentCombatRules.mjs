import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PLAYER_WEAPON_PROFILES,
  PLAYER_ARMOR_PROFILES,
  resolvePlayerEquipmentCombatProfile,
} from '../src/3d/gameplay/playerEquipmentCombatProfile.js';
import {
  resolvePlayerDefenseRules,
  resolvePlayerDodgeRules,
  resolvePlayerRangedRules,
  resolvePlayerCombatEnvelope,
  comparePlayerEquipmentProfiles,
  resolvePlayerEquipmentTransition,
  resolvePlayerHitReaction,
  resolvePlayerLockOnRules,
  buildPlayerHitboxHurtboxContract,
  validatePlayerEquipmentRuntimeInput,
} from '../src/3d/gameplay/playerEquipmentCombatRules.js';

const finiteTree = (value, path = 'root') => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'number') assert.ok(Number.isFinite(child), `${path}.${key} is finite`);
    else if (child && typeof child === 'object') finiteTree(child, `${path}.${key}`);
  }
};

const profiles = [
  ['unarmed', {}],
  ['dagger', { mainHand: { id: 'dagger' } }],
  ['arming-sword', { mainHand: { id: 'arming-sword' } }],
  ['longsword', { mainHand: { id: 'longsword' } }],
  ['greatsword', { mainHand: { id: 'greatsword' } }],
  ['spear', { mainHand: { id: 'spear' } }],
  ['battle-axe', { mainHand: { id: 'battle-axe' } }],
  ['mace', { mainHand: { id: 'mace' } }],
  ['staff', { mainHand: { id: 'staff' } }],
  ['bow', { mainHand: { id: 'bow' } }],
  ['crossbow', { mainHand: { id: 'crossbow' } }],
  ['shield', { mainHand: { id: 'shield' } }],
  ['buckler', { mainHand: { id: 'buckler' } }],
];

for (const [id, equipment] of profiles) {
  const profile = resolvePlayerEquipmentCombatProfile(equipment);
  assert.equal(profile.mainHand.id, id);
  for (const staminaRatio of [0, 0.1, 0.28, 0.5, 0.75, 1]) {
    for (const poiseRatio of [0, 0.1, 0.5, 1]) {
      const defense = resolvePlayerDefenseRules(profile, { staminaRatio, poiseRatio, guardInput: true, parryWindowOpen: true, dodgeInvulnerable: false });
      assert.equal(defense.staminaRatio, staminaRatio);
      assert.equal(defense.poiseRatio, poiseRatio);
      assert.ok(defense.staminaCostMultiplier > 0);
      assert.ok(defense.guardDamageMultiplier > 0);
      assert.ok(defense.poiseDamageMultiplier > 0);
      assert.ok(defense.guardBreakRisk >= 0 && defense.guardBreakRisk <= 1);
      finiteTree(defense, `defense:${id}:${staminaRatio}:${poiseRatio}`);
    }
  }
  for (const grounded of [true, false]) {
    for (const attackBusy of [true, false]) {
      for (const guardBreak of [true, false]) {
        const dodge = resolvePlayerDodgeRules(profile, { staminaRatio: 0.5, grounded, attackBusy, guardBreak });
        assert.equal(dodge.canStart, grounded && !attackBusy && !guardBreak);
        assert.ok(dodge.distanceMultiplier > 0);
        assert.equal(dodge.iframeWindow.duration, 0.22);
        finiteTree(dodge, `dodge:${id}`);
      }
    }
  }
  const ranged = resolvePlayerRangedRules(profile, { staminaRatio: 0.75, lockOn: true, moving: false });
  assert.equal(ranged.ranged, id === 'bow' || id === 'crossbow');
  if (ranged.ranged) assert.equal(ranged.projectile, true);
  finiteTree(ranged, `ranged:${id}`);
}

const heavyArmor = resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'greatsword' }, offHand: { id: 'shield' }, chest: { id: 'royal-plate' }, head: { id: 'plate' } });
const lightArmor = resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'dagger' }, chest: { id: 'cloth' } });
const heavyEnvelope = resolvePlayerCombatEnvelope(heavyArmor, { kind: 'heavy', staminaRatio: 0.4, poiseRatio: 0.2 });
assert.ok(heavyEnvelope.damageScaleAtCurrentStamina > 0);
assert.equal(heavyEnvelope.exhausted, false);
assert.equal(heavyEnvelope.vulnerable, false);
assert.ok(heavyEnvelope.movementMultiplier < 1);
assert.ok(heavyEnvelope.commitMeters > 0);
finiteTree(heavyEnvelope);

const exhaustedEnvelope = resolvePlayerCombatEnvelope(heavyArmor, { kind: 'heavy', staminaRatio: 0, poiseRatio: 1 });
assert.equal(exhaustedEnvelope.exhausted, true);
assert.ok(exhaustedEnvelope.damageScaleAtCurrentStamina > 0);
const staggerEnvelope = resolvePlayerCombatEnvelope(heavyArmor, { kind: 'light', staminaRatio: 1, poiseRatio: 0 });
assert.equal(staggerEnvelope.vulnerable, true);

const noShieldDefense = resolvePlayerDefenseRules(lightArmor, { staminaRatio: 1, poiseRatio: 1, guardInput: true, parryWindowOpen: true });
const shieldDefense = resolvePlayerDefenseRules(heavyArmor, { staminaRatio: 1, poiseRatio: 1, guardInput: true, parryWindowOpen: true });
assert.ok(shieldDefense.guardDamageMultiplier < noShieldDefense.guardDamageMultiplier);
assert.equal(shieldDefense.parryAvailable, true);
const exhaustedDefense = resolvePlayerDefenseRules(heavyArmor, { staminaRatio: 0.01, poiseRatio: 0.9, guardInput: true, parryWindowOpen: true });
assert.equal(exhaustedDefense.guardAvailable, true);
assert.equal(exhaustedDefense.parryAvailable, false);
const invulnerableDefense = resolvePlayerDefenseRules(heavyArmor, { staminaRatio: 1, poiseRatio: 1, guardInput: true, parryWindowOpen: true, dodgeInvulnerable: true });
assert.equal(invulnerableDefense.guardAvailable, false);
assert.equal(invulnerableDefense.parryAvailable, false);

const bowProfile = resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'bow' } });
const bowRules = resolvePlayerRangedRules(bowProfile, { staminaRatio: 1, lockOn: true, moving: false });
assert.equal(bowRules.stableAim, true);
assert.equal(bowRules.lockOnAssist, true);
assert.ok(bowRules.releaseQuality > 0.8);
const movingBowRules = resolvePlayerRangedRules(bowProfile, { staminaRatio: 0.1, lockOn: false, moving: true });
assert.equal(movingBowRules.stableAim, false);
assert.ok(movingBowRules.releaseQuality < bowRules.releaseQuality);

const before = resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'arming-sword' }, chest: { id: 'leather' } });
const after = resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'longsword' }, offHand: { id: 'shield' }, chest: { id: 'plate' }, head: { id: 'plate' } });
const delta = comparePlayerEquipmentProfiles(before, after);
assert.equal(delta.changed, true);
assert.equal(delta.weaponChanged, true);
assert.equal(delta.defenseChanged, true);
assert.ok(delta.changedSlots.includes('mainHand'));
assert.ok(delta.changedSlots.includes('offHand'));
assert.ok(delta.changedSlots.includes('chest'));
assert.ok(delta.changedSlots.includes('head'));
finiteTree(delta);

const transitionHard = resolvePlayerEquipmentTransition(before, after, { movementState: 'attack-light', attackKind: 'light', comboStep: 2, speedMps: 2, grounded: true });
assert.equal(transitionHard.hardReset, true);
assert.equal(transitionHard.animation.hardReset, true);
assert.ok(transitionHard.animation.crossfadeSeconds > 0);
assert.ok(transitionHard.socketsToRefresh.includes('mainHand'));
assert.ok(transitionHard.socketsToRefresh.includes('offHand'));

const same = resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'longsword' }, chest: { id: 'plate' } });
const transitionSoft = resolvePlayerEquipmentTransition(same, same, { movementState: 'move', attackKind: 'none', speedMps: 4, grounded: true });
assert.equal(transitionSoft.changed, false);
assert.equal(transitionSoft.hardReset, false);
assert.equal(transitionSoft.socketsToRefresh.length, 0);
assert.equal(transitionSoft.animation.preserveLocomotion, true);

const bowTransition = resolvePlayerEquipmentTransition(same, bowProfile, { movementState: 'idle', attackKind: 'none', speedMps: 0, grounded: true });
assert.equal(bowTransition.rangedChanged, true);
assert.equal(bowTransition.hardReset, true);
assert.equal(bowTransition.animation.toFamily, 'archery');

const hit = resolvePlayerHitReaction(heavyArmor, { rawAmount: 50, blockedAmount: 15, poise: 40, maxPoise: 100 });
assert.equal(hit.rawAmount, 50);
assert.equal(hit.blockedAmount, 15);
assert.equal(hit.poiseAfter < 40, true);
assert.ok(hit.effectiveImpact > 0);
assert.equal(typeof hit.staggers, 'boolean');
finiteTree(hit);
const fullBlock = resolvePlayerHitReaction(heavyArmor, { rawAmount: 50, blockedAmount: 50, poise: 40, maxPoise: 100 });
assert.equal(fullBlock.effectiveImpact, 0);
assert.equal(fullBlock.poiseAfter, 40);
const malformedHit = resolvePlayerHitReaction(heavyArmor, { rawAmount: Infinity, blockedAmount: -50, poise: NaN, maxPoise: 100 });
assert.equal(malformedHit.rawAmount, 0);
assert.equal(malformedHit.blockedAmount, 0);
assert.equal(malformedHit.poiseAfter, 100);

const lockMelee = resolvePlayerLockOnRules(same, { targetDistanceMeters: 4, targetAngleRad: 0.4, targetAlive: true, targetVisible: true, targetPriority: 0.5 });
assert.equal(lockMelee.eligible, true);
assert.equal(lockMelee.acquire, true);
assert.ok(lockMelee.score > 0.5 && lockMelee.score < 1);
const lockBroken = resolvePlayerLockOnRules(same, { targetDistanceMeters: 10, targetAngleRad: 0.2, targetAlive: true, targetVisible: true, currentLocked: true });
assert.equal(lockBroken.maintain, true);
assert.equal(lockBroken.breakLock, false);
const lockInvisible = resolvePlayerLockOnRules(same, { targetDistanceMeters: 4, targetAngleRad: 0.1, targetAlive: true, targetVisible: false, currentLocked: true });
assert.equal(lockInvisible.eligible, false);
assert.equal(lockInvisible.breakLock, false);
const lockFar = resolvePlayerLockOnRules(same, { targetDistanceMeters: 100, targetAngleRad: 0, targetAlive: true, targetVisible: true, currentLocked: true });
assert.equal(lockFar.eligible, false);
assert.equal(lockFar.breakLock, true);
const lockBow = resolvePlayerLockOnRules(bowProfile, { targetDistanceMeters: 24, targetAngleRad: 0.8, targetAlive: true, targetVisible: true });
assert.equal(lockBow.eligible, true);
assert.equal(lockBow.maxRange, 28);
const malformedLock = resolvePlayerLockOnRules(same, { targetDistanceMeters: NaN, targetAngleRad: Infinity, targetPriority: Infinity });
assert.ok(Number.isFinite(malformedLock.distanceMeters));
assert.ok(Number.isFinite(malformedLock.angleRad));
finiteTree(lockMelee);
finiteTree(lockBow);

const heavyHitbox = buildPlayerHitboxHurtboxContract(heavyArmor, { grounded: true, attackKind: 'heavy', stance: 'neutral' });
const crouchHitbox = buildPlayerHitboxHurtboxContract(lightArmor, { grounded: true, crouching: true, attackKind: 'light', stance: 'guard' });
assert.equal(heavyHitbox.hurtbox.shape, 'capsule');
assert.equal(heavyHitbox.hitbox.shape, 'arc');
assert.ok(heavyHitbox.hitbox.activeReachMeters > crouchHitbox.hitbox.activeReachMeters);
assert.ok(heavyHitbox.hurtbox.radius > 0);
assert.equal(heavyHitbox.separation.visualColliderParityRequired, true);
assert.equal(crouchHitbox.hurtbox.height, 1.22);
finiteTree(heavyHitbox);
finiteTree(crouchHitbox);

const validInput = validatePlayerEquipmentRuntimeInput({ equipment: { mainHand: { id: 'spear' }, chest: { id: 'chain' } }, kind: 'heavy', staminaRatio: 0.65, poiseRatio: 0.7, grounded: true, attackBusy: false, guardBreak: false, lockOn: false, moving: false });
assert.equal(validInput.ok, true);
assert.equal(validInput.ranged.ranged, false);
assert.ok(validInput.tuning.reach > 2);
finiteTree(validInput);
const bowInput = validatePlayerEquipmentRuntimeInput({ equipment: { mainHand: { id: 'bow' }, chest: { id: 'ranger' } }, kind: 'light', staminaRatio: 1, poiseRatio: 1, grounded: true, lockOn: true, moving: false });
assert.equal(bowInput.ok, true);
assert.equal(bowInput.ranged.ranged, true);
const malformedInput = validatePlayerEquipmentRuntimeInput({ equipment: { mainHand: { id: 'unknown' } }, kind: 'bogus', staminaRatio: Infinity, poiseRatio: NaN });
assert.equal(malformedInput.ok, true);
assert.ok(malformedInput.tuning.cost > 0);

const root = new THREE.Group();
root.name = 'player';
const bones = ['Head', 'Chest', 'Back', 'RightHand', 'LeftHand'];
for (const name of bones) { const node = new THREE.Object3D(); node.name = name; root.add(node); }
const roundTripA = resolvePlayerEquipmentTransition(
  resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'dagger' }, chest: { id: 'cloth' } }),
  resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'greatsword' }, chest: { id: 'plate' } }),
  { movementState: 'attack-heavy', attackKind: 'heavy', comboStep: 3, speedMps: 0, grounded: true },
);
const roundTripB = resolvePlayerEquipmentTransition(
  resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'dagger' }, chest: { id: 'cloth' } }),
  resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'greatsword' }, chest: { id: 'plate' } }),
  { movementState: 'attack-heavy', attackKind: 'heavy', comboStep: 3, speedMps: 0, grounded: true },
);
assert.deepEqual(roundTripA, roundTripB);
assert.ok(root.children.length === 5);

for (const armorId of Object.keys(PLAYER_ARMOR_PROFILES)) {
  for (const weaponId of Object.keys(PLAYER_WEAPON_PROFILES)) {
    const profile = resolvePlayerEquipmentCombatProfile({ mainHand: { id: weaponId }, chest: { id: armorId } });
    const input = validatePlayerEquipmentRuntimeInput({ equipment: { mainHand: { id: weaponId }, chest: { id: armorId } }, kind: 'light', staminaRatio: 0.75, poiseRatio: 0.75, grounded: true });
    assert.equal(input.ok, true);
    assert.equal(input.profile.mainHand.id, profile.mainHand.id);
    assert.equal(input.profile.armor.id, profile.armor.id);
  }
}

console.log('[checkPlayerEquipmentCombatRules] PASS defense/dodge/ranged envelopes, loadout transitions, hit reactions, lock-on, hitbox/hurtbox geometry, malformed input, exhaustive weapon x armour matrix, and deterministic runtime rules');
