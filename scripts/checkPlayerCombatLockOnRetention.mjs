import assert from 'node:assert/strict';
import { createPlayerCombatLockOnRetention, validatePlayerCombatLockOnRetention } from '../src/3d/gameplay/playerCombatLockOnRetention.js';

const actors = [
  { id: 'near', position: { x: 0, z: 5 }, priority: 1, isTargetable: true },
  { id: 'far', position: { x: 1, z: 9 }, priority: 0, isTargetable: true },
];
const director = createPlayerCombatLockOnRetention({ retentionFrames: 2 });
const first = director.step({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors });
assert.equal(first.lockedTargetId, 'near');
assert.equal(first.target.id, 'near');
assert.equal(validatePlayerCombatLockOnRetention(first), true);

const requested = director.step({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors, requestedTargetId: 'far' });
assert.equal(requested.lockedTargetId, 'far');

const missing = [{ id: 'far', position: { x: 1, z: 9 }, priority: 0, isTargetable: true }];
const retained = director.step({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors: missing });
assert.equal(retained.lockedTargetId, 'far');
assert.equal(retained.retained, false);

const empty = [];
const grace1 = director.step({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors: empty });
const grace2 = director.step({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors: empty });
const expired = director.step({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors: empty });
assert.equal(grace1.lockedTargetId, 'far');
assert.equal(grace2.lockedTargetId, 'far');
assert.equal(expired.lockedTargetId, null);

const disposed = director.step({ actors });
director.dispose();
assert.equal(director.step({ actors }).disposed, true);
assert.equal(director.snapshot().disposed, true);
assert.equal(disposed.disposed, false);

console.log('[checkPlayerCombatLockOnRetention] PASS');
