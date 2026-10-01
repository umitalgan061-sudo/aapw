import assert from 'node:assert/strict';
import { createPlayerHitboxHurtboxContract, validatePlayerHitboxHurtboxContract } from '../src/3d/gameplay/playerHitboxHurtboxContract.js';

const observation = {
  playerId: 'hero',
  attack: { active: true, phase: 'active', reach: 2.1, serial: 7 },
  volumes: [
    { id: 'torso', kind: 'hurtbox', bone: 'mixamorigSpine', radius: 0.5, height: 1.4 },
    { id: 'blade', kind: 'hitbox', tag: 'weapon', bone: 'mixamorigRightHand', radius: 0.14, height: 0.8, reach: 2.1, priority: 3 },
    { id: 'disabled', kind: 'hitbox', enabled: false, radius: 99 },
  ],
};

const first = createPlayerHitboxHurtboxContract(observation);
const second = createPlayerHitboxHurtboxContract({ ...observation, volumes: [...observation.volumes].reverse() });
assert.deepEqual(first, second);
assert.equal(first.resolution.accepted, true);
assert.equal(first.counts.hitboxes, 1);
assert.equal(first.counts.hurtboxes, 1);
assert.equal(validatePlayerHitboxHurtboxContract(first).valid, true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.hitboxes[0]), true);

const inactive = createPlayerHitboxHurtboxContract({ volumes: observation.volumes, attack: { active: false, reach: 2 } });
assert.equal(inactive.resolution.accepted, false);
assert.equal(inactive.resolution.rejectedReason, 'attack-inactive');

const malformed = createPlayerHitboxHurtboxContract(null);
assert.equal(malformed.resolution.accepted, false);
assert.equal(malformed.counts.total, 0);
console.log('player hitbox/hurtbox contract: PASS');
