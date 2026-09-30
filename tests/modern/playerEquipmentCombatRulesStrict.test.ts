import { describe, expect, it } from 'vitest';
import {
  buildPlayerHitboxHurtboxContract,
  resolvePlayerDefenseRules,
  resolvePlayerDodgeRules,
  resolvePlayerLockOnRules,
  resolvePlayerRangedRules,
  validatePlayerEquipmentRuntimeInput,
} from '../../src/3d/gameplay/playerEquipmentCombatRules.ts';
import { resolvePlayerEquipmentCombatProfile } from '../../src/3d/gameplay/playerEquipmentCombatProfile.ts';
import { createPlayerEquipmentCombatRuntime } from '../../src/3d/gameplay/playerEquipmentCombatRuntime.ts';

const longswordShieldPlate = {
  mainHand: { id: 'longsword' },
  offHand: { id: 'shield' },
  chest: { id: 'plate' },
};

describe('Kızıl Ufuk strict equipment/combat rules', () => {
  it('does not treat equivalent equipment objects with different key order as changes', () => {
    const target = new EventTarget();
    const model = { name: 'player', userData: {}, position: { x: 0, y: 0, z: 0 }, traverse() {} };
    const player = { object3D: model, getMotionState: () => ({ state: 'idle', stamina: 100, staminaRatio: 1, poise: 100, poiseRatio: 1, isGrounded: true, speedMps: 0, attackKind: 'none', attackActive: false, attackComboStep: 0, guarding: false, defenseResult: 'none' }) };
    let equipment: Record<string, unknown> = { mainHand: { id: 'longsword' }, offHand: { id: 'shield' }, chest: { id: 'plate' } };
    const runtime = createPlayerEquipmentCombatRuntime({ player, target, equipmentProvider: () => equipment, now: () => 100, emitFrames: false });
    const initialRevision = runtime.read().revision;
    equipment = { chest: { id: 'plate' }, offHand: { id: 'shield' }, mainHand: { id: 'longsword' } };
    runtime.update(0.016, 101);
    expect(runtime.read().revision).toBe(initialRevision);
    equipment = { mainHand: { id: 'greatsword' }, offHand: { id: 'shield' }, chest: { id: 'plate' } };
    runtime.update(0.016, 102);
    expect(runtime.read().revision).toBe(initialRevision + 1);
    runtime.dispose();
  });

  it('keeps empty equipment slots nullable while resolving an unarmed baseline', () => {
    const profile = resolvePlayerEquipmentCombatProfile({});
    expect(profile.slots.mainHand).toBeNull();
    expect(profile.slots.offHand).toBeNull();
    expect(profile.sourceIds.mainHand).toBe('unarmed');
    expect(profile.armor.id).toBe('unarmored');
  });
  it('produces a valid defensive contract for a shield loadout', () => {
    const defense = resolvePlayerDefenseRules(longswordShieldPlate, {
      staminaRatio: 0.92,
      poiseRatio: 0.8,
      guardInput: true,
      parryWindowOpen: true,
    });
    expect(defense.guardAvailable).toBe(true);
    expect(defense.parryAvailable).toBe(true);
    expect(defense.guardDamageMultiplier).toBeLessThan(1);
    expect(Number.isFinite(defense.staminaCostMultiplier)).toBe(true);
  });

  it('keeps dodge, lock-on and ranged decisions finite and bounded', () => {
    const dodge = resolvePlayerDodgeRules(longswordShieldPlate, { staminaRatio: 0.5, grounded: true });
    const lock = resolvePlayerLockOnRules(longswordShieldPlate, {
      targetDistanceMeters: 5,
      targetAngleRad: 0.2,
      targetAlive: true,
      targetVisible: true,
      targetPriority: 0.5,
    });
    const ranged = resolvePlayerRangedRules({ mainHand: { id: 'bow' } }, {
      staminaRatio: 0.9,
      lockOn: true,
      moving: false,
    });
    expect(dodge.canStart).toBe(true);
    expect(lock.acquire).toBe(true);
    expect(ranged.ranged).toBe(true);
    expect(ranged.projectile).toBe(true);
    expect([dodge.distanceMultiplier, lock.score, ranged.releaseQuality].every(Number.isFinite)).toBe(true);
  });

  it('keeps visual, collider and ground contracts explicit', () => {
    const hitbox = buildPlayerHitboxHurtboxContract(longswordShieldPlate, {
      grounded: true,
      attackKind: 'heavy',
      stance: 'neutral',
    });
    expect(hitbox.hurtbox.shape).toBe('capsule');
    expect(hitbox.hitbox.shape).toBe('arc');
    expect(hitbox.separation.visualColliderParityRequired).toBe(true);
    expect(hitbox.separation.groundedContactRequired).toBe(true);
    expect(hitbox.separation.maxVerticalPenetrationMeters).toBeLessThan(0.05);
  });

  it('fails closed on malformed equipment runtime input', () => {
    const result = validatePlayerEquipmentRuntimeInput({
      equipment: { mainHand: { id: 'bow' } },
      staminaRatio: Number.NaN,
      poiseRatio: Number.POSITIVE_INFINITY,
      grounded: true,
      lockOn: true,
      moving: false,
    });
    expect(result.ok).toBe(true);
    expect(result.ranged.ranged).toBe(true);
    expect(Number.isFinite(result.tuning.cost)).toBe(true);
    expect(Number.isFinite(result.dodge.staminaCost)).toBe(true);
  });
});
