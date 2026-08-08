import assert from 'node:assert/strict';

const { EventBus } = await import('../src/3d/eventBus.js');

const bus = new EventBus();
const received = [];

const offA = bus.on('tick', (payload) => received.push(['a', payload]));
const duplicateHandler = (payload) => received.push(['dup', payload]);
bus.on('tick', duplicateHandler);
bus.on('tick', duplicateHandler);

bus.emit('tick', { frame: 1 });
assert.deepEqual(received, [
	['a', { frame: 1 }],
	['dup', { frame: 1 }],
], 'Set-backed subscriptions must not duplicate the same handler');

offA();
received.length = 0;
bus.emit('tick', { frame: 2 });
assert.deepEqual(received, [['dup', { frame: 2 }]], 'unsubscribe function must remove only its handler');

let onceCount = 0;
let oncePayload = null;
bus.once('ready', (payload) => {
	onceCount += 1;
	oncePayload = payload;
});
bus.emit('ready', { phase: 'scene' });
bus.emit('ready', { phase: 'late-repeat' });
assert.equal(onceCount, 1, 'once handler must fire exactly once');
assert.deepEqual(oncePayload, { phase: 'scene' });

const isolation = [];
const originalConsoleError = console.error;
const loggedErrors = [];
console.error = (...args) => loggedErrors.push(args);
try {
	bus.on('fault', () => {
		throw new Error('synthetic listener failure');
	});
	bus.on('fault', (payload) => isolation.push(payload));
	assert.doesNotThrow(() => bus.emit('fault', 42), 'listener exceptions must not escape emit()');
} finally {
	console.error = originalConsoleError;
}
assert.deepEqual(isolation, [42], 'a failing listener must not block later listeners');
assert.equal(loggedErrors.length, 1, 'failing listener must be logged exactly once');
assert.match(String(loggedErrors[0][0]), /\[EventBus\] listener for "fault" threw:/);
assert.equal(loggedErrors[0][1] instanceof Error, true);

const snapshotOrder = [];
const lateHandler = () => snapshotOrder.push('late');
bus.on('snapshot', () => {
	snapshotOrder.push('first');
	bus.on('snapshot', lateHandler);
});
bus.on('snapshot', () => snapshotOrder.push('second'));
bus.emit('snapshot');
assert.deepEqual(snapshotOrder, ['first', 'second'], 'emit must iterate a snapshot of current handlers');
snapshotOrder.length = 0;
bus.emit('snapshot');
assert.deepEqual(snapshotOrder, ['first', 'second', 'late'], 'handler added during prior emit may participate next time');

bus.clear();
received.length = 0;
isolation.length = 0;
snapshotOrder.length = 0;
bus.emit('tick', { frame: 3 });
bus.emit('fault', 99);
bus.emit('snapshot');
assert.deepEqual(received, []);
assert.deepEqual(isolation, []);
assert.deepEqual(snapshotOrder, [], 'clear() must remove every listener for every event');

console.log('EventBus contract PASS: on/off/once, duplicate suppression, exception isolation, snapshot iteration and clear cleanup preserved.');
