import assert from 'node:assert/strict';
import { createPlayerCombatInputBuffer } from '../src/3d/gameplay/playerCombatInputBuffer.js';

let clock = 1000;
const buffer = createPlayerCombatInputBuffer({ now: () => clock, maxEntries: 3, windowMs: 100 });

assert.equal(buffer.enqueue('lightAttack', 'keyboard'), true);
clock += 10;
assert.equal(buffer.enqueue('heavy', 'gamepad', clock, { queuedDuring: 'attack' }), true);
assert.equal(buffer.enqueue('guard', 'touch'), true);
assert.equal(buffer.enqueue('invalid', 'touch'), false);
assert.deepEqual(buffer.peek().map((entry) => entry.kind), ['light', 'heavy', 'block']);

clock += 50;
const accepted = buffer.drain({ currentTime: clock, max: 2, accept: (entry) => entry.kind !== 'heavy' });
assert.deepEqual(accepted.map((entry) => entry.kind), ['light', 'block']);
assert.equal(buffer.peek().length, 0);

clock += 200;
assert.equal(buffer.enqueue('dodge', 'touch', clock - 150), true);
assert.equal(buffer.prune(clock), 0);
assert.equal(buffer.drain().length, 0);

buffer.enqueue('parry');
buffer.dispose();
assert.equal(buffer.enqueue('light'), false);
assert.equal(buffer.peek().length, 0);
assert.equal(buffer.drain().length, 0);

console.log('player combat input buffer contract: PASS');
