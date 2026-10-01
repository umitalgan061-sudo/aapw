import assert from 'node:assert/strict';
import {
  buildPlayerCombatActionAffordances,
  serializePlayerCombatActionAffordances,
} from '../src/3d/gameplay/playerCombatActionAffordanceDirector.js';

const base = {
  snapshot: {
    alive: true,
    grounded: true,
    stamina: 40,
    staminaMax: 100,
    hasRangedWeapon: true,
  },
  requestedAction: 'heavyAttack',
};

const first = buildPlayerCombatActionAffordances(base);
const second = buildPlayerCombatActionAffordances(base);
assert.deepEqual(first, second, 'same input stays deterministic');
assert.equal(first.requestedAvailable, true, 'heavy attack is available with enough stamina');
assert.equal(first.requestedReason, null, 'available action has no rejection reason');
assert.equal(first.rows.find((row) => row.action === 'dodge').available, true, 'dodge is available while grounded');
assert.equal(first.rows.find((row) => row.action === 'rangedAim').available, true, 'ranged aim requires a ranged weapon');

const blocked = buildPlayerCombatActionAffordances({ snapshot: { alive: true, grounded: true, stamina: 5 }, requestedAction: 'heavyAttack' });
assert.equal(blocked.requestedAvailable, false, 'heavy attack is blocked by stamina');
assert.equal(blocked.requestedReason, 'insufficient-stamina');
assert.equal(blocked.rows.find((row) => row.action === 'rangedAim').reason, 'no-ranged-weapon');

const airborne = buildPlayerCombatActionAffordances({ snapshot: { grounded: false, stamina: 100 }, requestedAction: 'dodge' });
assert.equal(airborne.requestedReason, 'airborne');

const malformed = buildPlayerCombatActionAffordances({ snapshot: { stamina: Number.NaN, staminaMax: Infinity, attackCost: 'bad' }, requestedAction: 'lightAttack' });
assert.equal(malformed.requestedAvailable, false, 'malformed zero stamina fails closed');
assert.equal(malformed.requestedReason, 'no-stamina');
assert.equal(Object.isFrozen(malformed), true, 'plan is frozen');
assert.equal(Object.isFrozen(malformed.rows[0]), true, 'rows are frozen');
assert.equal(serializePlayerCombatActionAffordances(first), serializePlayerCombatActionAffordances(second), 'serialization is stable');

console.log('PASS: player combat action affordance assertions');
