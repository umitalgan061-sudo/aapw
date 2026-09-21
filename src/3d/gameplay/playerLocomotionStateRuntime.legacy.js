/**
 * Presentation runtime coordinator for synthesized locomotion state.
 * Caller owns simulation time and gameplay facts; this coordinator only composes immutable read models.
 */
import {
  PLAYER_LOCOMOTION_STATE_SYNTHESIS_VERSION,
  createPlayerLocomotionStateSynthesisState,
  resolvePlayerLocomotionStateIntent,
  resolvePlayerLocomotionStateReadModel,
} from './playerLocomotionStateSynthesis.ts';
import {
  PLAYER_LOCOMOTION_STATE_TIMELINE_VERSION,
  createPlayerLocomotionStateTimelineState,
  advancePlayerLocomotionStateTimeline,
  resolvePlayerLocomotionStateTimelineSample,
} from './playerLocomotionStateTimeline.js';
import {
  PLAYER_LOCOMOTION_STATE_TELEMETRY_VERSION,
  createPlayerLocomotionStateTelemetryState,
  buildPlayerLocomotionStateTelemetrySample,
  appendPlayerLocomotionStateTelemetry,
  trimPlayerLocomotionStateTelemetry,
} from './playerLocomotionStateTelemetry.js';

export const PLAYER_LOCOMOTION_STATE_RUNTIME_VERSION = '2026-09-15-v1';
export const PLAYER_LOCOMOTION_STATE_RUNTIME_PHASES = Object.freeze([
  'cold','sampling','steady','transitioning','airborne','landing','recovery','blocked','fault',
]);
export const PLAYER_LOCOMOTION_STATE_RUNTIME_LIMITS = Object.freeze({
  maxTelemetrySamples:240,
  maxDeltaSeconds:0.2,
  maxFrameAdvance:4,
  faultConfidence:0.15,
});

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function freeze(value) { return Object.freeze(value); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function round(value, digits = 4) { const factor = 10 ** digits; const n = Math.round(finite(value) * factor) / factor; return Object.is(n,-0) ? 0 : n; }

export function createPlayerLocomotionStateRuntimeState(options = {}) {
  return freeze({
    frame:0,
    phase:'cold',
    synthesis:createPlayerLocomotionStateSynthesisState(),
    timeline:createPlayerLocomotionStateTimelineState(),
    telemetry:createPlayerLocomotionStateTelemetryState(),
    previousIntent:null,
    lastReadModel:null,
    errorCount:0,
    options:freeze({
      maxTelemetrySamples:Math.max(1, Math.floor(finite(options.maxTelemetrySamples, PLAYER_LOCOMOTION_STATE_RUNTIME_LIMITS.maxTelemetrySamples))),
    }),
  });
}

export function resolvePlayerLocomotionRuntimePhase(intent = {}, previousPhase = 'cold') {
  const state = text(intent.state, 'idle');
  if (intent.validation?.ok === false) return 'fault';
  if (state === 'airborne') return 'airborne';
  if (state.startsWith('landing-')) return 'landing';
  if (state.includes('recover')) return 'recovery';
  if (state === 'traversal-blocked') return 'blocked';
  if (intent.transition?.changed) return 'transitioning';
  if (previousPhase === 'cold') return 'sampling';
  return 'steady';
}

export function normalizePlayerLocomotionRuntimeInput(input = {}) {
  return freeze({
    ...input,
    deltaSeconds:clamp(Math.max(0.001, finite(input.deltaSeconds,1/60)),0.001,PLAYER_LOCOMOTION_STATE_RUNTIME_LIMITS.maxDeltaSeconds),
    frameAdvance:clamp(Math.floor(Math.max(1,finite(input.frameAdvance,1))),1,PLAYER_LOCOMOTION_STATE_RUNTIME_LIMITS.maxFrameAdvance),
  });
}

export function resolvePlayerLocomotionRuntimeReadModel(result = {}) {
  const intent = result.intent ?? {};
  const read = resolvePlayerLocomotionStateReadModel(intent);
  return freeze({
    version:PLAYER_LOCOMOTION_STATE_RUNTIME_VERSION,
    frame:Math.max(0,Math.floor(finite(result.state?.frame))),
    phase:text(result.state?.phase,'fault'),
    state:read.state,
    semanticState:read.semanticState,
    source:read.source,
    direction:read.direction,
    confidence:read.confidence,
    event:read.event,
    changed:read.changed,
    landingWeight:read.landingWeight,
    contactWeight:read.contactWeight,
    anticipationWeight:read.anticipationWeight,
    traversalWeight:read.traversalWeight,
    timelineProgress:clamp01(result.timelineSample?.progress),
    timelineEasedProgress:clamp01(result.timelineSample?.easedProgress),
    telemetryCount:Math.max(0,Math.floor(finite(result.state?.telemetry?.samples?.length))),
    rootMotionAllowed:intent.rootMotionAllowed !== false,
  });
}

export function validatePlayerLocomotionStateRuntimeResult(result = {}) {
  const errors = [];
  if (result.version !== PLAYER_LOCOMOTION_STATE_RUNTIME_VERSION) errors.push('runtime-version');
  if (!PLAYER_LOCOMOTION_STATE_RUNTIME_PHASES.includes(result.state?.phase)) errors.push('runtime-phase');
  if (result.intent?.validation?.ok === false) errors.push('intent-invalid');
  if (result.timelineSample?.version !== PLAYER_LOCOMOTION_STATE_TIMELINE_VERSION) errors.push('timeline-version');
  if (!Number.isFinite(result.state?.frame) || result.state.frame < 0) errors.push('frame');
  if (!Number.isFinite(result.intent?.confidence) || result.intent.confidence < 0 || result.intent.confidence > 1) errors.push('confidence');
  return freeze({ok:errors.length===0,errors:freeze(errors)});
}

export function updatePlayerLocomotionStateRuntime(state = createPlayerLocomotionStateRuntimeState(), rawInput = {}) {
  const input = normalizePlayerLocomotionRuntimeInput(rawInput);
  const previousIntent = state.previousIntent;
  const intent = resolvePlayerLocomotionStateIntent(input, previousIntent);
  const timelineResult = advancePlayerLocomotionStateTimeline(state.timeline, intent, previousIntent);
  const timelineSample = resolvePlayerLocomotionStateTimelineSample(intent, timelineResult.state, previousIntent);
  const telemetryRecord = buildPlayerLocomotionStateTelemetrySample(intent, timelineSample, previousIntent, state.frame + input.frameAdvance);
  let telemetry = appendPlayerLocomotionStateTelemetry(state.telemetry,{sample:telemetryRecord.sample,intent});
  telemetry = trimPlayerLocomotionStateTelemetry(telemetry,state.options.maxTelemetrySamples);
  const phase = resolvePlayerLocomotionRuntimePhase(intent,state.phase);
  const nextSynthesis = freeze({
    frame:state.synthesis.frameCount + input.frameAdvance,
    state:intent.state,
    semanticState:intent.semanticState,
    profile:intent.profile,
    confidence:intent.confidence,
    lastEvent:intent.event.type,
  });
  const nextState = freeze({
    ...state,
    frame:state.frame + input.frameAdvance,
    phase,
    synthesis:nextSynthesis,
    timeline:freeze({...timelineResult.state,previous:intent}),
    telemetry,
    previousIntent:intent,
    lastReadModel:null,
    errorCount:state.errorCount + (intent.validation?.ok === false ? 1 : 0),
  });
  const result = freeze({
    version:PLAYER_LOCOMOTION_STATE_RUNTIME_VERSION,
    state:nextState,
    intent,
    timelineSample,
    telemetry:telemetryRecord,
  });
  return freeze({...result,validation:validatePlayerLocomotionStateRuntimeResult(result)});
}

export function createPlayerLocomotionStateRuntimeController(options = {}) {
  let state = createPlayerLocomotionStateRuntimeState(options);
  return freeze({
    update(input = {}) {
      const result = updatePlayerLocomotionStateRuntime(state,input);
      state = result.state;
      return result;
    },
    read() {
      const intent = state.previousIntent;
      return resolvePlayerLocomotionRuntimeReadModel({ state, intent, timelineSample:resolvePlayerLocomotionStateTimelineSample(intent ?? resolvePlayerLocomotionStateIntent({}), state.timeline, null) });
    },
    telemetry() { return freeze([...state.telemetry.samples]); },
    reset() { state=createPlayerLocomotionStateRuntimeState(options); },
  });
}

export function runPlayerLocomotionStateRuntimeSequence(inputs = [], options = {}) {
  const controller = createPlayerLocomotionStateRuntimeController(options);
  const results = [];
  const safeInputs = Array.isArray(inputs) ? inputs : [];
  for (const input of safeInputs) results.push(controller.update(input));
  return freeze({ results:freeze(results), read:controller.read(), telemetry:controller.telemetry() });
}

export function comparePlayerLocomotionStateRuntimeSequences(first = [], second = []) {
  const left = Array.isArray(first) ? first : [];
  const right = Array.isArray(second) ? second : [];
  const count = Math.max(left.length,right.length);
  let stateMismatches=0;
  let eventMismatches=0;
  let phaseMismatches=0;
  let timelineDrift=0;
  for (let index=0;index<count;index+=1) {
    const a=left[index] ?? {};
    const b=right[index] ?? {};
    if (text(a.intent?.state,'idle')!==text(b.intent?.state,'idle')) stateMismatches+=1;
    if (text(a.intent?.event?.type,'none')!==text(b.intent?.event?.type,'none')) eventMismatches+=1;
    if (text(a.state?.phase,'fault')!==text(b.state?.phase,'fault')) phaseMismatches+=1;
    timelineDrift+=Math.abs(clamp01(a.timelineSample?.progress)-clamp01(b.timelineSample?.progress));
  }
  return freeze({count,stateMismatches,eventMismatches,phaseMismatches,timelineDrift:round(timelineDrift,6),deterministic:stateMismatches===0&&eventMismatches===0&&phaseMismatches===0&&timelineDrift<0.000001});
}

export function resolvePlayerLocomotionRuntimeHealth(state = createPlayerLocomotionStateRuntimeState()) {
  const sampleCount=state.telemetry.samples.length;
  const last=state.previousIntent;
  const confidence=clamp01(last?.confidence);
  return freeze({
    version:PLAYER_LOCOMOTION_STATE_RUNTIME_VERSION,
    healthy:state.errorCount===0 && confidence>=PLAYER_LOCOMOTION_STATE_RUNTIME_LIMITS.faultConfidence,
    phase:state.phase,
    frame:state.frame,
    telemetrySamples:sampleCount,
    errorCount:state.errorCount,
    confidence:round(confidence),
  });
}

export function auditPlayerLocomotionStateRuntime() {
  const inputs=[];
  for(let index=0;index<96;index+=1) inputs.push({
    planarSpeedMps:(index%61)/9,
    turnRateDegreesPerSecond:(index*53)%541,
    slopeDegrees:(index*7)%111-55,
    surfaceConfidence:index%13===0?0.3:0.92,
    surfaceSlip:index%11===0?0.8:0.1,
    grounded:index%19!==0,
    airTimeSeconds:index%19===0?0.3:0,
    landingImpactMps:index%17===0?5.3:0,
    traversalWeight:index%7===0?0.9:0,
    traversalForwardDistance:index%7===0?3.3:1,
    traversalBlocked:index%29===0,
    attackKind:index%23===0?'heavy':undefined,
    guarding:index%31===0,
    rootMotionAllowed:index%3!==0,
  });
  const run=runPlayerLocomotionStateRuntimeSequence(inputs,{maxTelemetrySamples:64});
  const invalid=run.results.filter(result=>!result.validation.ok).length;
  const health=run.results.length?resolvePlayerLocomotionRuntimeHealth(run.results.at(-1).state):{healthy:false};
  return freeze({version:PLAYER_LOCOMOTION_STATE_RUNTIME_VERSION,ok:invalid===0&&health.healthy===true,count:run.results.length,invalid,health});
}