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
assert.equal(guard.readState().accepted, 3);
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
const accessorFrame = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 } };
Object.defineProperty(accessorFrame, 'payload', { enumerable: true, get() { throw new Error('getter should not execute'); } });
assert.equal(createPlayerCombatRuntimeFrameGuard().inspect(accessorFrame).reason, 'payload-accessor-unsupported');
const symbolFrame = { version: 1, revision: 0, timestamp: 0, attack: { serial: 0 } };
Object.defineProperty(symbolFrame, Symbol('payload'), { enumerable: true, value: 'hidden' });
assert.equal(createPlayerCombatRuntimeFrameGuard().inspect(symbolFrame).reason, 'payload-symbol-key-unsupported');
const sparseFrame = { version: 1, revision: 1, timestamp: 0.016, attack: { serial: 1 }, payload: [] };
sparseFrame.payload.length = 4;
sparseFrame.payload[2] = 'sample';
const sparseResult = createPlayerCombatRuntimeFrameGuard().inspect(sparseFrame);
assert.equal(sparseResult.ok, true);
assert.equal(sparseResult.frame.payload.length, 4);
assert.equal(2 in sparseResult.frame.payload, true);
assert.equal(1 in sparseResult.frame.payload, false);
assert.throws(() => createPlayerCombatRuntimeFrameGuard({ maxPayloadDepth: -1 }), /maxPayloadDepth/);
assert.throws(() => createPlayerCombatRuntimeFrameGuard({ maxPayloadNodes: 0 }), /maxPayloadNodes/);
assert.throws(() => createPlayerCombatRuntimeFrameGuard({ maxPayloadArrayLength: 0 }), /maxPayloadArrayLength/);

const disposed = guard.dispose();
assert.equal(disposed.disposed, true);
assert.equal(disposed.last, null);
assert.equal(guard.readLastFrame(), null);
assert.equal(guard.readState().last, null);
assert.equal(guard.reset().last, null);
assert.equal(guard.readLastFrame(), null);

console.log('player combat runtime frame guard immutability: 51 checks passed');
