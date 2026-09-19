/** Deterministic replay and diff helpers for locomotion anticipation. */
import {
  createPlayerLocomotionAnticipationState,
  advancePlayerLocomotionAnticipationState,
  resolvePlayerLocomotionAnticipationProfile,
  validatePlayerLocomotionAnticipationProfile,
  validatePlayerLocomotionAnticipationState,
} from './playerLocomotionAnticipationPolicy.js';
import {
  createPlayerLocomotionAnticipationTelemetryState,
  advancePlayerLocomotionAnticipationTelemetry,
  createPlayerLocomotionAnticipationTelemetryReadModel,
} from './playerLocomotionAnticipationTelemetry.js';

export const PLAYER_LOCOMOTION_ANTICIPATION_REPLAY_VERSION = '2026-09-15-v1';
export const PLAYER_LOCOMOTION_ANTICIPATION_REPLAY_LIMITS = Object.freeze({ maxFrames: 600, maxDiffs: 128, maxScenarios: 64 });

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function freeze(value) { return Object.freeze(value); }
function fingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function copySample(sample) {
  return freeze({
    ...(sample ?? {}),
    velocity: freeze({ x: finite(sample?.velocity?.x), y: finite(sample?.velocity?.y) }),
    facing: freeze({ x: finite(sample?.facing?.x), y: finite(sample?.facing?.y, 1) }),
  });
}

export function createPlayerLocomotionAnticipationReplayTape(samples = [], metadata = {}) {
  const list = (Array.isArray(samples) ? samples : []).slice(0, 600).map(copySample);
  const base = { version: PLAYER_LOCOMOTION_ANTICIPATION_REPLAY_VERSION, sampleCount: list.length, metadata: { name: String(metadata.name ?? 'unnamed'), seed: String(metadata.seed ?? 'default') }, samples: freeze(list) };
  return freeze({ ...base, metadata: freeze(base.metadata), fingerprint: fingerprint(base) });
}

export function validatePlayerLocomotionAnticipationReplayTape(tape = {}) {
  const samples = Array.isArray(tape.samples);
  const bounded = samples && tape.samples.length <= 600;
  const version = tape.version === PLAYER_LOCOMOTION_ANTICIPATION_REPLAY_VERSION;
  const count = samples && Number.isInteger(tape.sampleCount) && tape.sampleCount === tape.samples.length;
  const fingerprintOk = typeof tape.fingerprint === 'string' && tape.fingerprint.length >= 8;
  return freeze({ ok: samples && bounded && version && count && fingerprintOk, samples, bounded, version, count, fingerprintOk });
}

export function replayPlayerLocomotionAnticipationTape(tape = {}) {
  const validation = validatePlayerLocomotionAnticipationReplayTape(tape);
  if (!validation.ok) throw new TypeError('invalid locomotion anticipation replay tape');
  let state = createPlayerLocomotionAnticipationState();
  let telemetry = createPlayerLocomotionAnticipationTelemetryState();
  let previous = null;
  const frames = [];
  for (let index = 0; index < tape.samples.length; index += 1) {
    const input = tape.samples[index];
    const profile = resolvePlayerLocomotionAnticipationProfile(input, previous);
    state = advancePlayerLocomotionAnticipationState(state, input, previous);
    telemetry = advancePlayerLocomotionAnticipationTelemetry(telemetry, input, index);
    frames.push(freeze({ index, input, profile, state, telemetry: createPlayerLocomotionAnticipationTelemetryReadModel(telemetry) }));
    previous = profile;
  }
  const finalState = frames.at(-1)?.state ?? state;
  return freeze({
    version: PLAYER_LOCOMOTION_ANTICIPATION_REPLAY_VERSION,
    sampleCount: frames.length,
    frames: freeze(frames),
    finalState,
    finalTelemetry: frames.at(-1)?.telemetry ?? createPlayerLocomotionAnticipationTelemetryReadModel(telemetry),
    valid: validatePlayerLocomotionAnticipationState(finalState).ok,
    profilesValid: frames.every((frame) => validatePlayerLocomotionAnticipationProfile(frame.profile).ok),
    fingerprint: fingerprint(frames),
  });
}

export function replayPlayerLocomotionAnticipationSamples(samples = [], metadata = {}) {
  return replayPlayerLocomotionAnticipationTape(createPlayerLocomotionAnticipationReplayTape(samples, metadata));
}

export function comparePlayerLocomotionAnticipationReplayRuns(first = {}, second = {}) {
  const left = Array.isArray(first.frames) ? first.frames : [];
  const right = Array.isArray(second.frames) ? second.frames : [];
  const differences = [];
  for (let index = 0; index < Math.max(left.length, right.length) && differences.length < 128; index += 1) {
    if (JSON.stringify(left[index]) !== JSON.stringify(right[index])) differences.push(index);
  }
  return freeze({ equal: left.length === right.length && differences.length === 0, differences: freeze(differences), firstFingerprint: String(first.fingerprint ?? ''), secondFingerprint: String(second.fingerprint ?? ''), leftFrames: left.length, rightFrames: right.length });
}

