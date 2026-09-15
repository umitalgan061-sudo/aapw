/**
 * Traversal presentation policy.
 *
 * Converts caller-owned traversal cues into stable presentation semantics. This module does not move
 * the player, resolve collision, mutate physics, own animation mixers, or decide navigation. It exists
 * so climb/vault/drop/land intent can be consumed consistently by animation, audio, VFX, telemetry and
 * replay systems without each consumer reverse-engineering raw traversal measurements.
 *
 * Contract principles:
 *  - deterministic: same input snapshot + prior state => byte-equivalent semantic output;
 *  - renderer agnostic: output is plain immutable data;
 *  - monotonic confidence: impossible/invalid measurements are clamped before state selection;
 *  - explicit precedence: cancellation/blocked/contact outrank predictive approach cues;
 *  - no hidden timers: callers own the clock and provide elapsed seconds where needed;
 *  - no geometry ownership: only distance/height/contact cues supplied by a caller are interpreted.
 */

export const PLAYER_TRAVERSAL_PRESENTATION_POLICY_VERSION = '2026-09-15-v2';

export const PLAYER_TRAVERSAL_PRESENTATION_STATES = Object.freeze([
  'clear',
  'approach',
  'prepare',
  'vault',
  'climb',
  'drop',
  'land',
  'blocked',
  'recover',
  'cancelled',
]);

export const PLAYER_TRAVERSAL_PRESENTATION_PHASES = Object.freeze([
  'idle',
  'anticipation',
  'commit',
  'execution',
  'contact',
  'recovery',
  'terminal',
]);

export const PLAYER_TRAVERSAL_PRESENTATION_EVENTS = Object.freeze([
  'none',
  'approach-enter',
  'prepare-enter',
  'commit-vault',
  'commit-climb',
  'commit-drop',
  'execute-vault',
  'execute-climb',
  'execute-drop',
  'land-soft',
  'land-hard',
  'blocked-enter',
  'recover-enter',
  'recover-exit',
  'cancel',
  'timeout',
  'clear-enter',
  'confidence-drop',
  'confidence-recover',
  'surface-change',
  'direction-change',
]);

export const PLAYER_TRAVERSAL_PRESENTATION_PHASE_WEIGHTS = Object.freeze({
  idle: 0,
  anticipation: 0.35,
  commit: 0.62,
  execution: 0.82,
  contact: 1,
  recovery: 0.7,
  terminal: 0,
});

