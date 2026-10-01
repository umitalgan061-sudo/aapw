import assert from 'node:assert/strict';
import { createPlayerCombatIntentQueue, validatePlayerCombatIntentQueue } from '../src/3d/gameplay/playerCombatIntentQueue.js';

const queue = createPlayerCombatIntentQueue({ capacity: 2 });
assert.equal(validatePlayerCombatIntentQueue(queue), true);
assert.equal(queue.push({ action: 'lightAttack', source: 'keyboard', pressed: true, strength: 2 }), true);
assert.equal(queue.push({ action: 'dodge', source: 'touch', held: true, strength: Number.NaN }), true);
assert.equal(queue.push({ action: 'none', source: 'gamepad', pressed: true }), false);
assert.equal(queue.size(), 2);
const peeked = queue.peek();
assert.equal(Object.isFrozen(peeked), true);
assert.equal(peeked[0].strength, 1);
assert.equal(peeked[1].strength, 0);
const drained = queue.drain(1);
assert.equal(drained.length, 1);
assert.equal(queue.size(), 1);
queue.clear();
assert.equal(queue.size(), 0);

const first = JSON.stringify(createPlayerCombatIntentQueue({ capacity: 2 }).peek());
const second = JSON.stringify(createPlayerCombatIntentQueue({ capacity: 2 }).peek());
assert.equal(first, second);
console.log('player combat intent queue regression: ok');
