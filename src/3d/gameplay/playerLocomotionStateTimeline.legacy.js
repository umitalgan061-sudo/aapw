/**
 * Deterministic temporal projection for the synthesized locomotion intent.
 * Timeline output is presentation-only and consumes caller-owned delta time.
 */
import {
  PLAYER_LOCOMOTION_STATE_EVENTS,
  PLAYER_LOCOMOTION_STATE_STATES,
  resolvePlayerLocomotionStateIntent,
} from './playerLocomotionStateSynthesis.js';

export const PLAYER_LOCOMOTION_STATE_TIMELINE_VERSION = '2026-09-15-v1';
export const PLAYER_LOCOMOTION_STATE_CUE_TYPES = Object.freeze([
  'state-enter','state-exit','event','contact','landing','traversal','recovery','direction','cadence','confidence',
]);

const LIMITS = Object.freeze({
  maxDuration:0.75,
  minDuration:0.025,
  maxEvents:8,
  maxHistory:32,
  confidenceFloor:0.25,
});

const STATE_DURATIONS = Object.freeze({
  idle:0.16,start:0.22,accelerate:0.14,cruise:0.12,brake:0.18,stop:0.2,strafe:0.14,reverse:0.16,pivot:0.24,recover:0.3,
  'turn-in-place':0.18,'combat-advance':0.14,'combat-retreat':0.16,'guard-walk':0.2,'dodge-recover':0.32,'stagger-recover':0.4,
  airborne:0.12,'landing-soft':0.18,'landing-hard':0.34,'slippery-step':0.16,'unstable-step':0.18,'contact-recover':0.25,
  'traversal-prepare':0.24,'traversal-clear':0.14,'traversal-blocked':0.2,
});

const EVENT_WEIGHTS = Object.freeze({
  none:0,start:0.72,'speed-up':0.38,'speed-down':0.45,'stop-enter':0.85,'direction-shift':0.76,'pivot-enter':0.9,'pivot-exit':0.65,
  'landing-soft':0.82,'landing-hard':1,'surface-slip':0.78,'recovery-enter':0.92,'recovery-exit':0.58,'contact-adjust':0.64,
  'traversal-enter':0.7,'traversal-exit':0.5,'traversal-blocked':0.88,'airborne-enter':0.62,'airborne-exit':0.58,'override-enter':1,
  'override-exit':0.72,'confidence-drop':0.55,'confidence-recover':0.42,'cadence-change':0.32,'foot-plant':0.52,'foot-release':0.46,
});

const EASING_CURVES = Object.freeze({
  idle:'smooth',start:'accelerate',accelerate:'accelerate',cruise:'linear',brake:'decelerate',stop:'decelerate',strafe:'smooth',reverse:'smooth',
  pivot:'sharp',recover:'smooth','turn-in-place':'smooth','combat-advance':'weighted','combat-retreat':'weighted','guard-walk':'smooth',
  'dodge-recover':'decelerate','stagger-recover':'decelerate',airborne:'linear','landing-soft':'impact','landing-hard':'impact','slippery-step':'staccato',
  'unstable-step':'staccato','contact-recover':'smooth','traversal-prepare':'anticipate','traversal-clear':'release','traversal-blocked':'hold',
});

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function freeze(value) { return Object.freeze(value); }
function round(value, digits = 4) { const factor = 10 ** digits; const n = Math.round(finite(value) * factor) / factor; return Object.is(n, -0) ? 0 : n; }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }

export function normalizePlayerLocomotionTimelineState(state = {}) {
  const stateName = PLAYER_LOCOMOTION_STATE_STATES.includes(state.state) ? state.state : 'idle';
  return freeze({
    state:stateName,
    elapsedSeconds:clamp(Math.max(0, finite(state.elapsedSeconds)), 0, LIMITS.maxDuration),
    durationSeconds:clamp(Math.max(LIMITS.minDuration, finite(state.durationSeconds, STATE_DURATIONS[stateName] ?? 0.16)), LIMITS.minDuration, LIMITS.maxDuration),
    confidence:clamp01(state.confidence),
    sequence:Math.max(0, Math.floor(finite(state.sequence))),
  });
}

