/** Stable selector helpers for consumers that must not duplicate locomotion semantics. */
import { CREATURE_LOCOMOTION_STATES, isCreatureLocomotionAirborne, isCreatureLocomotionReactive } from './creatureLocomotionStateSynthesis.ts';

function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp01(value) { return Math.max(0, Math.min(1, n(value))); }
function round(value) { return Math.round(n(value) * 10000) / 10000; }
function freeze(value) { return Object.freeze(value); }

export const CREATURE_LOCOMOTION_SELECTOR_VERSION = '2026-09-15-v1';

export function selectCreatureState(state) { return text(state?.state, 'idle'); }
export function selectCreatureGait(state) { return text(state?.gait, 'walk'); }
export function selectCreatureEvent(state) { return text(state?.event, 'none'); }
export function selectCreatureSource(state) { return text(state?.source, 'fallback'); }
export function selectCreatureConfidence(state) { return round(clamp01(state?.confidence)); }
export function selectCreatureGaitBlend(state) { return freeze({ ...(state?.gaitBlend || {}) }); }
export function selectCreaturePresentationChannels(state) { return freeze({ ...(state?.presentation || {}) }); }
export function selectCreatureCadence(state) { return freeze({ ...(state?.cadence || {}) }); }
export function selectCreatureContact(state) { return freeze({ ...(state?.contact || {}) }); }
export function selectCreatureFlight(state) { return freeze({ ...(state?.flight || {}) }); }
export function selectCreatureSocial(state) { return freeze({ ...(state?.social || {}) }); }
export function selectCreatureRootMotion(state) { return freeze({ ...(state?.rootMotion || {}) }); }

export function selectCreatureAlertIntensity(state) {
  return round(Math.max(clamp01(state?.presentation?.alert), clamp01(state?.presentation?.social)));
}

export function selectCreatureLocomotionIntensity(state) {
  return round(Math.max(clamp01(state?.presentation?.locomotion), clamp01(state?.cadence?.speedScale)));
}

export function selectCreatureContactConfidence(state) {
  return round(clamp01(state?.presentation?.contact ?? state?.contact?.plant));
}

export function selectCreatureImpactIntensity(state) {
  return round(Math.max(clamp01(state?.presentation?.impact), clamp01(state?.contact?.impact)));
}

export function selectCreatureShouldPlayMovementAudio(state) {
  return selectCreatureLocomotionIntensity(state) > 0.05 && !selectCreatureState(state).startsWith('landing');
}

export function selectCreatureShouldEmitLandingVfx(state) {
  return ['landing-soft', 'landing-hard'].includes(selectCreatureState(state));
}

export function selectCreatureShouldSuppressGroundEffects(state) {
  return isCreatureLocomotionAirborne(selectCreatureState(state));
}

export function selectCreatureShouldUseReactiveGait(state) {
  return isCreatureLocomotionReactive(selectCreatureState(state));
}

export function selectCreatureStateKnown(state) {
  return CREATURE_LOCOMOTION_STATES.includes(selectCreatureState(state));
}

export function selectCreatureTransitionActive(transition) {
  return Boolean(transition?.active) && n(transition?.progress, 1) < 1;
}

export function selectCreatureTransitionProgress(transition) {
  return round(Math.max(0, Math.min(1, n(transition?.progress, 1))));
}

export function selectCreatureConsumerSnapshot(state) {
  return freeze({
    version: CREATURE_LOCOMOTION_SELECTOR_VERSION,
    state: selectCreatureState(state),
    gait: selectCreatureGait(state),
    event: selectCreatureEvent(state),
    source: selectCreatureSource(state),
    confidence: selectCreatureConfidence(state),
    alertIntensity: selectCreatureAlertIntensity(state),
    locomotionIntensity: selectCreatureLocomotionIntensity(state),
    contactConfidence: selectCreatureContactConfidence(state),
    impactIntensity: selectCreatureImpactIntensity(state),
    airborne: isCreatureLocomotionAirborne(selectCreatureState(state)),
    reactive: isCreatureLocomotionReactive(selectCreatureState(state)),
    rootMotionOwnedElsewhere: state?.rootMotion?.movementOwnedElsewhere === true,
  });
}

export function compareCreatureSelectorSnapshots(left, right) {
  const a = selectCreatureConsumerSnapshot(left);
  const b = selectCreatureConsumerSnapshot(right);
  return freeze({
    sameState: a.state === b.state,
    sameGait: a.gait === b.gait,
    sameEvent: a.event === b.event,
    confidenceDelta: round(b.confidence - a.confidence),
    alertDelta: round(b.alertIntensity - a.alertIntensity),
    locomotionDelta: round(b.locomotionIntensity - a.locomotionIntensity),
  });
}