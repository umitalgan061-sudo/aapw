import assert from 'node:assert/strict';
import { resolvePlayerCombatResourceBudget, isPlayerCombatResourceBudget } from '../src/3d/gameplay/playerCombatResourceBudget.ts';

const profile = { mainHand: { id: 'sword', family: 'sword', damageMultiplier: 1, reachMultiplier: 1, poiseMultiplier: 1, projectile: false }, armor: { movementMultiplier: 1, staminaDrainMultiplier: 1, dodgeDistanceMultiplier: 1, poiseBonus: 0 }, shieldEquipped: false, ranged: false, twoHanded: false, effectiveGuardMultiplier: 0.8, sourceIds: { head: 'h', chest: 'c', back: 'b', mainHand: 'sword', offHand: 'o' } };

const light = resolvePlayerCombatResourceBudget(profile, { action: 'light', staminaRatio: 1, poiseRatio: 1 });
assert.equal(light.allowed, true);
assert.equal(isPlayerCombatResourceBudget(light), true);
assert.equal(light.replayKey, resolvePlayerCombatResourceBudget(profile, { action: 'light', staminaRatio: 1, poiseRatio: 1 }).replayKey);

const airborne = resolvePlayerCombatResourceBudget(profile, { action: 'dodge', grounded: false, staminaRatio: 1 });
assert.equal(airborne.allowed, false);
assert.equal(airborne.reason, 'airborne');

const busy = resolvePlayerCombatResourceBudget(profile, { action: 'heavy', attackBusy: true, staminaRatio: 1 });
assert.equal(busy.allowed, false);
assert.equal(busy.reason, 'attack-busy');

const tampered = { ...light, replayKey: 'tampered' };
assert.equal(isPlayerCombatResourceBudget(tampered), false);
assert.equal(Object.isFrozen(light), true);
console.log('player combat resource budget proof: PASS');
