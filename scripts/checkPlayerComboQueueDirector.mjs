import assert from 'node:assert/strict';
import { resolvePlayerComboQueue, serializePlayerComboQueue } from '../src/3d/gameplay/playerComboQueueDirector.js';

const base = { currentAction: 'light', comboIndex: 0, phaseProgress: 0.72, queueWindowOpen: true, queue: ['heavy', 'light'] };
const first = resolvePlayerComboQueue(base);
const second = resolvePlayerComboQueue(base);
assert.deepEqual(first, second);
assert.equal(first.accepted, true);
assert.equal(first.nextAction, 'heavy');
assert.deepEqual(first.remainingQueue, ['light']);
assert.equal(first.nextComboIndex, 1);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.remainingQueue), true);

const closed = resolvePlayerComboQueue({ ...base, phaseProgress: 0.2, queueWindowOpen: false });
assert.equal(closed.accepted, false);
assert.equal(closed.resetReason, 'window-closed');

const dead = resolvePlayerComboQueue({ ...base, dead: true });
assert.equal(dead.accepted, false);
assert.equal(dead.resetReason, 'dead');

const malformed = resolvePlayerComboQueue({ queue: ['light', 'invalid', 4], comboIndex: 'bad', phaseProgress: 'bad' });
assert.deepEqual(malformed.queue, ['light']);
assert.equal(malformed.comboIndex, 0);
assert.equal(malformed.phaseProgress, 0);
assert.equal(malformed.accepted, false);

assert.equal(serializePlayerComboQueue(base), serializePlayerComboQueue(base));
console.log('player combo queue director: PASS');
