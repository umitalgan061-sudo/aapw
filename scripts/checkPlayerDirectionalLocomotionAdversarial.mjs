import assert from 'node:assert/strict';
import {
  PLAYER_DIRECTIONAL_DIRECTIONS,
  PLAYER_DIRECTIONAL_SEMANTICS,
  createPlayerDirectionalLocomotionState,
  normalizePlayerDirectionalInput,
  resolvePlayerDirectionalBlendWeights,
  resolvePlayerDirectionalFullPresentation,
  resolvePlayerDirectionalPlaybackRate,
  resolvePlayerDirectionalPhaseStep,
  resolvePlayerDirectionalTurnAmount,
  resolvePlayerDirectionalSurfaceScale,
  resolvePlayerDirectionalSlopeScale,
  validatePlayerDirectionalPresentation,
  validatePlayerDirectionalState,
  advancePlayerDirectionalLocomotionState,
} from '../src/3d/gameplay/playerDirectionalLocomotionPolicy.js';
import {
  advancePlayerDirectionalTelemetry,
  createPlayerDirectionalTelemetryState,
  createPlayerDirectionalTelemetryReadModel,
  resolvePlayerDirectionalTelemetryBudget,
  buildPlayerDirectionalTelemetryScenario,
} from '../src/3d/gameplay/playerDirectionalLocomotionTelemetry.js';
import {
  buildPlayerDirectionalReplayCorpus,
  comparePlayerDirectionalCorpora,
  comparePlayerDirectionalReplayRuns,
  createPlayerDirectionalReplayTape,
  perturbPlayerDirectionalReplaySample,
  replayPlayerDirectionalSamples,
  replayPlayerDirectionalTape,
} from '../src/3d/gameplay/playerDirectionalLocomotionReplay.js';

function safe(value) {
  return JSON.stringify(value);
}

function sample(index = 0, overrides = {}) {
  const angle = (index % 16) * (Math.PI / 8);
  return {
    velocity: { x: Math.sin(angle), y: Math.cos(angle) },
    facing: { x: 0, y: 1 },
    planarSpeedMps: (index % 13) * 0.83,
    slopeDegrees: (index * 11) % 56,
    turnRateDegreesPerSecond: (index * 71) % 541,
    previousPhase: (index * 0.073) % 1,
    deltaSeconds: 0.016666,
    surfaceConfidence: ((index * 0.19) % 1),
    surfaceSlip: ((index * 0.11) % 0.6),
    ...overrides,
  };
}

const extremeInputs = [
  sample(1, { planarSpeedMps: Infinity, turnRateDegreesPerSecond: Infinity, slopeDegrees: Infinity }),
  sample(2, { planarSpeedMps: NaN, turnRateDegreesPerSecond: NaN, slopeDegrees: NaN }),
  sample(3, { velocity: { x: Infinity, y: -Infinity }, facing: { x: Infinity, y: NaN } }),
  sample(4, { deltaSeconds: -100, previousPhase: -999999 }),
  sample(5, { surfaceConfidence: -100, surfaceSlip: 100 }),
  sample(6, { attackKind: 'heavy', planarSpeedMps: 12 }),
  sample(7, { hitStaggerRemaining: 10, dodgeRemaining: 10, attackKind: 'heavy', guarding: true }),
  sample(8, { dodgeRemaining: 10, attackKind: 'heavy', guarding: true }),
  sample(9, { attackKind: 'light', guarding: true }),
];

for (const [index, input] of extremeInputs.entries()) {
  const normalized = normalizePlayerDirectionalInput(input);
  assert.equal(Number.isFinite(normalized.planarSpeedMps), true, `normalized speed ${index}`);
  assert.equal(Number.isFinite(normalized.slopeDegrees), true, `normalized slope ${index}`);
  assert.equal(Number.isFinite(normalized.turnRateDegreesPerSecond), true, `normalized turn ${index}`);
  const presentation = resolvePlayerDirectionalFullPresentation(input);
  assert.equal(validatePlayerDirectionalPresentation(presentation).ok, true, `presentation ${index}`);
}

