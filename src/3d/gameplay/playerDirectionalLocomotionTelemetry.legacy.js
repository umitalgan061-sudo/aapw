/**
 * Deterministic telemetry/read-model for directional locomotion presentation.
 *
 * This layer is observational. It aggregates already-resolved presentation values for HUD,
 * debug and acceptance consumers without becoming an animation or movement owner.
 *
 * @module gameplay/playerDirectionalLocomotionTelemetry
 */

import {
  PLAYER_DIRECTIONAL_DIRECTIONS,
  PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS,
  PLAYER_DIRECTIONAL_SEMANTICS,
  PLAYER_DIRECTIONAL_LOCOMOTION_VERSION,
  resolvePlayerDirectionalFingerprint,
  resolvePlayerDirectionalFullPresentation,
  validatePlayerDirectionalPresentation,
} from './playerDirectionalLocomotionPolicy.js';

export const PLAYER_DIRECTIONAL_TELEMETRY_VERSION = '2026-09-15-v1';

export const PLAYER_DIRECTIONAL_TELEMETRY_LIMITS = Object.freeze({
  maxSamples: 240,
  maxEvents: 64,
  maxHistory: 32,
  maxConfidenceEntries: 8,
  maxWarnings: 16,
});

const EVENT_TYPES = Object.freeze([
  'semantic-transition',
  'direction-transition',
  'footstep',
  'turn-class-change',
  'slope-class-change',
  'surface-confidence-drop',
  'presentation-invalid',
]);

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function freeze(value) {
  return Object.freeze(value);
}

function createCounters() {
  return {
    samples: 0,
    transitions: 0,
    directionChanges: 0,
    footsteps: 0,
    sharpTurns: 0,
    steepSamples: 0,
    lowConfidenceSamples: 0,
    invalidSamples: 0,
  };
}

export function createPlayerDirectionalTelemetryState() {
  return freeze({
    counters: freeze(createCounters()),
    lastSemanticState: 'idle',
    lastDirection: 'forward',
    lastTurnClass: 'neutral',
    lastSlopeClass: 'flat',
    lastFingerprint: '',
    sampleWindow: freeze([]),
    events: freeze([]),
    warnings: freeze([]),
    directionHistogram: freeze(Object.fromEntries(PLAYER_DIRECTIONAL_DIRECTIONS.map((key) => [key, 0]))),
    semanticHistogram: freeze(Object.fromEntries(PLAYER_DIRECTIONAL_SEMANTICS.map((key) => [key, 0]))),
  });
}

export function normalizePlayerDirectionalTelemetryInput(input = {}) {
  const presentation = resolvePlayerDirectionalFullPresentation(input);
  const validity = validatePlayerDirectionalPresentation(presentation);
  return freeze({ presentation, validity });
}

function pushBounded(list, value, max) {
  const next = list.concat(value);
  return next.length > max ? next.slice(next.length - max) : next;
}

function addCount(counters, key, amount = 1) {
  return { ...counters, [key]: (counters[key] ?? 0) + amount };
}

function nextHistogram(histogram, key) {
  return { ...histogram, [key]: (histogram[key] ?? 0) + 1 };
}

function event(type, data) {
  return freeze({ type, ...data });
}

export function resolvePlayerDirectionalTelemetryEvent(previous, current, index = 0) {
  const events = [];
  if (previous.semanticState !== current.semanticState) {
    events.push(event('semantic-transition', { index, from: previous.semanticState, to: current.semanticState }));
  }
  if (previous.dominantDirection !== current.dominantDirection) {
    events.push(event('direction-transition', { index, from: previous.dominantDirection, to: current.dominantDirection }));
  }
  if (current.foot?.emitted) {
    events.push(event('footstep', { index, foot: current.foot.foot, phase: current.foot.phase }));
  }
  if (previous.turn?.class !== current.turn?.class) {
    events.push(event('turn-class-change', { index, from: previous.turn?.class ?? 'neutral', to: current.turn?.class ?? 'neutral' }));
  }
  if (previous.slopeClass !== current.slopeClass) {
    events.push(event('slope-class-change', { index, from: previous.slopeClass, to: current.slopeClass }));
  }
  if (current.surface?.confidence < 0.5 && previous.surface?.confidence >= 0.5) {
    events.push(event('surface-confidence-drop', { index, confidence: current.surface.confidence }));
  }
  return events.filter((entry) => EVENT_TYPES.includes(entry.type));
}

