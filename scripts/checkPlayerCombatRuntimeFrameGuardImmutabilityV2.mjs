import assert from 'node:assert/strict';
import { createPlayerCombatRuntimeFrameGuard } from '../src/3d/gameplay/playerCombatRuntimeFrameGuard.js';

const guard = createPlayerCombatRuntimeFrameGuard();
const accepted = guard.inspect({
  version: 1,
  revision: 0,
  timestamp: 0,
  attack: { serial: 0, metadata: { phase: 'windup' } },
  feedback: { payload: { intensity: 0.4 } },
});
assert.equal(accepted.ok, true);
assert.equal(Object.isFrozen(accepted.frame), true);
assert.equal(Object.getPrototypeOf(accepted.frame), null);
assert.equal(Object.isFrozen(accepted.frame.attack.metadata), true);
assert.equal(Object.isFrozen(accepted.frame.feedback.payload), true);
assert.equal(guard.readLastFrame(), accepted.frame);

const cycle = { label: 'cycle' };
cycle.self = cycle;
const cycleResult = guard.inspect({
  version: 1,
  revision: 1,
  timestamp: 0.016,
  attack: { serial: 1 },
  metadata: cycle,
});
assert.equal(cycleResult.ok, true);
assert.equal(cycleResult.frame.metadata.self, cycleResult.frame.metadata);
assert.equal(Object.isFrozen(cycleResult.frame.metadata), true);
assert.equal(guard.inspect({ version: 1, revision: 1, timestamp: 0.016, attack: { serial: 1 } }).reason, 'duplicate-frame');

const rejected = guard.inspect({ version: 1, revision: 3, timestamp: 0.032, attack: { serial: 3 }, feedback: { payload: { intensity: 0.9 } } });
assert.equal(rejected.reason, 'revision-gap');
assert.equal(rejected.frame.feedback.payload.intensity, 0.9);
assert.equal(guard.readLastFrame(), cycleResult.frame);

const followUp = guard.inspect({ version: 1, revision: 1, timestamp: 0.016, attack: { serial: 2, metadata: { phase: 'active' } } });
assert.equal(followUp.ok, true);
const replayState = guard.readState();
assert.equal(replayState.accepted, 3, 'three accepted frames must survive rejection probes');
assert.equal(replayState.rejected, 2);
assert.equal(guard.readLastFrame().attack.serial, 2);

let getterExecuted = false;
const accessorFrame = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 } };
Object.defineProperty(accessorFrame, 'payload', { enumerable: false, get() { getterExecuted = true; throw new Error('getter must not execute'); } });
const accessorResult = createPlayerCombatRuntimeFrameGuard().inspect(accessorFrame);
assert.equal(accessorResult.reason, 'payload-accessor-unsupported');
assert.equal(accessorResult.frame, null);
assert.equal(getterExecuted, false);

const symbolFrame = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 }, feedback: { payload: {} } };
Object.defineProperty(symbolFrame.feedback.payload, Symbol('hidden'), { enumerable: false, value: true });
assert.equal(createPlayerCombatRuntimeFrameGuard().inspect(symbolFrame).reason, 'payload-symbol-key-unsupported');

const sparseFrame = { version: 1, revision: 1, timestamp: 0.016, attack: { serial: 1 }, payload: [] };
sparseFrame.payload.length = 4;
sparseFrame.payload[2] = 'sample';
const sparseResult = createPlayerCombatRuntimeFrameGuard().inspect(sparseFrame);
assert.equal(sparseResult.ok, true);
assert.equal(sparseResult.frame.payload.length, 4);
assert.equal(2 in sparseResult.frame.payload, true);
assert.equal(1 in sparseResult.frame.payload, false);

let rejectionReads = 0;
const unstableRejection = new Proxy({ version: 1, revision: 3, timestamp: 0.032, attack: { serial: 3 } }, {
  ownKeys(target) {
    rejectionReads += 1;
    if (rejectionReads >= 2) throw new Error('descriptor changed during rejection clone');
    return Reflect.ownKeys(target);
  },
});
const rejectionResult = createPlayerCombatRuntimeFrameGuard().inspect(unstableRejection);
assert.equal(rejectionResult.reason, 'payload-inspection-failed');
assert.equal(rejectionResult.frame, null);
assert.equal(rejectionReads, 2);

let revisionDescriptorReads = 0;
const unstableAcceptedTarget = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 }, payload: { label: 'stable' } };
Object.defineProperty(unstableAcceptedTarget, 'revision', { value: 0, writable: true, enumerable: true, configurable: true });
const unstableAcceptedProxy = new Proxy(unstableAcceptedTarget, {
  getOwnPropertyDescriptor(target, property) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
    if (property === 'revision') {
      revisionDescriptorReads += 1;
      if (revisionDescriptorReads >= 2) return { ...descriptor, value: 1 };
    }
    return descriptor;
  },
});
const unstableAcceptedGuard = createPlayerCombatRuntimeFrameGuard();
const unstableAcceptedResult = unstableAcceptedGuard.inspect(unstableAcceptedProxy);
assert.equal(unstableAcceptedResult.reason, 'payload-clone-unstable');
assert.equal(unstableAcceptedGuard.readState().accepted, 0);
assert.equal(unstableAcceptedGuard.readLastFrame(), null);

const disposed = guard.dispose();
assert.equal(disposed.disposed, true);
assert.equal(disposed.last, null);
assert.equal(guard.readLastFrame(), null);
assert.equal(guard.reset().last, null);

console.log('player combat runtime frame guard immutability v2: 31 checks passed');
