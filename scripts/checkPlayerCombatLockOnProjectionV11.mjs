import assert from 'node:assert/strict';
import { projectPlayerCombatLockOn } from '../src/3d/gameplay/playerCombatLockOnProjectionV11.js';
const input = { player: { position: { x: 0, z: 0 }, forward: { x: 0, z: 1 } }, lockedTargetId: 'far', targets: [{ id: 'far', position: { x: 0, z: 8 } }, { id: 'near', position: { x: 0, z: 4 } }, { id: 'side', position: { x: 8, z: 0 } }] };
const first = projectPlayerCombatLockOn(input); assert.equal(first.selectedTargetId, 'far'); assert.equal(first.retainedLock, true); assert.ok(Object.isFrozen(first.candidates[0]));
const repeat = projectPlayerCombatLockOn({ ...input, targets: [...input.targets].reverse() }); assert.equal(repeat.digest, first.digest);
const blocked = projectPlayerCombatLockOn({ ...input, targets: [{ id: 'dead', position: { x: 0, z: 2 }, isAlive: false }] }); assert.equal(blocked.selectedTargetId, null);
console.log('player combat lock-on projection: PASS');
