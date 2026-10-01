import assert from 'node:assert/strict';
import { projectPlayerLockOn, serializePlayerLockOnProjection } from '../src/3d/gameplay/playerLockOnDirector.js';

const projection = projectPlayerLockOn({
  requested: true,
  currentTargetId: 'goblin-2',
  targets: [
    { id: 'goblin-1', distanceMeters: 6, angleDegrees: 18, visible: true, alive: true, priority: 0 },
    { id: 'goblin-2', distanceMeters: 9, angleDegrees: 7, visible: true, alive: true, priority: 1 },
    { id: 'goblin-3', distanceMeters: 3, angleDegrees: 80, visible: true, alive: true },
    { id: 'goblin-4', distanceMeters: 2, angleDegrees: 4, visible: false, alive: true },
  ],
});
assert.equal(projection.active, true);
assert.equal(projection.targetId, 'goblin-2');
assert.equal(projection.visibleCandidateCount, 3);
assert.ok(Object.isFrozen(projection));
assert.equal(serializePlayerLockOnProjection(projection), serializePlayerLockOnProjection(projection));

const noTarget = projectPlayerLockOn({ requested: true, targets: [{ id: 'far', distanceMeters: 100, angleDegrees: 0 }] });
assert.equal(noTarget.active, false);
assert.equal(noTarget.reason, 'no-valid-target');

const off = projectPlayerLockOn({ requested: false, targets: [{ id: 'near', distanceMeters: 1, angleDegrees: 0 }] });
assert.equal(off.active, false);
assert.equal(off.reason, 'not-requested');

const malformed = projectPlayerLockOn({ requested: true, maxDistanceMeters: 'bad', maxAngleDegrees: NaN, targets: null });
assert.equal(Number.isFinite(malformed.maxDistanceMeters), true);
assert.equal(Number.isFinite(malformed.maxAngleDegrees), true);
assert.equal(malformed.candidateCount, 0);

console.log('PASS: player lock-on director assertions');
