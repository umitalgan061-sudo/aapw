import assert from 'node:assert/strict';
import { createPlayerCombatActionBuffer, validatePlayerCombatActionBufferSnapshot } from '../src/3d/gameplay/playerCombatActionBuffer.js';

const make = () => createPlayerCombatActionBuffer({ maxQueue: 3, now: () => 42 });
const buffer = make();
const first = buffer.push({ action: 'light', source: 'keyboard', sequence: 1 });
assert.equal(first.reason, 'accepted');
assert.equal(first.actions[0].pressedAt, 42);
assert.equal(first.actions[0].source, 'keyboard');
const second = buffer.push({ action: 'heavy', source: 'gamepad', sequence: 2, pressedAt: 43 });
const third = buffer.push({ action: 'dodge', source: 'touch', sequence: 3, pressedAt: 44 });
assert.deepEqual(second.actions.map((entry) => entry.action), ['heavy', 'light']);
assert.deepEqual(third.actions.map((entry) => entry.action), ['heavy', 'dodge', 'light']);
assert.equal(buffer.push({ action: 'parry', sequence: 2 }).reason, 'rejected-sequence');
assert.deepEqual(buffer.drain(2).map((entry) => entry.action), ['heavy', 'dodge']);
assert.equal(buffer.inspect().size, 1);
assert.equal(validatePlayerCombatActionBufferSnapshot(buffer.inspect()), true);
const disposed = buffer.dispose();
assert.equal(disposed.disposed, true);
assert.equal(buffer.push({ action: 'archery', sequence: 4 }).reason, 'disposed');
assert.deepEqual(buffer.drain(), []);

const replay = () => {
  const instance = make();
  instance.push({ action: 'heavy', source: 'mouse', sequence: 1, pressedAt: 9 });
  instance.push({ action: 'light', source: 'keyboard', sequence: 2, pressedAt: 10 });
  instance.push({ action: 'lock-on', source: 'gamepad', sequence: 3, pressedAt: 11, targetId: 'Enemy 01' });
  return instance.inspect();
};
assert.deepEqual(replay(), replay());
assert.equal(Object.isFrozen(replay()), true);
assert.equal(Object.isFrozen(replay().actions), true);
console.log('player combat action buffer: PASS');