export function resolvePlayerLocomotionStateDuration(state = 'idle', confidence = 1, event = 'none') {
  const base = STATE_DURATIONS[state] ?? STATE_DURATIONS.idle;
  const eventWeight = EVENT_WEIGHTS[event] ?? 0;
  const confidenceFactor = 1 + (0.75 - clamp01(confidence)) * 0.18;
  const eventFactor = 1 - eventWeight * 0.18;
  return round(clamp(base * confidenceFactor * eventFactor, LIMITS.minDuration, LIMITS.maxDuration), 4);
}

export function resolvePlayerLocomotionTimelineProgress(state = {}) {
  const normalized = normalizePlayerLocomotionTimelineState(state);
  return round(clamp01(normalized.elapsedSeconds / normalized.durationSeconds));
}

export function resolvePlayerLocomotionTimelineEnvelope(state = {}, nextState = {}) {
  const current = normalizePlayerLocomotionTimelineState(state);
  const nextName = PLAYER_LOCOMOTION_STATE_STATES.includes(nextState.state) ? nextState.state : current.state;
  const event = text(nextState.event, 'none');
  const targetDuration = resolvePlayerLocomotionStateDuration(nextName, nextState.confidence, event);
  const overlap = current.state === nextName ? 0 : clamp01((1 - current.confidence) * 0.2 + (EVENT_WEIGHTS[event] ?? 0) * 0.22);
  return freeze({
    from:current.state,
    to:nextName,
    changed:current.state !== nextName,
    durationSeconds:targetDuration,
    overlapSeconds:round(targetDuration * overlap),
    easing:EASING_CURVES[nextName] ?? 'smooth',
    overlapWeight:round(overlap),
  });
}

