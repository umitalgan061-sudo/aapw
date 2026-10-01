import assert from 'node:assert/strict';
import { resolvePlayerCombatStanceIntent, isPlayerCombatStanceIntent } from '../src/3d/gameplay/playerCombatStanceIntent.ts';

const profile = { mainHand: { id: 'sword', damageMultiplier: 1, reachMultiplier: 1, poiseMultiplier: 1, projectile: false }, armor: { staminaDrainMultiplier: 1, dodgeDistanceMultiplier: 1, movementMultiplier: 1, poiseBonus: 0 }, shieldEquipped: false, ranged: false, twoHanded: false, effectiveGuardMultiplier: 0.7, sourceIds: { head: 'h', chest: 'c', back: 'b', mainHand: 'm', offHand: 'o' } };

const guard = resolvePlayerCombatStanceIntent(profile, { stance: 'guard', guardInput: true, staminaRatio: 0.9, grounded: true });
assert.equal(guard.decisions.canGuard, true);
assert.equal(isPlayerCombatStanceIntent(guard), true);
assert.equal(Object.isFrozen(guard), true);

const airborne = resolvePlayerCombatStanceIntent(profile, { stance: 'attack', attackKind: 'heavy', grounded: false, staminaRatio: 1 });
assert.equal(airborne.decisions.canAttack, false);
assert.equal(airborne.grounded, false);

const replayA = resolvePlayerCombatStanceIntent(profile, { stance: 'dodge', grounded: true, staminaRatio: 0.8 });
const replayB = resolvePlayerCombatStanceIntent(profile, { stance: 'dodge', grounded: true, staminaRatio: 0.8 });
assert.deepEqual(replayA, replayB);

const tampered = { ...guard, stanceKey: `${guard.stanceKey}|tampered` };
assert.equal(isPlayerCombatStanceIntent(tampered), false);

const rangedProfile = { ...profile, ranged: true, twoHanded: true, mainHand: { ...profile.mainHand, projectile: true } };
const ranged = resolvePlayerCombatStanceIntent(rangedProfile, { stance: 'ranged', grounded: true, moving: false, staminaRatio: 0.95 });
assert.equal(ranged.decisions.canAim, true);
assert.equal(ranged.ranged.projectile, true);

console.log('player combat stance intent proof: PASS');
