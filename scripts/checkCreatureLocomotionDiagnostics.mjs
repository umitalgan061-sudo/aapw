import assert from 'node:assert/strict';
import { synthesizeCreatureLocomotionState } from '../src/3d/gameplay/creatureLocomotionStateSynthesis.js';
import { createCreatureLocomotionTimeline, tickCreatureLocomotionTimeline } from '../src/3d/gameplay/creatureLocomotionStateTimeline.js';
import { createCreatureLocomotionTelemetry, recordCreatureLocomotionTelemetry, finalizeCreatureLocomotionTelemetry } from '../src/3d/gameplay/creatureLocomotionStateTelemetry.js';
import { buildCreatureLocomotionDiagnosticSnapshot, classifyCreatureLocomotionIssue, explainCreatureLocomotionIssue, rankCreatureLocomotionDiagnosticSeverity, buildCreatureLocomotionDiagnosticReport, buildCreatureLocomotionHealthBadge, CREATURE_LOCOMOTION_DIAGNOSTIC_CODES } from '../src/3d/gameplay/creatureLocomotionStateDiagnostics.js';

const timeline = createCreatureLocomotionTimeline({ maxHistory: 32 });
const telemetry = createCreatureLocomotionTelemetry({ id: 'diagnostic-test' });
let previous = null;
const inputs = [
  { behaviour: 'wander', moving: true, speedMps: 1, targetSpeedMps: 1.5, deltaSeconds: 0.1 },
  { behaviour: 'flee-on-approach', moving: true, speedMps: 4, targetSpeedMps: 6, deltaSeconds: 0.1 },
  { speciesId: 'kuzgun', flightEnabled: true, flightPhase: 'cruise', grounded: false, moving: true, speedMps: 7, targetSpeedMps: 7, deltaSeconds: 0.1 },
];
for (const input of inputs) {
  const state = synthesizeCreatureLocomotionState(input, previous);
  tickCreatureLocomotionTimeline(timeline, input);
  recordCreatureLocomotionTelemetry(telemetry, state, input);
  previous = state;
}

const healthy = buildCreatureLocomotionDiagnosticSnapshot(previous, timeline, telemetry);
assert.equal(healthy.issue, 'NONE');
assert.equal(healthy.valid, true);
assert.ok(healthy.qualityScore >= 0 && healthy.qualityScore <= 1);

const badFlight = synthesizeCreatureLocomotionState({ speciesId: 'kuzgun', flightEnabled: true, flightPhase: 'cruise', grounded: false, moving: true, speedMps: 7, targetSpeedMps: 7 });
const mismatch = { ...badFlight, gait: 'walk' };
assert.equal(classifyCreatureLocomotionIssue(mismatch), 'AIRBORNE_GAIT_MISMATCH');
assert.equal(rankCreatureLocomotionDiagnosticSeverity('AIRBORNE_GAIT_MISMATCH'), 5);
assert.ok(explainCreatureLocomotionIssue('AIRBORNE_GAIT_MISMATCH').length > 10);

assert.equal(CREATURE_LOCOMOTION_DIAGNOSTIC_CODES.includes('NONE'), true);
const report = buildCreatureLocomotionDiagnosticReport([
  { id: 'healthy', state: healthy },
  { id: 'mismatch', state: mismatch },
].map((record) => ({ id: record.id, state: record.state, options: {} })));
assert.equal(report.total, 2);
assert.ok(report.issueCounts['NONE'] >= 1);
assert.ok(report.highestSeverity >= 5);
const badge = buildCreatureLocomotionHealthBadge(report);
assert.ok(['healthy', 'degraded', 'attention'].includes(badge.label));
assert.ok(badge.ratio >= 0 && badge.ratio <= 1);

const telemetrySnapshot = finalizeCreatureLocomotionTelemetry(telemetry);
assert.equal(telemetrySnapshot.invalidSamples, 0);
console.log('Creature locomotion diagnostics checks passed');
