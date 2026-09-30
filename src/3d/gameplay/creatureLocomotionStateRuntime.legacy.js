/**
 * Runtime facade for creature locomotion presentation state.
 * Keeps per-creature temporal state outside the behaviour brain while exposing immutable snapshots.
 */
import { synthesizeCreatureLocomotionState, projectCreatureGaitRequest } from './creatureLocomotionStateSynthesis.ts';
import { createCreatureLocomotionTimeline, tickCreatureLocomotionTimeline, getCreatureLocomotionTimelineLatest, summarizeCreatureLocomotionTimeline } from './creatureLocomotionStateTimeline.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, number(value, min))); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function freeze(value) { return Object.freeze(value); }
function round(value, digits = 4) { const factor = 10 ** digits; const out = Math.round(number(value) * factor) / factor; return Object.is(out, -0) ? 0 : out; }

export const CREATURE_LOCOMOTION_RUNTIME_VERSION = '2026-09-15-v1';

export function createCreatureLocomotionRuntime(options = {}) {
  return {
    version: CREATURE_LOCOMOTION_RUNTIME_VERSION,
    id: text(options.id, 'creature-runtime'),
    timeline: createCreatureLocomotionTimeline({ maxHistory: options.maxHistory }),
    lastInput: null,
    lastState: null,
    paused: false,
    frame: 0,
    elapsedSeconds: 0,
  };
}

export function resetCreatureLocomotionRuntime(runtime) {
  const target = runtime || createCreatureLocomotionRuntime();
  const fresh = createCreatureLocomotionTimeline({ maxHistory: target.timeline?.maxHistory });
  target.timeline = fresh;
  target.lastInput = null;
  target.lastState = null;
  target.paused = false;
  target.frame = 0;
  target.elapsedSeconds = 0;
  return target;
}

export function pauseCreatureLocomotionRuntime(runtime) {
  const target = runtime || createCreatureLocomotionRuntime();
  target.paused = true;
  return target;
}

export function resumeCreatureLocomotionRuntime(runtime) {
  const target = runtime || createCreatureLocomotionRuntime();
  target.paused = false;
  return target;
}

export function updateCreatureLocomotionRuntime(runtime, input = {}) {
  const target = runtime || createCreatureLocomotionRuntime();
  const delta = clamp(number(input.deltaSeconds, 1 / 60), 0.001, 0.25);
  const frameInput = target.paused ? { ...input, moving: false, speedMps: 0, deltaSeconds: delta } : input;
  const result = tickCreatureLocomotionTimeline(target.timeline, { ...frameInput, previousState: target.lastState?.state, previousGait: target.lastState?.gait }, target.elapsedSeconds + delta);
  target.lastInput = freeze({ ...frameInput });
  target.lastState = result.state;
  target.frame += 1;
  target.elapsedSeconds = result.timestamp;
  return freeze({
    runtimeId: target.id,
    frame: target.frame,
    timestamp: round(target.elapsedSeconds),
    paused: target.paused,
    state: result.state,
    transition: result.transition,
    gaitRequest: projectCreatureGaitRequest(result.state),
  });
}

export function getCreatureLocomotionRuntimeSnapshot(runtime) {
  const target = runtime || createCreatureLocomotionRuntime();
  return freeze({
    version: target.version,
    id: target.id,
    frame: target.frame,
    elapsedSeconds: round(target.elapsedSeconds),
    paused: Boolean(target.paused),
    state: target.lastState,
    latest: getCreatureLocomotionTimelineLatest(target.timeline),
    summary: summarizeCreatureLocomotionTimeline(target.timeline),
  });
}

export function buildCreatureLocomotionConsumerIntent(runtime, options = {}) {
  const state = runtime?.lastState || synthesizeCreatureLocomotionState(options.input || {});
  const gait = projectCreatureGaitRequest(state);
  return freeze({
    consumerVersion: '2026-09-15-v1',
    state,
    gait,
    channels: freeze({ ...(state.presentation || {}) }),
    audio: text(options.audioCue, state.state === 'idle' ? 'creature-idle' : 'creature-movement'),
    vfx: text(options.vfxCue, 'none'),
    ownership: freeze({
      movement: 'caller',
      physics: 'caller',
      skeleton: 'creatureGait',
      rendering: 'caller',
      audio: 'caller',
      vfx: 'caller',
      synthesis: 'creatureLocomotionStateRuntime',
    }),
  });
}

