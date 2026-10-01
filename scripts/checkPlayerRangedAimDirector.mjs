import assert from 'node:assert/strict';
import {
  createPlayerRangedAimDirector,
  serializePlayerRangedAimDirector,
} from '../src/3d/gameplay/playerRangedAimDirector.js';

const aimed = createPlayerRangedAimDirector({ action: 'aim', charge: 0.8, stamina: 1, targetPoint: { x: 4, y: 2, z: -9 }, aimAssist: 0.7 });
assert.equal(aimed.phase, 'aim');
assert.equal(aimed.canAct, true);
assert.equal(aimed.targetLockRequested, true);
assert.equal(Object.isFrozen(aimed), true);

const released = createPlayerRangedAimDirector({ action: 'release', charge: 0.9 });
assert.equal(released.phase, 'release');
assert.equal(released.releaseReady, true);
assert.ok(released.staminaCost > 0);

const blocked = createPlayerRangedAimDirector({ action: 'release', charge: 1, hasAmmo: false });
assert.equal(blocked.canAct, false);
assert.equal(blocked.failClosedReason, 'no-ammo');
assert.equal(blocked.phase, 'idle');

const malformed = createPlayerRangedAimDirector({ progress: 'bad', charge: Infinity, stamina: NaN, cameraForward: { x: 0, y: 0, z: 0 } });
assert.equal(malformed.progress, 0);
assert.equal(malformed.charge, 0);
assert.deepEqual(malformed.direction, { x: 0, y: 0, z: -1 });
assert.equal(serializePlayerRangedAimDirector(aimed), serializePlayerRangedAimDirector(aimed));
console.log('player ranged aim director checks passed');
