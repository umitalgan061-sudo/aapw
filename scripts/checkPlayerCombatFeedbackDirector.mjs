import assert from 'node:assert/strict';
import {
  buildPlayerCombatFeedback,
  serializePlayerCombatFeedback,
} from '../src/3d/gameplay/playerCombatFeedbackDirector.js';

const critical = buildPlayerCombatFeedback({
  outcome: 'critical',
  intensity: 0.8,
  comboStep: 3,
  targetDistance: 4,
  direction: { x: 3, y: 0, z: 4 },
  surface: 'metal',
});
assert.equal(critical.outcome, 'critical');
assert.equal(critical.hitStop.enabled, true);
assert.ok(critical.hitStop.durationMs >= 55);
assert.ok(critical.camera.shake <= 1);
assert.ok(Math.abs(Math.hypot(critical.camera.direction.x, critical.camera.direction.y, critical.camera.direction.z) - 1) < 1e-9);
assert.equal(critical.audio.cue, 'critical');
assert.deepEqual(critical.vfx, ['spark', 'flash']);
assert.equal(Object.isFrozen(critical), true);
assert.equal(Object.isFrozen(critical.camera), true);

const blocked = buildPlayerCombatFeedback({ outcome: 'block', intensity: 0.4 });
assert.equal(blocked.flags.isDefense, true);
assert.equal(blocked.flags.isPositive, false);
assert.equal(blocked.hitStop.timeScale < 1, true);

const malformed = buildPlayerCombatFeedback({
  outcome: 'unknown',
  intensity: Number.NaN,
  comboStep: Number.POSITIVE_INFINITY,
  targetDistance: Number.NEGATIVE_INFINITY,
  direction: { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: Number.NEGATIVE_INFINITY },
});
assert.equal(malformed.outcome, 'miss');
assert.equal(malformed.intensity, 0);
assert.equal(malformed.comboStep, 0);
assert.equal(malformed.targetDistance, 0);
assert.deepEqual(malformed.camera.direction, { x: 0, y: 0, z: 1 });

const first = serializePlayerCombatFeedback(buildPlayerCombatFeedback({ outcome: 'parry', intensity: 0.5, comboStep: 2 }));
const second = serializePlayerCombatFeedback(buildPlayerCombatFeedback({ outcome: 'parry', intensity: 0.5, comboStep: 2 }));
assert.equal(first, second);

console.log('player combat feedback director contract: PASS');
