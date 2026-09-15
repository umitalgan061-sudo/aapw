/** Deterministic bounded telemetry for locomotion anticipation presentation. */
import {
  PLAYER_DIRECTIONAL_DIRECTIONS,
  resolvePlayerDirectionalFingerprint,
} from './playerDirectionalLocomotionPolicy.js';
import {
  PLAYER_LOCOMOTION_ANTICIPATION_MODES,
  resolvePlayerLocomotionAnticipationProfile,
  validatePlayerLocomotionAnticipationProfile,
} from './playerLocomotionAnticipationPolicy.js';

export const PLAYER_LOCOMOTION_ANTICIPATION_TELEMETRY_VERSION = '2026-09-15-v1';
export const PLAYER_LOCOMOTION_ANTICIPATION_TELEMETRY_LIMITS = Object.freeze({ maxSamples: 240, maxEvents: 96, maxHistory: 48, maxWarnings: 24 });

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, digits = 4) { const f = 10 ** digits; return Math.round(finite(value) * f) / f; }
function freeze(value) { return Object.freeze(value); }
function bounded(list, value, max) { const next = [...(Array.isArray(list) ? list : []), value]; return next.length > max ? next.slice(next.length - max) : next; }
function createHistogram(keys) { return Object.fromEntries(keys.map((key) => [key, 0])); }

export function createPlayerLocomotionAnticipationTelemetryState() {
  return freeze({
    counters: freeze({ samples: 0, validSamples: 0, invalidSamples: 0, modeChanges: 0, directionChanges: 0, pivots: 0, starts: 0, brakes: 0, stops: 0, lowConfidence: 0, highSlip: 0, highGroundRisk: 0 }),
    latest: null,
    modeHistogram: freeze(createHistogram(PLAYER_LOCOMOTION_ANTICIPATION_MODES)),
    directionHistogram: freeze(createHistogram(PLAYER_DIRECTIONAL_DIRECTIONS)),
    events: freeze([]),
    warnings: freeze([]),
    history: freeze([]),
  });
}

export function resolvePlayerLocomotionAnticipationTelemetryEvent(previous, current, index = 0) {
  const events = [];
  if (!previous) return [freeze({ type: 'initial', index, mode: current.mode })];
  if (previous.mode !== current.mode) events.push(freeze({ type: 'mode-change', index, from: previous.mode, to: current.mode }));
  if (previous.anticipatedDirection !== current.anticipatedDirection) events.push(freeze({ type: 'direction-change', index, from: previous.anticipatedDirection, to: current.anticipatedDirection }));
  if (current.mode === 'pivot' && previous.mode !== 'pivot') events.push(freeze({ type: 'pivot', index, angle: current.directionShiftDegrees, weight: current.pivotWeight }));
  if (current.mode === 'start' && previous.mode !== 'start') events.push(freeze({ type: 'start', index, weight: current.startWeight }));
  if (current.mode === 'brake' && previous.mode !== 'brake') events.push(freeze({ type: 'brake', index, weight: current.brakeWeight }));
  if (current.mode === 'stop' && previous.mode !== 'stop') events.push(freeze({ type: 'stop', index, distance: current.stopDistanceMeters }));
  if (current.confidence < 0.5 && previous.confidence >= 0.5) events.push(freeze({ type: 'confidence-drop', index, confidence: current.confidence }));
  if (current.surfaceSlip >= 0.55 && previous.surfaceSlip < 0.55) events.push(freeze({ type: 'slip-rise', index, slip: current.surfaceSlip }));
  return events;
}

