/** Production TypeScript owner for src/3d/gameplay/creatureLocomotionStateSynthesis.js. Legacy .js remains compatibility-only. */
// @ts-nocheck
/**
 * Renderer-agnostic locomotion presentation synthesis for procedural creatures.
 *
 * The creature brain owns behaviour and movement intent; creatureGait owns bone animation.
 * This module owns the deterministic semantic bridge between those two layers. It never moves a
 * creature, mutates a rig, selects a mesh, or writes a mixer. A caller can feed it a brain snapshot,
 * contact cues, species plan metadata, and a previous state and receive an immutable presentation
 * intent suitable for gait, audio, VFX, UI telemetry, or a future animator.
 *
 * Design goals:
 * - deterministic for the same input snapshot;
 * - explicit priority rules for flight, landing, threat, social, and calm locomotion;
 * - no hidden time source and no randomness;
 * - stable vocabulary so downstream consumers do not infer meaning from speed alone;
 * - bounded numeric inputs so malformed runtime data cannot poison a frame;
 * - separation between semantic state and animation request details;
 * - graceful fallback for unknown species/gaits rather than throwing in a live frame.
 *
 * The module intentionally accepts plain objects. That keeps it compatible with creatureBrain,
 * replay fixtures, unit tests, and browser runtime code without creating a dependency cycle.
 * @module gameplay/creatureLocomotionStateSynthesis
 */

import { GAIT_LEG_PHASES } from './creatureGait.ts';

export const CREATURE_LOCOMOTION_STATE_SYNTHESIS_VERSION = '2026-09-15-v1';

export const CREATURE_LOCOMOTION_STATES = Object.freeze([
  'idle',
  'wander',
  'approach',
  'flee',
  'herd-flee',
  'flock-flee',
  'takeoff',
  'flight-climb',
  'flight-cruise',
  'flight-descend',
  'landing-soft',
  'landing-hard',
  'reacquire-ground',
  'turn',
  'brake',
  'recover',
  'blocked',
  'contact-unstable',
  'slip-recover',
]);

export const CREATURE_LOCOMOTION_EVENTS = Object.freeze([
  'none',
  'wander-enter',
  'wander-exit',
  'approach-enter',
  'approach-exit',
  'flee-enter',
  'flee-exit',
  'herd-alert',
  'flock-alert',
  'takeoff-enter',
  'flight-climb',
  'flight-cruise',
  'flight-descend',
  'airborne-enter',
  'airborne-exit',
  'landing-soft',
  'landing-hard',
  'ground-reacquired',
  'turn-start',
  'turn-stop',
  'brake-start',
  'blocked',
  'contact-unstable',
  'slip-recover',
  'confidence-drop',
  'confidence-recover',
  'gait-change',
  'pace-change',
]);

export const CREATURE_LOCOMOTION_SOURCES = Object.freeze([
  'flight',
  'landing',
  'reactive',
  'social',
  'behaviour',
  'contact',
  'fallback',
]);

export const CREATURE_LOCOMOTION_PRIORITIES = Object.freeze({
  flight: 100,
  landing: 96,
  reactive: 84,
  social: 76,
  contact: 70,
  behaviour: 50,
  fallback: 10,
});

const LIMITS = Object.freeze({
  maxSpeedMps: 30,
  maxTurnRateRad: 12,
  maxDistanceMeters: 200,
  maxAltitudeMeters: 100,
  maxAirTimeSeconds: 30,
  maxImpactMps: 20,
  confidenceFloor: 0,
  confidenceCeil: 1,
  unstableSlip: 0.65,
  hardLandingImpact: 5,
  softLandingImpact: 1,
  minMovingSpeed: 0.08,
  minTurnRate: 0.02,
  gaitBlendEpsilon: 0.0001,
});

const GAIT_ALIASES = Object.freeze({
  idle: 'walk',
  calm: 'walk',
  run: 'gallop',
  fast: 'sprint',
  escape: 'gallop',
  flight: 'flap',
});