for (let index = 0; index < 512; index += 1) {
  const input = sample(index);
  const presentation = resolvePlayerDirectionalFullPresentation(input);
  const values = Object.values(presentation.blendWeights);
  assert.equal(values.length, PLAYER_DIRECTIONAL_DIRECTIONS.length);
  assert.ok(values.every((value) => value >= 0 && value <= 1));
  assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 0.0003);
  assert.ok(PLAYER_DIRECTIONAL_SEMANTICS.includes(presentation.semanticState));
  assert.ok(PLAYER_DIRECTIONAL_DIRECTIONS.includes(presentation.dominantDirection));
  assert.ok(presentation.playbackRate >= 0.72 && presentation.playbackRate <= 1.35);
}

const boundarySpeeds = [5.09, 5.1, 5.1001, 5.55, 5.5999, 5.6, 5.6001, 6.5];
for (const speed of boundarySpeeds) {
  const locomotion = resolvePlayerDirectionalFullPresentation(sample(20, { planarSpeedMps: speed }));
  assert.equal(validatePlayerDirectionalPresentation(locomotion).ok, true);
  assert.ok(locomotion.playbackRate >= 0.72 && locomotion.playbackRate <= 1.35);
}

for (let turn = 0; turn <= 540; turn += 15) {
  const amount = resolvePlayerDirectionalTurnAmount(sample(21, { turnRateDegreesPerSecond: turn, deltaSeconds: 0.1 }));
  assert.ok(amount >= 0 && amount <= 54);
}

for (let slope = 0; slope <= 55; slope += 5) {
  const scale = resolvePlayerDirectionalSlopeScale(sample(22, { slopeDegrees: slope }));
  assert.ok(scale >= 0.82 && scale <= 1);
}

for (let confidence = 0; confidence <= 1; confidence += 0.1) {
  for (let slip = 0; slip <= 1; slip += 0.2) {
    const scale = resolvePlayerDirectionalSurfaceScale(sample(23, { surfaceConfidence: confidence, surfaceSlip: slip }));
    assert.ok(scale >= 0.68 && scale <= 1);
  }
}

let state = createPlayerDirectionalLocomotionState();
for (let index = 0; index < 700; index += 1) {
  state = advancePlayerDirectionalLocomotionState(state, sample(index, {
    planarSpeedMps: 6.2,
    previousPhase: state.phase,
  }));
  assert.equal(validatePlayerDirectionalState(state).ok, true, `state-${index}`);
  assert.ok(state.frameCount === index + 1);
  assert.ok(state.transitionCount <= state.frameCount);
  assert.ok(state.phase >= 0 && state.phase < 1);
}
assert.ok(state.footstepCount > 0);
assert.ok(state.lastPresentationFingerprint.length >= 8);

let telemetry = createPlayerDirectionalTelemetryState();
for (let index = 0; index < 300; index += 1) {
  telemetry = advancePlayerDirectionalTelemetry(telemetry, sample(index), index);
}
const readModel = createPlayerDirectionalTelemetryReadModel(telemetry);
assert.equal(readModel.counters.samples, 300);
assert.ok(readModel.counters.samples <= 300);
assert.ok(readModel.recentEvents.length <= 12);
assert.ok(readModel.warnings.length <= 16);
assert.equal(resolvePlayerDirectionalTelemetryBudget(300, readModel.recentEvents.length).withinBudget, true);

const telemetryScenarioA = buildPlayerDirectionalTelemetryScenario(Array.from({ length: 80 }, (_, index) => sample(index)));
const telemetryScenarioB = buildPlayerDirectionalTelemetryScenario(Array.from({ length: 80 }, (_, index) => sample(index)));
assert.equal(telemetryScenarioA.fingerprint, telemetryScenarioB.fingerprint);
assert.equal(safe(telemetryScenarioA.final), safe(telemetryScenarioB.final));

const sourceSamples = Array.from({ length: 96 }, (_, index) => sample(index, {
  previousPhase: (index * 0.011) % 1,
}));
const tape = createPlayerDirectionalReplayTape(sourceSamples, { name: 'adversarial', seed: '42' });
assert.equal(replayPlayerDirectionalTape(tape).valid, true);
assert.equal(replayPlayerDirectionalTape(tape).fingerprint, replayPlayerDirectionalTape(tape).fingerprint);

