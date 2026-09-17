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
assert.equal(Object.isFrozen(accepted.frame), false);

nested.feedback.payload.intensity = 1;
assert.equal(accepted.frame.feedback.payload.intensity, 1);

const followUp = guard.inspect({
  version: 1,
  revision: 1,
  timestamp: 0.016,
  attack: { serial: 1, metadata: { phase: 'active' } },
});
assert.equal(followUp.ok, true);
assert.equal(guard.readState().accepted, 2);

console.log('player combat runtime frame guard immutability baseline: 6 checks passed');
