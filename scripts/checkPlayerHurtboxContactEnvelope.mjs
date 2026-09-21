import assert from 'node:assert/strict';
import { createPlayerHurtboxContactEnvelope, validatePlayerHurtboxContactEnvelope } from '../src/3d/gameplay/playerHurtboxContactEnvelope.js';

const input = {
  source: 'runtime-hit-test',
  active: true,
  contacts: [
    { contactId: 'zeta', attackerId: 'enemy-2', targetId: 'player', kind: 'hit', phase: 'active', distance: 2, angle: 15, damage: 12, poiseDamage: 7, socket: 'chest', point: { x: 1, y: 0.8, z: -2 } },
    { contactId: 'alpha', attackerId: 'enemy-1', targetId: 'player', kind: 'guarded', phase: 'active', distance: 1, angle: -5, damage: 40, poiseDamage: 10, socket: 'shield', point: { x: 0, y: 1, z: 0 } },
    { contactId: 'beta', attackerId: 'enemy-3', targetId: 'player', kind: 'parried', phase: 'recovery', distance: 0.5, angle: 2, damage: 100, poiseDamage: 100 },
  ],
};

const run = () => {
  const envelope = createPlayerHurtboxContactEnvelope({ maxContacts: 8 });
  const first = envelope.build(input);
  const second = envelope.build(input);
  assert.deepEqual(second.contacts.map((contact) => contact.contactId), ['beta', 'alpha', 'zeta']);
  assert.equal(first.totals.hit, 1);
  assert.equal(first.totals.guarded, 1);
  assert.equal(first.totals.parried, 1);
  assert.equal(first.totals.damage, 12);
  assert.equal(first.totals.poiseDamage, 17);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.contacts[0]), true);
  assert.deepEqual(validatePlayerHurtboxContactEnvelope(first), { ok: true, contactCount: 3, serial: 1 });
  assert.deepEqual(first, { ...first, serial: 1 });
  envelope.dispose();
  assert.equal(envelope.build(input), null);
  assert.equal(envelope.snapshot().disposed, true);
  return { first, second };
};

const a = run();
const b = run();
assert.deepEqual(a, b, 'replay must be deterministic');
console.log('[player-hurtbox-contact-envelope] PASS deterministic replay, ordering, totals, immutability, validation, disposal');
