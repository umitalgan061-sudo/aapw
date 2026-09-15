/**
 * Temporal presentation policy for player locomotion.
 * Reads the existing directional locomotion contract and adds start, brake, stop, pivot and recovery intent.
 * This module never owns gameplay movement, physics, animation assets, a mixer, or renderer state.
 */
import {
  PLAYER_DIRECTIONAL_DIRECTIONS,
  resolvePlayerDirectionalAngle,
  resolvePlayerDirectionalBlendWeights,
  resolvePlayerDirectionalFullPresentation,
  resolvePlayerDirectionalSemantic,
  resolvePlayerDirectionalSlopeClass,
  resolvePlayerDirectionalTurnClass,
  normalizePlayerDirectionalInput,
} from './playerDirectionalLocomotionPolicy.js';

export const PLAYER_LOCOMOTION_ANTICIPATION_VERSION = '2026-09-15-v1';
export const PLAYER_LOCOMOTION_ANTICIPATION_LIMITS = Object.freeze({
  maxHistory: 24,
  maxLookAheadSeconds: 0.35,
  startThresholdMps: 0.35,
  stopThresholdMps: 0.18,
  brakeThresholdMps: 1.1,
  pivotAngleDegrees: 125,
  hardPivotAngleDegrees: 165,
  maxSpeedDeltaMps: 8,
  maxTurnDeltaDegrees: 540,
});

export const PLAYER_LOCOMOTION_ANTICIPATION_MODES = Object.freeze([
  'idle','start','accelerate','cruise','brake','stop','strafe','reverse','pivot','recover',
  'turn-in-place','combat-advance','combat-retreat','guard-walk','dodge-recover','stagger-recover',
]);

