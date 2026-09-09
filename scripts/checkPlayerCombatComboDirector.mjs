import assert from 'node:assert/strict';
import { createPlayerCombatComboDirector } from '../src/3d/gameplay/playerCombatComboDirector.js';

const director = createPlayerCombatComboDirector();
const first = director.accept('light', 1000);
assert.equal(first.accepted, true);
assert.equal(first.step, 1);
assert.equal(first.chainComplete, false);
assert.equal(director.buffer('heavy', 1200).buffered, true);
const second = director.accept('lightAttack', 1300);
assert.equal(second.step, 2);
assert.equal(second.action, 'light');
const third = director.accept('heavy', 1500);
assert.equal(third.chainComplete, true);
assert.equal(third.step, 3);
assert.equal(director.accept('spell', 1600).reason, 'unsupported-action');
assert.equal(director.snapshot(2501).step, 0);

const malformed = createPlayerCombatComboDirector({ maxSteps: Infinity, windowMs: NaN, resetMs: -10 });
assert.deepEqual(malformed.config, { maxSteps: 3, windowMs: 620, resetMs: 200, heavyFinisherStep: 3 });
const stableA = JSON.stringify(createPlayerCombatComboDirector().accept('light', 1));
const stableB = JSON.stringify(createPlayerCombatComboDirector().accept('light', 1));
assert.equal(stableA, stableB);

console.log('playerCombatComboDirector: ok');
