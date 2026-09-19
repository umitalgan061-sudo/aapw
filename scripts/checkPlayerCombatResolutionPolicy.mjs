import assert from 'node:assert/strict';
import {
  createPlayerCombatResolutionPolicy,
  resolvePlayerCombatResolution,
  validatePlayerCombatResolution,
} from '../src/3d/gameplay/playerCombatResolutionPolicy.js';

const input = {
  equipmentProfile: { damageMultiplier: 1.2, poiseMultiplier: 1.1, guardDamageMultiplier: 0.5, staminaMultiplier: 1.05 },
  contacts: [
    { id: 'b', outcome: 'guard', damage: 20, poise: 10, stamina: 12, sequence: 2, distance: 2 },
    { id: 'a', outcome: 'hit', damage: 30, poise: 8, stamina: 0, sequence: 1, distance: 1 },
    { id: 'c', outcome: 'perfect-guard', damage: 9, poise: 3, stamina: 8, sequence: 3, distance: 1 },
  ],
};

const first = resolvePlayerCombatResolution(input);
const second = resolvePlayerCombatResolution(input);
assert.deepEqual(first, second);
assert.equal(validatePlayerCombatResolution(first), true);
assert.deepEqual(first.events.map((event) => event.id), ['a', 'b', 'c']);
assert.equal(first.events[0].resolvedDamage, 36);
assert.equal(first.events[1].resolvedDamage, 12);
assert.equal(first.events[2].resolvedDamage, 0);
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(first.events[0]));

const policy = createPlayerCombatResolutionPolicy({ maxHistory: 2 });
assert.equal(policy.resolve(input).serial, 1);
assert.equal(policy.resolve({ contacts: [{ id: 'miss', outcome: 'missed', damage: 100 }] }).serial, 2);
assert.equal(policy.snapshot().history.length, 2);
policy.dispose();
assert.equal(policy.resolve(input), null);
assert.equal(policy.snapshot().history.length, 0);
console.log('PASS playerCombatResolutionPolicy deterministic contract');
