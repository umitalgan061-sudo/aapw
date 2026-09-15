import assert from 'node:assert/strict';
import {
  PLAYER_DIRECTIONAL_DIRECTIONS,
  PLAYER_DIRECTIONAL_SEMANTICS,
  normalizePlayerDirectionalInput,
  resolvePlayerDirectionalAngle,
  resolvePlayerDirectionalBlendWeights,
  resolvePlayerDirectionalFullPresentation,
  resolvePlayerDirectionalPhaseStep,
  validatePlayerDirectionalBlendWeights,
  validatePlayerDirectionalPresentation,
} from '../src/3d/gameplay/playerDirectionalLocomotionPolicy.js';
import {
  buildPlayerDirectionalReplayCorpus,
  comparePlayerDirectionalCorpora,
  replayPlayerDirectionalSamples,
} from '../src/3d/gameplay/playerDirectionalLocomotionReplay.js';

const magnitudes = [0, 0.1, 0.5, 1, 2.5, 3.2, 5.1, 5.6, 6.5, 9, 12];
const slopes = [0, 5, 10, 20, 30, 40, 50, 55];
const turns = [0, 30, 60, 120, 180, 300, 420, 540];
const phases = [0, 0.1, 0.24, 0.25, 0.49, 0.5, 0.74, 0.75, 0.99];
const confidences = [0, 0.15, 0.5, 0.85, 1];
const slips = [0, 0.2, 0.5, 1];
const attackKinds = ['none', 'light', 'heavy'];
const states = ['plain', 'guard', 'dodge', 'stagger'];

function createInput(index) {
  const angle = (index % 8) * (Math.PI / 4);
  const state = states[index % states.length];
  const attackKind = state === 'plain' ? attackKinds[index % attackKinds.length] : 'none';
  return {
    velocity: { x: Math.sin(angle), y: Math.cos(angle) },
    facing: { x: 0, y: 1 },
    planarSpeedMps: magnitudes[index % magnitudes.length],
    slopeDegrees: slopes[index % slopes.length],
    turnRateDegreesPerSecond: turns[index % turns.length],
    previousPhase: phases[index % phases.length],
    deltaSeconds: 0.016 + (index % 4) * 0.01,
    surfaceConfidence: confidences[index % confidences.length],
    surfaceSlip: slips[index % slips.length],
    attackKind,
    guarding: state === 'guard',
    dodgeRemaining: state === 'dodge' ? 0.12 : 0,
    hitStaggerRemaining: state === 'stagger' ? 0.2 : 0,
  };
}

const generated = Array.from({ length: 256 }, (_, index) => createInput(index));

for (const [index, input] of generated.entries()) {
  const normalized = normalizePlayerDirectionalInput(input);
  assert.ok(normalized.planarSpeedMps >= 0 && normalized.planarSpeedMps <= 12, `speed-${index}`);
  assert.ok(normalized.slopeDegrees >= 0 && normalized.slopeDegrees <= 55, `slope-${index}`);
  assert.ok(normalized.turnRateDegreesPerSecond >= 0 && normalized.turnRateDegreesPerSecond <= 540, `turn-${index}`);
  assert.ok(normalized.previousPhase >= 0 && normalized.previousPhase < 1, `phase-${index}`);
  assert.ok(normalized.surfaceConfidence >= 0 && normalized.surfaceConfidence <= 1, `confidence-${index}`);
  assert.ok(normalized.surfaceSlip >= 0 && normalized.surfaceSlip <= 1, `slip-${index}`);

  const angle = resolvePlayerDirectionalAngle(input);
  assert.ok(angle >= -Math.PI && angle <= Math.PI, `angle-${index}`);

  const weights = resolvePlayerDirectionalBlendWeights(input);
  assert.equal(validatePlayerDirectionalBlendWeights(weights), true, `weights-${index}`);

  const presentation = resolvePlayerDirectionalFullPresentation(input);
  assert.equal(validatePlayerDirectionalPresentation(presentation).ok, true, `presentation-${index}`);
  assert.equal(Object.isFrozen(presentation), true);
  assert.equal(Object.isFrozen(presentation.blendWeights), true);
  assert.equal(Object.isFrozen(presentation.surface), true);
  assert.equal(Object.isFrozen(presentation.combatOverlay), true);
}

for (let index = 0; index < generated.length - 1; index += 1) {
  const first = resolvePlayerDirectionalFullPresentation(generated[index]);
  const second = resolvePlayerDirectionalFullPresentation(generated[index]);
  assert.deepEqual(first, second, `repeat-${index}`);
}

