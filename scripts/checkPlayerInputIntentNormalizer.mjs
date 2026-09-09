import assert from 'node:assert/strict';
import {
  normalizePlayerInputIntent,
  serializePlayerInputIntent,
} from '../src/3d/gameplay/playerInputIntentNormalizer.js';

const keyboard = normalizePlayerInputIntent({
  source: 'keyboard', moveX: 2, moveY: 0.5, lookX: 0.01, action: 'light', pressed: true, sprint: true,
});
assert.equal(keyboard.source, 'keyboard');
assert.equal(keyboard.action, 'light');
assert.equal(keyboard.axes.moveX > 0.8, true);
assert.equal(keyboard.axes.lookX, 0);
assert.equal(keyboard.flags.combatIntent, true);
assert.equal(keyboard.flags.locomotionIntent, true);
assert.equal(Object.isFrozen(keyboard), true);
assert.equal(Object.isFrozen(keyboard.axes), true);

const touch = normalizePlayerInputIntent({
  source: 'touch', moveX: 0.05, moveY: -0.05, lookX: -0.8, lookY: 0.4, action: 'dodge', held: 1,
}, { deadZone: 0.1 });
assert.equal(touch.axes.moveX, 0);
assert.equal(touch.axes.moveY, 0);
assert.equal(touch.action, 'dodge');
assert.equal(touch.held, true);
assert.equal(touch.flags.hasLook, true);

const malformed = normalizePlayerInputIntent({
  source: 'wheel', moveX: Number.NaN, moveY: Number.POSITIVE_INFINITY,
  lookX: 'bad', action: 'teleport', pressed: 1,
}, { deadZone: Number.NaN });
assert.equal(malformed.source, 'unknown');
assert.equal(malformed.action, null);
assert.deepEqual(malformed.axes, { moveX: 0, moveY: 0, lookX: 0, lookY: 0 });
assert.equal(malformed.deadZone, 0.12);
assert.equal(Number.isFinite(malformed.magnitudes.move), true);

const first = serializePlayerInputIntent(keyboard);
const second = serializePlayerInputIntent(normalizePlayerInputIntent({
  action: 'light', source: 'keyboard', sprint: true, pressed: true,
  moveY: 0.5, moveX: 2, lookX: 0.01,
}));
assert.equal(first, second);

console.log('player-input-intent-normalizer: ok');