const BEHAVIOUR_STATE_MAP = Object.freeze({
  wander: { state: 'wander', source: 'behaviour', priority: CREATURE_LOCOMOTION_PRIORITIES.behaviour },
  'approach-friendly': { state: 'approach', source: 'reactive', priority: CREATURE_LOCOMOTION_PRIORITIES.reactive },
  'flee-on-approach': { state: 'flee', source: 'reactive', priority: CREATURE_LOCOMOTION_PRIORITIES.reactive },
  'herd-bound': { state: 'herd-flee', source: 'social', priority: CREATURE_LOCOMOTION_PRIORITIES.social },
  flock: { state: 'flock-flee', source: 'social', priority: CREATURE_LOCOMOTION_PRIORITIES.social },
  'combat-stance': { state: 'recover', source: 'behaviour', priority: 60 },
  pounce: { state: 'flee', source: 'reactive', priority: 62 },
  charge: { state: 'flee', source: 'reactive', priority: 62 },
  'regal-idle': { state: 'idle', source: 'behaviour', priority: 45 },
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, number(value, min)));
}

function clamp01(value) {
  return clamp(value, LIMITS.confidenceFloor, LIMITS.confidenceCeil);
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  const result = Math.round(number(value) * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function freeze(object) {
  return Object.freeze(object);
}

function freezeMap(object) {
  return freeze(Object.fromEntries(Object.entries(object).map(([key, value]) => [key, round(value)])));
}

export function normalizeCreatureLocomotionInput(input = {}) {
  const velocity = input.velocity && typeof input.velocity === 'object' ? input.velocity : {};
  const intent = input.intent && typeof input.intent === 'object' ? input.intent : {};
  const contact = input.contact && typeof input.contact === 'object' ? input.contact : {};
  const social = input.social && typeof input.social === 'object' ? input.social : {};
  const flight = input.flight && typeof input.flight === 'object' ? input.flight : {};

  return freeze({
    speciesId: text(input.speciesId, 'unknown'),
    behaviour: text(input.behaviour, text(input.behavior, 'wander')),
    requestedGait: text(input.requestedGait, ''),
    speedMps: clamp(Math.abs(number(input.speedMps, number(velocity.speedMps))), 0, LIMITS.maxSpeedMps),
    targetSpeedMps: clamp(Math.abs(number(input.targetSpeedMps, number(intent.targetSpeedMps))), 0, LIMITS.maxSpeedMps),
    turnRateRad: clamp(Math.abs(number(input.turnRateRad, number(intent.turnRateRad))), 0, LIMITS.maxTurnRateRad),
    distanceToPlayer: clamp(Math.abs(number(input.distanceToPlayer, number(intent.distanceToPlayer, LIMITS.maxDistanceMeters))), 0, LIMITS.maxDistanceMeters),
    moving: bool(input.moving, Math.abs(number(input.speedMps, number(velocity.speedMps))) > LIMITS.minMovingSpeed),
    grounded: bool(input.grounded, true),
    groundNormalConfidence: clamp01(input.groundNormalConfidence ?? contact.groundNormalConfidence ?? 1),
    surfaceConfidence: clamp01(input.surfaceConfidence ?? contact.surfaceConfidence ?? 1),
    surfaceSlip: clamp01(input.surfaceSlip ?? contact.surfaceSlip ?? 0),
    impactMps: clamp(Math.abs(number(input.impactMps, number(contact.impactMps))), 0, LIMITS.maxImpactMps),
    airTimeSeconds: clamp(Math.abs(number(input.airTimeSeconds, number(flight.airTimeSeconds))), 0, LIMITS.maxAirTimeSeconds),
    altitudeMeters: clamp(Math.abs(number(input.altitudeMeters, number(flight.altitudeMeters))), 0, LIMITS.maxAltitudeMeters),
    targetAltitudeMeters: clamp(Math.abs(number(input.targetAltitudeMeters, number(flight.targetAltitudeMeters))), 0, LIMITS.maxAltitudeMeters),
    flightPhase: text(input.flightPhase, text(flight.phase, 'grounded')),
    flightEnabled: bool(input.flightEnabled, bool(flight.enabled, false)),
    flightDistanceMeters: clamp(Math.abs(number(input.flightDistanceMeters, number(flight.distanceMeters))), 0, LIMITS.maxDistanceMeters),
    socialAlert: bool(input.socialAlert, bool(social.alert, false)),
    socialAlertRadius: clamp(Math.abs(number(input.socialAlertRadius, number(social.alertRadius))), 0, LIMITS.maxDistanceMeters),
    socialSameSpecies: bool(input.socialSameSpecies, bool(social.sameSpecies, false)),
    traversalBlocked: bool(input.traversalBlocked, false),
    directionChanged: bool(input.directionChanged, false),
    confidence: clamp01(input.confidence ?? 1),
    deltaSeconds: clamp(number(input.deltaSeconds, 1 / 60), 0.001, 0.25),
    gaitClockSeconds: Math.max(0, number(input.gaitClockSeconds)),
    previousState: text(input.previousState, ''),
    previousGait: text(input.previousGait, ''),
    sourceHint: text(input.sourceHint, ''),
  });
}

export function normalizeCreatureGaitName(requestedGait, fallback = 'walk') {
  const requested = text(requestedGait, fallback);
  const aliased = own(GAIT_ALIASES, requested) ? GAIT_ALIASES[requested] : requested;
  return own(GAIT_LEG_PHASES, aliased) ? aliased : (own(GAIT_LEG_PHASES, fallback) ? fallback : 'walk');
}

export function resolveCreatureFlightState(input) {
  const normalized = normalizeCreatureLocomotionInput(input);
  if (!normalized.flightEnabled) return null;

  const phase = normalized.flightPhase;
  if (phase === 'takeoff' || (!normalized.grounded && phase === 'grounded')) {
    return freeze({ state: 'takeoff', source: 'flight', priority: CREATURE_LOCOMOTION_PRIORITIES.flight, phase: 'takeoff' });
  }
  if (phase === 'climb') return freeze({ state: 'flight-climb', source: 'flight', priority: CREATURE_LOCOMOTION_PRIORITIES.flight, phase });
  if (phase === 'cruise') return freeze({ state: 'flight-cruise', source: 'flight', priority: CREATURE_LOCOMOTION_PRIORITIES.flight, phase });
  if (phase === 'descend' || phase === 'land') return freeze({ state: 'flight-descend', source: 'flight', priority: CREATURE_LOCOMOTION_PRIORITIES.flight, phase: 'descend' });
  if (phase === 'reacquire') return freeze({ state: 'reacquire-ground', source: 'landing', priority: CREATURE_LOCOMOTION_PRIORITIES.landing, phase });
  return null;
}

export function resolveCreatureLandingState(input) {
  const normalized = normalizeCreatureLocomotionInput(input);
  if (normalized.grounded && normalized.impactMps >= LIMITS.softLandingImpact && normalized.airTimeSeconds > 0.05) {
    const hard = normalized.impactMps >= LIMITS.hardLandingImpact;
    return freeze({
      state: hard ? 'landing-hard' : 'landing-soft',
      source: 'landing',
      priority: CREATURE_LOCOMOTION_PRIORITIES.landing,
      impactMps: round(normalized.impactMps),
    });
  }
  if (normalized.grounded && normalized.previousState.startsWith('flight-') && normalized.speedMps < LIMITS.minMovingSpeed) {
    return freeze({ state: 'reacquire-ground', source: 'landing', priority: CREATURE_LOCOMOTION_PRIORITIES.landing, impactMps: 0 });
  }
  return null;
}

export function resolveCreatureContactState(input) {
  const normalized = normalizeCreatureLocomotionInput(input);
  if (normalized.traversalBlocked) return freeze({ state: 'blocked', source: 'contact', priority: CREATURE_LOCOMOTION_PRIORITIES.contact });
  if (normalized.surfaceSlip >= LIMITS.unstableSlip) return freeze({ state: 'slip-recover', source: 'contact', priority: CREATURE_LOCOMOTION_PRIORITIES.contact });
  if (normalized.surfaceConfidence < 0.5 || normalized.groundNormalConfidence < 0.5) {
    return freeze({ state: 'contact-unstable', source: 'contact', priority: CREATURE_LOCOMOTION_PRIORITIES.contact });
  }
  return null;
}

export function resolveCreatureBehaviourState(input) {
  const normalized = normalizeCreatureLocomotionInput(input);
  const mapped = BEHAVIOUR_STATE_MAP[normalized.behaviour];
  if (mapped) return freeze({ ...mapped });

  if (normalized.behaviour === 'idle' || !normalized.moving) {
    return freeze({ state: 'idle', source: 'behaviour', priority: 45 });
  }
  return freeze({ state: 'wander', source: 'behaviour', priority: CREATURE_LOCOMOTION_PRIORITIES.behaviour });
}

export function resolveCreatureSocialState(input) {
  const normalized = normalizeCreatureLocomotionInput(input);
  if (!normalized.socialAlert || !normalized.socialSameSpecies) return null;
  const flight = normalized.flightEnabled;
  return freeze({
    state: flight ? 'flock-flee' : 'herd-flee',
    source: 'social',
    priority: CREATURE_LOCOMOTION_PRIORITIES.social,
  });
}

export function resolveCreatureTurnState(input) {
  const normalized = normalizeCreatureLocomotionInput(input);
  if (normalized.directionChanged && normalized.turnRateRad >= LIMITS.minTurnRate && normalized.moving) {
    return freeze({ state: 'turn', source: 'behaviour', priority: 58 });
  }
  return null;
}

export function selectCreatureLocomotionSource(input) {
  const normalized = normalizeCreatureLocomotionInput(input);
  const candidates = [
    resolveCreatureFlightState(normalized),
    resolveCreatureLandingState(normalized),
    resolveCreatureContactState(normalized),
    resolveCreatureSocialState(normalized),
    resolveCreatureTurnState(normalized),
    resolveCreatureBehaviourState(normalized),
  ].filter(Boolean);

  if (candidates.length === 0) {
    return freeze({ state: 'idle', source: 'fallback', priority: CREATURE_LOCOMOTION_PRIORITIES.fallback });
  }

  candidates.sort((left, right) => right.priority - left.priority);
  return freeze(candidates[0]);
}

export function resolveCreatureGaitForState(input, stateSource) {
  const normalized = normalizeCreatureLocomotionInput(input);
  const sourceState = text(stateSource?.state, 'idle');
  if (sourceState === 'flight-climb' || sourceState === 'flight-cruise' || sourceState === 'flight-descend' || sourceState === 'takeoff') {
    return 'flap';
  }
  if (sourceState === 'landing-soft' || sourceState === 'landing-hard' || sourceState === 'reacquire-ground') {
    return 'walk';
  }
  if (normalized.requestedGait) return normalizeCreatureGaitName(normalized.requestedGait);
  if (sourceState === 'flee' || sourceState === 'herd-flee' || sourceState === 'flock-flee') return 'gallop';
  if (sourceState === 'approach') return 'trot';
  if (sourceState === 'wander') return 'walk';
  if (sourceState === 'turn') return 'walk';
  return 'walk';
}

export function resolveCreaturePace(input) {
  const normalized = normalizeCreatureLocomotionInput(input);
  const denominator = Math.max(normalized.targetSpeedMps, LIMITS.minMovingSpeed);
  const ratio = clamp01(normalized.speedMps / denominator);
  const acceleration = clamp01((normalized.targetSpeedMps - normalized.speedMps) / Math.max(normalized.targetSpeedMps, 1));
  const braking = clamp01((normalized.speedMps - normalized.targetSpeedMps) / Math.max(normalized.speedMps, 1));
  return freeze({ speedRatio: round(ratio), acceleration: round(acceleration), braking: round(braking), moving: normalized.moving });
}

export function resolveCreatureGaitBlend(input, primaryGait) {
  const normalized = normalizeCreatureLocomotionInput(input);
  const gait = normalizeCreatureGaitName(primaryGait);
  const pace = resolveCreaturePace(normalized);
  const blends = Object.fromEntries(Object.keys(GAIT_LEG_PHASES).map((name) => [name, 0]));

  blends[gait] = 1;
  if (gait === 'walk' && pace.speedRatio > 0.55) {
    blends.walk = round(1 - (pace.speedRatio - 0.55) / 0.45);
    blends.trot = round(1 - blends.walk);
  }
  if ((gait === 'gallop' || gait === 'sprint') && pace.speedRatio < 0.85) {
    blends[gait] = round(0.35 + pace.speedRatio * 0.65);
    blends.trot = round(1 - blends[gait]);
  }
  if (gait === 'flap') {
    blends.flap = 1;
    blends.walk = 0;
    blends.trot = 0;
  }

  let total = Object.values(blends).reduce((sum, value) => sum + value, 0);
  if (total <= LIMITS.gaitBlendEpsilon) {
    blends.walk = 1;
    total = 1;
  }
  for (const name of Object.keys(blends)) blends[name] = round(blends[name] / total);
  return freezeMap(blends);
}

export function resolveCreatureCadence(input, gaitName) {
  const normalized = normalizeCreatureLocomotionInput(input);
  const gait = normalizeCreatureGaitName(gaitName);
  const alertLike = ['flee', 'herd-flee', 'flock-flee', 'flight-climb', 'flight-cruise', 'flight-descend', 'takeoff'].includes(normalized.previousState);
  const plan = input.plan && typeof input.plan === 'object' ? input.plan : {};
  const stride = plan.strideHz && typeof plan.strideHz === 'object' ? plan.strideHz : {};
  const walkHz = clamp(number(stride.walk, 1), 0.1, 10);
  const runHz = clamp(number(stride.run, Math.max(walkHz, 1.5)), 0.1, 12);
  const cyclesPerSecond = gait === 'flap' || alertLike ? runHz : walkHz;
  const speedScale = clamp01(normalized.speedMps / Math.max(normalized.targetSpeedMps, 1));
  return freeze({ cyclesPerSecond: round(cyclesPerSecond), speedScale: round(speedScale), gait });
}

export function resolveCreatureContactWeights(input) {
  const normalized = normalizeCreatureLocomotionInput(input);
  const plant = clamp01(normalized.groundNormalConfidence * normalized.surfaceConfidence * (1 - normalized.surfaceSlip * 0.35));
  const air = normalized.grounded ? 0 : 1;
  const impact = clamp01(normalized.impactMps / LIMITS.maxImpactMps);
  const slip = normalized.surfaceSlip;
  return freeze({ plant: round(plant), air: round(air), impact: round(impact), slip: round(slip) });
}

export function resolveCreatureConfidence(input, source) {
  const normalized = normalizeCreatureLocomotionInput(input);
  const sourceConfidence = clamp01(number(source?.priority, 10) / 100);
  const ground = normalized.grounded ? 1 : 0.75;
  const surface = normalized.surfaceConfidence * normalized.groundNormalConfidence;
  const social = normalized.socialSameSpecies ? 0.95 : 1;
  return round(clamp01(normalized.confidence * 0.55 + sourceConfidence * 0.15 + ground * 0.12 + surface * 0.13 + social * 0.05));
}

export function resolveCreatureEvent(previous, next, input, gait, confidence) {
  const previousState = text(previous?.state, text(input?.previousState, 'idle'));
  const previousGait = text(previous?.gait, text(input?.previousGait, ''));
  const nextState = text(next?.state, 'idle');
  const normalized = normalizeCreatureLocomotionInput(input);
  const previousConfidence = clamp01(previous?.confidence ?? 1);

  if (nextState === 'takeoff' && previousState !== 'takeoff') return 'takeoff-enter';
  if (['flight-climb', 'flight-cruise', 'flight-descend'].includes(nextState) && !previousState.startsWith('flight-')) return 'airborne-enter';
  if (nextState === 'flight-climb' && previousState !== nextState) return 'flight-climb';
  if (nextState === 'flight-cruise' && previousState !== nextState) return 'flight-cruise';
  if (nextState === 'flight-descend' && previousState !== nextState) return 'flight-descend';
  if (nextState === 'landing-hard' && previousState !== nextState) return 'landing-hard';
  if (nextState === 'landing-soft' && previousState !== nextState) return 'landing-soft';
  if (previousState.startsWith('flight-') && !nextState.startsWith('flight-') && nextState !== 'takeoff') return 'airborne-exit';
  if (nextState === 'reacquire-ground' && previousState !== nextState) return 'ground-reacquired';
  if (nextState === 'wander' && previousState !== nextState) return 'wander-enter';
  if (previousState === 'wander' && nextState !== previousState) return 'wander-exit';
  if (nextState === 'approach' && previousState !== nextState) return 'approach-enter';
  if (previousState === 'approach' && nextState !== previousState) return 'approach-exit';
  if (['flee', 'herd-flee', 'flock-flee'].includes(nextState) && !['flee', 'herd-flee', 'flock-flee'].includes(previousState)) {
    return nextState === 'flock-flee' ? 'flock-alert' : nextState === 'herd-flee' ? 'herd-alert' : 'flee-enter';
  }
  if (['flee', 'herd-flee', 'flock-flee'].includes(previousState) && !['flee', 'herd-flee', 'flock-flee'].includes(nextState)) return 'flee-exit';
  if (nextState === 'turn' && previousState !== nextState) return 'turn-start';
  if (previousState === 'turn' && nextState !== previousState) return 'turn-stop';
  if (nextState === 'blocked') return 'blocked';
  if (nextState === 'contact-unstable') return 'contact-unstable';
  if (nextState === 'slip-recover') return 'slip-recover';
  if (previousGait && previousGait !== gait) return 'gait-change';
  const previousPace = Number(previous?.pace?.speedRatio ?? 0);
  const nextPace = Number(resolveCreaturePace(normalized).speedRatio);
  if (Math.abs(previousPace - nextPace) >= 0.2) return 'pace-change';
  if (confidence < 0.5 && previousConfidence >= 0.5) return 'confidence-drop';
  if (confidence >= 0.75 && previousConfidence < 0.75) return 'confidence-recover';
  return 'none';
}

export function resolveCreatureRootMotionIntent(input, state) {
  const normalized = normalizeCreatureLocomotionInput(input);
  const airState = ['takeoff', 'flight-climb', 'flight-cruise', 'flight-descend'].includes(state.state);
  const movementOwnedElsewhere = true;
  return freeze({
    movementOwnedElsewhere,
    animationRootMotionAllowed: !airState,
    speedMps: round(normalized.speedMps),
    targetSpeedMps: round(normalized.targetSpeedMps),
  });
}

export function resolveCreaturePresentationChannels(input, state, confidence) {
  const normalized = normalizeCreatureLocomotionInput(input);
  const contacts = resolveCreatureContactWeights(normalized);
  const airborne = ['takeoff', 'flight-climb', 'flight-cruise', 'flight-descend'].includes(state.state);
  const reactive = ['flee', 'herd-flee', 'flock-flee', 'approach'].includes(state.state);
  const alert = reactive || state.state === 'blocked' || state.state === 'contact-unstable';
  return freeze({
    locomotion: round(clamp01(confidence * (normalized.moving ? 1 : 0))),
    alert: round(alert ? 0.9 + confidence * 0.1 : 0),
    airborne: round(airborne ? 1 : 0),
    contact: contacts.plant,
    impact: contacts.impact,
    slip: contacts.slip,
    turn: round(clamp01(normalized.turnRateRad / Math.max(1, 8))),
    social: round(normalized.socialAlert && normalized.socialSameSpecies ? 1 : 0),
  });
}

export function synthesizeCreatureLocomotionState(input = {}, previous = null) {
  const normalized = normalizeCreatureLocomotionInput(input);
  const source = selectCreatureLocomotionSource(normalized);
  const gait = resolveCreatureGaitForState(normalized, source);
  const cadence = resolveCreatureCadence({ ...normalized, previousState: source.state }, gait);
  const pace = resolveCreaturePace(normalized);
  const blends = resolveCreatureGaitBlend(normalized, gait);
  const confidence = resolveCreatureConfidence(normalized, source);
  const event = resolveCreatureEvent(previous, { state: source.state }, normalized, gait, confidence);
  const channels = resolveCreaturePresentationChannels(normalized, { state: source.state }, confidence);
  const contacts = resolveCreatureContactWeights(normalized);
  const rootMotion = resolveCreatureRootMotionIntent(normalized, source);

  return freeze({
    version: CREATURE_LOCOMOTION_STATE_SYNTHESIS_VERSION,
    speciesId: normalized.speciesId,
    state: source.state,
    source: source.source,
    priority: source.priority,
    event,
    confidence,
    gait,
    gaitBlend: blends,
    cadence,
    pace,
    contact: contacts,
    presentation: channels,
    rootMotion,
    direction: freeze({ changed: normalized.directionChanged }),
    flight: freeze({
      enabled: normalized.flightEnabled,
      phase: normalized.flightPhase,
      altitudeMeters: round(normalized.altitudeMeters),
      targetAltitudeMeters: round(normalized.targetAltitudeMeters),
      distanceMeters: round(normalized.flightDistanceMeters),
    }),
    social: freeze({
      alerted: normalized.socialAlert,
      sameSpecies: normalized.socialSameSpecies,
      radiusMeters: round(normalized.socialAlertRadius),
    }),
    timing: freeze({
      deltaSeconds: round(normalized.deltaSeconds, 5),
      gaitClockSeconds: round(normalized.gaitClockSeconds),
    }),
  });
}

export function isCreatureLocomotionAirborne(state) {
  return ['takeoff', 'flight-climb', 'flight-cruise', 'flight-descend'].includes(text(state));
}

export function isCreatureLocomotionReactive(state) {
  return ['approach', 'flee', 'herd-flee', 'flock-flee'].includes(text(state));
}

export function isCreatureLocomotionStable(state) {
  return ['idle', 'wander', 'approach', 'flee', 'herd-flee', 'flock-flee', 'flight-cruise', 'turn'].includes(text(state));
}

export function summarizeCreatureLocomotionState(state) {
  const value = state && typeof state === 'object' ? state : {};
  return freeze({
    speciesId: text(value.speciesId, 'unknown'),
    state: text(value.state, 'idle'),
    gait: normalizeCreatureGaitName(value.gait),
    source: text(value.source, 'fallback'),
    event: text(value.event, 'none'),
    confidence: round(clamp01(value.confidence)),
  });
}

export function validateCreatureLocomotionState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') return ['state must be an object'];
  if (!CREATURE_LOCOMOTION_STATES.includes(state.state)) errors.push(`unknown state: ${String(state.state)}`);
  if (!CREATURE_LOCOMOTION_SOURCES.includes(state.source)) errors.push(`unknown source: ${String(state.source)}`);
  if (!CREATURE_LOCOMOTION_EVENTS.includes(state.event)) errors.push(`unknown event: ${String(state.event)}`);
  if (!own(GAIT_LEG_PHASES, state.gait)) errors.push(`unknown gait: ${String(state.gait)}`);
  if (!(state.confidence >= 0 && state.confidence <= 1)) errors.push('confidence outside [0,1]');
  if (!state.gaitBlend || typeof state.gaitBlend !== 'object') errors.push('gaitBlend missing');
  if (!state.presentation || typeof state.presentation !== 'object') errors.push('presentation missing');
  return errors;
}

export function projectCreatureGaitRequest(state) {
  const value = state && typeof state === 'object' ? state : synthesizeCreatureLocomotionState();
  return freeze({
    gait: normalizeCreatureGaitName(value.gait),
    gaitBlend: freeze({ ...(value.gaitBlend || {}) }),
    cyclesPerSecond: number(value.cadence?.cyclesPerSecond, 1),
    speedScale: clamp01(value.cadence?.speedScale),
    clockSeconds: Math.max(0, number(value.timing?.gaitClockSeconds)),
    state: text(value.state, 'idle'),
    event: text(value.event, 'none'),
  });
}

export function compareCreatureLocomotionStates(left, right) {
  const a = summarizeCreatureLocomotionState(left);
  const b = summarizeCreatureLocomotionState(right);
  return freeze({
    sameState: a.state === b.state,
    sameGait: a.gait === b.gait,
    sameSource: a.source === b.source,
    sameEvent: a.event === b.event,
    confidenceDelta: round(b.confidence - a.confidence),
  });
}

export function cloneCreatureLocomotionState(state) {
  return freeze(JSON.parse(JSON.stringify(state || {})));
}

export function buildCreatureLocomotionScenario(overrides = {}) {
  return freeze({
    speciesId: 'unknown',
    behaviour: 'wander',
    speedMps: 0,
    targetSpeedMps: 0,
    grounded: true,
    confidence: 1,
    surfaceConfidence: 1,
    groundNormalConfidence: 1,
    surfaceSlip: 0,
    moving: false,
    flightEnabled: false,
    flightPhase: 'grounded',
    deltaSeconds: 1 / 60,
    ...overrides,
  });
}

export function enumerateCreatureLocomotionGaits() {
  return Object.freeze(Object.keys(GAIT_LEG_PHASES));
}

export function enumerateCreatureLocomotionStates() {
  return Object.freeze([...CREATURE_LOCOMOTION_STATES]);
}

export function enumerateCreatureLocomotionEvents() {
  return Object.freeze([...CREATURE_LOCOMOTION_EVENTS]);
}

export function explainCreatureLocomotionPriority(source) {
  const value = text(source, 'fallback');
  return CREATURE_LOCOMOTION_PRIORITIES[value] ?? CREATURE_LOCOMOTION_PRIORITIES.fallback;
}

export function resolveCreatureAudioCue(state) {
  const value = text(state?.state, 'idle');
  const cues = Object.freeze({
    idle: 'creature-idle',
    wander: 'creature-step',
    approach: 'creature-step-alert',
    flee: 'creature-run',
    'herd-flee': 'creature-herd-run',
    'flock-flee': 'creature-flock-run',
    takeoff: 'creature-takeoff',
    'flight-climb': 'creature-wingbeat',
    'flight-cruise': 'creature-wingbeat-soft',
    'flight-descend': 'creature-wingbeat-soft',
    'landing-soft': 'creature-landing-soft',
    'landing-hard': 'creature-landing-hard',
    'reacquire-ground': 'creature-step',
    turn: 'creature-turn',
    blocked: 'creature-blocked',
    'contact-unstable': 'creature-unstable',
    'slip-recover': 'creature-slip',
    recover: 'creature-recover',
  });
  return text(cues[value], 'creature-idle');
}

export function resolveCreatureVfxCue(state) {
  const value = text(state?.state, 'idle');
  const cues = Object.freeze({
    flee: 'dust-trail',
    'herd-flee': 'herd-dust',
    'flock-flee': 'feather-burst',
    takeoff: 'takeoff-debris',
    'flight-descend': 'landing-airwash',
    'landing-soft': 'soft-landing-dust',
    'landing-hard': 'hard-landing-dust',
    'slip-recover': 'slip-spark',
    blocked: 'contact-stop',
    'contact-unstable': 'contact-warning',
  });
  return text(cues[value], 'none');
}

export function createCreatureLocomotionDebugRecord(state) {
  const summary = summarizeCreatureLocomotionState(state);
  return freeze({
    ...summary,
    audioCue: resolveCreatureAudioCue(state),
    vfxCue: resolveCreatureVfxCue(state),
    airborne: isCreatureLocomotionAirborne(summary.state),
    reactive: isCreatureLocomotionReactive(summary.state),
    stable: isCreatureLocomotionStable(summary.state),
  });
}

export function replayCreatureLocomotionSequence(inputs = []) {
  let previous = null;
  const states = [];
  for (const input of inputs) {
    const next = synthesizeCreatureLocomotionState(input, previous);
    states.push(next);
    previous = next;
  }
  return Object.freeze(states);
}

export function assertCreatureLocomotionDeterminism(input, previous = null) {
  const left = synthesizeCreatureLocomotionState(input, previous);
  const right = synthesizeCreatureLocomotionState(input, previous);
  return freeze({ equal: JSON.stringify(left) === JSON.stringify(right), left, right });
}

export function getCreatureLocomotionConstants() {
  return freeze({ ...LIMITS });
}

export function getCreatureLocomotionPriorityTable() {
  return freeze({ ...CREATURE_LOCOMOTION_PRIORITIES });
}

export function getCreatureLocomotionBehaviourTable() {
  return freeze(Object.fromEntries(Object.entries(BEHAVIOUR_STATE_MAP).map(([key, value]) => [key, freeze({ ...value })])));
}


export interface CreatureLocomotionSnapshot { readonly state:string; readonly gait:string; readonly speed:number }
