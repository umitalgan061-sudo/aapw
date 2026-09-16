import assert from 'node:assert/strict';
import {
  resolvePlayerCombatAnimationTransition,
  validatePlayerCombatAnimationTransition,
} from '../src/3d/gameplay/playerCombatAnimationTransition.js';

const idleToHeavy = resolvePlayerCombatAnimationTransition({
  fromState: 'locomotion',
  toState: 'heavy-attack',
  fromAction: 'run',
  toAction: 'heavy',
  normalizedProgress: 0.2,
  speedMps: 4,
  queue: [{ action: 'light', state: 'light-attack' }, { action: 'dodge' }],
});
assert.equal(idleToHeavy.stateChanged, true);
assert.equal(idleToHeavy.hardCut, true);
assert.equal(idleToHeavy.crossFadeSeconds, 0);
assert.equal(idleToHeavy.queue.length, 2);
assert.equal(idleToHeavy.queue[1].state, 'dodge');
assert.equal(validatePlayerCombatAnimationTransition(idleToHeavy), true);

const locomotion = resolvePlayerCombatAnimationTransition({
  fromState: 'guard',
  toState: 'locomotion',
  fromAction: 'guard',
  toAction: 'run',
  grounded: true,
  speedMps: 3,
  defaultFadeSeconds: 0.2,
});
assert.equal(locomotion.hardCut, false);
assert.equal(locomotion.preserveFootContact, true);
assert.ok(locomotion.crossFadeSeconds > 0);

const defeated = resolvePlayerCombatAnimationTransition({
  fromState: 'light-attack',
  toState: 'defeated',
  fromAction: 'light',
  toAction: 'death',
  queue: Array.from({ length: 8 }, (_, index) => ({ action: `a${index}` })),
});
assert.equal(defeated.hardCut, true);
assert.equal(defeated.crossFadeSeconds, 0);
assert.equal(defeated.queue.length, 4);
assert.equal(defeated.queue.every((entry) => entry.accepted === false), true);

const repeatA = resolvePlayerCombatAnimationTransition({ fromState: 'idle', toState: 'dodge', normalizedProgress: 0.4 });
const repeatB = resolvePlayerCombatAnimationTransition({ fromState: 'idle', toState: 'dodge', normalizedProgress: 0.4 });
assert.deepEqual(repeatA, repeatB);
assert.equal(Object.isFrozen(repeatA), true);
assert.equal(Object.isFrozen(repeatA.queue), true);
assert.equal(Object.isFrozen(repeatA.queue[0]), true);

console.log('player combat animation transition: PASS');
