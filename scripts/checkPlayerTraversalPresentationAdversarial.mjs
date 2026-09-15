import assert from 'node:assert/strict';
import { buildPlayerTraversalPresentationState, normalizePlayerTraversalPresentationCue } from '../src/3d/gameplay/playerTraversalPresentationPolicy.js';
import { isTraversalPresentationTransitionAllowed } from '../src/3d/gameplay/playerTraversalPresentationTransitionPolicy.js';

const hostile = [
  {}, {traversalWeight:Infinity}, {traversalWeight:-Infinity}, {traversalWeight:NaN},
  {traversalForwardDistance:-999}, {traversalForwardDistance:999}, {traversalHeight:-999}, {traversalHeight:999},
  {landingImpactMps:-999}, {landingImpactMps:999}, {surfaceConfidence:-1}, {surfaceConfidence:2},
  {footPlantConfidence:-1}, {footPlantConfidence:2}, {deltaSeconds:0}, {deltaSeconds:999},
  {cancelRequested:true,traversalBlocked:true,traversalWeight:1},
  {grounded:false,traversalHeight:999,traversalWeight:1},
  {grounded:false,traversalHeight:-999,traversalWeight:1},
];
for (const input of hostile) {
  const normalized=normalizePlayerTraversalPresentationCue(input);
  const state=buildPlayerTraversalPresentationState(null,normalized);
  assert.equal(typeof state.state,'string');
  assert.ok(state.confidence>=0&&state.confidence<=1);
  assert.ok(state.channels.traversal>=0&&state.channels.traversal<=1);
  assert.ok(state.channels.confidence>=0&&state.channels.confidence<=1);
}
const states=['clear','approach','prepare','vault','climb','drop','land','blocked','recover','cancelled'];
for(const from of states)for(const to of states)assert.equal(typeof isTraversalPresentationTransitionAllowed(from,to),'boolean');
assert.equal(buildPlayerTraversalPresentationState(null,{cancelRequested:true,traversalBlocked:true,traversalWeight:1}).state,'cancelled');
assert.equal(buildPlayerTraversalPresentationState(null,{traversalBlocked:true,traversalWeight:1}).state,'blocked');
console.log(`adversarial traversal inputs passed: ${hostile.length}`);
