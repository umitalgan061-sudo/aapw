import assert from 'node:assert/strict';
import { resolvePlayerCombatActionExecutionPlan, validatePlayerCombatActionExecutionPlan } from '../src/3d/gameplay/playerCombatActionExecutionPlan.js';

const base = { mainHand: { id: 'sword', type: 'sword' }, armor: { chest: { id: 'leather' } } };
const light = resolvePlayerCombatActionExecutionPlan(base, { action: 'light', staminaRatio: 1, grounded: true, targetDistanceMeters: 1.4, targetAngleRad: 0.2, targetAlive: true, targetVisible: true, lockOn: true });
assert.equal(light.allowed, true);
assert.equal(light.execution, 'melee');
assert.equal(light.staminaCost, 12);
assert.equal(validatePlayerCombatActionExecutionPlan(light).ok, true);

const rejected = resolvePlayerCombatActionExecutionPlan(base, { action: 'heavy', staminaRatio: 0, attackBusy: false, grounded: true });
assert.equal(rejected.allowed, false);
assert.ok(rejected.reasons.includes('stamina-exhausted'));
assert.equal(rejected.staminaCost, 0);

const guard = resolvePlayerCombatActionExecutionPlan(base, { action: 'guard', staminaRatio: 0.5, grounded: true });
assert.equal(guard.action, 'block');
assert.equal(guard.execution, 'defense');

const parryClosed = resolvePlayerCombatActionExecutionPlan(base, { action: 'parry', staminaRatio: 1, parryWindowOpen: false });
assert.equal(parryClosed.allowed, false);
assert.ok(parryClosed.reasons.includes('parry-window-closed'));

const dodge = resolvePlayerCombatActionExecutionPlan(base, { action: 'dodge', staminaRatio: 1, grounded: true, attackBusy: false });
assert.equal(dodge.allowed, true);
assert.equal(dodge.execution, 'evade');

const ranged = resolvePlayerCombatActionExecutionPlan({ mainHand: { id: 'bow', type: 'bow' } }, { action: 'archery', staminaRatio: 1, moving: false, lockOn: false });
assert.equal(ranged.execution, 'projectile');
assert.equal(ranged.allowed, true);

const stableA = JSON.stringify(resolvePlayerCombatActionExecutionPlan(base, { action: 'light', staminaRatio: 0.75, targetDistanceMeters: 1.2, targetAngleRad: 0.1, lockOn: true }));
const stableB = JSON.stringify(resolvePlayerCombatActionExecutionPlan(base, { action: 'light', staminaRatio: 0.75, targetDistanceMeters: 1.2, targetAngleRad: 0.1, lockOn: true }));
assert.equal(stableA, stableB);
assert.equal(Object.isFrozen(light), true);
assert.equal(Object.isFrozen(light.reasons), true);

console.log('playerCombatActionExecutionPlan: ok');
