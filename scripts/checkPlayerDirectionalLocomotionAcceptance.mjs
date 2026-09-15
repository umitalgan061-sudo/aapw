import assert from 'node:assert/strict';
import {
  PLAYER_DIRECTIONAL_DIRECTIONS,
  PLAYER_DIRECTIONAL_SEMANTICS,
  createPlayerDirectionalScenario,
  resolvePlayerDirectionalBlendWeights,
  resolvePlayerDirectionalFullPresentation,
  validatePlayerDirectionalBlendWeights,
  validatePlayerDirectionalPresentation,
} from '../src/3d/gameplay/playerDirectionalLocomotionPolicy.js';
import {
  buildPlayerDirectionalTelemetryScenario,
  comparePlayerDirectionalTelemetry,
} from '../src/3d/gameplay/playerDirectionalLocomotionTelemetry.js';
import {
  comparePlayerDirectionalCorpora,
  comparePlayerDirectionalReplayRuns,
  createPlayerDirectionalReplayDigest,
  createPlayerDirectionalReplayTape,
  perturbPlayerDirectionalReplaySample,
  buildPlayerDirectionalReplayCorpus,
  replayPlayerDirectionalSamples,
  summarizePlayerDirectionalReplay,
} from '../src/3d/gameplay/playerDirectionalLocomotionReplay.js';

function assertRange(value, min, max, label) {
  assert.equal(Number.isFinite(value), true, `${label} finite`);
  assert.ok(value >= min && value <= max, `${label} in range`);
}

function scenarioSample(index, overrides = {}) {
  const angle = (index % 8) * (Math.PI / 4);
  return {
    velocity: { x: Math.sin(angle), y: Math.cos(angle) },
    facing: { x: 0, y: 1 },
    planarSpeedMps: 0.5 + (index % 12) * 0.62,
    slopeDegrees: (index * 7) % 50,
    turnRateDegreesPerSecond: (index * 53) % 520,
    previousPhase: (index * 0.17) % 1,
    deltaSeconds: 1 / 60,
    surfaceConfidence: 0.35 + ((index * 0.13) % 0.65),
    surfaceSlip: (index % 5) / 10,
    ...overrides,
  };
}

const matrix = Array.from({ length: 48 }, (_, index) => scenarioSample(index));

for (const [index, input] of matrix.entries()) {
  const presentation = resolvePlayerDirectionalFullPresentation(input);
  assert.equal(validatePlayerDirectionalPresentation(presentation).ok, true, `presentation-${index}`);
  assert.equal(validatePlayerDirectionalBlendWeights(presentation.blendWeights), true, `blend-${index}`);
  assert.ok(PLAYER_DIRECTIONAL_DIRECTIONS.includes(presentation.dominantDirection));
  assert.ok(PLAYER_DIRECTIONAL_SEMANTICS.includes(presentation.semanticState));
  assertRange(presentation.playbackRate, 0.72, 1.35, `rate-${index}`);
  assertRange(presentation.cadenceScale, 0.68, 1.22, `cadence-${index}`);
  assertRange(presentation.phase.phase, 0, 1, `phase-${index}`);
}

for (const angle of Array.from({ length: 65 }, (_, index) => -Math.PI + index * (Math.PI / 32))) {
  const weights = resolvePlayerDirectionalBlendWeights({
    velocity: { x: Math.sin(angle), y: Math.cos(angle) },
    facing: { x: 0, y: 1 },
    planarSpeedMps: 4,
  });
  assert.equal(validatePlayerDirectionalBlendWeights(weights), true);
  assert.equal(Object.values(weights).filter((value) => value > 0).length <= 2, true);
}

const replayA = replayPlayerDirectionalSamples(matrix, { name: 'matrix', seed: 'a' });
const replayB = replayPlayerDirectionalSamples(matrix, { name: 'matrix', seed: 'a' });
assert.equal(comparePlayerDirectionalReplayRuns(replayA, replayB).equal, true);
assert.equal(replayA.fingerprint, replayB.fingerprint);
assert.deepEqual(createPlayerDirectionalReplayDigest(replayA), createPlayerDirectionalReplayDigest(replayB));
assert.equal(summarizePlayerDirectionalReplay(replayA).frameCount, matrix.length);

const changedMatrix = matrix.map((sample, index) => index === 25
  ? perturbPlayerDirectionalReplaySample(sample, { speedDelta: 1.2, turnDelta: 80 })
  : sample);
const replayChanged = replayPlayerDirectionalSamples(changedMatrix, { name: 'matrix', seed: 'a' });
const replayDiff = comparePlayerDirectionalReplayRuns(replayA, replayChanged);
assert.equal(replayDiff.equal, false);
assert.ok(replayDiff.differences.includes(25));

