/**
 * Replay and diff helpers for directional locomotion presentation scenarios.
 *
 * Inputs are treated as immutable observations. The replay does not own player simulation and
 * does not mutate the source samples.
 *
 * @module gameplay/playerDirectionalLocomotionReplay
 */

import {
  PLAYER_DIRECTIONAL_DIRECTIONS,
  PLAYER_DIRECTIONAL_SEMANTICS,
  advancePlayerDirectionalLocomotionState,
  createPlayerDirectionalLocomotionState,
  resolvePlayerDirectionalFingerprint,
  resolvePlayerDirectionalFullPresentation,
  validatePlayerDirectionalState,
} from './playerDirectionalLocomotionPolicy.js';
import {
  advancePlayerDirectionalTelemetry,
  createPlayerDirectionalTelemetryState,
  createPlayerDirectionalTelemetryReadModel,
  resolvePlayerDirectionalTelemetryQuality,
} from './playerDirectionalLocomotionTelemetry.js';

export const PLAYER_DIRECTIONAL_REPLAY_VERSION = '2026-09-15-v1';

export const PLAYER_DIRECTIONAL_REPLAY_LIMITS = Object.freeze({
  maxFrames: 600,
  maxDiffs: 128,
  maxScenarios: 64,
});

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function freeze(value) {
  return Object.freeze(value);
}

function copySamples(samples) {
  return (Array.isArray(samples) ? samples : []).slice(0, PLAYER_DIRECTIONAL_REPLAY_LIMITS.maxFrames).map((sample) => freeze({ ...(sample ?? {}) }));
}

export function createPlayerDirectionalReplayTape(samples = [], metadata = {}) {
  const normalizedSamples = copySamples(samples);
  return freeze({
    version: PLAYER_DIRECTIONAL_REPLAY_VERSION,
    sampleCount: normalizedSamples.length,
    samples: freeze(normalizedSamples),
    metadata: freeze({
      name: String(metadata.name ?? 'unnamed'),
      source: String(metadata.source ?? 'runtime-observation'),
      seed: String(metadata.seed ?? 'default'),
    }),
    fingerprint: resolvePlayerDirectionalFingerprint({ samples: normalizedSamples, metadata }),
  });
}

export function validatePlayerDirectionalReplayTape(tape = {}) {
  const samples = Array.isArray(tape.samples);
  const bounded = samples && tape.samples.length <= PLAYER_DIRECTIONAL_REPLAY_LIMITS.maxFrames;
  const version = tape.version === PLAYER_DIRECTIONAL_REPLAY_VERSION;
  const fingerprint = typeof tape.fingerprint === 'string' && tape.fingerprint.length >= 8;
  return freeze({ ok: samples && bounded && version && fingerprint, samples, bounded, version, fingerprint });
}

export function replayPlayerDirectionalTape(tape = {}) {
  const validation = validatePlayerDirectionalReplayTape(tape);
  if (!validation.ok) throw new TypeError('invalid directional replay tape');
  let state = createPlayerDirectionalLocomotionState();
  let telemetry = createPlayerDirectionalTelemetryState();
  const frames = [];
  for (let index = 0; index < tape.samples.length; index += 1) {
    const sample = tape.samples[index];
    const presentation = resolvePlayerDirectionalFullPresentation(sample, state.semanticState);
    state = advancePlayerDirectionalLocomotionState(state, sample);
    telemetry = advancePlayerDirectionalTelemetry(telemetry, sample, index);
    frames.push(freeze({
      index,
      state,
      presentation,
      telemetry: createPlayerDirectionalTelemetryReadModel(telemetry),
    }));
  }
  const finalState = frames.at(-1)?.state ?? state;
  const finalTelemetry = frames.at(-1)?.telemetry ?? createPlayerDirectionalTelemetryReadModel(telemetry);
  return freeze({
    version: PLAYER_DIRECTIONAL_REPLAY_VERSION,
    sampleCount: frames.length,
    frames: freeze(frames),
    finalState,
    finalTelemetry,
    valid: validatePlayerDirectionalState(finalState).ok,
    quality: resolvePlayerDirectionalTelemetryQuality(finalTelemetry),
    fingerprint: resolvePlayerDirectionalFingerprint(frames),
  });
}

