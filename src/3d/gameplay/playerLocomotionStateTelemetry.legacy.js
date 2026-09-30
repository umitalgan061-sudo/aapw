/**
 * Compact deterministic telemetry/read-model helpers for locomotion state synthesis.
 * Telemetry records are immutable snapshots; they never mutate gameplay ownership.
 */
import {
  PLAYER_LOCOMOTION_STATE_EVENTS,
  PLAYER_LOCOMOTION_STATE_STATES,
  resolvePlayerLocomotionStateIntent,
  summarizePlayerLocomotionStateIntents,
} from './playerLocomotionStateSynthesis.js';
import { resolvePlayerLocomotionStateTimelineSample } from './playerLocomotionStateTimeline.js';

export const PLAYER_LOCOMOTION_STATE_TELEMETRY_VERSION = '2026-09-15-v1';
export const PLAYER_LOCOMOTION_STATE_TELEMETRY_FIELDS = Object.freeze([
  'frame','state','previousState','event','source','direction','confidence','speedMps','speedDeltaMps','groundRisk','surfaceConfidence','surfaceSlip',
  'anticipationWeight','contactWeight','landingWeight','traversalWeight','timelineProgress','timelineEasedProgress','durationSeconds','rootMotionAllowed',
]);

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function round(value, digits = 4) { const factor = 10 ** digits; const n = Math.round(finite(value) * factor) / factor; return Object.is(n, -0) ? 0 : n; }
function freeze(value) { return Object.freeze(value); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }

export function createPlayerLocomotionStateTelemetryState() {
  return freeze({ frame:0, samples:[], previousIntent:null, dropped:0 });
}

export function normalizePlayerLocomotionStateTelemetrySample(sample = {}) {
  const state = PLAYER_LOCOMOTION_STATE_STATES.includes(sample.state) ? sample.state : 'idle';
  const event = PLAYER_LOCOMOTION_STATE_EVENTS.includes(sample.event) ? sample.event : 'none';
  return freeze({
    frame:Math.max(0, Math.floor(finite(sample.frame))),
    state,
    previousState:text(sample.previousState, 'idle'),
    event,
    source:text(sample.source, 'fallback'),
    direction:text(sample.direction, 'forward'),
    confidence:round(clamp01(sample.confidence)),
    speedMps:round(clamp(Math.max(0, finite(sample.speedMps)), 0, 12)),
    speedDeltaMps:round(clamp(finite(sample.speedDeltaMps), -8, 8)),
    groundRisk:round(clamp01(sample.groundRisk)),
    surfaceConfidence:round(clamp01(sample.surfaceConfidence)),
    surfaceSlip:round(clamp01(sample.surfaceSlip)),
    anticipationWeight:round(clamp01(sample.anticipationWeight)),
    contactWeight:round(clamp01(sample.contactWeight)),
    landingWeight:round(clamp01(sample.landingWeight)),
    traversalWeight:round(clamp01(sample.traversalWeight)),
    timelineProgress:round(clamp01(sample.timelineProgress)),
    timelineEasedProgress:round(clamp01(sample.timelineEasedProgress)),
    durationSeconds:round(clamp(Math.max(0.025, finite(sample.durationSeconds, 0.16)), 0.025, 0.75)),
    rootMotionAllowed:Boolean(sample.rootMotionAllowed),
  });
}

export function buildPlayerLocomotionStateTelemetrySample(intent = {}, timeline = null, previous = null, frame = 0) {
  const sample = normalizePlayerLocomotionStateTelemetrySample({
    frame,
    state:intent.state,
    previousState:previous?.state,
    event:intent.event?.type,
    source:intent.source?.source,
    direction:intent.direction?.selected,
    confidence:intent.confidence,
    speedMps:intent.profile?.speedMps,
    speedDeltaMps:intent.profile?.speedDeltaMps,
    groundRisk:intent.profile?.groundRisk,
    surfaceConfidence:intent.profile?.surfaceConfidence,
    surfaceSlip:intent.profile?.surfaceSlip,
    anticipationWeight:intent.weights?.anticipation,
    contactWeight:intent.weights?.contact,
    landingWeight:intent.weights?.landing,
    traversalWeight:intent.weights?.traversal,
    timelineProgress:timeline?.progress,
    timelineEasedProgress:timeline?.easedProgress,
    durationSeconds:timeline?.durationSeconds,
    rootMotionAllowed:intent.rootMotionAllowed,
  });
  return freeze({ version:PLAYER_LOCOMOTION_STATE_TELEMETRY_VERSION, fields:PLAYER_LOCOMOTION_STATE_TELEMETRY_FIELDS, sample });
}

