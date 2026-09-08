#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  applyGamepadRadialDeadzone,
  resolveGamepadSprintIntent,
  resolveParryGuardFrame,
  resolvePlayerCombatFeedbackHaptic,
} from '../src/3d/input.js';

assert.deepEqual(applyGamepadRadialDeadzone(0, 0), { x: 0, y: 0, magnitude: 0 });
assert.equal(applyGamepadRadialDeadzone(Number.NaN, 0.1).magnitude, 0);
const diagonal = applyGamepadRadialDeadzone(0.7071, 0.7071);
assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - diagonal.magnitude) < 1e-12);
assert.ok(diagonal.x > 0 && diagonal.y > 0);

assert.equal(resolveGamepadSprintIntent(0.71, true), false);
assert.equal(resolveGamepadSprintIntent(0.72, true), true);
assert.equal(resolveGamepadSprintIntent(0.56, true, true), true);
assert.equal(resolveGamepadSprintIntent(0.54, true, true), false);

assert.deepEqual(resolveParryGuardFrame(false, false), { guarding: false, rearmPending: false });
assert.deepEqual(resolveParryGuardFrame(false, true), { guarding: true, rearmPending: false });
assert.deepEqual(resolveParryGuardFrame(true, true), { guarding: false, rearmPending: true });
assert.deepEqual(resolveParryGuardFrame(false, false, true), { guarding: true, rearmPending: false });

assert.equal(resolvePlayerCombatFeedbackHaptic({ outcome: 'parry', blockedAmount: 0 }), null);
assert.equal(resolvePlayerCombatFeedbackHaptic({ outcome: 'hit', appliedAmount: 0 }), null);
assert.ok(resolvePlayerCombatFeedbackHaptic({ outcome: 'parry', blockedAmount: 1 }));
assert.ok(resolvePlayerCombatFeedbackHaptic({ outcome: 'hit-stagger', appliedAmount: 1 }));
assert.ok(resolvePlayerCombatFeedbackHaptic({ outcome: 'guard-break', blockedAmount: 1 }));

console.log('PLAYER_INPUT_ARBITRATION_OK');
