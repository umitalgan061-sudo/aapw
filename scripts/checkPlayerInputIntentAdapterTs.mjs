import assert from 'node:assert/strict';
import { normalizePlayerInput, PLAYER_INPUT_PARITY_LIMITS } from '../src/3d/gameplay/playerInputIntentAdapter.ts';

const keyboard = normalizePlayerInput({ keyboard: { move: { x: 1, y: -1 }, sprint: true, lightPressed: true } });
assert.equal(keyboard.moveX, 1);
assert.equal(keyboard.moveZ, 1);
assert.equal(keyboard.sprint, true);
assert.equal(keyboard.lightPressed, true);

const gamepad = normalizePlayerInput({ gamepad: { move: { x: 0.5, y: -0.5 }, guard: true } });
assert.ok(gamepad.moveX > 0 && gamepad.moveZ < 0);
assert.equal(gamepad.guard, true);

const touchPriority = normalizePlayerInput({
  keyboard: { move: { x: 0, y: -1 } },
  gamepad: { move: { x: 0.1, y: 0.1 } },
  touch: { move: { x: -0.75, y: 0 }, dodgePressed: true },
});
assert.ok(touchPriority.moveX < 0);
assert.equal(touchPriority.moveZ, 0);
assert.equal(touchPriority.dodgePressed, true);

const deadzoned = normalizePlayerInput({ gamepad: { move: { x: PLAYER_INPUT_PARITY_LIMITS.deadzone, y: 0 } } });
assert.equal(deadzoned.moveMagnitude, 0);

const bounded = normalizePlayerInput({ gamepad: { move: { x: 4, y: 4 } } });
assert.equal(bounded.moveMagnitude, 1);

console.log(JSON.stringify({ ok: true, keyboard, gamepad, touchPriority, deadzoned, bounded }));
