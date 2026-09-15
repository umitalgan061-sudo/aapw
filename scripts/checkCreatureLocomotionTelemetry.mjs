import assert from 'node:assert/strict';
import { createCreatureLocomotionTelemetry, recordCreatureLocomotionTelemetry, finalizeCreatureLocomotionTelemetry, calculateCreatureLocomotionQualityScore, listCreatureLocomotionTelemetryAlerts, buildCreatureLocomotionTelemetryEnvelope, serializeCreatureLocomotionTelemetry, deserializeCreatureLocomotionTelemetry, mergeCreatureLocomotionTelemetry } from '../src/3d/gameplay/creatureLocomotionStateTelemetry.js';
import { synthesizeCreatureLocomotionState } from '../src/3d/gameplay/creatureLocomotionStateSynthesis.js';

const telemetry = createCreatureLocomotionTelemetry({ id: 'telemetry-test' });
const inputs = [
  { behaviour: 'wander', moving: false, speedMps: 0, targetSpeedMps: 0, deltaSeconds: 0.1 },
  { behaviour: 'wander', moving: true, speedMps: 1, targetSpeedMps: 1.5, deltaSeconds: 0.1 },
  { behaviour: 'flee-on-approach', moving: true, speedMps: 4, targetSpeedMps: 6, deltaSeconds: 0.1 },
  { speciesId: 'kuzgun', behaviour: 'flee-on-approach', flightEnabled: true, flightPhase: 'cruise', grounded: false, moving: true, speedMps: 7, targetSpeedMps: 7, deltaSeconds: 0.1 },
  { grounded: true, impactMps: 7, airTimeSeconds: 2, moving: false, deltaSeconds: 0.1 },
];
let previous = null;
for (const input of inputs) {
  const state = synthesizeCreatureLocomotionState(input, previous);
  recordCreatureLocomotionTelemetry(telemetry, state, input);
  previous = state;
}
const snapshot = finalizeCreatureLocomotionTelemetry(telemetry);
assert.equal(snapshot.sampleCount, inputs.length);
assert.ok(snapshot.averageConfidence > 0);
assert.ok(snapshot.averageSpeedMps >= 0);
assert.ok(snapshot.transitionsPerSecond > 0);
assert.ok(snapshot.airborneRatio > 0);
assert.ok(snapshot.reactiveRatio > 0);
assert.equal(snapshot.hardLandingCount, 1);
assert.equal(snapshot.invalidSamples, 0);
assert.ok(calculateCreatureLocomotionQualityScore(telemetry) >= 0);
assert.ok(calculateCreatureLocomotionQualityScore(telemetry) <= 1);

const envelope = buildCreatureLocomotionTelemetryEnvelope(telemetry, { speciesId: 'mixed' });
assert.equal(envelope.schema, 'creature-locomotion-telemetry');
assert.equal(envelope.speciesId, 'mixed');
assert.ok(Array.isArray(envelope.alerts));

const restored = deserializeCreatureLocomotionTelemetry(serializeCreatureLocomotionTelemetry(telemetry));
assert.equal(finalizeCreatureLocomotionTelemetry(restored).sampleCount, snapshot.sampleCount);
const merged = mergeCreatureLocomotionTelemetry(telemetry, restored);
assert.equal(finalizeCreatureLocomotionTelemetry(merged).sampleCount, snapshot.sampleCount * 2);

const noisy = createCreatureLocomotionTelemetry({ id: 'noisy' });
for (let index = 0; index < 20; index += 1) {
  const state = synthesizeCreatureLocomotionState({ behaviour: index % 2 ? 'wander' : 'flee-on-approach', moving: true, speedMps: 2, targetSpeedMps: 3, deltaSeconds: 0.05 });
  recordCreatureLocomotionTelemetry(noisy, state, { deltaSeconds: 0.05, speedMps: 2 });
}
assert.ok(listCreatureLocomotionTelemetryAlerts(noisy, { maxTransitionsPerSecond: 0.1 }).includes('state-thrash'));
console.log('Creature locomotion telemetry checks passed');
