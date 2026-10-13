import assert from 'node:assert/strict';
import { normalizePlayerInput, PLAYER_INPUT_PARITY_LIMITS } from '../src/3d/gameplay/playerInputIntentAdapter.js';

const keyboard = normalizePlayerInput({ keyboard: { w: true, d: true, sprint: true, lightPressed: true } });
assert.equal(keyboard.sprint, true);
assert.equal(keyboard.lightPressed, true);
assert.equal(keyboard.moveX, 1);
assert.equal(keyboard.moveZ, -1);

const gamepad = normalizePlayerInput({ gamepad: { leftStick: { x: 0.5, y: -0.5 }, guard: true } });
assert.ok(gamepad.moveX > 0 && gamepad.moveZ < 0);
assert.equal(gamepad.guard, true);

const touchWins = normalizePlayerInput({
  keyboard: { w: true },
  gamepad: { leftStick: { x: 0.1, y: 0.1 } },
  touch: { moveStick: { x: -0.75, y: 0 }, dodgePressed: true },
});
assert.ok(touchWins.moveX < 0);
assert.equal(touchWins.moveZ, 0);
assert.equal(touchWins.dodgePressed, true);

const deadzoned = normalizePlayerInput({ gamepad: { leftStick: { x: PLAYER_INPUT_PARITY_LIMITS.deadzone, y: 0 } } });
assert.equal(deadzoned.moveMagnitude, 0);

console.log(JSON.stringify({ ok: true, keyboard, gamepad, touchWins, deadzoned }));