export function advancePlayerLocomotionAnticipationTelemetry(state, input, index = 0) {
  const prior = state || createPlayerLocomotionAnticipationTelemetryState();
  const current = resolvePlayerLocomotionAnticipationProfile(input, prior.latest?.semanticState ?? 'idle');
  const validation = validatePlayerLocomotionAnticipationProfile(current);
  const previous = prior.latest;
  const emitted = resolvePlayerLocomotionAnticipationTelemetryEvent(previous, current, index);
  let counters = { ...prior.counters, samples: prior.counters.samples + 1 };
  counters.validSamples += validation.ok ? 1 : 0;
  counters.invalidSamples += validation.ok ? 0 : 1;
  counters.modeChanges += previous?.mode !== current.mode ? 1 : 0;
  counters.directionChanges += previous?.anticipatedDirection !== current.anticipatedDirection ? 1 : 0;
  counters.pivots += current.mode === 'pivot' ? 1 : 0;
  counters.starts += current.mode === 'start' ? 1 : 0;
  counters.brakes += current.mode === 'brake' ? 1 : 0;
  counters.stops += current.mode === 'stop' ? 1 : 0;
  counters.lowConfidence += current.confidence < 0.5 ? 1 : 0;
  counters.highSlip += current.surfaceSlip >= 0.55 ? 1 : 0;
  counters.highGroundRisk += current.groundRisk >= 0.6 ? 1 : 0;
  const modeHistogram = { ...prior.modeHistogram, [current.mode]: (prior.modeHistogram[current.mode] ?? 0) + 1 };
  const directionHistogram = { ...prior.directionHistogram, [current.anticipatedDirection]: (prior.directionHistogram[current.anticipatedDirection] ?? 0) + 1 };
  const sample = freeze({ index, mode: current.mode, semanticState: current.semanticState, presentDirection: current.presentDirection, anticipatedDirection: current.anticipatedDirection, speedMps: current.speedMps, speedDeltaMps: current.speedDeltaMps, brakeWeight: current.brakeWeight, pivotWeight: current.pivotWeight, confidence: current.confidence, groundRisk: current.groundRisk, valid: validation.ok });
  let events = prior.events;
  for (const event of emitted) events = bounded(events, event, PLAYER_LOCOMOTION_ANTICIPATION_TELEMETRY_LIMITS.maxEvents);
  let warnings = prior.warnings;
  if (!validation.ok) warnings = bounded(warnings, `invalid:${index}`, PLAYER_LOCOMOTION_ANTICIPATION_TELEMETRY_LIMITS.maxWarnings);
  return freeze({
    counters: freeze(counters),
    latest: current,
    modeHistogram: freeze(modeHistogram),
    directionHistogram: freeze(directionHistogram),
    events: freeze(events),
    warnings: freeze(warnings),
    history: freeze(bounded(prior.history, sample, PLAYER_LOCOMOTION_ANTICIPATION_TELEMETRY_LIMITS.maxHistory)),
  });
}

export function createPlayerLocomotionAnticipationTelemetryReadModel(state = createPlayerLocomotionAnticipationTelemetryState()) {
  const c = state.counters;
  const n = Math.max(1, c.samples);
  const validity = c.validSamples / n;
  const confidenceRisk = c.lowConfidence / n;
  const groundRisk = c.highGroundRisk / n;
  const transitionRisk = clamp(c.modeChanges / n, 0, 1);
  const score = clamp(validity * 0.42 + (1 - confidenceRisk) * 0.2 + (1 - groundRisk) * 0.18 + (1 - transitionRisk) * 0.2, 0, 1);
  const grade = score >= 0.95 ? 'A' : score >= 0.85 ? 'B' : score >= 0.7 ? 'C' : score >= 0.5 ? 'D' : 'E';
  return freeze({
    version: PLAYER_LOCOMOTION_ANTICIPATION_TELEMETRY_VERSION,
    counters: c,
    rates: freeze({ validity: round(validity), confidenceRisk: round(confidenceRisk), groundRisk: round(groundRisk), transitionRate: round(transitionRisk), pivotRate: round(c.pivots / n), brakeRate: round(c.brakes / n), stopRate: round(c.stops / n) }),
    quality: freeze({ score: round(score), grade }),
    latest: state.latest,
    modeHistogram: state.modeHistogram,
    directionHistogram: state.directionHistogram,
    recentEvents: state.events.slice(-16),
    warnings: state.warnings,
    history: state.history,
    fingerprint: resolvePlayerDirectionalFingerprint({ counters: c, latest: state.latest, modeHistogram: state.modeHistogram, directionHistogram: state.directionHistogram, history: state.history }),
  });
}

