/** Production TypeScript owner for src/3d/gameplay/playerLocomotionStateSynthesis.js. Legacy .js remains compatibility-only. */
// @ts-nocheck
/**
 * Renderer-agnostic locomotion state synthesis.
 * Combines existing anticipation/directional contracts with caller-owned contact/traversal cues.
 * No movement, physics, combat, camera, navigation, persistence, asset, mixer or renderer ownership.
 */
import { PLAYER_DIRECTIONAL_DIRECTIONS, normalizePlayerDirectionalInput } from './playerDirectionalLocomotionPolicy.js';
import { resolvePlayerLocomotionAnticipationProfile } from './playerLocomotionAnticipationPolicy.js';
import { resolvePlayerLocomotionAnimationRequest } from './playerLocomotionAnimationBridge.js';

export const PLAYER_LOCOMOTION_STATE_SYNTHESIS_VERSION = '2026-09-15-v1';
export const PLAYER_LOCOMOTION_STATE_STATES = Object.freeze([
  'idle','start','accelerate','cruise','brake','stop','strafe','reverse','pivot','recover','turn-in-place',
  'combat-advance','combat-retreat','guard-walk','dodge-recover','stagger-recover',
  'airborne','landing-soft','landing-hard','slippery-step','unstable-step','contact-recover','traversal-prepare','traversal-clear','traversal-blocked',
]);
export const PLAYER_LOCOMOTION_STATE_EVENTS = Object.freeze([
  'none','start','speed-up','speed-down','stop-enter','direction-shift','pivot-enter','pivot-exit','landing-soft','landing-hard',
  'surface-slip','recovery-enter','recovery-exit','contact-adjust','traversal-enter','traversal-exit','traversal-blocked',
  'airborne-enter','airborne-exit','override-enter','override-exit','confidence-drop','confidence-recover','cadence-change','foot-plant','foot-release',
]);
export const PLAYER_LOCOMOTION_STATE_SOURCES = Object.freeze([
  'override','semantic','landing','airborne','traversal','surface','anticipation','fallback',
]);
export const PLAYER_LOCOMOTION_STATE_PRIORITIES = Object.freeze({
  override:100, stagger:95, dodge:90, landing:88, attack:84, guard:78, pivot:72, brake:64, stop:58, traversal:52, locomotion:40, idle:10,
});

const LIMITS = Object.freeze({
  maxSpeed:12,
  maxTurnRate:540,
  maxSlope:55,
  maxImpact:9,
  maxAirTime:4,
  slipThreshold:0.55,
  unstableThreshold:0.60,
  traversalThreshold:0.45,
  landingSoftImpact:1.2,
  landingHardImpact:4.5,
  lowConfidence:0.5,
  confidenceRecovery:0.74,
});

const MODE_TO_STATE = Object.freeze({
  idle:'idle',start:'start',accelerate:'accelerate',cruise:'cruise',brake:'brake',stop:'stop',strafe:'strafe',reverse:'reverse',
  pivot:'pivot',recover:'recover','turn-in-place':'turn-in-place','combat-advance':'combat-advance','combat-retreat':'combat-retreat',
  'guard-walk':'guard-walk','dodge-recover':'dodge-recover','stagger-recover':'stagger-recover',
});

const SEMANTIC_SOURCE = Object.freeze({
  'hit-stagger':Object.freeze({ state:'stagger-recover', source:'semantic', priority:95 }),
  dodge:Object.freeze({ state:'dodge-recover', source:'semantic', priority:90 }),
  guard:Object.freeze({ state:'guard-walk', source:'semantic', priority:78 }),
  'heavy-attack':Object.freeze({ state:'recover', source:'semantic', priority:84 }),
  'light-attack':Object.freeze({ state:'recover', source:'semantic', priority:84 }),
});

