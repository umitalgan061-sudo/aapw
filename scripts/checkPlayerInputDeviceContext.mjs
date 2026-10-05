import assert from 'node:assert/strict';
import { createPlayerInputDeviceContext, validatePlayerInputDeviceContext, inferDevice } from '../src/3d/gameplay/playerInputDeviceContext.js';

assert.equal(inferDevice({ source: 'keyboard', action: 'KeyW' }), 'keyboard');
assert.equal(inferDevice({ source: 'mouse', action: 'Mouse0' }), 'mouse');
assert.equal(inferDevice({ axis: true }), 'gamepad');
assert.equal(inferDevice({ source: 'touch', action: 'lightAttack' }), 'touch');

let clock = 10;
const input = createPlayerInputDeviceContext({ now: () => clock, maxActivity: 3 });
let first = input.recordKeyboard('lightAttack');
assert.equal(first.activeDevice, 'keyboard');
clock = 20;
input.recordMouse(0);
clock = 30;
input.recordGamepad({ axis: true, magnitude: 2 });
clock = 40;
const bounded = input.recordTouch('dodge');
assert.equal(bounded.activity.length, 3);
assert.equal(bounded.activeDevice, 'touch');
assert.equal(bounded.lastActivity.action, 'dodge');
assert.equal(validatePlayerInputDeviceContext(bounded), true);
assert.equal(Object.isFrozen(bounded), true);
assert.equal(Object.isFrozen(bounded.activity), true);
assert.equal(Object.isFrozen(bounded.lastActivity), true);

const replayA = createPlayerInputDeviceContext({ now: () => 0, maxActivity: 4 });
const replayB = createPlayerInputDeviceContext({ now: () => 0, maxActivity: 4 });
const events = [
  ['keyboard', 'moveForward'],
  ['mouse', 'Mouse0'],
  ['gamepad', 'heavyAttack'],
  ['touch', 'lockOn'],
];
for (const [device, action] of events) {
  replayA.record({ device, action });
  replayB.record({ device, action });
}
assert.deepEqual(replayA.snapshot(), replayB.snapshot());

input.reset();
assert.equal(input.snapshot().sequence, 0);
assert.equal(input.snapshot().activeDevice, 'unknown');
input.dispose();
assert.equal(input.recordTouch('block').disposed, true);
console.log('player input device context checks passed');
