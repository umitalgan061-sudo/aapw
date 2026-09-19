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
assert.equal(Object.getPrototypeOf(accepted.frame), null);
assert.equal(Object.isFrozen(accepted.frame.attack), true);
assert.equal(Object.isFrozen(accepted.frame.attack.metadata), true);
assert.equal(Object.isFrozen(accepted.frame.feedback.payload), true);
assert.equal(guard.readLastFrame(), accepted.frame);

nested.feedback.payload.intensity = 1;
nested.attack.metadata.phase = 'active';
assert.equal(accepted.frame.feedback.payload.intensity, 0.4);
assert.equal(accepted.frame.attack.metadata.phase, 'windup');
assert.notEqual(accepted.frame, nested);

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
assert.equal(guard.readLastFrame(), cycleResult.frame);
assert.equal(guard.inspect({
  version: 1,
  revision: 1,
  timestamp: 0.016,
  attack: { serial: 1 },
}).reason, 'duplicate-frame');

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
assert.equal(guard.readLastFrame(), cycleResult.frame);

const followUp = guard.inspect({
  version: 1,
  revision: 1,
  timestamp: 0.016,
  attack: { serial: 2, metadata: { phase: 'active' } },
});
assert.equal(followUp.ok, true);
assert.equal(Object.isFrozen(followUp.frame), true);
assert.equal(guard.readLastFrame(), followUp.frame);
const acceptedCountAfterReplay = guard.readState().accepted;
assert.equal(acceptedCountAfterReplay, 3, 'three accepted frames must survive rejection probes');
assert.equal(guard.readState().rejected, 2);

assert.equal(guard.inspect({ version: '1', revision: 2, timestamp: 0.032, attack: { serial: 2 } }).reason, 'unsupported-version');
assert.equal(guard.inspect({ version: 1, revision: '2', timestamp: 0.032, attack: { serial: 2 } }).reason, 'invalid-revision');
assert.equal(guard.inspect({ version: 1, revision: 2, timestamp: '0.032', attack: { serial: 2 } }).reason, 'invalid-timestamp');
assert.equal(guard.inspect({ version: 1, revision: 2, timestamp: 0.032, attack: { serial: '2' } }).reason, 'invalid-attack-serial');

const deepGuard = createPlayerCombatRuntimeFrameGuard({ maxPayloadDepth: 1 });
const tooDeep = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 }, metadata: { nested: { value: true } } };
assert.equal(deepGuard.inspect(tooDeep).reason, 'payload-depth-exceeded');
const wideGuard = createPlayerCombatRuntimeFrameGuard({ maxPayloadNodes: 3 });
const tooWide = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 }, a: {}, b: {} };
assert.equal(wideGuard.inspect(tooWide).reason, 'payload-node-budget-exceeded');
const arrayGuard = createPlayerCombatRuntimeFrameGuard({ maxPayloadArrayLength: 2 });
const tooLong = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 }, feedback: { samples: [0, 1, 2] } };
assert.equal(arrayGuard.inspect(tooLong).reason, 'payload-array-length-exceeded');
assert.equal(arrayGuard.inspect(tooLong).frame, null);
const stringGuard = createPlayerCombatRuntimeFrameGuard({ maxPayloadStringLength: 3 });
const tooLongString = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 }, label: 'long' };
assert.equal(stringGuard.inspect(tooLongString).reason, 'payload-string-length-exceeded');
assert.equal(stringGuard.inspect(tooLongString).frame, null);
const totalStringGuard = createPlayerCombatRuntimeFrameGuard({ maxPayloadStringLength: 8, maxPayloadTotalStringLength: 5 });
const tooMuchText = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 }, labels: ['ab', 'cd', 'ef'] };
assert.equal(totalStringGuard.inspect(tooMuchText).reason, 'payload-total-string-length-exceeded');
assert.equal(totalStringGuard.inspect(tooMuchText).frame, null);
let getterExecuted = false;
const accessorFrame = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 } };
Object.defineProperty(accessorFrame, 'payload', { enumerable: true, get() { getterExecuted = true; throw new Error('getter should not execute'); } });
const accessorResult = createPlayerCombatRuntimeFrameGuard().inspect(accessorFrame);
assert.equal(accessorResult.reason, 'payload-accessor-unsupported');
assert.equal(accessorResult.frame, null);
assert.equal(getterExecuted, false);
const symbolFrame = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 } };
Object.defineProperty(symbolFrame, Symbol('payload'), { enumerable: true, value: 'hidden' });
const symbolResult = createPlayerCombatRuntimeFrameGuard().inspect(symbolFrame);
assert.equal(symbolResult.reason, 'payload-symbol-key-unsupported');
assert.equal(symbolResult.frame, null);
const hiddenSymbolFrame = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 } };
Object.defineProperty(hiddenSymbolFrame, Symbol('hidden-payload'), { enumerable: false, value: 'hidden' });
const hiddenSymbolResult = createPlayerCombatRuntimeFrameGuard().inspect(hiddenSymbolFrame);
assert.equal(hiddenSymbolResult.reason, 'payload-symbol-key-unsupported');
assert.equal(hiddenSymbolResult.frame, null);
const sparseFrame = { version: 1, revision: 1, timestamp: 0.016, attack: { serial: 1 }, payload: [] };
sparseFrame.payload.length = 4;
sparseFrame.payload[2] = 'sample';
const sparseResult = createPlayerCombatRuntimeFrameGuard().inspect(sparseFrame);
assert.equal(sparseResult.ok, true);
assert.equal(sparseResult.frame.payload.length, 4);
assert.equal(2 in sparseResult.frame.payload, true);
assert.equal(1 in sparseResult.frame.payload, false);

