import assert from 'node:assert/strict';
import { createPlayerInputParityIntent, isPlayerInputParityIntent } from '../src/3d/gameplay/playerInputParityIntent.ts';

const keyboard = createPlayerInputParityIntent({
  source: 'keyboard',
  moveX: 0.06,
  moveY: 0.8,
  lookX: -0.4,
  pressed: ['attackLight', 'attackLight', 'unknown'],
  held: ['guard', 'guard'],
});
assert.equal(keyboard.moveX, 0);
assert.equal(keyboard.moveY, (0.8 - 0.12) / 0.88);
assert.deepEqual(keyboard.pressed, ['attackLight']);
assert.deepEqual(keyboard.held, ['guard']);
assert.equal(isPlayerInputParityIntent(keyboard), true);
assert.equal(Object.isFrozen(keyboard), true);
assert.equal(Object.isFrozen(keyboard.pressed), true);

const gamepadA = createPlayerInputParityIntent({ source: 'gamepad', moveX: 0.5, moveY: -0.5, lookY: 0.2, pressed: ['dodge'] });
const gamepadB = createPlayerInputParityIntent({ source: 'gamepad', moveX: 0.5, moveY: -0.5, lookY: 0.2, pressed: ['dodge'] });
assert.deepEqual(gamepadA, gamepadB);

const tampered = { ...gamepadA, moveX: 1 };
assert.equal(isPlayerInputParityIntent(tampered), false);
console.log('player input parity intent proof: PASS');