const OVERRIDE_ALIASES = Object.freeze({
  attack:'recover',
  stagger:'stagger-recover',
  dodge:'dodge-recover',
  guard:'guard-walk',
  air:'airborne',
  land:'landing-soft',
  traverse:'traversal-prepare',
  blocked:'traversal-blocked',
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function freeze(value) { return Object.freeze(value); }
function text(value, fallback = '') { return typeof value === 'string' && value.length > 0 ? value : fallback; }
function round(value, digits = 4) {
  const factor = 10 ** digits;
  const rounded = Math.round(finite(value) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}
function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

export function normalizePlayerLocomotionStateInput(input = {}) {
  const directional = normalizePlayerDirectionalInput(input);
  const override = text(input.gameplayOverride, '');
  const alias = own(OVERRIDE_ALIASES, override) ? OVERRIDE_ALIASES[override] : override;
  return freeze({
    ...input,
    planarSpeedMps:clamp(Math.max(0, finite(directional.planarSpeedMps)), 0, LIMITS.maxSpeed),
    turnRateDegreesPerSecond:clamp(Math.abs(finite(directional.turnRateDegreesPerSecond)), 0, LIMITS.maxTurnRate),
    slopeDegrees:clamp(finite(directional.slopeDegrees), -LIMITS.maxSlope, LIMITS.maxSlope),
    surfaceConfidence:clamp01(directional.surfaceConfidence),
    surfaceSlip:clamp01(directional.surfaceSlip),
    deltaSeconds:clamp(Math.max(0.001, finite(directional.deltaSeconds, 1 / 60)), 0.001, 0.2),
    grounded:input.grounded !== false,
    airTimeSeconds:clamp(Math.max(0, finite(input.airTimeSeconds)), 0, LIMITS.maxAirTime),
    landingImpactMps:clamp(Math.max(0, finite(input.landingImpactMps)), 0, LIMITS.maxImpact),
    traversalWeight:clamp01(input.traversalWeight),
    traversalBlocked:Boolean(input.traversalBlocked),
    traversalForwardDistance:clamp(Math.max(0, finite(input.traversalForwardDistance)), 0, 8),
    traversalHeight:clamp(finite(input.traversalHeight), -3, 3),
    gameplayOverride:alias,
    rootMotionAllowed:input.rootMotionAllowed !== false,
    footPlantConfidence:clamp01(input.footPlantConfidence),
    footContactPhase:clamp01(input.footContactPhase),
  });
}

export function resolvePlayerLocomotionStateOverride(input = {}) {
  const normalized = normalizePlayerLocomotionStateInput(input);
  if (!normalized.gameplayOverride) return null;
  const state = PLAYER_LOCOMOTION_STATE_STATES.includes(normalized.gameplayOverride) ? normalized.gameplayOverride : 'recover';
  return freeze({ state, source:'override', priority:PLAYER_LOCOMOTION_STATE_PRIORITIES.override, requested:normalized.gameplayOverride });
}

export function resolvePlayerLocomotionTraversalSource(input = {}) {
  const normalized = normalizePlayerLocomotionStateInput(input);
  const weight = normalized.traversalWeight;
  if (weight < LIMITS.traversalThreshold && !normalized.traversalBlocked) return null;
  if (normalized.traversalBlocked) return freeze({ state:'traversal-blocked', source:'traversal', priority:PLAYER_LOCOMOTION_STATE_PRIORITIES.traversal, weight });
  if (normalized.traversalForwardDistance > 2.5 && normalized.traversalHeight > -0.25) return freeze({ state:'traversal-prepare', source:'traversal', priority:PLAYER_LOCOMOTION_STATE_PRIORITIES.traversal, weight });
  return freeze({ state:'traversal-clear', source:'traversal', priority:PLAYER_LOCOMOTION_STATE_PRIORITIES.traversal, weight });
}

export function resolvePlayerLocomotionContactSource(input = {}) {
  const normalized = normalizePlayerLocomotionStateInput(input);
  if (!normalized.grounded) return freeze({ state:'airborne', source:'airborne', priority:52 });
  if (normalized.landingImpactMps >= LIMITS.landingHardImpact) return freeze({ state:'landing-hard', source:'landing', priority:PLAYER_LOCOMOTION_STATE_PRIORITIES.landing });
  if (normalized.airTimeSeconds > 0.08 && normalized.landingImpactMps >= LIMITS.landingSoftImpact) return freeze({ state:'landing-soft', source:'landing', priority:PLAYER_LOCOMOTION_STATE_PRIORITIES.landing });
  if (normalized.surfaceSlip >= LIMITS.slipThreshold && normalized.planarSpeedMps > 0.4) return freeze({ state:'slippery-step', source:'surface', priority:PLAYER_LOCOMOTION_STATE_PRIORITIES.traversal });
  if (normalized.surfaceConfidence < LIMITS.lowConfidence && normalized.planarSpeedMps > 0.4) return freeze({ state:'contact-recover', source:'surface', priority:PLAYER_LOCOMOTION_STATE_PRIORITIES.traversal });
  return null;
}

export function resolvePlayerLocomotionSemanticSource(profile = {}) {
  const semantic = text(profile.semanticState, 'idle');
  return SEMANTIC_SOURCE[semantic] ? freeze(SEMANTIC_SOURCE[semantic]) : null;
}

export function resolvePlayerLocomotionStateSource(input = {}, profile = {}) {
  const candidates = [];
  const override = resolvePlayerLocomotionStateOverride(input);
  const contact = resolvePlayerLocomotionContactSource(input);
  const semantic = resolvePlayerLocomotionSemanticSource(profile);
  const traversal = resolvePlayerLocomotionTraversalSource(input);
  if (override) candidates.push(override);
  if (contact) candidates.push(contact);
  if (semantic) candidates.push(semantic);
  if (traversal) candidates.push(traversal);
  if (profile.mode === 'pivot') candidates.push(freeze({ state:'pivot', source:'anticipation', priority:PLAYER_LOCOMOTION_STATE_PRIORITIES.pivot }));
  const fallbackState = MODE_TO_STATE[profile.mode] ?? 'idle';
  candidates.push(freeze({ state:fallbackState, source:'anticipation', priority:PLAYER_LOCOMOTION_STATE_PRIORITIES.locomotion }));
  candidates.sort((left, right) => right.priority - left.priority);
  return freeze(candidates[0]);
}

export function resolvePlayerLocomotionStateDirection(profile = {}) {
  const current = text(profile.presentDirection, 'forward');
  const anticipated = text(profile.anticipatedDirection, current);
  const shiftDegrees = finite(profile.directionShiftDegrees);
  const lookAhead = clamp01(finite(profile.lookAheadSeconds) / 0.35);
  const selected = lookAhead >= 0.42 && Math.abs(shiftDegrees) >= 15 ? anticipated : current;
  return freeze({
    current,
    anticipated,
    selected:PLAYER_DIRECTIONAL_DIRECTIONS.includes(selected) ? selected : current,
    shiftDegrees:round(shiftDegrees, 3),
    anticipationStrength:round(lookAhead),
  });
}

export function resolvePlayerLocomotionStateBlend(profile = {}, animationRequest = {}) {
  const raw = profile.anticipatedBlendWeights && typeof profile.anticipatedBlendWeights === 'object' ? profile.anticipatedBlendWeights : {};
  const directions = Object.fromEntries(PLAYER_DIRECTIONAL_DIRECTIONS.map((direction) => [direction, clamp01(raw[direction])]));
  let total = Object.values(directions).reduce((sum, value) => sum + value, 0);
  if (total <= 0) directions.forward = 1;
  total = Object.values(directions).reduce((sum, value) => sum + value, 0);
  const normalized = Object.fromEntries(PLAYER_DIRECTIONAL_DIRECTIONS.map((direction) => [direction, round(directions[direction] / total)]));
  const channels = animationRequest.channels && typeof animationRequest.channels === 'object'
    ? Object.fromEntries(Object.entries(animationRequest.channels).map(([key, value]) => [key, round(clamp01(value))]))
    : {};
  return freeze({ directions:freeze(normalized), channels:freeze(channels), total:round(total) });
}

export function resolvePlayerLocomotionLanding(input = {}) {
  const normalized = normalizePlayerLocomotionStateInput(input);
  const raw = clamp01(normalized.landingImpactMps / LIMITS.maxImpact);
  return freeze({
    weight:round(raw),
    softWeight:round(clamp01(raw / 0.55)),
    hardWeight:round(clamp01((raw - 0.45) / 0.55)),
    airTimeSeconds:round(normalized.airTimeSeconds),
  });
}

export function resolvePlayerLocomotionStateConfidence(input = {}, profile = {}, source = {}) {
  const normalized = normalizePlayerLocomotionStateInput(input);
  const profileConfidence = clamp01(profile.confidence);
  const sourceConfidence = clamp01(finite(source.priority, 10) / 100);
  const groundConfidence = normalized.grounded ? 1 : 0.72;
  const contactConfidence = normalized.surfaceConfidence * (1 - normalized.surfaceSlip * 0.34);
  const traversalConfidence = normalized.traversalWeight > 0 ? 0.85 + normalized.traversalWeight * 0.15 : 1;
  return round(clamp(profileConfidence * 0.5 + sourceConfidence * 0.14 + groundConfidence * 0.13 + contactConfidence * 0.16 + traversalConfidence * 0.07, 0, 1));
}

export function resolvePlayerLocomotionStateWeights(input = {}, profile = {}, transition = {}, landing = {}) {
  const normalized = normalizePlayerLocomotionStateInput(input);
  const risk = clamp01(finite(profile.groundRisk)) * 0.28 + normalized.surfaceSlip * 0.24 + (1 - normalized.surfaceConfidence) * 0.1;
  const contact = clamp01(profile.contact?.plant);
  return freeze({
    locomotion:round(clamp01(profile.confidence) * clamp01(1 - risk)),
    anticipation:round(clamp01(finite(profile.lookAheadSeconds) / 0.35)),
    contact:round(clamp01(contact * (1 - risk))),
    transition:round(transition.changed ? transition.confidence : 1),
    landing:round(clamp01(landing.weight)),
    traversal:round(normalized.traversalWeight),
  });
}

export function resolvePlayerLocomotionStateEvent(input = {}, profile = {}, previous = null, source = {}, confidence = 0) {
  const normalized = normalizePlayerLocomotionStateInput(input);
  const prior = text(previous?.state, 'idle');
  const next = text(source.state, 'idle');
  const directionShift = Math.abs(finite(profile.directionShiftDegrees));
  const speedDelta = finite(profile.speedDeltaMps);
  const previousConfidence = clamp01(previous?.confidence);
  if (source.source === 'override' && prior !== next) return 'override-enter';
  if (prior !== 'airborne' && next === 'airborne') return 'airborne-enter';
  if (prior === 'airborne' && next !== 'airborne') return 'airborne-exit';
  if (next === 'landing-hard' && prior !== next) return 'landing-hard';
  if (next === 'landing-soft' && prior !== next) return 'landing-soft';
  if (source.source === 'traversal' && next === 'traversal-blocked') return 'traversal-blocked';
  if (source.source === 'traversal' && prior !== next) return 'traversal-enter';
  if (source.source !== 'traversal' && prior.startsWith('traversal-')) return 'traversal-exit';
  if (next === 'pivot' && prior !== next) return 'pivot-enter';
  if (prior === 'pivot' && next !== prior) return 'pivot-exit';
  if (next === 'stop' && prior !== next) return 'stop-enter';
  if (directionShift >= 55 && normalized.planarSpeedMps > 0.6) return 'direction-shift';
  if (normalized.surfaceSlip >= LIMITS.slipThreshold && normalized.planarSpeedMps > 0.5) return 'surface-slip';
  if (speedDelta > 0.18) return 'speed-up';
  if (speedDelta < -0.18) return 'speed-down';
  if (next === 'start' && prior !== next) return 'start';
  if (next.includes('recover') && !prior.includes('recover')) return 'recovery-enter';
  if (!next.includes('recover') && prior.includes('recover')) return 'recovery-exit';
  if (confidence < LIMITS.lowConfidence && previousConfidence >= LIMITS.lowConfidence) return 'confidence-drop';
  if (confidence >= LIMITS.confidenceRecovery && previousConfidence < LIMITS.confidenceRecovery) return 'confidence-recover';
  if (normalized.footPlantConfidence > 0.82 && normalized.footContactPhase < 0.08) return 'foot-plant';
  if (normalized.footPlantConfidence > 0.5 && normalized.footContactPhase > 0.92) return 'foot-release';
  if (source.source === 'surface') return 'contact-adjust';
  return 'none';
}

export function resolvePlayerLocomotionTransition(previous = null, source = {}, confidence = 0) {
  const from = text(previous?.state, 'idle');
  const to = text(source?.state, 'idle');
  return freeze({
    from,
    to,
    changed:from !== to,
    confidence:round(clamp01(confidence)),
    edge:from === to ? 'steady' : `${from}->${to}`,
  });
}

export function validatePlayerLocomotionStateIntent(intent = {}) {
  const errors = [];
  const warnings = [];
  if (!PLAYER_LOCOMOTION_STATE_STATES.includes(intent.state)) errors.push(`unknown-state:${intent.state}`);
  if (!PLAYER_LOCOMOTION_STATE_EVENTS.includes(intent.event?.type)) errors.push(`unknown-event:${intent.event?.type}`);
  if (!PLAYER_LOCOMOTION_STATE_SOURCES.includes(intent.source?.source)) errors.push(`unknown-source:${intent.source?.source}`);
  if (!Number.isFinite(intent.confidence) || intent.confidence < 0 || intent.confidence > 1) errors.push('confidence-out-of-range');
  if (!PLAYER_DIRECTIONAL_DIRECTIONS.includes(intent.direction?.selected)) errors.push(`unknown-direction:${intent.direction?.selected}`);
  if (intent.transition?.changed && !intent.transition.edge.includes('->')) errors.push('transition-edge-invalid');
  if (intent.input?.surfaceConfidence < 0.5) warnings.push('low-surface-confidence');
  if (intent.input?.surfaceSlip > LIMITS.slipThreshold) warnings.push('slip-risk');
  if (intent.input?.grounded === false) warnings.push('airborne');
  if (intent.input?.traversalBlocked) warnings.push('traversal-blocked');
  if (intent.confidence < LIMITS.lowConfidence) warnings.push('low-confidence');
  return freeze({ ok:errors.length === 0, errors:freeze(errors), warnings:freeze(warnings) });
}

export function resolvePlayerLocomotionStateIntent(input = {}, previous = null) {
  const normalized = normalizePlayerLocomotionStateInput(input);
  const previousProfile = previous?.profile ?? previous ?? null;
  const profile = resolvePlayerLocomotionAnticipationProfile(normalized, previousProfile);
  const animationRequest = resolvePlayerLocomotionAnimationRequest(normalized, previousProfile);
  const source = resolvePlayerLocomotionStateSource(normalized, profile);
  const confidence = resolvePlayerLocomotionStateConfidence(normalized, profile, source);
  const direction = resolvePlayerLocomotionStateDirection(profile);
  const blend = resolvePlayerLocomotionStateBlend(profile, animationRequest);
  const landing = resolvePlayerLocomotionLanding(normalized);
  const transition = resolvePlayerLocomotionTransition(previous, source, confidence);
  const event = freeze({ type:resolvePlayerLocomotionStateEvent(normalized, profile, previous, source, confidence), state:source.state, direction:direction.selected, weight:confidence });
  const weights = resolvePlayerLocomotionStateWeights(normalized, profile, transition, landing);
  const result = {
    version:PLAYER_LOCOMOTION_STATE_SYNTHESIS_VERSION,
    input:normalized,
    profile,
    animationRequest,
    source,
    state:source.state,
    semanticState:text(profile.semanticState, 'idle'),
    confidence,
    direction,
    blend,
    landing,
    transition,
    weights,
    event,
    rootMotionAllowed:normalized.rootMotionAllowed,
  };
  const validation = validatePlayerLocomotionStateIntent(result);
  return freeze({ ...result, validation });
}

export function createPlayerLocomotionStateSynthesisState() {
  return freeze({ frameCount:0, state:'idle', semanticState:'idle', profile:null, confidence:0, lastEvent:'none' });
}

export function advancePlayerLocomotionStateSynthesisState(state = createPlayerLocomotionStateSynthesisState(), input = {}) {
  const intent = resolvePlayerLocomotionStateIntent(input, state);
  return freeze({ frameCount:state.frameCount + 1, state:intent.state, semanticState:intent.semanticState, profile:intent.profile, confidence:intent.confidence, lastEvent:intent.event.type });
}

export function updatePlayerLocomotionStateSynthesis(state = createPlayerLocomotionStateSynthesisState(), input = {}) {
  const intent = resolvePlayerLocomotionStateIntent(input, state);
  const nextState = advancePlayerLocomotionStateSynthesisState(state, input);
  return freeze({ state:nextState, intent });
}

export function resolvePlayerLocomotionStateReadModel(intent = {}) {
  return freeze({
    version:PLAYER_LOCOMOTION_STATE_SYNTHESIS_VERSION,
    state:text(intent.state, 'idle'),
    semanticState:text(intent.semanticState, 'idle'),
    source:text(intent.source?.source, 'fallback'),
    direction:text(intent.direction?.selected, 'forward'),
    confidence:round(clamp01(intent.confidence)),
    event:text(intent.event?.type, 'none'),
    changed:Boolean(intent.transition?.changed),
    landingWeight:round(clamp01(intent.weights?.landing)),
    contactWeight:round(clamp01(intent.weights?.contact)),
    anticipationWeight:round(clamp01(intent.weights?.anticipation)),
    traversalWeight:round(clamp01(intent.weights?.traversal)),
    rootMotionAllowed:intent.rootMotionAllowed !== false,
  });
}

export function createPlayerLocomotionStateSynthesisController({ onIntent = null } = {}) {
  let state = createPlayerLocomotionStateSynthesisState();
  return freeze({
    update(input = {}) {
      const result = updatePlayerLocomotionStateSynthesis(state, input);
      state = result.state;
      if (typeof onIntent === 'function') onIntent(result.intent);
      return result;
    },
    read() {
      return resolvePlayerLocomotionStateReadModel({
        state:state.state,
        semanticState:state.semanticState,
        source:{ source:'anticipation' },
        confidence:state.confidence,
        event:{ type:state.lastEvent },
        direction:{ selected:state.profile?.anticipatedDirection ?? 'forward' },
        transition:{ changed:false },
        weights:{ landing:0, contact:0, anticipation:0, traversal:0 },
      });
    },
    reset() { state=createPlayerLocomotionStateSynthesisState(); },
  });
}

export function summarizePlayerLocomotionStateIntents(intents = []) {
  const safe = Array.isArray(intents) ? intents : [];
  const states = safe.map((item) => text(item?.state, 'idle'));
  const events = safe.map((item) => text(item?.event?.type, 'none'));
  const frequency = (values) => values.reduce((result, value) => { result[value] = (result[value] ?? 0) + 1; return result; }, {});
  const averageConfidence = safe.length ? safe.reduce((sum, item) => sum + clamp01(item?.confidence), 0) / safe.length : 0;
  return freeze({
    count:safe.length,
    averageConfidence:round(averageConfidence),
    transitionCount:safe.filter((item) => item?.transition?.changed).length,
    invalidCount:safe.filter((item) => item?.validation?.ok === false).length,
    pivotCount:states.filter((value) => value === 'pivot').length,
    recoveryCount:states.filter((value) => value.includes('recover')).length,
    landingCount:events.filter((value) => value.startsWith('landing-')).length,
    traversalCount:states.filter((value) => value.startsWith('traversal-')).length,
    slipCount:events.filter((value) => value === 'surface-slip').length,
    stateFrequency:freeze(frequency(states)),
    eventFrequency:freeze(frequency(events)),
  });
}

export function comparePlayerLocomotionStateIntents(first = [], second = []) {
  const left = Array.isArray(first) ? first : [];
  const right = Array.isArray(second) ? second : [];
  const count = Math.max(left.length, right.length);
  let stateMismatches = 0;
  let eventMismatches = 0;
  let directionMismatches = 0;
  let sourceMismatches = 0;
  let confidenceDrift = 0;
  for (let index = 0; index < count; index += 1) {
    if (text(left[index]?.state, 'idle') !== text(right[index]?.state, 'idle')) stateMismatches += 1;
    if (text(left[index]?.event?.type, 'none') !== text(right[index]?.event?.type, 'none')) eventMismatches += 1;
    if (text(left[index]?.direction?.selected, 'forward') !== text(right[index]?.direction?.selected, 'forward')) directionMismatches += 1;
    if (text(left[index]?.source?.source, 'fallback') !== text(right[index]?.source?.source, 'fallback')) sourceMismatches += 1;
    confidenceDrift += Math.abs(clamp01(left[index]?.confidence) - clamp01(right[index]?.confidence));
  }
  return freeze({
    count,
    stateMismatches,
    eventMismatches,
    directionMismatches,
    sourceMismatches,
    confidenceDrift:round(confidenceDrift, 6),
    deterministic:stateMismatches === 0 && eventMismatches === 0 && directionMismatches === 0 && sourceMismatches === 0 && confidenceDrift < 0.000001,
  });
}

export const PLAYER_LOCOMOTION_STATE_SCENARIOS = Object.freeze([
  Object.freeze({ name:'idle', input:Object.freeze({ planarSpeedMps:0 }) }),
  Object.freeze({ name:'walk-start', input:Object.freeze({ planarSpeedMps:0.42 }) }),
  Object.freeze({ name:'accelerate', input:Object.freeze({ planarSpeedMps:3.2 }) }),
  Object.freeze({ name:'cruise', input:Object.freeze({ planarSpeedMps:5.4 }) }),
  Object.freeze({ name:'brake', input:Object.freeze({ planarSpeedMps:2.0 }) }),
  Object.freeze({ name:'reverse', input:Object.freeze({ planarSpeedMps:2.4, velocity:Object.freeze({ x:0, y:-1 }) }) }),
  Object.freeze({ name:'pivot', input:Object.freeze({ planarSpeedMps:4.4, turnRateDegreesPerSecond:260, velocity:Object.freeze({ x:1, y:0 }) }) }),
  Object.freeze({ name:'turn-in-place', input:Object.freeze({ planarSpeedMps:0, turnRateDegreesPerSecond:120 }) }),
  Object.freeze({ name:'guard', input:Object.freeze({ planarSpeedMps:1.2, guarding:true }) }),
  Object.freeze({ name:'attack-recover', input:Object.freeze({ planarSpeedMps:1.2, attackKind:'light' }) }),
  Object.freeze({ name:'heavy-advance', input:Object.freeze({ planarSpeedMps:4.5, attackKind:'heavy' }) }),
  Object.freeze({ name:'dodge', input:Object.freeze({ planarSpeedMps:4.8, dodgeRemaining:0.2 }) }),
  Object.freeze({ name:'stagger', input:Object.freeze({ planarSpeedMps:1.8, hitStaggerRemaining:0.2 }) }),
  Object.freeze({ name:'airborne', input:Object.freeze({ planarSpeedMps:1.6, grounded:false, airTimeSeconds:0.4 }) }),
  Object.freeze({ name:'landing-soft', input:Object.freeze({ planarSpeedMps:1.4, grounded:true, airTimeSeconds:0.2, landingImpactMps:2.2 }) }),
  Object.freeze({ name:'landing-hard', input:Object.freeze({ planarSpeedMps:1.2, grounded:true, airTimeSeconds:0.4, landingImpactMps:6.2 }) }),
  Object.freeze({ name:'slippery', input:Object.freeze({ planarSpeedMps:2.3, surfaceSlip:0.8 }) }),
  Object.freeze({ name:'contact-recover', input:Object.freeze({ planarSpeedMps:2.3, surfaceConfidence:0.3 }) }),
  Object.freeze({ name:'traversal-prepare', input:Object.freeze({ planarSpeedMps:2.2, traversalWeight:0.9, traversalForwardDistance:3.2, traversalHeight:0.4 }) }),
  Object.freeze({ name:'traversal-clear', input:Object.freeze({ planarSpeedMps:2.2, traversalWeight:0.7, traversalForwardDistance:1.4, traversalHeight:0.2 }) }),
  Object.freeze({ name:'traversal-blocked', input:Object.freeze({ planarSpeedMps:2.2, traversalWeight:0.8, traversalBlocked:true }) }),
]);

export function auditPlayerLocomotionStateSynthesis() {
  const controller = createPlayerLocomotionStateSynthesisController();
  const intents = PLAYER_LOCOMOTION_STATE_SCENARIOS.map((scenario) => controller.update(scenario.input).intent);
  const summary = summarizePlayerLocomotionStateIntents(intents);
  return freeze({
    version:PLAYER_LOCOMOTION_STATE_SYNTHESIS_VERSION,
    ok:summary.invalidCount === 0 && summary.count === PLAYER_LOCOMOTION_STATE_SCENARIOS.length,
    count:summary.count,
    invalid:summary.invalidCount,
    states:intents.map((intent) => intent.state),
    events:intents.map((intent) => intent.event.type),
  });
}


export interface PlayerLocomotionSnapshot { readonly state:string; readonly direction:string; readonly speed:number }
