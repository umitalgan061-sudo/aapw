import assert from 'node:assert/strict';
import { projectPlayerCombatResources, serializePlayerCombatResources } from '../src/3d/gameplay/playerCombatResourceDirector.js';

const base = { alive: true, maxHealth: 100, health: 82, maxStamina: 100, stamina: 50, maxPoise: 60, poise: 24, rangedReady: true, requestedAction: 'heavy', staminaRecoveryRate: 8, poiseRecoveryRate: 4 };
const first = projectPlayerCombatResources(base);
const second = projectPlayerCombatResources({ ...base });
assert.equal(serializePlayerCombatResources(base), serializePlayerCombatResources({ ...base }));
assert.equal(first.selectedAction, 'heavy');
assert.equal(first.actions.find(row => row.action === 'heavy').allowed, true);
assert.equal(first.actions.find(row => row.action === 'dodge').allowed, true);
assert.equal(first.staminaRatio, 0.5);
assert.equal(first.poiseRatio, 0.4);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.actions[0]), true);
assert.deepEqual(first, second);

const blocked = projectPlayerCombatResources({ ...base, stamina: 5, requestedAction: 'heavy' });
assert.equal(blocked.selectedAction, null);
assert.equal(blocked.actions.find(row => row.action === 'heavy').reason, 'stamina');

const stunned = projectPlayerCombatResources({ ...base, stunned: true, requestedAction: 'light' });
assert.equal(stunned.canAct, false);
assert.equal(stunned.actions.every(row => row.allowed === false), true);

const ranged = projectPlayerCombatResources({ ...base, rangedReady: false, requestedAction: 'ranged' });
assert.equal(ranged.actions.find(row => row.action === 'ranged').reason, 'ranged-unready');

const malformed = projectPlayerCombatResources({ alive: true, maxHealth: 'x', health: Infinity, maxStamina: NaN, stamina: 20, maxPoise: 10, poise: 99, requestedAction: 'unknown' });
assert.equal(malformed.maxHealth, 0);
assert.equal(malformed.stamina, 0);
assert.equal(malformed.selectedAction, null);
assert.equal(Number.isFinite(malformed.poise), true);

console.log('player combat resource director: PASS');