export function replayPlayerDirectionalSamples(samples = [], metadata = {}) {
  return replayPlayerDirectionalTape(createPlayerDirectionalReplayTape(samples, metadata));
}

export function comparePlayerDirectionalReplayRuns(first = {}, second = {}) {
  const firstFrames = Array.isArray(first.frames) ? first.frames : [];
  const secondFrames = Array.isArray(second.frames) ? second.frames : [];
  const length = Math.max(firstFrames.length, secondFrames.length);
  const diffs = [];
  for (let index = 0; index < length && diffs.length < PLAYER_DIRECTIONAL_REPLAY_LIMITS.maxDiffs; index += 1) {
    if (JSON.stringify(firstFrames[index]) !== JSON.stringify(secondFrames[index])) diffs.push(index);
  }
  return freeze({
    equal: diffs.length === 0 && firstFrames.length === secondFrames.length,
    firstFrames: firstFrames.length,
    secondFrames: secondFrames.length,
    differences: freeze(diffs),
    firstFingerprint: String(first.fingerprint ?? ''),
    secondFingerprint: String(second.fingerprint ?? ''),
  });
}

export function diffPlayerDirectionalReplayFrames(first = {}, second = {}, frameIndex = 0) {
  const a = first.frames?.[frameIndex];
  const b = second.frames?.[frameIndex];
  if (!a || !b) return freeze({ equal: false, reason: 'missing-frame', frameIndex });
  const fields = [
    ['semanticState', a.presentation?.semanticState, b.presentation?.semanticState],
    ['dominantDirection', a.presentation?.dominantDirection, b.presentation?.dominantDirection],
    ['phase', a.presentation?.phase?.phase, b.presentation?.phase?.phase],
    ['playbackRate', a.presentation?.playbackRate, b.presentation?.playbackRate],
    ['cadenceScale', a.presentation?.cadenceScale, b.presentation?.cadenceScale],
    ['slopeClass', a.presentation?.slopeClass, b.presentation?.slopeClass],
    ['turnClass', a.presentation?.turn?.class, b.presentation?.turn?.class],
  ];
  const differences = fields.filter(([, left, right]) => JSON.stringify(left) !== JSON.stringify(right)).map(([name, left, right]) => freeze({ name, left, right }));
  return freeze({ equal: differences.length === 0, frameIndex, differences: freeze(differences) });
}

export function summarizePlayerDirectionalReplay(replay = {}) {
  const frames = Array.isArray(replay.frames) ? replay.frames : [];
  const semanticCounts = Object.fromEntries(PLAYER_DIRECTIONAL_SEMANTICS.map((semantic) => [semantic, 0]));
  const directionCounts = Object.fromEntries(PLAYER_DIRECTIONAL_DIRECTIONS.map((direction) => [direction, 0]));
  let maxSpeed = 0;
  let maxTurnWeight = 0;
  let maxSlopeScale = 0;
  let footsteps = 0;
  for (const frame of frames) {
    const presentation = frame.presentation ?? {};
    if (semanticCounts[presentation.semanticState] !== undefined) semanticCounts[presentation.semanticState] += 1;
    if (directionCounts[presentation.dominantDirection] !== undefined) directionCounts[presentation.dominantDirection] += 1;
    maxSpeed = Math.max(maxSpeed, finite(presentation.speedMps));
    maxTurnWeight = Math.max(maxTurnWeight, finite(presentation.turn?.weight));
    maxSlopeScale = Math.max(maxSlopeScale, finite(presentation.slopeScale));
    if (presentation.foot?.emitted) footsteps += 1;
  }
  return freeze({
    frameCount: frames.length,
    semanticCounts: freeze(semanticCounts),
    directionCounts: freeze(directionCounts),
    maxSpeed,
    maxTurnWeight,
    maxSlopeScale,
    footsteps,
    fingerprint: String(replay.fingerprint ?? ''),
  });
}