export function diffPlayerLocomotionAnticipationFrame(first = {}, second = {}, frameIndex = 0) {
  const a = first.frames?.[frameIndex];
  const b = second.frames?.[frameIndex];
  if (!a || !b) return freeze({ equal: false, reason: 'missing-frame', frameIndex });
  const fields = [
    ['mode', a.profile?.mode, b.profile?.mode],
    ['presentDirection', a.profile?.presentDirection, b.profile?.presentDirection],
    ['anticipatedDirection', a.profile?.anticipatedDirection, b.profile?.anticipatedDirection],
    ['speedMps', a.profile?.speedMps, b.profile?.speedMps],
    ['speedDeltaMps', a.profile?.speedDeltaMps, b.profile?.speedDeltaMps],
    ['startWeight', a.profile?.startWeight, b.profile?.startWeight],
    ['brakeWeight', a.profile?.brakeWeight, b.profile?.brakeWeight],
    ['pivotWeight', a.profile?.pivotWeight, b.profile?.pivotWeight],
    ['phase', a.profile?.phase, b.profile?.phase],
  ];
  const differences = fields.filter(([, l, r]) => JSON.stringify(l) !== JSON.stringify(r)).map(([name, l, r]) => freeze({ name, left: l, right: r }));
  return freeze({ equal: differences.length === 0, frameIndex, differences: freeze(differences) });
}

export function summarizePlayerLocomotionAnticipationReplay(replay = {}) {
  const modes = {};
  const directions = {};
  let pivots = 0; let starts = 0; let brakes = 0; let stops = 0; let maxSpeed = 0; let maxGroundRisk = 0;
  for (const frame of Array.isArray(replay.frames) ? replay.frames : []) {
    const p = frame.profile ?? {};
    modes[p.mode] = (modes[p.mode] ?? 0) + 1;
    directions[p.anticipatedDirection] = (directions[p.anticipatedDirection] ?? 0) + 1;
    pivots += p.mode === 'pivot' ? 1 : 0;
    starts += p.mode === 'start' ? 1 : 0;
    brakes += p.mode === 'brake' ? 1 : 0;
    stops += p.mode === 'stop' ? 1 : 0;
    maxSpeed = Math.max(maxSpeed, finite(p.speedMps));
    maxGroundRisk = Math.max(maxGroundRisk, finite(p.groundRisk));
  }
  return freeze({ frameCount: replay.frames?.length ?? 0, modeHistogram: freeze(modes), directionHistogram: freeze(directions), pivots, starts, brakes, stops, maxSpeed, maxGroundRisk, fingerprint: String(replay.fingerprint ?? '') });
}

export function perturbPlayerLocomotionAnticipationSample(sample = {}, perturbation = {}) {
  return freeze({ ...sample, planarSpeedMps: finite(sample.planarSpeedMps) + finite(perturbation.speedDelta), turnRateDegreesPerSecond: finite(sample.turnRateDegreesPerSecond) + finite(perturbation.turnDelta), slopeDegrees: finite(sample.slopeDegrees) + finite(perturbation.slopeDelta), surfaceConfidence: finite(sample.surfaceConfidence, 1) + finite(perturbation.confidenceDelta), surfaceSlip: finite(sample.surfaceSlip) + finite(perturbation.slipDelta) });
}

export function buildPlayerLocomotionAnticipationReplayCorpus(scenarios = []) {
  const list = (Array.isArray(scenarios) ? scenarios : []).slice(0, 64);
  const corpus = list.map((scenario, index) => {
    const tape = createPlayerLocomotionAnticipationReplayTape(scenario.samples, { ...scenario.metadata, name: scenario.metadata?.name ?? `scenario-${index + 1}` });
    const replay = replayPlayerLocomotionAnticipationTape(tape);
    return freeze({ index, name: tape.metadata.name, tape, replay, summary: summarizePlayerLocomotionAnticipationReplay(replay) });
  });
  return freeze({ version: PLAYER_LOCOMOTION_ANTICIPATION_REPLAY_VERSION, count: corpus.length, corpus: freeze(corpus), fingerprint: fingerprint(corpus.map((entry) => entry.replay.fingerprint)) });
}

export function comparePlayerLocomotionAnticipationCorpora(first = {}, second = {}) {
  const left = first.corpus ?? []; const right = second.corpus ?? []; const differences = [];
  for (let index = 0; index < Math.max(left.length, right.length) && differences.length < 128; index += 1) {
    if ((left[index]?.replay?.fingerprint ?? null) !== (right[index]?.replay?.fingerprint ?? null)) differences.push(index);
  }
  return freeze({ equal: left.length === right.length && differences.length === 0, differences: freeze(differences), leftCount: left.length, rightCount: right.length });
}

export function createPlayerLocomotionAnticipationReplayDigest(replay = {}) {
  const summary = summarizePlayerLocomotionAnticipationReplay(replay);
  return freeze({ version: PLAYER_LOCOMOTION_ANTICIPATION_REPLAY_VERSION, sampleCount: summary.frameCount, fingerprint: summary.fingerprint, pivots: summary.pivots, starts: summary.starts, brakes: summary.brakes, stops: summary.stops, modes: summary.modeHistogram, directions: summary.directionHistogram });
}

export function auditPlayerLocomotionAnticipationReplay() {
  const empty = replayPlayerLocomotionAnticipationSamples([]);
  return freeze({ version: PLAYER_LOCOMOTION_ANTICIPATION_REPLAY_VERSION, valid: empty.valid, profileContract: empty.profilesValid, sampleCount: empty.sampleCount, fingerprintLength: empty.fingerprint.length, limits: freeze({ ...PLAYER_LOCOMOTION_ANTICIPATION_REPLAY_LIMITS }) });
}
