/**
 * Read-only diagnostics for creature locomotion presentation state.
 * Produces actionable classifications without changing runtime state.
 */
import { CREATURE_LOCOMOTION_STATES, isCreatureLocomotionAirborne, isCreatureLocomotionReactive } from './creatureLocomotionStateSynthesis.js';
import { calculateCreatureLocomotionChangeRate } from './creatureLocomotionStateTimeline.js';
import { calculateCreatureLocomotionQualityScore, evaluateCreatureLocomotionState } from './creatureLocomotionStateQuality.js';

function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp01(value) { return Math.max(0, Math.min(1, n(value))); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function round(value, digits = 4) { const factor = 10 ** digits; const result = Math.round(n(value) * factor) / factor; return Object.is(result, -0) ? 0 : result; }
function freeze(value) { return Object.freeze(value); }

export const CREATURE_LOCOMOTION_DIAGNOSTICS_VERSION = '2026-09-15-v1';

export const CREATURE_LOCOMOTION_DIAGNOSTIC_CODES = Object.freeze([
  'NONE',
  'LOW_CONFIDENCE',
  'STATE_THRASH',
  'INVALID_STATE',
  'AIRBORNE_GAIT_MISMATCH',
  'GROUND_GAIT_MISMATCH',
  'CONTACT_INSTABILITY',
  'EXCESSIVE_BLOCKING',
  'EXCESSIVE_HARD_LANDING',
  'EXCESSIVE_REACTIVE_TIME',
  'NO_MOVEMENT_PROGRESS',
]);

export function classifyCreatureLocomotionIssue(state, timeline = null, telemetry = null, options = {}) {
  if (!state || !CREATURE_LOCOMOTION_STATES.includes(state.state)) return 'INVALID_STATE';
  if (isCreatureLocomotionAirborne(state.state) && state.gait !== 'flap') return 'AIRBORNE_GAIT_MISMATCH';
  if (!isCreatureLocomotionAirborne(state.state) && state.gait === 'flap' && !['wander'].includes(state.state)) return 'GROUND_GAIT_MISMATCH';
  if (state.state === 'contact-unstable' || state.state === 'slip-recover') return 'CONTACT_INSTABILITY';
  const confidence = clamp01(state.confidence);
  if (confidence < clamp01(options.minConfidence ?? 0.5)) return 'LOW_CONFIDENCE';
  if (timeline && calculateCreatureLocomotionChangeRate(timeline, options.windowSeconds ?? 2) > n(options.maxChangesPerSecond, 8)) return 'STATE_THRASH';
  if (telemetry) {
    const hard = n(telemetry.hardLandingCount);
    const blocked = n(telemetry.blockedCount);
    if (hard > n(options.maxHardLandings, 3)) return 'EXCESSIVE_HARD_LANDING';
    if (blocked > n(options.maxBlocked, 4)) return 'EXCESSIVE_BLOCKING';
    if (telemetry.reactiveRatio > clamp01(options.maxReactiveRatio ?? 0.9)) return 'EXCESSIVE_REACTIVE_TIME';
  }
  return 'NONE';
}

export function buildCreatureLocomotionDiagnosticSnapshot(state, timeline = null, telemetry = null, options = {}) {
  const issue = classifyCreatureLocomotionIssue(state, timeline, telemetry, options);
  const evaluation = evaluateCreatureLocomotionState(state, options.input || {});
  return freeze({
    version: CREATURE_LOCOMOTION_DIAGNOSTICS_VERSION,
    issue,
    valid: evaluation.valid && issue === 'NONE',
    state: text(state?.state, 'idle'),
    gait: text(state?.gait, 'walk'),
    event: text(state?.event, 'none'),
    confidence: round(clamp01(state?.confidence)),
    airborne: isCreatureLocomotionAirborne(state?.state),
    reactive: isCreatureLocomotionReactive(state?.state),
    qualityScore: telemetry ? calculateCreatureLocomotionQualityScore(telemetry) : null,
    changeRate: timeline ? calculateCreatureLocomotionChangeRate(timeline, options.windowSeconds ?? 2) : null,
  });
}

export function explainCreatureLocomotionIssue(code) {
  const explanations = Object.freeze({
    NONE: 'No locomotion presentation issue detected.',
    LOW_CONFIDENCE: 'State confidence is below the configured floor.',
    STATE_THRASH: 'State transitions are changing more often than the configured stability budget.',
    INVALID_STATE: 'The snapshot contains a state outside the declared vocabulary.',
    AIRBORNE_GAIT_MISMATCH: 'An airborne state is not using the flap gait.',
    GROUND_GAIT_MISMATCH: 'A grounded semantic state is incorrectly using the flight gait.',
    CONTACT_INSTABILITY: 'Contact confidence/slip data indicates unstable ground presentation.',
    EXCESSIVE_BLOCKING: 'Blocked contact events exceed the configured runtime threshold.',
    EXCESSIVE_HARD_LANDING: 'Hard landing frequency exceeds the configured threshold.',
    EXCESSIVE_REACTIVE_TIME: 'The creature spends an unusually large fraction of the sample window in reactive states.',
    NO_MOVEMENT_PROGRESS: 'Movement state is active without observable progress metadata.',
  });
  return text(explanations[text(code, 'NONE')], explanations.NONE);
}

export function rankCreatureLocomotionDiagnosticSeverity(code) {
  const severity = Object.freeze({
    NONE: 0,
    LOW_CONFIDENCE: 2,
    STATE_THRASH: 4,
    INVALID_STATE: 5,
    AIRBORNE_GAIT_MISMATCH: 5,
    GROUND_GAIT_MISMATCH: 4,
    CONTACT_INSTABILITY: 3,
    EXCESSIVE_BLOCKING: 3,
    EXCESSIVE_HARD_LANDING: 3,
    EXCESSIVE_REACTIVE_TIME: 2,
    NO_MOVEMENT_PROGRESS: 2,
  });
  return severity[text(code, 'NONE')] ?? severity.NONE;
}

export function buildCreatureLocomotionDiagnosticReport(records = []) {
  const snapshots = records.map((record) => {
    const snapshot = buildCreatureLocomotionDiagnosticSnapshot(record.state, record.timeline, record.telemetry, record.options);
    return freeze({ id: text(record.id, 'creature'), snapshot, explanation: explainCreatureLocomotionIssue(snapshot.issue), severity: rankCreatureLocomotionDiagnosticSeverity(snapshot.issue) });
  });
  const counts = {};
  for (const item of snapshots) counts[item.snapshot.issue] = (counts[item.snapshot.issue] || 0) + 1;
  const highest = snapshots.reduce((best, current) => current.severity > best ? current.severity : best, 0);
  return freeze({
    version: CREATURE_LOCOMOTION_DIAGNOSTICS_VERSION,
    total: snapshots.length,
    healthy: snapshots.filter((item) => item.snapshot.issue === 'NONE').length,
    highestSeverity: highest,
    issueCounts: freeze({ ...counts }),
    records: freeze(snapshots),
  });
}

export function filterCreatureLocomotionDiagnostics(records = [], code = 'NONE') {
  return freeze(records.filter((record) => record?.snapshot?.issue === text(code, 'NONE')));
}

export function serializeCreatureLocomotionDiagnostics(report) {
  return JSON.stringify(report || buildCreatureLocomotionDiagnosticReport());
}

export function compareCreatureLocomotionDiagnosticReports(left, right) {
  const a = JSON.stringify(left?.issueCounts || {});
  const b = JSON.stringify(right?.issueCounts || {});
  return freeze({ equal: a === b && n(left?.highestSeverity) === n(right?.highestSeverity), left: a, right: b });
}

export function buildCreatureLocomotionHealthBadge(report) {
  const score = report?.total ? report.healthy / report.total : 1;
  return freeze({
    label: score >= 0.95 ? 'healthy' : score >= 0.8 ? 'degraded' : 'attention',
    ratio: round(score),
    highestSeverity: n(report?.highestSeverity),
  });
}