export function buildPlayerLocomotionAnticipationTelemetryScenario(samples = []) {
  let state = createPlayerLocomotionAnticipationTelemetryState();
  const history = [];
  const list = Array.isArray(samples) ? samples : [];
  for (let index = 0; index < list.length; index += 1) {
    state = advancePlayerLocomotionAnticipationTelemetry(state, list[index], index);
    history.push(createPlayerLocomotionAnticipationTelemetryReadModel(state));
  }
  return freeze({ count: history.length, history: freeze(history), final: history.at(-1) ?? createPlayerLocomotionAnticipationTelemetryReadModel(state), fingerprint: resolvePlayerDirectionalFingerprint(history) });
}

export function comparePlayerLocomotionAnticipationTelemetry(first = {}, second = {}) {
  return freeze({ equal: JSON.stringify(first) === JSON.stringify(second), firstFingerprint: resolvePlayerDirectionalFingerprint(first), secondFingerprint: resolvePlayerDirectionalFingerprint(second) });
}

export function resolvePlayerLocomotionAnticipationTelemetryBudget(sampleCount = 0, eventCount = 0) {
  const samples = Math.max(0, Math.floor(finite(sampleCount)));
  const events = Math.max(0, Math.floor(finite(eventCount)));
  return freeze({ samplesAllowed: 240 - samples, eventsAllowed: 96 - events, withinBudget: samples <= 240 && events <= 96 });
}

export function resolvePlayerLocomotionAnticipationTelemetryBuckets(values = []) {
  const buckets = { '<0.25': 0, '0.25-0.5': 0, '0.5-0.75': 0, '>=0.75': 0 };
  for (const value of Array.isArray(values) ? values : []) {
    const v = clamp(finite(value), 0, 1);
    if (v < 0.25) buckets['<0.25'] += 1; else if (v < 0.5) buckets['0.25-0.5'] += 1; else if (v < 0.75) buckets['0.5-0.75'] += 1; else buckets['>=0.75'] += 1;
  }
  return freeze(buckets);
}

export function createPlayerLocomotionAnticipationTelemetryController({ onReadModel = null } = {}) {
  let state = createPlayerLocomotionAnticipationTelemetryState();
  return freeze({
    update(input = {}) { state = advancePlayerLocomotionAnticipationTelemetry(state, input, state.counters.samples); const readModel = createPlayerLocomotionAnticipationTelemetryReadModel(state); if (typeof onReadModel === 'function') onReadModel(readModel); return freeze({ state, readModel }); },
    read() { return createPlayerLocomotionAnticipationTelemetryReadModel(state); },
    reset() { state = createPlayerLocomotionAnticipationTelemetryState(); },
  });
}

export function auditPlayerLocomotionAnticipationTelemetry() {
  const state = advancePlayerLocomotionAnticipationTelemetry(createPlayerLocomotionAnticipationTelemetryState(), { velocity: { x: 0, y: 1 }, facing: { x: 0, y: 1 }, planarSpeedMps: 1.8, deltaSeconds: 1 / 60, surfaceConfidence: 1, surfaceSlip: 0 }, 0);
  const model = createPlayerLocomotionAnticipationTelemetryReadModel(state);
  return freeze({ version: PLAYER_LOCOMOTION_ANTICIPATION_TELEMETRY_VERSION, sampleValid: Boolean(model.latest), qualityGrade: model.quality.grade, immutable: Object.isFrozen(model) && Object.isFrozen(model.counters), directionCount: PLAYER_DIRECTIONAL_DIRECTIONS.length });
}
