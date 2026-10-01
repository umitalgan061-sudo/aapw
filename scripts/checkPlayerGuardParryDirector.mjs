import assert from 'node:assert/strict';
import { createPlayerGuardParryDirector, serializePlayerGuardParryFrame } from '../src/3d/gameplay/playerGuardParryDirector.js';

const base = {
  attackActive: true,
  attack: { id: 'sword-light', damage: 40, poiseDamage: 0.5 },
  attacker: { id: 'raider', faction: 'hostile' },
  defender: { id: 'player', faction: 'player', guarding: true, parry: true },
  elapsed: 0.08,
};

const parry = createPlayerGuardParryDirector(base);
assert.equal(parry.response, 'parry');
assert.equal(parry.critical, true);
assert.equal(parry.incomingDamage, 0);
assert(Object.isFrozen(parry));
assert(Object.isFrozen(parry.timing));

const block = createPlayerGuardParryDirector({ ...base, elapsed: 0.3, defender: { ...base.defender, parry: false } });
assert.equal(block.response, 'block');
assert.equal(block.incomingDamage, 8);
assert.equal(block.critical, false);

const hit = createPlayerGuardParryDirector({ ...base, defender: { id: 'player', faction: 'player', guarding: false, parry: false } });
assert.equal(hit.response, 'hit');
assert.equal(hit.incomingDamage, 40);

const inactive = createPlayerGuardParryDirector({ ...base, attackActive: false });
assert.equal(inactive.response, 'none');
assert.equal(inactive.reason, 'attack-inactive');

const malformed = createPlayerGuardParryDirector({ guarding: true, parry: true, elapsed: 'bad', incomingDamage: 'bad' });
assert.equal(malformed.response, 'hit');
assert(Number.isFinite(malformed.incomingDamage));

const a = serializePlayerGuardParryFrame(createPlayerGuardParryDirector(base));
const b = serializePlayerGuardParryFrame(createPlayerGuardParryDirector(base));
assert.equal(a, b);

console.log('player guard/parry director contract: PASS');