export function advanceCreatureLocomotionClock(runtime, deltaSeconds) {
  const target = runtime || createCreatureLocomotionRuntime();
  if (!target.paused) target.elapsedSeconds += clamp(number(deltaSeconds, 1 / 60), 0, 0.25);
  return round(target.elapsedSeconds);
}

export function inspectCreatureLocomotionRuntime(runtime) {
  const target = runtime || createCreatureLocomotionRuntime();
  return freeze({
    id: target.id,
    frame: target.frame,
    paused: target.paused,
    elapsedSeconds: round(target.elapsedSeconds),
    hasState: Boolean(target.lastState),
    historySamples: target.timeline?.history?.length || 0,
    latestState: text(target.lastState?.state, 'idle'),
    latestGait: text(target.lastState?.gait, 'walk'),
  });
}

export function serializeCreatureLocomotionRuntime(runtime) {
  const target = runtime || createCreatureLocomotionRuntime();
  return JSON.stringify({
    version: target.version,
    id: target.id,
    frame: target.frame,
    elapsedSeconds: target.elapsedSeconds,
    paused: target.paused,
    lastInput: target.lastInput,
    lastState: target.lastState,
    timeline: target.timeline,
  });
}

export function hydrateCreatureLocomotionRuntime(serialized, options = {}) {
  const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized || {};
  const target = createCreatureLocomotionRuntime({ id: parsed.id || options.id, maxHistory: parsed.timeline?.maxHistory || options.maxHistory });
  target.version = text(parsed.version, target.version);
  target.frame = Math.max(0, Math.trunc(number(parsed.frame)));
  target.elapsedSeconds = Math.max(0, number(parsed.elapsedSeconds));
  target.paused = Boolean(parsed.paused);
  target.lastInput = parsed.lastInput || null;
  target.lastState = parsed.lastState || null;
  if (parsed.timeline) target.timeline = parsed.timeline;
  return target;
}

export function cloneCreatureLocomotionRuntime(runtime) {
  return hydrateCreatureLocomotionRuntime(serializeCreatureLocomotionRuntime(runtime), { id: runtime?.id });
}

export function runCreatureLocomotionFrames(inputs = [], options = {}) {
  const runtime = createCreatureLocomotionRuntime(options);
  const results = [];
  for (const input of inputs) results.push(updateCreatureLocomotionRuntime(runtime, input));
  return freeze(results);
}

export function compareCreatureLocomotionRuntimeRuns(leftInputs = [], rightInputs = [], options = {}) {
  const left = runCreatureLocomotionFrames(leftInputs, options);
  const right = runCreatureLocomotionFrames(rightInputs, options);
  const leftJson = JSON.stringify(left.map((item) => item.state));
  const rightJson = JSON.stringify(right.map((item) => item.state));
  return freeze({ equal: leftJson === rightJson, left, right });
}

export function gateCreatureLocomotionInput(input = {}) {
  const allowed = [
    'speciesId','behaviour','behavior','requestedGait','speedMps','targetSpeedMps','turnRateRad','distanceToPlayer',
    'moving','grounded','groundNormalConfidence','surfaceConfidence','surfaceSlip','impactMps','airTimeSeconds',
    'altitudeMeters','targetAltitudeMeters','flightPhase','flightEnabled','flightDistanceMeters','socialAlert',
    'socialAlertRadius','socialSameSpecies','traversalBlocked','directionChanged','confidence','deltaSeconds',
    'gaitClockSeconds','previousState','previousGait','sourceHint','plan','velocity','intent','contact','social','flight',
  ];
  return freeze(Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(input, key)).map((key) => [key, input[key]])));
}

export function updateCreatureLocomotionRuntimeSafe(runtime, input = {}) {
  return updateCreatureLocomotionRuntime(runtime, gateCreatureLocomotionInput(input));
}