import assert from 'node:assert/strict';
import { buildAnimationLayerPlan, buildPlayerAnimationLayerDirector, validateAnimationLayerPlan } from '../src/3d/gameplay/playerAnimationLayerDirector.js';

const input = {
  layers: [
    { layer: 'locomotion', clip: 'run', weight: 0.8 },
    { layer: 'combat', clip: 'sword-light', weight: 0.7 },
    { layer: 'additive', clip: 'breath', weight: 0.9 },
    { layer: 'combat', clip: 'duplicate', weight: 0.1, priority: 10 },
    { layer: 'unknown', clip: 'bad', weight: 4 },
  ],
  locomotionWeight: 0.9,
  environmentalConfidence: 0.1,
};
const first = buildPlayerAnimationLayerDirector(input);
const second = buildPlayerAnimationLayerDirector(input);
assert.deepEqual(first, second);
assert.equal(first.plan.layers.length, 4);
assert.equal(first.plan.layers.some((row) => row.layer === 'unknown'), false);
assert.equal(first.plan.layers.find((row) => row.layer === 'additive').weight <= 0.35, true);
assert.equal(first.validation.ok, true);
assert.equal(first.validation.warnings.includes('low-environment-confidence'), true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.plan.layers), true);
assert.equal(Object.isFrozen(first.plan.layers[0]), true);

const protectedPlan = buildAnimationLayerPlan({ layers: [{ layer: 'combat', weight: 1 }], normalizedTime: 0 });
const protectedResult = buildPlayerAnimationLayerDirector({ layers: [{ layer: 'combat', weight: 1 }], normalizedTime: 0.1, interruptible: true });
assert.equal(protectedResult.transition.protectedWindow, true);
assert.equal(protectedResult.transition.permitted, false);
assert.equal(validateAnimationLayerPlan(protectedPlan).ok, true);

const malformed = buildPlayerAnimationLayerDirector({ layers: 'bad', locomotionWeight: 'nope', environmentalConfidence: 'nope', normalizedTime: 'nope' });
assert.equal(malformed.validation.ok, true);
assert.equal(Number.isFinite(malformed.plan.locomotionWeight), true);
assert.equal(Number.isFinite(malformed.transition.crossfadeSeconds), true);
assert.equal(JSON.stringify(first), JSON.stringify(second));
console.log('player-animation-layer-director: ok');
