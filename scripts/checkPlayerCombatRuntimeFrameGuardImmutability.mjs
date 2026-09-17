import assert from 'node:assert/strict';
import { createPlayerCombatRuntimeFrameGuard } from '../src/3d/gameplay/playerCombatRuntimeFrameGuard.js';

const nested = {
  version: 1,
  revision: 0,
  timestamp: 0,
  attack: { serial: 0, metadata: { phase: 'windup' } },
  feedback: { kind: 'light', payload: { intensity: 0.4 } },
};

const guard = createPlayerCombatRuntimeFrameGuard();
const accepted = guard.inspect(nested);
assert.equal(accepted.ok, true);
assert.equal(Object.isFrozen(accepted), true);
assert.equal(Object.isFrozen(accepted.frame), true);
assert.equal(Object.isFrozen(accepted.frame.attack), true);
assert.equal(Object.isFrozen(accepted.frame.attack.metadata), true);
assert.equal(Object.isFrozen(accepted.frame.feedback.payload), true);

nested.feedback.payload.intensity = 1;
nested.attack.metadata.phase = 'active';
assert.equal(accepted.frame.feedback.payload.intensity, 0.4);
assert.equal(accepted.frame.attack.metadata.phase, 'windup');
assert.notEqual(accepted.frame, nested);

const rejectedInput = {
  version: 1,
  revision: 3,
  timestamp: 0.032,
  attack: { serial: 3 },
  feedback: { payload: { intensity: 0.9 } },
};
const rejected = guard.inspect(rejectedInput);
assert.equal(rejected.reason, 'revision-gap');
assert.equal(Object.isFrozen(rejected), true);
assert.equal(Object.isFrozen(rejected.frame), true);
assert.equal(Object.isFrozen(rejected.frame.feedback.payload), true);
rejectedInput.feedback.payload.intensity = 0.1;
assert.equal(rejected.frame.feedback.payload.intensity, 0.9);

const followUp = guard.inspect({
  version: 1,
  revision: 1,
  timestamp: 0.016,
  attack: { serial: 1, metadata: { phase: 'active' } },
});
assert.equal(followUp.ok, true);
assert.equal(Object.isFrozen(followUp.frame), true);
assert.equal(guard.readState().accepted, 2);
assert.equal(guard.readState().rejected, 1);

console.log('player combat runtime frame guard immutability: 16 checks passed');