const runA = replayPlayerDirectionalSamples(sourceSamples, { name: 'adversarial', seed: '42' });
const runB = replayPlayerDirectionalSamples(sourceSamples, { name: 'adversarial', seed: '42' });
assert.equal(comparePlayerDirectionalReplayRuns(runA, runB).equal, true);

const mutations = [
  { speedDelta: 0.001 },
  { speedDelta: 1.5 },
  { speedDelta: -2 },
  { turnDelta: 90 },
  { slopeDelta: 15 },
  { phaseDelta: 0.25 },
];
for (const [index, mutation] of mutations.entries()) {
  const mutated = sourceSamples.map((entry, sampleIndex) => sampleIndex === 48 + index
    ? perturbPlayerDirectionalReplaySample(entry, mutation)
    : entry);
  const mutatedRun = replayPlayerDirectionalSamples(mutated, { name: 'adversarial', seed: '42' });
  const comparison = comparePlayerDirectionalReplayRuns(runA, mutatedRun);
  assert.equal(comparison.equal, false, `mutation-${index}`);
  assert.ok(comparison.differences.length >= 1);
}

const corpusInputs = Array.from({ length: 12 }, (_, scenarioIndex) => ({
  samples: Array.from({ length: 16 }, (_, index) => sample(scenarioIndex * 16 + index)),
  metadata: { name: `scenario-${scenarioIndex}`, seed: String(scenarioIndex) },
}));
const corpusA = buildPlayerDirectionalReplayCorpus(corpusInputs);
const corpusB = buildPlayerDirectionalReplayCorpus(corpusInputs);
assert.equal(comparePlayerDirectionalCorpora(corpusA, corpusB).equal, true);
assert.equal(corpusA.count, 12);

const invalidTape = { ...tape, sampleCount: 99999 };
assert.equal(replayPlayerDirectionalTape(invalidTape).valid, true);

const cappedSamples = Array.from({ length: 700 }, (_, index) => sample(index));
const cappedRun = replayPlayerDirectionalSamples(cappedSamples, { name: 'cap-test' });
assert.equal(cappedRun.sampleCount, 600);
assert.ok(cappedRun.frames.length <= 600);

const emptyRun = replayPlayerDirectionalSamples([]);
assert.equal(emptyRun.sampleCount, 0);
assert.equal(emptyRun.valid, true);

const semanticOverrideInputs = [
  sample(30, { planarSpeedMps: 7, attackKind: 'heavy' }),
  sample(31, { planarSpeedMps: 7, dodgeRemaining: 0.2 }),
  sample(32, { planarSpeedMps: 7, hitStaggerRemaining: 0.2 }),
  sample(33, { planarSpeedMps: 7, guarding: true }),
];
const semanticStates = semanticOverrideInputs.map((input) => resolvePlayerDirectionalFullPresentation(input).semanticState);
assert.deepEqual(semanticStates, ['heavy-attack', 'dodge', 'hit-stagger', 'guard']);

let phase = 0;
for (let index = 0; index < 120; index += 1) {
  const step = resolvePlayerDirectionalPhaseStep(sample(index, { previousPhase: phase, planarSpeedMps: 7 }));
  phase = step.phase;
  assert.ok(phase >= 0 && phase < 1);
}

const combatStress = [
  ...Array.from({ length: 40 }, (_, index) => sample(index, { attackKind: index % 2 ? 'light' : 'heavy' })),
  ...Array.from({ length: 40 }, (_, index) => sample(index + 40, { guarding: true })),
  ...Array.from({ length: 40 }, (_, index) => sample(index + 80, { dodgeRemaining: 0.15 })),
  ...Array.from({ length: 40 }, (_, index) => sample(index + 120, { hitStaggerRemaining: 0.15 })),
];
for (const input of combatStress) {
  const p = resolvePlayerDirectionalFullPresentation(input);
  assert.equal(validatePlayerDirectionalPresentation(p).ok, true);
}

console.log('PLAYER_DIRECTIONAL_LOCOMOTION_ADVERSARIAL_PASS');
