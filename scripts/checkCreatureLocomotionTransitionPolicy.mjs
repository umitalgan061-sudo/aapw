import assert from 'node:assert/strict';
import { buildCreatureTransitionPolicy, resolveCreatureTransitionDuration, resolveCreatureTransitionCurve, sampleCreatureTransition, resolveCreatureTransitionLayerWeights, validateCreatureTransitionPolicy, classifyCreatureLocomotionState } from '../src/3d/gameplay/creatureLocomotionTransitionPolicy.js';

const idleWalk = buildCreatureTransitionPolicy('idle', 'wander');
assert.equal(validateCreatureTransitionPolicy(idleWalk).length, 0);
assert.equal(classifyCreatureLocomotionState('idle'), 'idle');
assert.equal(classifyCreatureLocomotionState('flight-cruise'), 'airborne');
assert.equal(classifyCreatureLocomotionState('flee'), 'reactive');
assert.equal(classifyCreatureLocomotionState('landing-soft'), 'recovery');
assert.ok(resolveCreatureTransitionDuration('wander', 'flee') < resolveCreatureTransitionDuration('wander', 'wander'));
assert.equal(resolveCreatureTransitionCurve('flight-cruise', 'flight-descend').curve, 'airborne-crossfade');
assert.equal(resolveCreatureTransitionCurve('flee', 'herd-flee').curve, 'alert-crossfade');
assert.equal(resolveCreatureTransitionCurve('flight-descend', 'landing-hard').curve, 'ease-out-impact');
assert.equal(sampleCreatureTransition(idleWalk, 0), 0);
assert.equal(sampleCreatureTransition(idleWalk, idleWalk.durationSeconds), 1);
const weights = resolveCreatureTransitionLayerWeights(idleWalk, idleWalk.durationSeconds / 2);
assert.ok(weights.from > 0 && weights.to > 0);
assert.ok(Math.abs(weights.from + weights.to - 1) < 0.0002);
console.log('Creature locomotion transition policy checks passed');