export function advancePlayerDirectionalTelemetry(state, input, index = 0) {
  const currentInput = normalizePlayerDirectionalTelemetryInput(input);
  const current = currentInput.presentation;
  const previous = state?.lastResolvedPresentation ?? resolvePlayerDirectionalFullPresentation({ semanticState: state?.lastSemanticState });
  const emittedEvents = resolvePlayerDirectionalTelemetryEvent(previous, current, index);
  let counters = { ...(state?.counters ?? createCounters()), samples: (state?.counters?.samples ?? 0) + 1 };
  if (previous.semanticState !== current.semanticState) counters = addCount(counters, 'transitions');
  if (previous.dominantDirection !== current.dominantDirection) counters = addCount(counters, 'directionChanges');
  if (current.foot?.emitted) counters = addCount(counters, 'footsteps');
  if (current.turn?.class === 'sharp') counters = addCount(counters, 'sharpTurns');
  if (current.slopeClass === 'steep' || current.slopeClass === 'extreme') counters = addCount(counters, 'steepSamples');
  if (current.surface?.confidence < 0.5) counters = addCount(counters, 'lowConfidenceSamples');
  if (!currentInput.validity.ok) counters = addCount(counters, 'invalidSamples');
  const directionHistogram = nextHistogram(state?.directionHistogram ?? {}, current.dominantDirection);
  const semanticHistogram = nextHistogram(state?.semanticHistogram ?? {}, current.semanticState);
  const sample = freeze({
    index,
    semanticState: current.semanticState,
    direction: current.dominantDirection,
    speedMps: current.speedMps,
    cadenceScale: current.cadenceScale,
    playbackRate: current.playbackRate,
    phase: current.phase?.phase ?? 0,
    foot: current.foot?.foot ?? null,
    valid: currentInput.validity.ok,
  });
  let warnings = state?.warnings ?? [];
  if (!currentInput.validity.ok) warnings = pushBounded(warnings, `invalid-presentation:${index}`, PLAYER_DIRECTIONAL_TELEMETRY_LIMITS.maxWarnings);
  let events = state?.events ?? [];
  for (const emitted of emittedEvents) events = pushBounded(events, emitted, PLAYER_DIRECTIONAL_TELEMETRY_LIMITS.maxEvents);
  const sampleWindow = pushBounded(state?.sampleWindow ?? [], sample, PLAYER_DIRECTIONAL_TELEMETRY_LIMITS.maxHistory);
  const fingerprint = resolvePlayerDirectionalFingerprint({ sample, events: emittedEvents });
  return freeze({
    counters: freeze(counters),
    lastSemanticState: current.semanticState,
    lastDirection: current.dominantDirection,
    lastTurnClass: current.turn?.class ?? 'neutral',
    lastSlopeClass: current.slopeClass,
    lastFingerprint: fingerprint,
    lastResolvedPresentation: current,
    sampleWindow: freeze(sampleWindow),
    events: freeze(events),
    warnings: freeze(warnings),
    directionHistogram: freeze(directionHistogram),
    semanticHistogram: freeze(semanticHistogram),
  });
}

export function createPlayerDirectionalTelemetryReadModel(state = createPlayerDirectionalTelemetryState()) {
  const counters = state.counters ?? createCounters();
  const samples = Math.max(0, counters.samples);
  const invalidRate = samples > 0 ? counters.invalidSamples / samples : 0;
  const confidenceRisk = samples > 0 ? counters.lowConfidenceSamples / samples : 0;
  const changeRate = samples > 0 ? counters.transitions / samples : 0;
  return freeze({
    version: PLAYER_DIRECTIONAL_TELEMETRY_VERSION,
    policyVersion: PLAYER_DIRECTIONAL_LOCOMOTION_VERSION,
    counters,
    rates: freeze({
      invalidRate: round(invalidRate),
      confidenceRisk: round(confidenceRisk),
      transitionRate: round(changeRate),
      footstepRate: round(samples > 0 ? counters.footsteps / samples : 0),
    }),
    latest: freeze({
      semanticState: state.lastSemanticState,
      direction: state.lastDirection,
      turnClass: state.lastTurnClass,
      slopeClass: state.lastSlopeClass,
      fingerprint: state.lastFingerprint,
    }),
    directionHistogram: state.directionHistogram,
    semanticHistogram: state.semanticHistogram,
    recentEvents: state.events?.slice(-12) ?? [],
    warnings: state.warnings ?? [],
  });
}

