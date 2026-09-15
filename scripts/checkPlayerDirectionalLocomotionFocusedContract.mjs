import assert from 'node:assert/strict';
import {
  resolvePlayerDirectionalFullPresentation,
  resolvePlayerDirectionalBlendWeights,
  validatePlayerDirectionalBlendWeights,
} from '../src/3d/gameplay/playerDirectionalLocomotionPolicy.js';

const cases = [
  { name: 'forward', velocity: { x: 0, y: 1 } },
  { name: 'forward-right', velocity: { x: 0.7071, y: 0.7071 } },
  { name: 'right', velocity: { x: 1, y: 0 } },
  { name: 'back-right', velocity: { x: 0.7071, y: -0.7071 } },
  { name: 'back', velocity: { x: 0, y: -1 } },
  { name: 'back-left', velocity: { x: -0.7071, y: -0.7071 } },
  { name: 'left', velocity: { x: -1, y: 0 } },
  { name: 'forward-left', velocity: { x: -0.7071, y: 0.7071 } },
];

for (const testCase of cases) {
  const input = {
    velocity: testCase.velocity,
    facing: { x: 0, y: 1 },
    planarSpeedMps: 4,
    deltaSeconds: 1 / 60,
  };
  const weights = resolvePlayerDirectionalBlendWeights(input);
  assert.equal(validatePlayerDirectionalBlendWeights(weights), true, testCase.name);
  const presentation = resolvePlayerDirectionalFullPresentation(input);
  assert.equal(presentation.valid, true, `${testCase.name}-valid`);
  assert.ok(presentation.blendMagnitude >= 0 && presentation.blendMagnitude <= 1);
  assert.ok(presentation.playbackRate >= 0.72 && presentation.playbackRate <= 1.35);
}

const transitions = [
  { planarSpeedMps: 0 },
  { planarSpeedMps: 5.55 },
  { planarSpeedMps: 5.6 },
  { planarSpeedMps: 5.25 },
  { planarSpeedMps: 5.09 },
];
let previous = 'idle';
for (const input of transitions) {
  const p = resolvePlayerDirectionalFullPresentation({
    ...input,
    velocity: { x: 0, y: 1 },
    facing: { x: 0, y: 1 },
    deltaSeconds: 1 / 60,
  }, previous);
  assert.equal(p.valid, true);
  previous = p.semanticState;
}
assert.equal(previous, 'locomotion');

const malformed = resolvePlayerDirectionalFullPresentation({
  velocity: { x: Infinity, y: NaN },
  facing: { x: NaN, y: Infinity },
  planarSpeedMps: Infinity,
  slopeDegrees: Infinity,
  turnRateDegreesPerSecond: Infinity,
  previousPhase: Infinity,
  surfaceConfidence: NaN,
  surfaceSlip: NaN,
});
assert.equal(malformed.valid, true);
assert.ok(Number.isFinite(malformed.playbackRate));
assert.ok(Number.isFinite(malformed.phase.phase));

console.log('PLAYER_DIRECTIONAL_LOCOMOTION_FOCUSED_CONTRACT_PASS');