export function resolvePlayerLocomotionEasing(curve = 'smooth', progress = 0) {
  const t = clamp01(progress);
  if (curve === 'linear') return round(t);
  if (curve === 'accelerate') return round(t * t);
  if (curve === 'decelerate') return round(1 - (1 - t) ** 2);
  if (curve === 'sharp') return round(t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
  if (curve === 'impact') return round(t < 0.24 ? t / 0.24 : 0.72 + (t - 0.24) / 0.76 * 0.28);
  if (curve === 'staccato') return round(clamp01(Math.floor(t * 4) / 3));
  if (curve === 'weighted') return round(t * 0.65 + (1 - Math.cos(Math.PI * t)) * 0.175);
  if (curve === 'anticipate') return round(t * t * (3 - 2 * t));
  if (curve === 'release') return round(1 - (1 - t) ** 3);
  if (curve === 'hold') return round(t < 0.82 ? 0.92 * t / 0.82 : 0.92 + 0.08 * (t - 0.82) / 0.18);
  return round(t * t * (3 - 2 * t));
}

export function resolvePlayerLocomotionCueWeight(event = 'none', progress = 0, confidence = 1) {
  const base = EVENT_WEIGHTS[event] ?? 0;
  const envelope = resolvePlayerLocomotionEasing(EASING_CURVES[text(event, 'none')] ?? 'smooth', progress);
  return round(clamp01(base * envelope * (0.55 + clamp01(confidence) * 0.45)));
}

export function resolvePlayerLocomotionTimelineCues(intent = {}, previous = null, progress = 0) {
  const cues = [];
  const state = text(intent.state, 'idle');
  const event = text(intent.event?.type, 'none');
  const p = clamp01(progress);
  const confidence = clamp01(intent.confidence);
  if (previous?.state !== state) cues.push(freeze({ type:'state-exit', state:text(previous?.state, 'idle'), weight:round(1 - p) }));
  if (previous?.state !== state) cues.push(freeze({ type:'state-enter', state, weight:round(p < 0.35 ? 1 : 1 - p * 0.45) }));
  if (event !== 'none') cues.push(freeze({ type:'event', event, weight:resolvePlayerLocomotionCueWeight(event, p, confidence) }));
  if (intent.weights?.contact > 0.35) cues.push(freeze({ type:'contact', weight:round(clamp01(intent.weights.contact * (1 - p * 0.25))) }));
  if (intent.weights?.landing > 0.2) cues.push(freeze({ type:'landing', weight:round(clamp01(intent.weights.landing * (1 - p * 0.55))) }));
  if (intent.weights?.traversal > 0.2) cues.push(freeze({ type:'traversal', weight:round(clamp01(intent.weights.traversal * (0.65 + p * 0.35))) }));
  if (intent.semanticState?.includes('recover')) cues.push(freeze({ type:'recovery', weight:round(clamp01(0.72 + confidence * 0.28)) }));
  cues.push(freeze({ type:'direction', direction:intent.direction?.selected ?? 'forward', weight:round(clamp01(intent.weights?.anticipation ?? 0)) }));
  return freeze(cues.slice(0, LIMITS.maxEvents));
}

export function resolvePlayerLocomotionStateTimelineSample(input = {}, state = {}, previous = null) {
  const intent = input.state && input.profile ? input : resolvePlayerLocomotionStateIntent(input, previous);
  const normalizedState = normalizePlayerLocomotionTimelineState({
    state:intent.state,
    elapsedSeconds:state.elapsedSeconds,
    durationSeconds:state.durationSeconds ?? resolvePlayerLocomotionStateDuration(intent.state, intent.confidence, intent.event?.type),
    confidence:intent.confidence,
    sequence:state.sequence,
  });
  const progress = resolvePlayerLocomotionTimelineProgress(normalizedState);
  const envelope = resolvePlayerLocomotionTimelineEnvelope(state, { state:intent.state, confidence:intent.confidence, event:intent.event?.type });
  return freeze({
    version:PLAYER_LOCOMOTION_STATE_TIMELINE_VERSION,
    state:intent.state,
    event:text(intent.event?.type, 'none'),
    progress,
    easedProgress:resolvePlayerLocomotionEasing(EASING_CURVES[intent.state] ?? 'smooth', progress),
    durationSeconds:normalizedState.durationSeconds,
    envelope,
    cues:resolvePlayerLocomotionTimelineCues(intent, previous, progress),
    confidence:clamp01(intent.confidence),
    sequence:normalizedState.sequence,
  });
}

export function advancePlayerLocomotionStateTimeline(state = {}, input = {}, previous = null) {
  const normalized = normalizePlayerLocomotionTimelineState(state);
  const intent = input.state && input.profile ? input : resolvePlayerLocomotionStateIntent(input, previous);
  const nextDuration = resolvePlayerLocomotionStateDuration(intent.state, intent.confidence, intent.event?.type);
  const elapsed = normalized.state === intent.state ? normalized.elapsedSeconds + clamp(Math.max(0, finite(input.deltaSeconds, 1 / 60)), 0, 0.2) : 0;
  const next = normalizePlayerLocomotionTimelineState({
    state:intent.state,
    elapsedSeconds:Math.min(elapsed, nextDuration),
    durationSeconds:nextDuration,
    confidence:intent.confidence,
    sequence:normalized.sequence + 1,
  });
  return freeze({ state:next, sample:resolvePlayerLocomotionStateTimelineSample(intent, next, previous), intent });
}

export function createPlayerLocomotionStateTimelineState() {
  return freeze({ state:'idle', elapsedSeconds:0, durationSeconds:STATE_DURATIONS.idle, confidence:1, sequence:0, previous:null });
}

export function createPlayerLocomotionStateTimelineController({ onSample = null } = {}) {
  let state = createPlayerLocomotionStateTimelineState();
  return freeze({
    update(input = {}) {
      const result = advancePlayerLocomotionStateTimeline(state, input, state.previous);
      state = freeze({ ...result.state, previous:result.intent });
      if (typeof onSample === 'function') onSample(result.sample);
      return freeze({ state, ...result });
    },
    read() { return freeze({ state:state.state, elapsedSeconds:state.elapsedSeconds, durationSeconds:state.durationSeconds, confidence:state.confidence, sequence:state.sequence }); },
    reset() { state=createPlayerLocomotionStateTimelineState(); },
  });
}

export function validatePlayerLocomotionStateTimelineSample(sample = {}) {
  const errors = [];
  if (sample.version !== PLAYER_LOCOMOTION_STATE_TIMELINE_VERSION) errors.push('version');
  if (!PLAYER_LOCOMOTION_STATE_STATES.includes(sample.state)) errors.push('state');
  if (!PLAYER_LOCOMOTION_STATE_EVENTS.includes(sample.event)) errors.push('event');
  if (!Number.isFinite(sample.progress) || sample.progress < 0 || sample.progress > 1) errors.push('progress');
  if (!Number.isFinite(sample.easedProgress) || sample.easedProgress < 0 || sample.easedProgress > 1) errors.push('eased-progress');
  if (!Number.isFinite(sample.durationSeconds) || sample.durationSeconds < LIMITS.minDuration || sample.durationSeconds > LIMITS.maxDuration) errors.push('duration');
  if (!Number.isFinite(sample.confidence) || sample.confidence < 0 || sample.confidence > 1) errors.push('confidence');
  if (!Array.isArray(sample.cues) || sample.cues.length > LIMITS.maxEvents) errors.push('cues');
  return freeze({ ok:errors.length === 0, errors:freeze(errors) });
}

export function summarizePlayerLocomotionTimelineSamples(samples = []) {
  const safe = Array.isArray(samples) ? samples : [];
  const eventCounts = {};
  const stateCounts = {};
  for (const sample of safe) {
    const state = text(sample?.state, 'idle');
    const event = text(sample?.event, 'none');
    stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    eventCounts[event] = (eventCounts[event] ?? 0) + 1;
  }
  const averageProgress = safe.length ? safe.reduce((sum, sample) => sum + clamp01(sample?.progress), 0) / safe.length : 0;
  const averageConfidence = safe.length ? safe.reduce((sum, sample) => sum + clamp01(sample?.confidence), 0) / safe.length : 0;
  return freeze({
    count:safe.length,
    averageProgress:round(averageProgress),
    averageConfidence:round(averageConfidence),
    invalidCount:safe.filter((sample) => validatePlayerLocomotionStateTimelineSample(sample).ok === false).length,
    stateCounts:freeze(stateCounts),
    eventCounts:freeze(eventCounts),
    cueCount:safe.reduce((sum, sample) => sum + (Array.isArray(sample?.cues) ? sample.cues.length : 0), 0),
  });
}

export function comparePlayerLocomotionStateTimelineRuns(first = [], second = []) {
  const left = Array.isArray(first) ? first : [];
  const right = Array.isArray(second) ? second : [];
  const count = Math.max(left.length, right.length);
  let stateMismatches = 0;
  let eventMismatches = 0;
  let progressDrift = 0;
  let confidenceDrift = 0;
  for (let index = 0; index < count; index += 1) {
    if (text(left[index]?.state, 'idle') !== text(right[index]?.state, 'idle')) stateMismatches += 1;
    if (text(left[index]?.event, 'none') !== text(right[index]?.event, 'none')) eventMismatches += 1;
    progressDrift += Math.abs(clamp01(left[index]?.progress) - clamp01(right[index]?.progress));
    confidenceDrift += Math.abs(clamp01(left[index]?.confidence) - clamp01(right[index]?.confidence));
  }
  return freeze({ count, stateMismatches, eventMismatches, progressDrift:round(progressDrift, 6), confidenceDrift:round(confidenceDrift, 6), deterministic:stateMismatches === 0 && eventMismatches === 0 && progressDrift < 0.000001 && confidenceDrift < 0.000001 });
}

export const PLAYER_LOCOMOTION_TIMELINE_TRANSITION_MATRIX = Object.freeze([
  Object.freeze({ from:'idle',to:'start',curve:'accelerate',priority:40 }),
  Object.freeze({ from:'idle',to:'turn-in-place',curve:'smooth',priority:42 }),
  Object.freeze({ from:'idle',to:'guard-walk',curve:'smooth',priority:78 }),
  Object.freeze({ from:'idle',to:'combat-advance',curve:'weighted',priority:84 }),
  Object.freeze({ from:'idle',to:'dodge-recover',curve:'decelerate',priority:90 }),
  Object.freeze({ from:'idle',to:'stagger-recover',curve:'decelerate',priority:95 }),
  Object.freeze({ from:'start',to:'accelerate',curve:'accelerate',priority:40 }),
  Object.freeze({ from:'start',to:'cruise',curve:'smooth',priority:40 }),
  Object.freeze({ from:'start',to:'brake',curve:'decelerate',priority:64 }),
  Object.freeze({ from:'accelerate',to:'cruise',curve:'linear',priority:40 }),
  Object.freeze({ from:'accelerate',to:'strafe',curve:'smooth',priority:40 }),
  Object.freeze({ from:'accelerate',to:'pivot',curve:'sharp',priority:72 }),
  Object.freeze({ from:'accelerate',to:'brake',curve:'decelerate',priority:64 }),
  Object.freeze({ from:'cruise',to:'brake',curve:'decelerate',priority:64 }),
  Object.freeze({ from:'cruise',to:'pivot',curve:'sharp',priority:72 }),
  Object.freeze({ from:'cruise',to:'strafe',curve:'smooth',priority:40 }),
  Object.freeze({ from:'cruise',to:'reverse',curve:'smooth',priority:40 }),
  Object.freeze({ from:'cruise',to:'traversal-prepare',curve:'anticipate',priority:52 }),
  Object.freeze({ from:'brake',to:'stop',curve:'decelerate',priority:58 }),
  Object.freeze({ from:'brake',to:'cruise',curve:'release',priority:40 }),
  Object.freeze({ from:'brake',to:'pivot',curve:'sharp',priority:72 }),
  Object.freeze({ from:'stop',to:'idle',curve:'smooth',priority:10 }),
  Object.freeze({ from:'stop',to:'start',curve:'accelerate',priority:40 }),
  Object.freeze({ from:'strafe',to:'cruise',curve:'smooth',priority:40 }),
  Object.freeze({ from:'strafe',to:'pivot',curve:'sharp',priority:72 }),
  Object.freeze({ from:'reverse',to:'brake',curve:'decelerate',priority:64 }),
  Object.freeze({ from:'reverse',to:'pivot',curve:'sharp',priority:72 }),
  Object.freeze({ from:'pivot',to:'cruise',curve:'release',priority:40 }),
  Object.freeze({ from:'pivot',to:'stop',curve:'decelerate',priority:58 }),
  Object.freeze({ from:'recover',to:'cruise',curve:'release',priority:40 }),
  Object.freeze({ from:'recover',to:'idle',curve:'smooth',priority:10 }),
  Object.freeze({ from:'turn-in-place',to:'start',curve:'accelerate',priority:40 }),
  Object.freeze({ from:'guard-walk',to:'cruise',curve:'release',priority:40 }),
  Object.freeze({ from:'guard-walk',to:'recover',curve:'smooth',priority:84 }),
  Object.freeze({ from:'combat-advance',to:'recover',curve:'weighted',priority:84 }),
  Object.freeze({ from:'combat-retreat',to:'guard-walk',curve:'weighted',priority:78 }),
  Object.freeze({ from:'dodge-recover',to:'cruise',curve:'release',priority:40 }),
  Object.freeze({ from:'stagger-recover',to:'idle',curve:'decelerate',priority:10 }),
  Object.freeze({ from:'airborne',to:'landing-soft',curve:'impact',priority:88 }),
  Object.freeze({ from:'airborne',to:'landing-hard',curve:'impact',priority:88 }),
  Object.freeze({ from:'landing-soft',to:'cruise',curve:'release',priority:40 }),
  Object.freeze({ from:'landing-hard',to:'recover',curve:'decelerate',priority:84 }),
  Object.freeze({ from:'slippery-step',to:'cruise',curve:'release',priority:40 }),
  Object.freeze({ from:'unstable-step',to:'contact-recover',curve:'smooth',priority:52 }),
  Object.freeze({ from:'contact-recover',to:'cruise',curve:'release',priority:40 }),
  Object.freeze({ from:'traversal-prepare',to:'traversal-clear',curve:'anticipate',priority:52 }),
  Object.freeze({ from:'traversal-prepare',to:'traversal-blocked',curve:'hold',priority:52 }),
  Object.freeze({ from:'traversal-clear',to:'cruise',curve:'release',priority:40 }),
  Object.freeze({ from:'traversal-blocked',to:'cruise',curve:'release',priority:40 }),
  Object.freeze({ from:'traversal-blocked',to:'stop',curve:'decelerate',priority:58 }),
]);

export function auditPlayerLocomotionStateTimeline() {
  const controller = createPlayerLocomotionStateTimelineController();
  const samples = [];
  const inputs = [
    { planarSpeedMps:0 },
    { planarSpeedMps:0.8 },
    { planarSpeedMps:4.2 },
    { planarSpeedMps:4.2, turnRateDegreesPerSecond:260, velocity:{x:1,y:0} },
    { planarSpeedMps:1, airTimeSeconds:0.3, landingImpactMps:2.1 },
    { planarSpeedMps:2, surfaceSlip:0.8 },
    { planarSpeedMps:2, grounded:false, airTimeSeconds:0.2 },
    { planarSpeedMps:2.2, traversalWeight:0.9, traversalForwardDistance:3.2, traversalHeight:0.4 },
    { planarSpeedMps:2.2, traversalWeight:0.9, traversalBlocked:true },
  ];
  for (const input of inputs) samples.push(controller.update(input).sample);
  const summary = summarizePlayerLocomotionTimelineSamples(samples);
  return freeze({ version:PLAYER_LOCOMOTION_STATE_TIMELINE_VERSION, ok:summary.invalidCount === 0, summary });
}