export function resolvePlayerDirectionalReplayEventBudget(replay = {}) {
  const frames = Array.isArray(replay.frames) ? replay.frames.length : 0;
  const events = replay.finalTelemetry?.counters?.footsteps ?? 0;
  return freeze({
    frames,
    events,
    framesWithinBudget: frames <= PLAYER_DIRECTIONAL_REPLAY_LIMITS.maxFrames,
    diffsWithinBudget: events <= PLAYER_DIRECTIONAL_REPLAY_LIMITS.maxDiffs,
  });
}

export function buildPlayerDirectionalReplayCorpus(scenarios = []) {
  const list = Array.isArray(scenarios) ? scenarios.slice(0, PLAYER_DIRECTIONAL_REPLAY_LIMITS.maxScenarios) : [];
  const corpus = list.map((scenario, index) => {
    const tape = createPlayerDirectionalReplayTape(scenario.samples, { ...scenario.metadata, name: scenario.metadata?.name ?? `scenario-${index + 1}` });
    const replay = replayPlayerDirectionalTape(tape);
    return freeze({ index, name: tape.metadata.name, tape, replay, summary: summarizePlayerDirectionalReplay(replay) });
  });
  return freeze({
    version: PLAYER_DIRECTIONAL_REPLAY_VERSION,
    count: corpus.length,
    corpus: freeze(corpus),
    fingerprint: resolvePlayerDirectionalFingerprint(corpus.map((entry) => entry.replay.fingerprint)),
  });
}

export function comparePlayerDirectionalCorpora(first = {}, second = {}) {
  const left = Array.isArray(first.corpus) ? first.corpus : [];
  const right = Array.isArray(second.corpus) ? second.corpus : [];
  const count = Math.max(left.length, right.length);
  const differences = [];
  for (let index = 0; index < count && differences.length < PLAYER_DIRECTIONAL_REPLAY_LIMITS.maxDiffs; index += 1) {
    const leftFingerprint = left[index]?.replay?.fingerprint ?? null;
    const rightFingerprint = right[index]?.replay?.fingerprint ?? null;
    if (leftFingerprint !== rightFingerprint) differences.push(index);
  }
  return freeze({ equal: differences.length === 0 && left.length === right.length, differences: freeze(differences), leftCount: left.length, rightCount: right.length });
}

export function createPlayerDirectionalReplayDigest(replay = {}) {
  const summary = summarizePlayerDirectionalReplay(replay);
  return freeze({
    version: PLAYER_DIRECTIONAL_REPLAY_VERSION,
    sampleCount: summary.frameCount,
    fingerprint: String(replay.fingerprint ?? ''),
    finalStateFingerprint: resolvePlayerDirectionalFingerprint(replay.finalState ?? {}),
    telemetryFingerprint: resolvePlayerDirectionalFingerprint(replay.finalTelemetry ?? {}),
    semantics: summary.semanticCounts,
    directions: summary.directionCounts,
    footsteps: summary.footsteps,
  });
}

export function resolvePlayerDirectionalReplayLimits() {
  return freeze({ ...PLAYER_DIRECTIONAL_REPLAY_LIMITS });
}

export function auditPlayerDirectionalReplay() {
  const empty = replayPlayerDirectionalSamples([]);
  return freeze({
    version: PLAYER_DIRECTIONAL_REPLAY_VERSION,
    valid: empty.valid,
    sampleCount: empty.sampleCount,
    fingerprintLength: empty.fingerprint.length,
    limits: resolvePlayerDirectionalReplayLimits(),
  });
}

export function perturbPlayerDirectionalReplaySample(sample = {}, perturbation = {}) {
  return freeze({
    ...sample,
    planarSpeedMps: clamp(finite(sample.planarSpeedMps, 0) + finite(perturbation.speedDelta, 0), 0, 12),
    turnRateDegreesPerSecond: clamp(finite(sample.turnRateDegreesPerSecond, 0) + finite(perturbation.turnDelta, 0), 0, 540),
    slopeDegrees: clamp(finite(sample.slopeDegrees, 0) + finite(perturbation.slopeDelta, 0), 0, 55),
    previousPhase: finite(sample.previousPhase, 0) + finite(perturbation.phaseDelta, 0),
  });
}