let descriptorReads = 0;
const unstableTarget = { version: 1, revision: 3, timestamp: 0.032, attack: { serial: 3 } };
const unstableProxy = new Proxy(unstableTarget, {
  ownKeys(target) {
    descriptorReads += 1;
    if (descriptorReads >= 2) throw new Error('descriptor changed during rejection clone');
    return Reflect.ownKeys(target);
  },
});
const unstableResult = createPlayerCombatRuntimeFrameGuard().inspect(unstableProxy);
assert.equal(unstableResult.reason, 'payload-inspection-failed');
assert.equal(unstableResult.frame, null);
assert.equal(descriptorReads, 2);

let coreReadCount = 0;
const unstableCoreTarget = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 }, payload: { label: 'stable' } };
const unstableCoreProxy = new Proxy(unstableCoreTarget, {
  get(target, property, receiver) {
    if (property === 'revision') {
      coreReadCount += 1;
      if (coreReadCount >= 2) return 1;
    }
    return Reflect.get(target, property, receiver);
  },
});
const unstableCoreGuard = createPlayerCombatRuntimeFrameGuard();
const unstableCoreResult = unstableCoreGuard.inspect(unstableCoreProxy);
assert.equal(unstableCoreResult.reason, 'payload-clone-unstable');
assert.equal(unstableCoreGuard.readState().accepted, 0);
assert.equal(unstableCoreGuard.readLastFrame(), null);

assert.throws(() => createPlayerCombatRuntimeFrameGuard({ maxPayloadDepth: -1 }), /maxPayloadDepth/);
assert.throws(() => createPlayerCombatRuntimeFrameGuard({ maxPayloadNodes: 0 }), /maxPayloadNodes/);
assert.throws(() => createPlayerCombatRuntimeFrameGuard({ maxPayloadArrayLength: 0 }), /maxPayloadArrayLength/);
assert.throws(() => createPlayerCombatRuntimeFrameGuard({ maxPayloadTotalStringLength: 0 }), /maxPayloadTotalStringLength/);

const disposed = guard.dispose();
assert.equal(disposed.disposed, true);
assert.equal(disposed.last, null);
assert.equal(guard.readLastFrame(), null);
assert.equal(guard.readState().last, null);
assert.equal(guard.reset().last, null);
assert.equal(guard.readLastFrame(), null);

console.log('player combat runtime frame guard immutability: 75 checks passed');