const LIMITS = Object.freeze({
  maxDistanceMeters: 8,
  maxHeightMeters: 3,
  maxWidthMeters: 4,
  maxSpeedMps: 12,
  maxDeltaSeconds: 0.2,
  minDeltaSeconds: 0.001,
  prepareDistanceMeters: 2.75,
  commitDistanceMeters: 1.9,
  climbThresholdMeters: 0.95,
  dropThresholdMeters: -0.55,
  hardLandingImpactMps: 4.5,
  softLandingImpactMps: 1.2,
  lowConfidence: 0.5,
  recoverConfidence: 0.74,
  timeoutSeconds: 1.8,
  directionChangeDegrees: 35,
  speedMatchMps: 0.35,
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(finite(value), 0, 1);
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  const rounded = Math.round(finite(value) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function freeze(value) {
  return Object.freeze(value);
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function normalizePlayerTraversalPresentationCue(input = {}) {
  const state = text(input.requestedState, '');
  const phase = text(input.requestedPhase, '');
  return freeze({
    traversalWeight: clamp01(input.traversalWeight),
    forwardDistanceMeters: clamp(Math.max(0, finite(input.traversalForwardDistance)), 0, LIMITS.maxDistanceMeters),
    heightMeters: clamp(finite(input.traversalHeight), -LIMITS.maxHeightMeters, LIMITS.maxHeightMeters),
    widthMeters: clamp(Math.max(0, finite(input.traversalWidth)), 0, LIMITS.maxWidthMeters),
    approachSpeedMps: clamp(Math.max(0, finite(input.planarSpeedMps)), 0, LIMITS.maxSpeedMps),
    verticalSpeedMps: clamp(finite(input.verticalSpeedMps), -LIMITS.maxSpeedMps, LIMITS.maxSpeedMps),
    surfaceConfidence: clamp01(input.surfaceConfidence ?? 1),
    traversalConfidence: clamp01(input.traversalConfidence ?? input.traversalWeight),
    footContactConfidence: clamp01(input.footPlantConfidence ?? 1),
    landingImpactMps: clamp(Math.max(0, finite(input.landingImpactMps)), 0, 9),
    grounded: input.grounded !== false,
    blocked: Boolean(input.traversalBlocked),
    cancelRequested: Boolean(input.cancelRequested),
    directionDegrees: finite(input.directionDegrees),
    directionShiftDegrees: finite(input.directionShiftDegrees),
    deltaSeconds: clamp(finite(input.deltaSeconds, 1 / 60), LIMITS.minDeltaSeconds, LIMITS.maxDeltaSeconds),
    elapsedSeconds: clamp(Math.max(0, finite(input.elapsedSeconds)), 0, 60),
    requestedState: state,
    requestedPhase: phase,
    surfaceId: text(input.surfaceId, 'unknown'),
    obstacleId: text(input.obstacleId, ''),
  });
}

export function resolveTraversalTechnique(cue = {}) {
  const n = normalizePlayerTraversalPresentationCue(cue);
  if (n.heightMeters <= LIMITS.dropThresholdMeters) return 'drop';
  if (n.heightMeters >= LIMITS.climbThresholdMeters) return 'climb';
  if (n.forwardDistanceMeters <= LIMITS.commitDistanceMeters) return 'vault';
  return 'prepare';
}

export function resolveTraversalPhase(state, cue = {}, previous = null) {
  const n = normalizePlayerTraversalPresentationCue(cue);
  if (state === 'clear') return 'idle';
  if (state === 'approach' || state === 'prepare') return 'anticipation';
  if (state === 'vault' || state === 'climb' || state === 'drop') {
    if (previous?.state === state && previous?.phase === 'execution') return 'execution';
    return n.traversalWeight >= 0.78 ? 'commit' : 'anticipation';
  }
  if (state === 'land') return 'contact';
  if (state === 'blocked') return 'terminal';
  if (state === 'recover') return 'recovery';
  return 'terminal';
}

export function resolveTraversalConfidence(cue = {}, state = 'clear') {
  const n = normalizePlayerTraversalPresentationCue(cue);
  const stateFactor = Object.freeze({ clear: 0.98, approach: 0.72, prepare: 0.8, vault: 0.88, climb: 0.88, drop: 0.86, land: 0.9, blocked: 0.96, recover: 0.8, cancelled: 1 })[state] ?? 0.5;
  const contactFactor = n.grounded ? n.footContactConfidence : 0.76;
  const geometryFactor = n.traversalConfidence * (0.65 + n.surfaceConfidence * 0.35);
  return round(clamp01(geometryFactor * 0.58 + contactFactor * 0.18 + stateFactor * 0.24));
}

export function resolveTraversalState(cue = {}, previous = null) {
  const n = normalizePlayerTraversalPresentationCue(cue);
  if (n.cancelRequested) return 'cancelled';
  if (n.blocked) return 'blocked';
  if (previous?.state === 'land' && !n.grounded) return 'recover';
  if (n.landingImpactMps >= LIMITS.hardLandingImpactMps && n.grounded) return 'land';
  if (n.landingImpactMps >= LIMITS.softLandingImpactMps && n.grounded && n.elapsedSeconds < 0.35) return 'land';
  if (!n.grounded) return n.heightMeters >= LIMITS.climbThresholdMeters ? 'climb' : 'drop';
  if (n.traversalWeight < 0.15) return 'clear';
  if (n.forwardDistanceMeters > LIMITS.prepareDistanceMeters) return 'approach';
  if (n.heightMeters <= LIMITS.dropThresholdMeters) return 'drop';
  if (n.heightMeters >= LIMITS.climbThresholdMeters) return 'climb';
  if (n.forwardDistanceMeters <= LIMITS.commitDistanceMeters) return 'vault';
  return 'prepare';
}

function stateEvent(previousState, nextState, cue, confidence, previousConfidence = null) {
  const n = normalizePlayerTraversalPresentationCue(cue);
  if (nextState === 'cancelled' && previousState !== nextState) return 'cancel';
  if (nextState === 'blocked' && previousState !== nextState) return 'blocked-enter';
  if (nextState === 'approach' && previousState !== nextState) return 'approach-enter';
  if (nextState === 'prepare' && previousState !== nextState) return 'prepare-enter';
  if (nextState === 'vault' && previousState !== nextState) return 'commit-vault';
  if (nextState === 'climb' && previousState !== nextState) return 'commit-climb';
  if (nextState === 'drop' && previousState !== nextState) return 'commit-drop';
  if (nextState === 'land' && previousState !== nextState) return n.landingImpactMps >= LIMITS.hardLandingImpactMps ? 'land-hard' : 'land-soft';
  if (nextState === 'recover' && previousState !== nextState) return 'recover-enter';
  if (previousState === 'recover' && nextState !== previousState) return 'recover-exit';
  if (nextState === 'clear' && previousState !== nextState) return 'clear-enter';
  if (confidence < LIMITS.lowConfidence && previousConfidence != null && previousConfidence >= LIMITS.lowConfidence) return 'confidence-drop';
  if (confidence >= LIMITS.recoverConfidence && previousConfidence != null && previousConfidence < LIMITS.recoverConfidence) return 'confidence-recover';
  if (Math.abs(n.directionShiftDegrees) >= LIMITS.directionChangeDegrees) return 'direction-change';
  if (Math.abs(n.approachSpeedMps) <= LIMITS.speedMatchMps && previousState !== nextState) return 'surface-change';
  return 'none';
}

export function buildPlayerTraversalPresentationState(previous = null, cue = {}) {
  const n = normalizePlayerTraversalPresentationCue(cue);
  const state = resolveTraversalState(n, previous);
  const phase = resolveTraversalPhase(state, n, previous);
  const confidence = resolveTraversalConfidence(n, state);
  const previousConfidence = previous?.confidence == null ? null : clamp01(previous.confidence);
  const event = stateEvent(text(previous?.state, 'clear'), state, n, confidence, previousConfidence);
  const technique = ['vault', 'climb', 'drop'].includes(state) ? resolveTraversalTechnique(n) : null;
  const anticipationWeight = clamp01(1 - n.forwardDistanceMeters / LIMITS.maxDistanceMeters);
  const commitmentWeight = clamp01(n.traversalWeight * (1 - n.forwardDistanceMeters / LIMITS.maxDistanceMeters));
  const contactWeight = n.grounded ? clamp01(n.footContactConfidence) : 0;
  const impactWeight = clamp01(n.landingImpactMps / LIMITS.hardLandingImpactMps);

  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_POLICY_VERSION,
    state,
    phase,
    event,
    technique,
    confidence,
    terminal: ['clear', 'blocked', 'cancelled'].includes(state),
    elapsedSeconds: round(n.elapsedSeconds),
    surfaceId: n.surfaceId,
    obstacleId: n.obstacleId,
    metrics: freeze({
      distance: round(n.forwardDistanceMeters),
      height: round(n.heightMeters),
      width: round(n.widthMeters),
      approachSpeed: round(n.approachSpeedMps),
      verticalSpeed: round(n.verticalSpeedMps),
      traversalWeight: round(n.traversalWeight),
      surfaceConfidence: round(n.surfaceConfidence),
      footContactConfidence: round(n.footContactConfidence),
      impact: round(n.landingImpactMps),
    }),
    channels: freeze({
      traversal: round(n.traversalWeight),
      anticipation: round(anticipationWeight),
      commitment: round(commitmentWeight),
      contact: round(contactWeight),
      impact: round(impactWeight),
      confidence: confidence,
    }),
  });
}

export function projectPlayerTraversalPresentationState(presentation, options = {}) {
  const p = presentation ?? buildPlayerTraversalPresentationState(null, {});
  const audio = options.audio !== false;
  const vfx = options.vfx !== false;
  const debug = options.debug !== false;
  const animationState = Object.freeze({
    locomotion: p.state,
    phase: p.phase,
    technique: p.technique,
    weight: p.channels.traversal,
    anticipation: p.channels.anticipation,
    commitment: p.channels.commitment,
    contact: p.channels.contact,
    impact: p.channels.impact,
  });
  return freeze({
    animation: animationState,
    audio: freeze({ enabled: audio, cue: p.event, state: p.state, intensity: p.channels.impact }),
    vfx: freeze({ enabled: vfx, cue: p.event, state: p.state, weight: p.channels.traversal }),
    debug: debug ? freeze({ state: p.state, phase: p.phase, event: p.event, confidence: p.confidence }) : null,
  });
}

export function resolveTraversalTerminalRecovery(previous, current) {
  const prior = text(previous?.state, 'clear');
  const next = text(current?.state, 'clear');
  if (prior === 'blocked' && next === 'clear') return 'recover-exit';
  if (prior === 'land' && next === 'clear') return 'recover-exit';
  if (prior === 'cancelled' && next === 'clear') return 'recover-exit';
  return 'none';
}

export function compareTraversalPresentationState(left, right) {
  const a = left ?? {};
  const b = right ?? {};
  const keys = ['state', 'phase', 'event', 'technique', 'confidence', 'terminal', 'surfaceId', 'obstacleId'];
  return keys.every((key) => a[key] === b[key]);
}

export function isTraversalPresentationState(value) {
  return PLAYER_TRAVERSAL_PRESENTATION_STATES.includes(value);
}

export function isTraversalPresentationPhase(value) {
  return PLAYER_TRAVERSAL_PRESENTATION_PHASES.includes(value);
}

export function isTraversalPresentationEvent(value) {
  return PLAYER_TRAVERSAL_PRESENTATION_EVENTS.includes(value);
}

export function getTraversalPresentationLimits() {
  return freeze({ ...LIMITS });
}

export function getTraversalPhaseWeight(phase) {
  return PLAYER_TRAVERSAL_PRESENTATION_PHASE_WEIGHTS[phase] ?? 0;
}

export function summarizeTraversalPresentation(presentation) {
  const p = presentation ?? buildPlayerTraversalPresentationState(null, {});
  return freeze({
    state: p.state,
    phase: p.phase,
    event: p.event,
    technique: p.technique,
    confidence: round(p.confidence),
    progress: round((p.channels.anticipation + p.channels.commitment + p.channels.contact) / 3),
  });
}

export function createTraversalCueFromContact(contact = {}, locomotion = {}) {
  return freeze({
    traversalWeight: clamp01(contact.weight ?? contact.traversalWeight),
    traversalForwardDistance: finite(contact.forwardDistanceMeters ?? contact.distance),
    traversalHeight: finite(contact.heightMeters ?? contact.height),
    traversalWidth: finite(contact.widthMeters ?? contact.width),
    traversalBlocked: Boolean(contact.blocked),
    surfaceConfidence: clamp01(contact.surfaceConfidence ?? 1),
    footPlantConfidence: clamp01(contact.footPlantConfidence ?? 1),
    landingImpactMps: finite(contact.landingImpactMps),
    grounded: locomotion.grounded !== false,
    planarSpeedMps: finite(locomotion.planarSpeedMps),
    verticalSpeedMps: finite(locomotion.verticalSpeedMps),
    directionDegrees: finite(locomotion.directionDegrees),
    directionShiftDegrees: finite(locomotion.directionShiftDegrees),
    deltaSeconds: finite(locomotion.deltaSeconds, 1 / 60),
    elapsedSeconds: finite(locomotion.elapsedSeconds),
    surfaceId: text(contact.surfaceId, 'unknown'),
    obstacleId: text(contact.obstacleId, ''),
  });
}