export function resolvePlayerDirectionalTelemetryQuality(readModel = {}) {
  const invalid = finite(readModel.rates?.invalidRate, 1);
  const confidence = finite(readModel.rates?.confidenceRisk, 1);
  const transitions = finite(readModel.rates?.transitionRate, 1);
  const score = clamp(1 - invalid * 0.55 - confidence * 0.25 - Math.max(0, transitions - 0.5) * 0.4, 0, 1);
  const grade = score >= 0.95 ? 'A' : score >= 0.85 ? 'B' : score >= 0.7 ? 'C' : score >= 0.5 ? 'D' : 'E';
  return freeze({ score: round(score), grade, invalidRisk: round(invalid), confidenceRisk: round(confidence), transitionRisk: round(transitions) });
}

export function buildPlayerDirectionalTelemetryScenario(samples = []) {
  let state = createPlayerDirectionalTelemetryState();
  const history = [];
  for (let index = 0; index < (Array.isArray(samples) ? samples : []).length; index += 1) {
    state = advancePlayerDirectionalTelemetry(state, samples[index], index);
    history.push(createPlayerDirectionalTelemetryReadModel(state));
  }
  const final = history.at(-1) ?? createPlayerDirectionalTelemetryReadModel(state);
  return freeze({
    sampleCount: history.length,
    history: freeze(history),
    final,
    quality: resolvePlayerDirectionalTelemetryQuality(final),
    fingerprint: resolvePlayerDirectionalFingerprint(history),
  });
}

export function comparePlayerDirectionalTelemetry(first = {}, second = {}) {
  const left = JSON.stringify(first);
  const right = JSON.stringify(second);
  return freeze({ equal: left === right, firstFingerprint: resolvePlayerDirectionalFingerprint(first), secondFingerprint: resolvePlayerDirectionalFingerprint(second) });
}

export function auditPlayerDirectionalTelemetry() {
  const empty = createPlayerDirectionalTelemetryReadModel();
  const quality = resolvePlayerDirectionalTelemetryQuality(empty);
  return freeze({
    version: PLAYER_DIRECTIONAL_TELEMETRY_VERSION,
    maxSamples: PLAYER_DIRECTIONAL_TELEMETRY_LIMITS.maxSamples,
    maxEvents: PLAYER_DIRECTIONAL_TELEMETRY_LIMITS.maxEvents,
    maxHistory: PLAYER_DIRECTIONAL_TELEMETRY_LIMITS.maxHistory,
    policyVersion: PLAYER_DIRECTIONAL_LOCOMOTION_VERSION,
    quality: quality.grade,
    finiteLimits: Object.values(PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS).every((value) => Number.isFinite(Number(value))),
  });
}

export function resolvePlayerDirectionalTelemetryBudget(sampleCount = 0, eventCount = 0) {
  const samples = Math.max(0, Math.floor(finite(sampleCount, 0)));
  const events = Math.max(0, Math.floor(finite(eventCount, 0)));
  return freeze({
    samplesAllowed: Math.max(0, PLAYER_DIRECTIONAL_TELEMETRY_LIMITS.maxSamples - samples),
    eventsAllowed: Math.max(0, PLAYER_DIRECTIONAL_TELEMETRY_LIMITS.maxEvents - events),
    withinBudget: samples <= PLAYER_DIRECTIONAL_TELEMETRY_LIMITS.maxSamples && events <= PLAYER_DIRECTIONAL_TELEMETRY_LIMITS.maxEvents,
  });
}

export function resolvePlayerDirectionalTelemetryConfidenceBuckets(values = []) {
  const buckets = Object.fromEntries(Array.from({ length: PLAYER_DIRECTIONAL_TELEMETRY_LIMITS.maxConfidenceEntries }, (_, index) => [`${index + 1}/8`, 0]));
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = clamp(finite(value, 0), 0, 1);
    const index = Math.min(7, Math.floor(normalized * 8));
    buckets[`${index + 1}/8`] += 1;
  }
  return freeze(buckets);
}

export function createPlayerDirectionalTelemetryController({ onReadModel = null } = {}) {
  let state = createPlayerDirectionalTelemetryState();
  return freeze({
    update(input = {}) {
      state = advancePlayerDirectionalTelemetry(state, input, state.counters.samples);
      const readModel = createPlayerDirectionalTelemetryReadModel(state);
      if (typeof onReadModel === 'function') onReadModel(readModel);
      return freeze({ state, readModel });
    },
    read() {
      return createPlayerDirectionalTelemetryReadModel(state);
    },
    reset() {
      state = createPlayerDirectionalTelemetryState();
    },
  });
}