export function appendPlayerLocomotionStateTelemetry(state = createPlayerLocomotionStateTelemetryState(), record = {}) {
  const sample = normalizePlayerLocomotionStateTelemetrySample(record.sample ?? record);
  const samples = [...state.samples, sample];
  return freeze({ frame:sample.frame, samples, previousIntent:record.intent ?? state.previousIntent, dropped:Math.max(0, state.dropped) });
}

export function trimPlayerLocomotionStateTelemetry(state = createPlayerLocomotionStateTelemetryState(), maxSamples = 240) {
  const limit = Math.max(1, Math.floor(finite(maxSamples, 240)));
  if (state.samples.length <= limit) return state;
  const dropped = state.samples.length - limit;
  return freeze({ ...state, samples:state.samples.slice(-limit), dropped:state.dropped + dropped });
}

export function summarizePlayerLocomotionStateTelemetry(samples = []) {
  const safe = Array.isArray(samples) ? samples.map(normalizePlayerLocomotionStateTelemetrySample) : [];
  const states = {};
  const events = {};
  for (const sample of safe) {
    states[sample.state] = (states[sample.state] ?? 0) + 1;
    events[sample.event] = (events[sample.event] ?? 0) + 1;
  }
  const averageConfidence = safe.length ? safe.reduce((sum, sample) => sum + sample.confidence, 0) / safe.length : 0;
  const averageSpeed = safe.length ? safe.reduce((sum, sample) => sum + sample.speedMps, 0) / safe.length : 0;
  const lowConfidence = safe.filter((sample) => sample.confidence < 0.5).length;
  const highSlip = safe.filter((sample) => sample.surfaceSlip >= 0.55).length;
  const transitions = safe.filter((sample) => sample.state !== sample.previousState).length;
  return freeze({
    count:safe.length,
    averageConfidence:round(averageConfidence),
    averageSpeedMps:round(averageSpeed),
    lowConfidenceCount:lowConfidence,
    highSlipCount:highSlip,
    transitionCount:transitions,
    stateCounts:freeze(states),
    eventCounts:freeze(events),
  });
}

export function resolvePlayerLocomotionStateTelemetryRisk(sample = {}) {
  const normalized = normalizePlayerLocomotionStateTelemetrySample(sample);
  const risk = normalized.groundRisk * 0.34 + normalized.surfaceSlip * 0.25 + (1 - normalized.surfaceConfidence) * 0.18 + (1 - normalized.confidence) * 0.23;
  const flags = [];
  if (normalized.groundRisk >= 0.6) flags.push('ground-risk');
  if (normalized.surfaceSlip >= 0.55) flags.push('surface-slip');
  if (normalized.surfaceConfidence < 0.5) flags.push('surface-confidence');
  if (normalized.confidence < 0.5) flags.push('synthesis-confidence');
  if (normalized.event === 'traversal-blocked') flags.push('traversal-blocked');
  return freeze({ score:round(clamp01(risk)), severe:risk >= 0.72, flags:freeze(flags) });
}

export function resolvePlayerLocomotionStateTelemetryQuality(samples = []) {
  const safe = Array.isArray(samples) ? samples : [];
  const risks = safe.map(resolvePlayerLocomotionStateTelemetryRisk);
  const summary = summarizePlayerLocomotionStateTelemetry(safe);
  const invalid = safe.filter((sample) => !PLAYER_LOCOMOTION_STATE_STATES.includes(sample.state) || !PLAYER_LOCOMOTION_STATE_EVENTS.includes(sample.event)).length;
  const riskAverage = risks.length ? risks.reduce((sum, item) => sum + item.score, 0) / risks.length : 0;
  return freeze({
    count:summary.count,
    invalidCount:invalid,
    qualityScore:round(clamp01(1 - riskAverage * 0.7 - summary.lowConfidenceCount / Math.max(1, summary.count) * 0.3)),
    averageRisk:round(riskAverage),
    severeRiskCount:risks.filter((item) => item.severe).length,
  });
}

