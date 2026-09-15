/** Deterministic, renderer-free telemetry for creature locomotion presentation state. */
import { CREATURE_LOCOMOTION_EVENTS, CREATURE_LOCOMOTION_STATES, summarizeCreatureLocomotionState } from './creatureLocomotionStateSynthesis.js';

function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, n(value, min))); }
function clamp01(value) { return clamp(value, 0, 1); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function round(value, digits = 4) { const factor = 10 ** digits; const result = Math.round(n(value) * factor) / factor; return Object.is(result, -0) ? 0 : result; }
function freeze(value) { return Object.freeze(value); }

export const CREATURE_LOCOMOTION_TELEMETRY_VERSION = '2026-09-15-v1';

export function createCreatureLocomotionTelemetry(options = {}) {
  return {
    version: CREATURE_LOCOMOTION_TELEMETRY_VERSION,
    id: text(options.id, 'creature-telemetry'),
    sampleCount: 0,
    elapsedSeconds: 0,
    stateCounts: {},
    gaitCounts: {},
    eventCounts: {},
    sourceCounts: {},
    confidenceSum: 0,
    speedSum: 0,
    transitionCount: 0,
    airborneSamples: 0,
    reactiveSamples: 0,
    socialSamples: 0,
    hardLandingCount: 0,
    softLandingCount: 0,
    blockedCount: 0,
    invalidSamples: 0,
  };
}

function increment(table, key) { table[key] = (table[key] || 0) + 1; }

export function recordCreatureLocomotionTelemetry(telemetry, state, input = {}) {
  const target = telemetry || createCreatureLocomotionTelemetry();
  const summary = summarizeCreatureLocomotionState(state);
  target.sampleCount += 1;
  target.elapsedSeconds += Math.max(0, n(input.deltaSeconds, n(state?.timing?.deltaSeconds, 1 / 60)));
  increment(target.stateCounts, summary.state);
  increment(target.gaitCounts, summary.gait);
  increment(target.eventCounts, summary.event);
  increment(target.sourceCounts, summary.source);
  target.confidenceSum += clamp01(summary.confidence);
  target.speedSum += Math.abs(n(input.speedMps, input.velocity?.speedMps));
  if (state?.event && state.event !== 'none') target.transitionCount += 1;
  if (['takeoff', 'flight-climb', 'flight-cruise', 'flight-descend'].includes(summary.state)) target.airborneSamples += 1;
  if (['approach', 'flee', 'herd-flee', 'flock-flee'].includes(summary.state)) target.reactiveSamples += 1;
  if (state?.social?.alerted) target.socialSamples += 1;
  if (summary.state === 'landing-hard') target.hardLandingCount += 1;
  if (summary.state === 'landing-soft') target.softLandingCount += 1;
  if (summary.state === 'blocked') target.blockedCount += 1;
  if (!CREATURE_LOCOMOTION_STATES.includes(summary.state) || !CREATURE_LOCOMOTION_EVENTS.includes(summary.event)) target.invalidSamples += 1;
  return target;
}

export function finalizeCreatureLocomotionTelemetry(telemetry) {
  const target = telemetry || createCreatureLocomotionTelemetry();
  const samples = Math.max(1, target.sampleCount);
  const elapsed = Math.max(0.001, target.elapsedSeconds);
  return freeze({
    version: target.version,
    id: target.id,
    sampleCount: target.sampleCount,
    elapsedSeconds: round(target.elapsedSeconds),
    averageConfidence: round(target.confidenceSum / samples),
    averageSpeedMps: round(target.speedSum / samples),
    transitionsPerSecond: round(target.transitionCount / elapsed, 3),
    airborneRatio: round(target.airborneSamples / samples),
    reactiveRatio: round(target.reactiveSamples / samples),
    socialRatio: round(target.socialSamples / samples),
    hardLandingCount: target.hardLandingCount,
    softLandingCount: target.softLandingCount,
    blockedCount: target.blockedCount,
    invalidSamples: target.invalidSamples,
    stateCounts: freeze({ ...target.stateCounts }),
    gaitCounts: freeze({ ...target.gaitCounts }),
    eventCounts: freeze({ ...target.eventCounts }),
    sourceCounts: freeze({ ...target.sourceCounts }),
  });
}

export function resetCreatureLocomotionTelemetry(telemetry) {
  const id = telemetry?.id;
  return createCreatureLocomotionTelemetry({ id });
}

export function mergeCreatureLocomotionTelemetry(left, right) {
  const merged = createCreatureLocomotionTelemetry({ id: `${text(left?.id, 'left')}+${text(right?.id, 'right')}` });
  merged.sampleCount = n(left?.sampleCount) + n(right?.sampleCount);
  merged.elapsedSeconds = n(left?.elapsedSeconds) + n(right?.elapsedSeconds);
  merged.confidenceSum = n(left?.confidenceSum) + n(right?.confidenceSum);
  merged.speedSum = n(left?.speedSum) + n(right?.speedSum);
  merged.transitionCount = n(left?.transitionCount) + n(right?.transitionCount);
  merged.airborneSamples = n(left?.airborneSamples) + n(right?.airborneSamples);
  merged.reactiveSamples = n(left?.reactiveSamples) + n(right?.reactiveSamples);
  merged.socialSamples = n(left?.socialSamples) + n(right?.socialSamples);
  merged.hardLandingCount = n(left?.hardLandingCount) + n(right?.hardLandingCount);
  merged.softLandingCount = n(left?.softLandingCount) + n(right?.softLandingCount);
  merged.blockedCount = n(left?.blockedCount) + n(right?.blockedCount);
  merged.invalidSamples = n(left?.invalidSamples) + n(right?.invalidSamples);
  for (const table of ['stateCounts', 'gaitCounts', 'eventCounts', 'sourceCounts']) {
    for (const [key, value] of Object.entries(left?.[table] || {})) increment(merged[table], key), merged[table][key] += value - 1;
    for (const [key, value] of Object.entries(right?.[table] || {})) increment(merged[table], key), merged[table][key] += value - 1;
  }
  return merged;
}

export function calculateCreatureLocomotionQualityScore(telemetry) {
  const snapshot = finalizeCreatureLocomotionTelemetry(telemetry);
  const confidenceScore = snapshot.averageConfidence;
  const stabilityScore = clamp01(1 - snapshot.transitionsPerSecond / 12);
  const validityScore = clamp01(1 - snapshot.invalidSamples / Math.max(1, snapshot.sampleCount));
  const contactScore = clamp01(1 - snapshot.blockedCount / Math.max(1, snapshot.sampleCount) * 0.5);
  return round(confidenceScore * 0.45 + stabilityScore * 0.25 + validityScore * 0.2 + contactScore * 0.1);
}

export function listCreatureLocomotionTelemetryAlerts(telemetry, thresholds = {}) {
  const snapshot = finalizeCreatureLocomotionTelemetry(telemetry);
  const alerts = [];
  const minConfidence = clamp01(thresholds.minConfidence ?? 0.65);
  const maxTransitionsPerSecond = Math.max(0.1, n(thresholds.maxTransitionsPerSecond, 8));
  const maxInvalidRatio = clamp01(thresholds.maxInvalidRatio ?? 0);
  if (snapshot.averageConfidence < minConfidence) alerts.push('low-confidence');
  if (snapshot.transitionsPerSecond > maxTransitionsPerSecond) alerts.push('state-thrash');
  if (snapshot.invalidSamples / Math.max(1, snapshot.sampleCount) > maxInvalidRatio) alerts.push('invalid-state');
  if (snapshot.hardLandingCount > Math.max(0, n(thresholds.maxHardLandings, 3))) alerts.push('hard-landing-frequency');
  if (snapshot.blockedCount > Math.max(0, n(thresholds.maxBlocked, 4))) alerts.push('blocked-frequency');
  return freeze(alerts);
}

export function buildCreatureLocomotionTelemetryEnvelope(telemetry, metadata = {}) {
  const snapshot = finalizeCreatureLocomotionTelemetry(telemetry);
  return freeze({
    schema: 'creature-locomotion-telemetry',
    version: CREATURE_LOCOMOTION_TELEMETRY_VERSION,
    generatedBy: text(metadata.generatedBy, 'creatureLocomotionStateTelemetry'),
    session: text(metadata.session, 'local'),
    speciesId: text(metadata.speciesId, 'unknown'),
    qualityScore: calculateCreatureLocomotionQualityScore(telemetry),
    alerts: listCreatureLocomotionTelemetryAlerts(telemetry, metadata.thresholds),
    snapshot,
  });
}

export function serializeCreatureLocomotionTelemetry(telemetry) {
  return JSON.stringify(telemetry || createCreatureLocomotionTelemetry());
}

export function deserializeCreatureLocomotionTelemetry(serialized, options = {}) {
  const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized || {};
  const target = createCreatureLocomotionTelemetry({ id: options.id || parsed.id });
  for (const key of Object.keys(target)) {
    if (key === 'stateCounts' || key === 'gaitCounts' || key === 'eventCounts' || key === 'sourceCounts') target[key] = { ...(parsed[key] || {}) };
    else if (key !== 'version' && parsed[key] !== undefined) target[key] = n(parsed[key], target[key]);
  }
  return target;
}

export function rankCreatureLocomotionTelemetry(records = []) {
  return freeze([...records]
    .map((record) => ({ record, score: calculateCreatureLocomotionQualityScore(record) }))
    .sort((a, b) => b.score - a.score || text(a.record?.id).localeCompare(text(b.record?.id))));
}

export function compareCreatureLocomotionTelemetry(left, right) {
  const a = finalizeCreatureLocomotionTelemetry(left);
  const b = finalizeCreatureLocomotionTelemetry(right);
  return freeze({
    confidenceDelta: round(b.averageConfidence - a.averageConfidence),
    transitionRateDelta: round(b.transitionsPerSecond - a.transitionsPerSecond),
    airborneRatioDelta: round(b.airborneRatio - a.airborneRatio),
    reactiveRatioDelta: round(b.reactiveRatio - a.reactiveRatio),
    qualityDelta: round(calculateCreatureLocomotionQualityScore(right) - calculateCreatureLocomotionQualityScore(left)),
  });
}
