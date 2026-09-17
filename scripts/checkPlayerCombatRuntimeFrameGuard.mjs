import assert from 'node:assert/strict';
import { createPlayerCombatRuntimeFrameGuard } from '../src/3d/gameplay/playerCombatRuntimeFrameGuard.js';

const frame = (revision, timestamp, serial = 0) => ({
  version: 1,
  revision,
  timestamp,
  attack: { serial },
});

const guard = createPlayerCombatRuntimeFrameGuard();
assert.equal(guard.inspect(frame(0, 0)).ok, true);
assert.equal(guard.inspect(frame(1, 0.016, 1)).ok, true);
assert.equal(guard.inspect(frame(0, 0.032, 1)).reason, 'revision-regressed');
assert.equal(guard.inspect(frame(3, 0.048, 1)).reason, 'revision-gap');
assert.equal(guard.inspect(frame(2, -1, 1)).reason, 'timestamp-regressed');
assert.equal(guard.inspect(frame(2, 0.048, 0)).reason, 'attack-serial-regressed');
assert.equal(guard.readState().accepted, 2);
assert.equal(guard.readState().rejected, 4);

const reset = guard.reset();
assert.equal(reset.last, null);
assert.equal(guard.inspect(frame(0, 0)).ok, true);
assert.equal(guard.dispose().disposed, true);
assert.equal(guard.inspect(frame(1, 0.016)).reason, 'disposed');

assert.throws(() => createPlayerCombatRuntimeFrameGuard({ maxRevisionGap: -1 }), /maxRevisionGap/);
assert.throws(() => createPlayerCombatRuntimeFrameGuard({ maxTimestampRegression: 61 }), /maxTimestampRegression/);

console.log('player combat runtime frame guard: 12 checks passed');