const MODE_BIAS = Object.freeze({
  idle: 0.0, start: 1.08, accelerate: 1.05, cruise: 1.0, brake: 0.94, stop: 0.84,
  strafe: 1.02, reverse: 0.98, pivot: 0.88, recover: 0.92, 'turn-in-place': 0.9,
  'combat-advance': 1.03, 'combat-retreat': 0.97, 'guard-walk': 0.93,
  'dodge-recover': 0.82, 'stagger-recover': 0.78,
});

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function round(value, digits = 4) {
  const factor = 10 ** digits;
  const rounded = Math.round(finite(value) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}
function freeze(value) { return Object.freeze(value); }
function degrees(radians) { return radians * 180 / Math.PI; }

export function normalizePlayerLocomotionAnticipationPrevious(previous = null) {
  if (!previous || typeof previous !== 'object') return null;
  return freeze({
    planarSpeedMps: clamp(Math.max(0, finite(previous.planarSpeedMps)), 0, 12),
    directionAngleRadians: finite(previous.directionAngleRadians),
    semanticState: typeof previous.semanticState === 'string' ? previous.semanticState : 'idle',
    phase: clamp01(previous.phase),
    turnRateDegreesPerSecond: clamp(Math.max(0, finite(previous.turnRateDegreesPerSecond)), 0, 540),
    surfaceConfidence: clamp01(previous.surfaceConfidence),
    surfaceSlip: clamp01(previous.surfaceSlip),
  });
}

export function resolvePlayerLocomotionDelta(input = {}, previous = null) {
  const current = normalizePlayerDirectionalInput(input);
  const prior = normalizePlayerLocomotionAnticipationPrevious(previous);
  const speedDelta = prior ? current.planarSpeedMps - prior.planarSpeedMps : current.planarSpeedMps;
  const currentAngle = resolvePlayerDirectionalAngle(current);
  const priorAngle = prior?.directionAngleRadians ?? currentAngle;
  const angleDelta = degrees(Math.atan2(
    Math.sin(currentAngle - priorAngle),
    Math.cos(currentAngle - priorAngle),
  ));
  return freeze({
    speedDeltaMps: round(clamp(speedDelta, -8, 8), 3),
    accelerationMps2: round(speedDelta / Math.max(current.deltaSeconds, 0.016), 3),
    directionAngleRadians: round(currentAngle, 5),
    angleDeltaDegrees: round(clamp(angleDelta, -180, 180), 3),
    absoluteAngleDeltaDegrees: round(Math.abs(angleDelta), 3),
    previousSpeedMps: round(prior?.planarSpeedMps ?? 0, 3),
    previousSemanticState: prior?.semanticState ?? 'idle',
    hasPrevious: Boolean(prior),
  });
}

export function classifyPlayerLocomotionMotionMode(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const delta = resolvePlayerLocomotionDelta(normalized, previous);
  if (normalized.planarSpeedMps < PLAYER_LOCOMOTION_ANTICIPATION_LIMITS.stopThresholdMps) {
    return previous?.planarSpeedMps > 1 ? 'stop' : 'idle';
  }
  if (delta.absoluteAngleDeltaDegrees >= PLAYER_LOCOMOTION_ANTICIPATION_LIMITS.hardPivotAngleDegrees && normalized.planarSpeedMps >= 0.8) return 'pivot';
  if (delta.absoluteAngleDeltaDegrees >= PLAYER_LOCOMOTION_ANTICIPATION_LIMITS.pivotAngleDegrees && normalized.planarSpeedMps >= 0.8) return 'pivot';
  if (delta.speedDeltaMps < -PLAYER_LOCOMOTION_ANTICIPATION_LIMITS.brakeThresholdMps * normalized.deltaSeconds) return 'brake';
  if (normalized.planarSpeedMps < 1) return delta.speedDeltaMps > 0 ? 'start' : 'cruise';
  if (delta.absoluteAngleDeltaDegrees >= 45) return 'strafe';
  if (delta.accelerationMps2 > 1.25) return 'accelerate';
  return 'cruise';
}

export function resolvePlayerLocomotionStartWeight(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const delta = resolvePlayerLocomotionDelta(normalized, previous);
  const rising = clamp01(delta.accelerationMps2 / 4);
  const threshold = clamp01((normalized.planarSpeedMps - 0.35) / 1.25);
  return round(clamp((1 - threshold) * 0.58 + rising * 0.42, 0, 1));
}

export function resolvePlayerLocomotionBrakeWeight(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const delta = resolvePlayerLocomotionDelta(normalized, previous);
  const deceleration = clamp01(-delta.accelerationMps2 / 5);
  const speed = clamp01(normalized.planarSpeedMps / 7);
  const slip = normalized.surfaceSlip;
  const turn = clamp01(normalized.turnRateDegreesPerSecond / 220);
  return round(clamp(deceleration * 0.62 + speed * 0.12 + slip * 0.18 + turn * 0.08, 0, 1));
}

export function resolvePlayerLocomotionStopDistance(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const delta = resolvePlayerLocomotionDelta(normalized, previous);
  const deceleration = Math.max(0.35, Math.abs(Math.min(delta.accelerationMps2, -0.35)));
  const stoppingTime = clamp(normalized.planarSpeedMps / deceleration, 0, 2);
  return round(clamp(normalized.planarSpeedMps * stoppingTime * 0.5, 0, 8), 4);
}

export function resolvePlayerLocomotionPivotWeight(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const delta = resolvePlayerLocomotionDelta(normalized, previous);
  const angleRatio = clamp01((delta.absoluteAngleDeltaDegrees - 90) / 90);
  const turnRatio = clamp01(normalized.turnRateDegreesPerSecond / 360);
  const speedRatio = clamp01(normalized.planarSpeedMps / 7);
  return round(clamp(angleRatio * 0.56 + turnRatio * 0.3 + speedRatio * 0.1 + (1 - normalized.surfaceConfidence) * 0.04, 0, 1));
}

export function resolvePlayerLocomotionAnticipationMode(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const semantic = resolvePlayerDirectionalSemantic(normalized, previous?.semanticState ?? 'idle');
  const motion = classifyPlayerLocomotionMotionMode(normalized, previous);
  if (semantic === 'hit-stagger') return 'stagger-recover';
  if (semantic === 'dodge') return 'dodge-recover';
  if (semantic === 'guard' && normalized.planarSpeedMps > 0.3) return 'guard-walk';
  if (semantic === 'heavy-attack' || semantic === 'light-attack') return normalized.planarSpeedMps > 2 ? 'combat-advance' : 'recover';
  if (normalized.planarSpeedMps < 0.18) {
    if (previous?.planarSpeedMps > 1) return 'stop';
    if (normalized.turnRateDegreesPerSecond > 30) return 'turn-in-place';
    return 'idle';
  }
  if (motion === 'pivot') return 'pivot';
  return motion;
}

export function resolvePlayerLocomotionLookAheadSeconds(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const delta = resolvePlayerLocomotionDelta(normalized, previous);
  const turn = clamp01(normalized.turnRateDegreesPerSecond / 360);
  const motion = clamp01(Math.abs(delta.accelerationMps2) / 5);
  return round(clamp((0.08 + turn * 0.14 + motion * 0.09) * (0.75 + normalized.surfaceConfidence * 0.25), 0.05, 0.35), 4);
}

export function resolvePlayerLocomotionAnticipatedDirection(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const delta = resolvePlayerLocomotionDelta(normalized, previous);
  const lookAhead = resolvePlayerLocomotionLookAheadSeconds(normalized, previous);
  const signedTurn = Math.sign(delta.angleDeltaDegrees || 1);
  const projectedAngle = delta.directionAngleRadians + normalized.turnRateDegreesPerSecond * Math.PI / 180 * lookAhead * signedTurn;
  const index = ((Math.round(projectedAngle / (Math.PI / 4)) % 8) + 8) % 8;
  return PLAYER_DIRECTIONAL_DIRECTIONS[index];
}

export function resolvePlayerLocomotionAnticipatedBlend(input = {}, previous = null) {
  const current = normalizePlayerDirectionalInput(input);
  const present = resolvePlayerDirectionalBlendWeights(current);
  const nextDirection = resolvePlayerLocomotionAnticipatedDirection(current, previous);
  const anticipation = clamp01(resolvePlayerLocomotionLookAheadSeconds(current, previous) / 0.35);
  const weights = Object.fromEntries(PLAYER_DIRECTIONAL_DIRECTIONS.map((direction) => [direction, 0]));
  for (const direction of PLAYER_DIRECTIONAL_DIRECTIONS) weights[direction] = round(present[direction] * (1 - anticipation), 4);
  weights[nextDirection] = round(weights[nextDirection] + anticipation, 4);
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  weights[nextDirection] = round(weights[nextDirection] + (1 - sum), 4);
  return freeze(weights);
}

export function resolvePlayerLocomotionCadenceBias(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const mode = resolvePlayerLocomotionAnticipationMode(normalized, previous);
  const slope = resolvePlayerDirectionalSlopeClass(normalized);
  const terrain = slope === 'extreme' ? 0.84 : slope === 'steep' ? 0.9 : slope === 'rising' ? 0.96 : 1;
  const confidence = 0.88 + normalized.surfaceConfidence * 0.12;
  const delta = resolvePlayerLocomotionDelta(normalized, previous);
  const acceleration = clamp(1 + delta.accelerationMps2 * 0.015, 0.82, 1.12);
  return round(clamp((MODE_BIAS[mode] ?? 1) * terrain * confidence * acceleration, 0.7, 1.18));
}

export function resolvePlayerLocomotionPresentationConfidence(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const delta = resolvePlayerLocomotionDelta(normalized, previous);
  const accelerationRisk = clamp01(Math.abs(delta.accelerationMps2) / 8);
  const turnRisk = clamp01(normalized.turnRateDegreesPerSecond / 540);
  const slopeRisk = clamp01(normalized.slopeDegrees / 55);
  return round(clamp(
    normalized.surfaceConfidence * 0.58 + (1 - normalized.surfaceSlip) * 0.18
      + (1 - slopeRisk) * 0.12 + (1 - accelerationRisk) * 0.06 + (1 - turnRisk) * 0.06,
    0,
    1,
  ));
}

export function resolvePlayerLocomotionContactResponse(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const brake = resolvePlayerLocomotionBrakeWeight(normalized, previous);
  const pivot = resolvePlayerLocomotionPivotWeight(normalized, previous);
  const confidence = resolvePlayerLocomotionPresentationConfidence(normalized, previous);
  return freeze({
    plant: round(clamp(confidence * (1 - normalized.surfaceSlip * 0.48) * (1 - pivot * 0.2), 0, 1)),
    toeRelease: round(clamp(0.3 + normalized.surfaceSlip * 0.45 + brake * 0.2, 0, 1)),
    heelRelease: round(clamp(0.74 - normalized.surfaceSlip * 0.3 - brake * 0.16, 0.2, 1)),
    correctiveStep: round(clamp(pivot * 0.68 + normalized.surfaceSlip * 0.28 + (1 - confidence) * 0.18, 0, 1)),
  });
}

export function resolvePlayerLocomotionAnticipationProfile(input = {}, previous = null) {
  const normalized = normalizePlayerDirectionalInput(input);
  const directional = resolvePlayerDirectionalFullPresentation(normalized, previous?.semanticState ?? 'idle');
  const delta = resolvePlayerLocomotionDelta(normalized, previous);
  const mode = resolvePlayerLocomotionAnticipationMode(normalized, previous);
  const lookAheadSeconds = resolvePlayerLocomotionLookAheadSeconds(normalized, previous);
  const confidence = resolvePlayerLocomotionPresentationConfidence(normalized, previous);
  const cadenceBias = resolvePlayerLocomotionCadenceBias(normalized, previous);
  const profile = {
    version: PLAYER_LOCOMOTION_ANTICIPATION_VERSION,
    policyVersion: directional.version,
    mode,
    semanticState: directional.semanticState,
    presentDirection: directional.dominantDirection,
    anticipatedDirection: resolvePlayerLocomotionAnticipatedDirection(normalized, previous),
    directionShiftDegrees: delta.angleDeltaDegrees,
    speedMps: normalized.planarSpeedMps,
    speedDeltaMps: delta.speedDeltaMps,
    accelerationMps2: delta.accelerationMps2,
    startWeight: resolvePlayerLocomotionStartWeight(normalized, previous),
    brakeWeight: resolvePlayerLocomotionBrakeWeight(normalized, previous),
    pivotWeight: resolvePlayerLocomotionPivotWeight(normalized, previous),
    stopDistanceMeters: resolvePlayerLocomotionStopDistance(normalized, previous),
    lookAheadSeconds,
    cadenceBias,
    playbackRate: round(clamp(directional.playbackRate * (0.92 + cadenceBias * 0.08), 0.72, 1.35)),
    phase: directional.phase.phase,
    anticipatedBlendWeights: resolvePlayerLocomotionAnticipatedBlend(normalized, previous),
    contact: resolvePlayerLocomotionContactResponse(normalized, previous),
    confidence,
    turnClass: resolvePlayerDirectionalTurnClass(normalized),
    slopeClass: resolvePlayerDirectionalSlopeClass(normalized),
    surfaceConfidence: normalized.surfaceConfidence,
    surfaceSlip: normalized.surfaceSlip,
    groundRisk: round(clamp(normalized.surfaceSlip * 0.5 + normalized.slopeDegrees / 110 + (1 - confidence) * 0.28, 0, 1)),
  };
  return freeze(profile);
}

export function validatePlayerLocomotionAnticipationProfile(profile = {}) {
  const weights = PLAYER_DIRECTIONAL_DIRECTIONS.map((direction) => finite(profile.anticipatedBlendWeights?.[direction]));
  const sum = weights.reduce((a, b) => a + b, 0);
  const modeOk = PLAYER_LOCOMOTION_ANTICIPATION_MODES.includes(profile.mode);
  const rateOk = Number.isFinite(profile.playbackRate) && profile.playbackRate >= 0.72 && profile.playbackRate <= 1.35;
  const phaseOk = Number.isFinite(profile.phase) && profile.phase >= 0 && profile.phase < 1;
  const confidenceOk = Number.isFinite(profile.confidence) && profile.confidence >= 0 && profile.confidence <= 1;
  return freeze({ ok: modeOk && rateOk && phaseOk && confidenceOk && Math.abs(sum - 1) <= 0.0005, modeOk, rateOk, phaseOk, confidenceOk, blendOk: Math.abs(sum - 1) <= 0.0005 });
}

export function createPlayerLocomotionAnticipationState() {
  return freeze({ frameCount: 0, transitionCount: 0, startCount: 0, stopCount: 0, brakeCount: 0, pivotCount: 0, mode: 'idle', semanticState: 'idle', phase: 0, history: freeze([]), fingerprint: '' });
}

function fingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function advancePlayerLocomotionAnticipationState(state = createPlayerLocomotionAnticipationState(), input = {}, previous = null) {
  const prior = state || createPlayerLocomotionAnticipationState();
  const profile = resolvePlayerLocomotionAnticipationProfile(input, previous);
  const changed = profile.mode !== prior.mode || profile.semanticState !== prior.semanticState;
  const history = [...(prior.history ?? []), freeze({ mode: profile.mode, direction: profile.anticipatedDirection, phase: profile.phase })].slice(-24);
  const next = {
    frameCount: prior.frameCount + 1,
    transitionCount: prior.transitionCount + (changed ? 1 : 0),
    startCount: prior.startCount + (profile.mode === 'start' ? 1 : 0),
    stopCount: prior.stopCount + (profile.mode === 'stop' ? 1 : 0),
    brakeCount: prior.brakeCount + (profile.mode === 'brake' ? 1 : 0),
    pivotCount: prior.pivotCount + (profile.mode === 'pivot' ? 1 : 0),
    mode: profile.mode,
    semanticState: profile.semanticState,
    phase: profile.phase,
    history: freeze(history),
  };
  return freeze({ ...next, fingerprint: fingerprint(profile) });
}

export function validatePlayerLocomotionAnticipationState(state = {}) {
  const bounded = Array.isArray(state.history) && state.history.length <= 24;
  const frame = Number.isInteger(state.frameCount) && state.frameCount >= 0;
  const transition = Number.isInteger(state.transitionCount) && state.transitionCount >= 0 && state.transitionCount <= state.frameCount;
  return freeze({ ok: bounded && frame && transition, bounded, frame, transition });
}

export function createPlayerLocomotionAnticipationController({ onProfile = null } = {}) {
  let state = createPlayerLocomotionAnticipationState();
  let previous = null;
  return freeze({
    update(input = {}) {
      const profile = resolvePlayerLocomotionAnticipationProfile(input, previous);
      state = advancePlayerLocomotionAnticipationState(state, input, previous);
      previous = freeze({ planarSpeedMps: input.planarSpeedMps, directionAngleRadians: resolvePlayerDirectionalAngle(input), semanticState: profile.semanticState, phase: profile.phase, turnRateDegreesPerSecond: input.turnRateDegreesPerSecond, surfaceConfidence: input.surfaceConfidence, surfaceSlip: input.surfaceSlip });
      if (typeof onProfile === 'function') onProfile(profile);
      return freeze({ profile, state });
    },
    read() { return freeze({ ...state }); },
    reset() { state = createPlayerLocomotionAnticipationState(); previous = null; },
  });
}

export function resolvePlayerLocomotionCapabilities() {
  return Object.freeze(['temporal-start','temporal-brake','stop-distance','pivot-anticipation','surface-contact','terrain-cadence','combat-recovery','bounded-look-ahead','immutable-output','deterministic-fingerprint']);
}

export function auditPlayerLocomotionAnticipationPolicy() {
  const probe = resolvePlayerLocomotionAnticipationProfile({ velocity: { x: 0, y: 1 }, facing: { x: 0, y: 1 }, planarSpeedMps: 3.2, deltaSeconds: 1 / 60, surfaceConfidence: 1, surfaceSlip: 0 });
  return freeze({ version: PLAYER_LOCOMOTION_ANTICIPATION_VERSION, modeCount: PLAYER_LOCOMOTION_ANTICIPATION_MODES.length, capabilities: resolvePlayerLocomotionCapabilities(), validProbe: validatePlayerLocomotionAnticipationProfile(probe).ok, immutable: Object.isFrozen(probe), limits: freeze({ ...PLAYER_LOCOMOTION_ANTICIPATION_LIMITS }) });
}