const corpusA = buildPlayerDirectionalReplayCorpus([
  { samples: matrix.slice(0, 8), metadata: { name: 'north' } },
  { samples: matrix.slice(8, 16), metadata: { name: 'diagonal' } },
  { samples: matrix.slice(16, 24), metadata: { name: 'terrain' } },
]);
const corpusB = buildPlayerDirectionalReplayCorpus([
  { samples: matrix.slice(0, 8), metadata: { name: 'north' } },
  { samples: matrix.slice(8, 16), metadata: { name: 'diagonal' } },
  { samples: matrix.slice(16, 24), metadata: { name: 'terrain' } },
]);
assert.equal(comparePlayerDirectionalCorpora(corpusA, corpusB).equal, true);

const corpusChanged = buildPlayerDirectionalReplayCorpus([
  { samples: matrix.slice(0, 8), metadata: { name: 'north' } },
  { samples: changedMatrix.slice(8, 16), metadata: { name: 'diagonal' } },
  { samples: matrix.slice(16, 24), metadata: { name: 'terrain' } },
]);
assert.equal(comparePlayerDirectionalCorpora(corpusA, corpusChanged).equal, false);

const telemetryA = buildPlayerDirectionalTelemetryScenario(matrix.slice(0, 24));
const telemetryB = buildPlayerDirectionalTelemetryScenario(matrix.slice(0, 24));
assert.equal(comparePlayerDirectionalTelemetry(telemetryA, telemetryB).equal, true);
assert.equal(telemetryA.fingerprint, telemetryB.fingerprint);
assert.ok(telemetryA.quality.score >= 0);
assert.ok(telemetryA.quality.score <= 1);

const modes = [
  { name: 'idle', sample: scenarioSample(0, { planarSpeedMps: 0 }) },
  { name: 'walk', sample: scenarioSample(1, { planarSpeedMps: 2.4 }) },
  { name: 'sprint', sample: scenarioSample(2, { planarSpeedMps: 6.3, runIntent: true }) },
  { name: 'guard', sample: scenarioSample(3, { guarding: true }) },
  { name: 'light', sample: scenarioSample(4, { attackKind: 'light' }) },
  { name: 'heavy', sample: scenarioSample(5, { attackKind: 'heavy' }) },
  { name: 'dodge', sample: scenarioSample(6, { dodgeRemaining: 0.2 }) },
  { name: 'stagger', sample: scenarioSample(7, { hitStaggerRemaining: 0.2 }) },
];
for (const mode of modes) {
  const p = resolvePlayerDirectionalFullPresentation(mode.sample);
  assert.equal(typeof p.semanticState, 'string', `${mode.name}-semantic`);
  assert.equal(validatePlayerDirectionalPresentation(p).ok, true, `${mode.name}-valid`);
}

const phaseChain = [];
let previousPhase = 0.98;
for (let index = 0; index < 40; index += 1) {
  const p = resolvePlayerDirectionalFullPresentation(scenarioSample(index, {
    previousPhase,
    planarSpeedMps: 6,
  }));
  phaseChain.push(p.phase.phase);
  previousPhase = p.phase.phase;
}
for (const phase of phaseChain) assertRange(phase, 0, 1, 'phase-chain');
assert.ok(phaseChain.some((value, index) => index > 0 && value < phaseChain[index - 1]));

const surfaceChain = Array.from({ length: 20 }, (_, index) => resolvePlayerDirectionalFullPresentation(scenarioSample(index, {
  surfaceConfidence: index / 20,
  surfaceSlip: (20 - index) / 40,
  slopeDegrees: index * 2,
})));
for (const p of surfaceChain) {
  assertRange(p.surface.confidence, 0, 1, 'surface-confidence');
  assertRange(p.surface.groundedConfidence, 0, 1, 'grounded-confidence');
  assertRange(p.surface.footPlantWeight, 0, 1, 'foot-plant');
}

const directionStress = [];
for (let index = 0; index < 160; index += 1) {
  directionStress.push(resolvePlayerDirectionalFullPresentation(scenarioSample(index)));
}
assert.equal(directionStress.length, 160);
assert.ok(new Set(directionStress.map((p) => p.dominantDirection)).size >= 4);
assert.ok(new Set(directionStress.map((p) => p.slopeClass)).size >= 3);
assert.ok(new Set(directionStress.map((p) => p.turn.class)).size >= 3);

const oneShot = createPlayerDirectionalReplayTape(matrix.slice(0, 4), { name: 'small' });
assert.equal(oneShot.sampleCount, 4);
assert.equal(oneShot.metadata.name, 'small');
assert.equal(oneShot.fingerprint.length >= 8, true);

const scenario = createPlayerDirectionalScenario(matrix.slice(0, 10));
assert.equal(scenario.count, 10);
assert.equal(scenario.valid, true);
assert.equal(scenario.finalState.frameCount, 10);

console.log('PLAYER_DIRECTIONAL_LOCOMOTION_ACCEPTANCE_PASS');
