import assert from 'node:assert/strict';
import { resolvePlayerAnimationTransition } from '../src/3d/gameplay/playerAnimationTransitionPolicy.js';

const rising = resolvePlayerAnimationTransition({ previousSemanticState: 'locomotion', planarSpeedMps: 5.55 });
assert.equal(rising, 'locomotion');

const entered = resolvePlayerAnimationTransition({ previousSemanticState: 'locomotion', planarSpeedMps: 5.6 });
assert.equal(entered, 'sprint');

const held = resolvePlayerAnimationTransition({ previousSemanticState: 'sprint', planarSpeedMps: 5.25 });
assert.equal(held, 'sprint');

const exited = resolvePlayerAnimationTransition({ previousSemanticState: 'sprint', planarSpeedMps: 5.09 });
assert.equal(exited, 'locomotion');

const attack = resolvePlayerAnimationTransition({ previousSemanticState: 'sprint', planarSpeedMps: 5.25, attackKind: 'heavy' });
assert.equal(attack, 'heavy-attack');

const malformed = resolvePlayerAnimationTransition({ previousSemanticState: 'sprint', planarSpeedMps: Infinity, sprintEnterSpeedMps: Infinity, sprintExitSpeedMps: NaN });
assert.equal(malformed, 'locomotion');

const first = JSON.stringify(Array.from({ length: 20 }, (_, index) => resolvePlayerAnimationTransition({
  previousSemanticState: index % 2 ? 'sprint' : 'locomotion',
  planarSpeedMps: 5.08 + (index % 5) * 0.14,
})));
const second = JSON.stringify(Array.from({ length: 20 }, (_, index) => resolvePlayerAnimationTransition({
  previousSemanticState: index % 2 ? 'sprint' : 'locomotion',
  planarSpeedMps: 5.08 + (index % 5) * 0.14,
})));
assert.equal(first, second);

console.log('[checkPlayerAnimationTransitionHysteresis] PASS');
