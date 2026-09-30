/** Runtime-safe quality and invariant checks for creature locomotion presentation state. */
import {
  CREATURE_LOCOMOTION_EVENTS,
  CREATURE_LOCOMOTION_SOURCES,
  CREATURE_LOCOMOTION_STATES,
  normalizeCreatureLocomotionInput,
  synthesizeCreatureLocomotionState,
  isCreatureLocomotionAirborne,
  isCreatureLocomotionReactive,
} from './creatureLocomotionStateSynthesis.js';

function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp01(value) { return Math.max(0, Math.min(1, n(value))); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function round(value, digits = 4) { const factor = 10 ** digits; const result = Math.round(n(value) * factor) / factor; return Object.is(result, -0) ? 0 : result; }
function freeze(value) { return Object.freeze(value); }

export const CREATURE_LOCOMOTION_QUALITY_VERSION = '2026-09-15-v1';

export const CREATURE_LOCOMOTION_INVARIANTS = Object.freeze([
  'state-vocabulary',
  'event-vocabulary',
  'source-vocabulary',
  'confidence-bounds',
  'gait-blend-normalized',
  'presentation-bounds',
  'airborne-gait',
  'grounded-gait',
  'deterministic-synthesis',
  'movement-ownership',
  'immutable-output',
]);

function checkBounds(object, keys) {
  const errors = [];
  for (const key of keys) {
    const value = n(object?.[key], 0);
    if (value < 0 || value > 1) errors.push(`${key} outside [0,1]`);
  }
  return errors;
}

export function checkCreatureLocomotionVocabulary(state) {
  const errors = [];
  if (!CREATURE_LOCOMOTION_STATES.includes(state?.state)) errors.push('state-vocabulary');
  if (!CREATURE_LOCOMOTION_EVENTS.includes(state?.event)) errors.push('event-vocabulary');
  if (!CREATURE_LOCOMOTION_SOURCES.includes(state?.source)) errors.push('source-vocabulary');
  return errors;
}

export function checkCreatureLocomotionConfidence(state) {
  return state?.confidence >= 0 && state?.confidence <= 1 ? [] : ['confidence-bounds'];
}

export function checkCreatureLocomotionGaitBlend(state) {
  const blend = state?.gaitBlend;
  if (!blend || typeof blend !== 'object') return ['gait-blend-normalized'];
  const values = Object.values(blend).map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return ['gait-blend-normalized'];
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.abs(total - 1) < 0.0002 ? [] : ['gait-blend-normalized'];
}

export function checkCreaturePresentationBounds(state) {
  return checkBounds(state?.presentation || {}, ['locomotion', 'alert', 'airborne', 'contact', 'impact', 'slip', 'turn', 'social']);
}

export function checkCreatureAirborneGait(state) {
  if (!isCreatureLocomotionAirborne(state?.state)) return [];
  return state?.gait === 'flap' ? [] : ['airborne-gait'];
}

export function checkCreatureGroundedGait(state, input = {}) {
  if (!input.grounded || isCreatureLocomotionAirborne(state?.state)) return [];
  return state?.gait === 'flap' ? ['grounded-gait'] : [];
}

export function checkCreatureMovementOwnership(state) {
  const movement = state?.rootMotion?.movementOwnedElsewhere;
  return movement === true ? [] : ['movement-ownership'];
}

export function checkCreatureOutputImmutability(state) {
  try {
    const before = JSON.stringify(state);
    if (state && typeof state === 'object') state.__qualityMutationProbe = true;
    const unchanged = JSON.stringify(state) === before;
    try { delete state.__qualityMutationProbe; } catch { /* frozen output is expected */ }
    return unchanged ? [] : ['immutable-output'];
  } catch {
    return ['immutable-output'];
  }
}

export function checkCreatureLocomotionState(state, input = {}) {
  return [
    ...checkCreatureLocomotionVocabulary(state),
    ...checkCreatureLocomotionConfidence(state),
    ...checkCreatureLocomotionGaitBlend(state),
    ...checkCreaturePresentationBounds(state),
    ...checkCreatureAirborneGait(state),
    ...checkCreatureGroundedGait(state, input),
    ...checkCreatureMovementOwnership(state),
  ];
}

export function evaluateCreatureLocomotionState(state, input = {}) {
  const errors = checkCreatureLocomotionState(state, input);
  const normalized = normalizeCreatureLocomotionInput(input);
  return freeze({
    valid: errors.length === 0,
    errors: freeze(errors),
    state: text(state?.state, 'idle'),
    gait: text(state?.gait, 'walk'),
    confidence: clamp01(state?.confidence),
    airborne: isCreatureLocomotionAirborne(state?.state),
    reactive: isCreatureLocomotionReactive(state?.state),
    speedMps: round(normalized.speedMps),
  });
}

export function checkCreatureLocomotionDeterminism(input, previous = null) {
  const first = synthesizeCreatureLocomotionState(input, previous);
  const second = synthesizeCreatureLocomotionState(input, previous);
  return freeze({
    equal: JSON.stringify(first) === JSON.stringify(second),
    fingerprintA: JSON.stringify(first),
    fingerprintB: JSON.stringify(second),
  });
}

export function runCreatureLocomotionQualityMatrix(cases = []) {
  const rows = [];
  for (const testCase of cases) {
    const input = testCase?.input || {};
    const state = synthesizeCreatureLocomotionState(input, testCase?.previous || null);
    const evaluation = evaluateCreatureLocomotionState(state, input);
    const deterministic = checkCreatureLocomotionDeterminism(input, testCase?.previous || null);
    rows.push(freeze({
      id: text(testCase?.id, `case-${rows.length}`),
      evaluation,
      deterministic: deterministic.equal,
    }));
  }
  return freeze(rows);
}

export function summarizeCreatureLocomotionQuality(rows = []) {
  const total = rows.length;
  const valid = rows.filter((row) => row.evaluation?.valid).length;
  const deterministic = rows.filter((row) => row.deterministic).length;
  const errorCounts = {};
  for (const row of rows) for (const error of row.evaluation?.errors || []) errorCounts[error] = (errorCounts[error] || 0) + 1;
  return freeze({
    total,
    valid,
    invalid: total - valid,
    validRatio: round(total ? valid / total : 1),
    deterministic,
    deterministicRatio: round(total ? deterministic / total : 1),
    errorCounts: freeze({ ...errorCounts }),
  });
}

export function assertCreatureLocomotionQuality(rows = []) {
  const summary = summarizeCreatureLocomotionQuality(rows);
  if (summary.invalid > 0) throw new Error(`creature locomotion quality failure: ${JSON.stringify(summary.errorCounts)}`);
  if (summary.deterministic !== summary.total) throw new Error('creature locomotion determinism failure');
  return summary;
}

export function buildCreatureLocomotionQualityReport(cases = [], metadata = {}) {
  const rows = runCreatureLocomotionQualityMatrix(cases);
  return freeze({
    schema: 'creature-locomotion-quality',
    version: CREATURE_LOCOMOTION_QUALITY_VERSION,
    generatedBy: text(metadata.generatedBy, 'creatureLocomotionStateQuality'),
    scope: text(metadata.scope, 'runtime'),
    invariants: CREATURE_LOCOMOTION_INVARIANTS,
    summary: summarizeCreatureLocomotionQuality(rows),
    rows,
  });
}

export const CREATURE_LOCOMOTION_EXPECTATIONS = Object.freeze({
  idle: Object.freeze({ gait: 'walk', airborne: false, reactive: false }),
  wander: Object.freeze({ gait: 'walk', airborne: false, reactive: false }),
  approach: Object.freeze({ gait: 'trot', airborne: false, reactive: true }),
  flee: Object.freeze({ gait: 'gallop', airborne: false, reactive: true }),
  'herd-flee': Object.freeze({ gait: 'gallop', airborne: false, reactive: true }),
  'flock-flee': Object.freeze({ gait: 'gallop', airborne: false, reactive: true }),
  takeoff: Object.freeze({ gait: 'flap', airborne: true, reactive: false }),
  'flight-climb': Object.freeze({ gait: 'flap', airborne: true, reactive: false }),
  'flight-cruise': Object.freeze({ gait: 'flap', airborne: true, reactive: false }),
  'flight-descend': Object.freeze({ gait: 'flap', airborne: true, reactive: false }),
  'landing-soft': Object.freeze({ gait: 'walk', airborne: false, reactive: false }),
  'landing-hard': Object.freeze({ gait: 'walk', airborne: false, reactive: false }),
  'reacquire-ground': Object.freeze({ gait: 'walk', airborne: false, reactive: false }),
  turn: Object.freeze({ gait: 'walk', airborne: false, reactive: false }),
  blocked: Object.freeze({ gait: 'walk', airborne: false, reactive: false }),
  'contact-unstable': Object.freeze({ gait: 'walk', airborne: false, reactive: false }),
  'slip-recover': Object.freeze({ gait: 'walk', airborne: false, reactive: false }),
  recover: Object.freeze({ gait: 'walk', airborne: false, reactive: false }),
});

export function checkCreatureLocomotionExpectedShape(state) {
  const expected = CREATURE_LOCOMOTION_EXPECTATIONS[state?.state];
  if (!expected) return [`no-expectation:${String(state?.state)}`];
  const errors = [];
  if (expected.gait !== state.gait) errors.push(`expected-gait:${expected.gait}`);
  if (expected.airborne !== isCreatureLocomotionAirborne(state.state)) errors.push('expected-airborne');
  if (expected.reactive !== isCreatureLocomotionReactive(state.state)) errors.push('expected-reactive');
  return errors;
}

export function checkCreatureLocomotionScenario(input, previous = null) {
  const state = synthesizeCreatureLocomotionState(input, previous);
  return freeze({ state, errors: freeze([...checkCreatureLocomotionState(state, input), ...checkCreatureLocomotionExpectedShape(state)]) });
}
