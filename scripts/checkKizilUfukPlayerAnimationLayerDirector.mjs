import assert from 'node:assert/strict';
import {
  createPlayerAnimationLayerDirector,
  resolvePlayerAnimationLayerReceipt,
  resolvePlayerAnimationLayerWeights,
  validatePlayerAnimationLayerReceipt,
} from '../src/3d/gameplay/playerAnimationLayerDirector.js';

const idle = resolvePlayerAnimationLayerWeights({ semanticState: 'idle' });
assert.equal(idle.semanticState, 'idle');
assert.equal(idle.upperBody, 0);
assert.equal(idle.lowerBody, 1);

const heavy = resolvePlayerAnimationLayerReceipt({ sequence: 4, semanticState: 'heavy-attack', locomotionWeight: 0.8, combatWeight: 1, additiveWeight: 0.2, interruptibility: 0, contactConfidence: 1, phase: 'active' });
assert.equal(heavy.sequence, 4);
assert.equal(heavy.phase, 'active');
assert.equal(heavy.upperBody, 1);
assert.equal(validatePlayerAnimationLayerReceipt(heavy), true);

const director = createPlayerAnimationLayerDirector({ maxHistory: 2 });
const first = director.update({ sequence: 1, semanticState: 'guard', combatWeight: 1 });
const second = director.update({ sequence: 2, semanticState: 'dodge', combatWeight: 1 });
director.update({ sequence: 3, semanticState: 'ranged-release', combatWeight: 1 });
assert.equal(first.sequence, 1);
assert.deepEqual(director.snapshot().map(({ sequence }) => sequence), [2, 3]);
assert.throws(() => director.update({ sequence: 3, semanticState: 'idle' }));
assert.throws(() => director.snapshot().push(second), TypeError);

director.reset();
assert.deepEqual(director.snapshot(), []);
director.dispose();
assert.equal(director.isDisposed(), true);
assert.throws(() => director.update({ sequence: 1 }));

const a = resolvePlayerAnimationLayerReceipt({ sequence: 9, semanticState: 'light-attack', combatWeight: 0.75 });
const b = resolvePlayerAnimationLayerReceipt({ sequence: 9, semanticState: 'light-attack', combatWeight: 0.75 });
assert.deepEqual(a, b);

console.log('animation layer director checks passed');