for (const semantic of PLAYER_DIRECTIONAL_SEMANTICS) {
  const input = semantic === 'idle'
    ? createInput(0)
    : semantic === 'locomotion'
      ? createInput(1)
      : semantic === 'sprint'
        ? { ...createInput(2), runIntent: true, planarSpeedMps: 6 }
        : semantic === 'light-attack'
          ? { ...createInput(3), attackKind: 'light' }
          : semantic === 'heavy-attack'
            ? { ...createInput(4), attackKind: 'heavy' }
            : semantic === 'guard'
              ? { ...createInput(5), guarding: true }
              : semantic === 'dodge'
                ? { ...createInput(6), dodgeRemaining: 0.1 }
                : { ...createInput(7), hitStaggerRemaining: 0.1 };
  const presentation = resolvePlayerDirectionalFullPresentation(input);
  assert.ok(PLAYER_DIRECTIONAL_SEMANTICS.includes(presentation.semanticState));
}

for (const direction of PLAYER_DIRECTIONAL_DIRECTIONS) {
  const angles = {
    forward: 0,
    'forward-right': Math.PI / 4,
    right: Math.PI / 2,
    'back-right': Math.PI * 0.75,
    back: Math.PI,
    'back-left': -Math.PI * 0.75,
    left: -Math.PI / 2,
    'forward-left': -Math.PI / 4,
  };
  const angle = angles[direction];
  const input = {
    ...createInput(12),
    velocity: { x: Math.sin(angle), y: Math.cos(angle) },
    planarSpeedMps: 4,
  };
  const weights = resolvePlayerDirectionalBlendWeights(input);
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.0003, `direction-sum-${direction}`);
  assert.ok(Object.values(weights).filter((value) => value > 0.0001).length <= 2, `direction-sparsity-${direction}`);
}

for (const phase of phases) {
  const result = resolvePlayerDirectionalPhaseStep(createInput(50, { previousPhase: phase }));
  assert.ok(result.phase >= 0 && result.phase < 1, `phase-result-${phase}`);
}

const malformedVariants = [
  { planarSpeedMps: Infinity },
  { planarSpeedMps: -Infinity },
  { planarSpeedMps: NaN },
  { slopeDegrees: Infinity },
  { slopeDegrees: -Infinity },
  { turnRateDegreesPerSecond: NaN },
  { previousPhase: Infinity },
  { previousPhase: -Infinity },
  { deltaSeconds: NaN },
  { surfaceConfidence: Infinity },
  { surfaceSlip: NaN },
];
for (const [index, override] of malformedVariants.entries()) {
  const presentation = resolvePlayerDirectionalFullPresentation({ ...createInput(index), ...override });
  assert.equal(validatePlayerDirectionalPresentation(presentation).ok, true, `malformed-${index}`);
}

const longSamples = Array.from({ length: 600 }, (_, index) => createInput(index));
const replay1 = replayPlayerDirectionalSamples(longSamples, { name: 'invariant-long', seed: '100' });
const replay2 = replayPlayerDirectionalSamples(longSamples, { name: 'invariant-long', seed: '100' });
assert.equal(replay1.fingerprint, replay2.fingerprint);
assert.equal(replay1.frames.length, 600);
assert.equal(replay1.valid, true);

const corpusA = buildPlayerDirectionalReplayCorpus([
  { samples: longSamples.slice(0, 100), metadata: { name: 'a' } },
  { samples: longSamples.slice(100, 200), metadata: { name: 'b' } },
  { samples: longSamples.slice(200, 300), metadata: { name: 'c' } },
  { samples: longSamples.slice(300, 400), metadata: { name: 'd' } },
  { samples: longSamples.slice(400, 500), metadata: { name: 'e' } },
  { samples: longSamples.slice(500, 600), metadata: { name: 'f' } },
]);
const corpusB = buildPlayerDirectionalReplayCorpus([
  { samples: longSamples.slice(0, 100), metadata: { name: 'a' } },
  { samples: longSamples.slice(100, 200), metadata: { name: 'b' } },
  { samples: longSamples.slice(200, 300), metadata: { name: 'c' } },
  { samples: longSamples.slice(300, 400), metadata: { name: 'd' } },
  { samples: longSamples.slice(400, 500), metadata: { name: 'e' } },
  { samples: longSamples.slice(500, 600), metadata: { name: 'f' } },
]);
assert.equal(comparePlayerDirectionalCorpora(corpusA, corpusB).equal, true);

const changed = longSamples.slice();
changed[321] = { ...changed[321], planarSpeedMps: 10, surfaceSlip: 1 };
const corpusChanged = buildPlayerDirectionalReplayCorpus([
  { samples: longSamples.slice(0, 300), metadata: { name: 'a' } },
  { samples: changed.slice(300, 400), metadata: { name: 'd' } },
]);
const compactOriginal = buildPlayerDirectionalReplayCorpus([
  { samples: longSamples.slice(0, 300), metadata: { name: 'a' } },
  { samples: longSamples.slice(300, 400), metadata: { name: 'd' } },
]);
assert.equal(comparePlayerDirectionalCorpora(compactOriginal, corpusChanged).equal, false);

console.log('PLAYER_DIRECTIONAL_LOCOMOTION_INVARIANT_MATRIX_PASS');