export function comparePlayerLocomotionStateTelemetryRuns(first = [], second = []) {
  const left = Array.isArray(first) ? first : [];
  const right = Array.isArray(second) ? second : [];
  const count = Math.max(left.length, right.length);
  let stateMismatches = 0;
  let eventMismatches = 0;
  let frameMismatches = 0;
  let confidenceDrift = 0;
  let riskDrift = 0;
  for (let index = 0; index < count; index += 1) {
    const a = normalizePlayerLocomotionStateTelemetrySample(left[index]);
    const b = normalizePlayerLocomotionStateTelemetrySample(right[index]);
    if (a.state !== b.state) stateMismatches += 1;
    if (a.event !== b.event) eventMismatches += 1;
    if (a.frame !== b.frame) frameMismatches += 1;
    confidenceDrift += Math.abs(a.confidence - b.confidence);
    riskDrift += Math.abs(resolvePlayerLocomotionStateTelemetryRisk(a).score - resolvePlayerLocomotionStateTelemetryRisk(b).score);
  }
  return freeze({
    count,
    stateMismatches,
    eventMismatches,
    frameMismatches,
    confidenceDrift:round(confidenceDrift, 6),
    riskDrift:round(riskDrift, 6),
    deterministic:stateMismatches === 0 && eventMismatches === 0 && frameMismatches === 0 && confidenceDrift < 0.000001 && riskDrift < 0.000001,
  });
}

export function createPlayerLocomotionStateTelemetryController({ maxSamples = 240, onSample = null } = {}) {
  let state = createPlayerLocomotionStateTelemetryState();
  return freeze({
    update(input = {}) {
      const intent = input.intent?.state ? input.intent : resolvePlayerLocomotionStateIntent(input, state.previousIntent);
      const timeline = input.timeline ?? resolvePlayerLocomotionStateTimelineSample(intent, {}, state.previousIntent);
      const record = buildPlayerLocomotionStateTelemetrySample(intent, timeline, state.previousIntent, state.frame + 1);
      state = trimPlayerLocomotionStateTelemetry(appendPlayerLocomotionStateTelemetry(state, { sample:record.sample, intent }), maxSamples);
      if (typeof onSample === 'function') onSample(record);
      return record;
    },
    read() { return freeze({ version:PLAYER_LOCOMOTION_STATE_TELEMETRY_VERSION, frame:state.frame, count:state.samples.length, dropped:state.dropped, summary:summarizePlayerLocomotionStateTelemetry(state.samples) }); },
    samples() { return freeze([...state.samples]); },
    reset() { state=createPlayerLocomotionStateTelemetryState(); },
  });
}

export function auditPlayerLocomotionStateTelemetry() {
  const controller = createPlayerLocomotionStateTelemetryController({ maxSamples:64 });
  for (let index = 0; index < 96; index += 1) {
    controller.update({
      planarSpeedMps:index % 24,
      turnRateDegreesPerSecond:(index % 9) * 47,
      slopeDegrees:(index % 12) * 4,
      surfaceConfidence:index % 10 === 0 ? 0.3 : 1,
      surfaceSlip:index % 8 === 0 ? 0.75 : 0.08,
      grounded:index % 17 !== 0,
      airTimeSeconds:index % 17 === 0 ? 0.2 : 0,
      landingImpactMps:index % 23 === 0 ? 5 : 0,
      traversalWeight:index % 11 === 0 ? 0.8 : 0,
      traversalBlocked:index % 29 === 0,
    });
  }
  const read = controller.read();
  const quality = resolvePlayerLocomotionStateTelemetryQuality(controller.samples());
  return freeze({ version:PLAYER_LOCOMOTION_STATE_TELEMETRY_VERSION, ok:read.count === 64 && quality.invalidCount === 0 && quality.qualityScore >= 0, read, quality });
}
