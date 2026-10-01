import assert from 'node:assert/strict';
import { projectResourceBudget, stableSerializeResourceBudget } from '../src/3d/gameplay/playerResourceBudgetDirector.js';

const healthy = projectResourceBudget({ maxHealth: 120, health: 90, maxStamina: 80, stamina: 40, maxPoise: 60, poise: 30 });
assert.equal(healthy.affordance.canAttack, true);
assert.equal(healthy.affordance.canDodge, true);
assert.equal(healthy.state.exhausted, false);

const exhausted = projectResourceBudget({ maxStamina: 80, stamina: 0, attacking: false, guard: false });
assert.equal(exhausted.state.exhausted, true);
assert.equal(exhausted.affordance.canSprint, false);
assert.equal(exhausted.affordance.canDodge, false);

const guard = projectResourceBudget({ stamina: 70, maxStamina: 100, guard: true, poise: 20, maxPoise: 100 });
assert.equal(guard.affordance.canSprint, false);
assert.equal(guard.recovery.staminaPerSecond, 4.5);
assert.equal(guard.recovery.poisePerSecond, 6);

const malformed = projectResourceBudget({ health: 'nope', stamina: Infinity, poise: NaN, maxHealth: 0, maxStamina: -2, maxPoise: null });
assert.equal(malformed.evidence.bounded, true);
for (const value of Object.values(malformed.resources)) assert.equal(Number.isFinite(value), true);
assert.equal(Object.isFrozen(malformed), true);
assert.equal(stableSerializeResourceBudget(healthy), stableSerializeResourceBudget(projectResourceBudget({ maxHealth: 120, health: 90, maxStamina: 80, stamina: 40, maxPoise: 60, poise: 30 })));
console.log('playerResourceBudgetDirector: PASS');
