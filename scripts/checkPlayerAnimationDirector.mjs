import assert from 'node:assert/strict';
import { createPlayerAnimationDirector, resolvePlayerAnimationIntent } from '../src/3d/gameplay/playerAnimationDirector.js';

const actions = { idle: 'idle', walking: 'walking', running: 'running', guard: 'guard', 'light-attack': 'light', 'heavy-attack': 'heavy', dodge: 'dodge', 'hit-stagger': 'stagger' };

assert.equal(resolvePlayerAnimationIntent({ planarSpeedMps: 0, availableActions: actions }).action, 'idle');
assert.equal(resolvePlayerAnimationIntent({ planarSpeedMps: 3.2, availableActions: actions }).action, 'walking');
assert.equal(resolvePlayerAnimationIntent({ runIntent: true, planarSpeedMps: 6.5, availableActions: actions }).action, 'running');
assert.equal(resolvePlayerAnimationIntent({ guarding: true, planarSpeedMps: 0, availableActions: actions }).action, 'guard');
assert.equal(resolvePlayerAnimationIntent({ attackKind: 'heavy', availableActions: actions }).action, 'heavy');
assert.equal(resolvePlayerAnimationIntent({ dodgeRemaining: 0.2, availableActions: actions }).timeScale, 1.45);
assert.equal(resolvePlayerAnimationIntent({ hitStaggerRemaining: 0.1, availableActions: actions }).action, 'stagger');
assert.equal(resolvePlayerAnimationIntent({ attackKind: 'light', availableActions: { idle: 'idle' } }).action, 'idle');

const calls = [];
const director = createPlayerAnimationDirector({ actions, playAction: (...args) => calls.push(args) });
director.update({ planarSpeedMps: 3.2 });
director.update({ planarSpeedMps: 3.2 });
director.update({ attackKind: 'light' });
director.update({ attackKind: 'light' });
assert.deepEqual(calls, [['walking', 1], ['light', 1]]);
director.reset();
director.update({ planarSpeedMps: 3.2 });
assert.equal(calls.length, 3);
console.log('PLAYER_ANIMATION_DIRECTOR_CONTRACT_OK');
