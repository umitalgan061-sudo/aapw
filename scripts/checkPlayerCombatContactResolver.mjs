import assert from 'node:assert/strict';
import { resolveCombatContacts, serializeCombatContacts } from '../src/3d/gameplay/playerCombatContactResolver.js';

const input = {
  attack: { active: true, serial: 7, reachMeters: 2, comboStep: 2, damageScale: 1.4 },
  attacker: { x: 0, z: 0, facing: { x: 0, z: 1 } },
  targets: [
    { id: 'near', x: 0, z: 1.3, radiusMeters: 0.4, hostile: true },
    { id: 'side', x: 1.8, z: 0, radiusMeters: 0.4, hostile: true },
    { id: 'dead', x: 0, z: 1, active: false, hostile: true },
    { id: 'friendly', x: 0, z: 1, hostile: false },
  ],
};

const first = resolveCombatContacts(input);
const second = resolveCombatContacts(input);
assert.deepEqual(first, second);
assert.equal(first.hitCount, 1);
assert.equal(first.contacts[0].targetId, 'near');
assert.equal(first.contacts[0].comboStep, 2);
assert.equal(first.contacts[0].damageScale, 1.4);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.contacts), true);
assert.equal(serializeCombatContacts(first), serializeCombatContacts(second));

const inactive = resolveCombatContacts({ ...input, attack: { ...input.attack, active: false } });
assert.equal(inactive.hitCount, 0);

const malformed = resolveCombatContacts({ attack: { active: true, reachMeters: 'bad' }, attacker: {}, targets: 'bad' });
assert.equal(malformed.hitCount, 0);
assert.ok(Number.isFinite(malformed.attackSerial));

console.log('player combat contact resolver contract: PASS');
