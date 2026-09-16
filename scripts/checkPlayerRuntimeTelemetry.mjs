import assert from 'node:assert/strict';
import {
  PLAYER_RUNTIME_TELEMETRY_VERSION,
  createRuntimeTelemetryState,
  appendRuntimeFrameSample,
  appendRuntimeFrameSamples,
  deriveRuntimeTelemetry,
  buildRuntimeFrameWindow,
  detectCadenceTransition,
  selectStableProbeSamples,
  createRuntimeProbeTranscript,
  validateRuntimeTelemetry,
  replayRuntimeTelemetry,
} from '../src/3d/gameplay/playerRuntimeTelemetry.js';

assert.equal(PLAYER_RUNTIME_TELEMETRY_VERSION, '2026-09-15-v1');

const initial = createRuntimeTelemetryState();
assert.equal(initial.maxSamples, 120);
assert.deepEqual(initial.samples, []);
assert.equal(initial.sequence, 0);
assert.equal(initial.droppedSamples, 0);
assert.ok(Object.isFrozen(initial));

const custom = createRuntimeTelemetryState({ maxSamples: 8 });
assert.equal(custom.maxSamples, 8);
assert.ok(Object.isFrozen(custom));

const one = appendRuntimeFrameSample(initial, 0.0167);
assert.equal(one.samples.length, 1);
assert.equal(one.sequence, 1);
assert.equal(one.droppedSamples, 0);
assert.ok(one.samples[0] > 0.016);

const invalid = appendRuntimeFrameSample(one, NaN);
assert.equal(invalid.samples.length, 1);
assert.equal(invalid.droppedSamples, 1);
assert.equal(invalid.sequence, 2);

const infinite = appendRuntimeFrameSample(invalid, Infinity);
assert.equal(infinite.samples.length, 1);
assert.equal(infinite.droppedSamples, 2);
assert.equal(infinite.sequence, 3);

const negative = appendRuntimeFrameSample(infinite, -2);
assert.equal(negative.samples.length, 1);
assert.equal(negative.droppedSamples, 3);

const batched = appendRuntimeFrameSamples(custom, [0.01, 0.02, 0.03, 0.04]);
assert.equal(batched.samples.length, 4);
assert.equal(batched.sequence, 4);
assert.equal(batched.droppedSamples, 0);
assert.deepEqual(batched.samples, [0.01, 0.02, 0.03, 0.04]);

const overfilled = appendRuntimeFrameSamples(custom, [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]);
assert.equal(overfilled.samples.length, 8);
assert.equal(overfilled.droppedSamples, 2);
assert.equal(overfilled.samples[0], 0.03);
assert.equal(overfilled.samples.at(-1), 0.1);

const telemetryNormal = deriveRuntimeTelemetry(batched);
assert.equal(telemetryNormal.version, PLAYER_RUNTIME_TELEMETRY_VERSION);
assert.equal(telemetryNormal.summary.count, 4);
assert.equal(telemetryNormal.classification, 'normal');
assert.equal(telemetryNormal.constrained, false);
assert.ok(telemetryNormal.simulationWallRatio > 0);
assert.ok(Object.isFrozen(telemetryNormal));

const telemetrySlow = deriveRuntimeTelemetry(appendRuntimeFrameSamples(createRuntimeTelemetryState({ maxSamples: 8 }), [3.5, 3.5, 3.5, 8.6]));
assert.equal(telemetrySlow.classification, 'severely-constrained');
assert.equal(telemetrySlow.constrained, true);
assert.ok(telemetrySlow.summary.maxSeconds > 8);

const windowSmall = buildRuntimeFrameWindow(overfilled, 3);
assert.equal(windowSmall.size, 3);
assert.equal(windowSmall.requestedSize, 3);
assert.deepEqual(windowSmall.samples, [0.08, 0.09, 0.1]);
assert.ok(windowSmall.summary.count === 3);
assert.ok(Object.isFrozen(windowSmall));

const windowLarge = buildRuntimeFrameWindow(overfilled, 60);
assert.equal(windowLarge.size, 8);
assert.equal(windowLarge.requestedSize, 60);

const transitionDrop = detectCadenceTransition(telemetrySlow, telemetryNormal.summary);
assert.equal(transitionDrop.transitionedToConstrained, true);
assert.equal(transitionDrop.recoveredToNormal, false);
assert.ok(transitionDrop.fpsDrop > 0);
assert.ok(transitionDrop.fpsAfter < transitionDrop.fpsBefore);

const transitionRecover = detectCadenceTransition(telemetryNormal, telemetrySlow.summary);
assert.equal(transitionRecover.transitionedToConstrained, false);
assert.equal(transitionRecover.recoveredToNormal, true);
assert.ok(transitionRecover.fpsRise > 0);

const transitionStable = detectCadenceTransition(telemetryNormal, telemetryNormal.summary);
assert.equal(transitionStable.transitionedToConstrained, false);
assert.equal(transitionStable.recoveredToNormal, false);
assert.equal(transitionStable.fpsDrop, 0);
assert.equal(transitionStable.fpsRise, 0);

const stableReady = selectStableProbeSamples(batched, { minimumSamples: 4, windowSize: 4 });
assert.equal(stableReady.ready, true);
assert.equal(stableReady.samples.length, 4);
assert.match(stableReady.reason, /latest bounded/);

const stableNotReady = selectStableProbeSamples(custom, { minimumSamples: 6, windowSize: 6 });
assert.equal(stableNotReady.ready, false);
assert.equal(stableNotReady.samples.length, 4);
assert.match(stableNotReady.reason, /minimum sample/);

const transcript = createRuntimeProbeTranscript([0.016, 0.017, 0.018, 0.019, 0.02, 0.021, 0.022, 0.023], { minimumSamples: 8, windowSize: 8 });
assert.equal(transcript.version, PLAYER_RUNTIME_TELEMETRY_VERSION);
assert.equal(transcript.stable.ready, true);
assert.equal(transcript.stable.samples.length, 8);
assert.equal(transcript.telemetry.summary.count, 8);
assert.equal(transcript.environment.classification, 'normal');
assert.equal(transcript.environment.fps, transcript.telemetry.summary.fps);
assert.ok(Object.isFrozen(transcript.environment));

const slowTranscript = createRuntimeProbeTranscript([3.5, 3.5, 3.5, 8.6], { minimumSamples: 4, windowSize: 4 });
assert.equal(slowTranscript.environment.classification, 'severely-constrained');
assert.equal(slowTranscript.environment.simulationWallRatio, slowTranscript.telemetry.simulationWallRatio);

const validTelemetry = validateRuntimeTelemetry(transcript.telemetry);
assert.equal(validTelemetry.valid, true);
assert.deepEqual(validTelemetry.errors, []);

const invalidTelemetry = validateRuntimeTelemetry({ ...transcript.telemetry, version: 'wrong' });
assert.equal(invalidTelemetry.valid, false);
assert.ok(invalidTelemetry.errors.includes('version'));

const invalidClass = validateRuntimeTelemetry({ ...transcript.telemetry, classification: 'gpu-good' });
assert.equal(invalidClass.valid, false);
assert.ok(invalidClass.errors.includes('classification'));

const invalidRatio = validateRuntimeTelemetry({ ...transcript.telemetry, simulationWallRatio: 2 });
assert.equal(invalidRatio.valid, false);
assert.ok(invalidRatio.errors.includes('simulationWallRatio'));

const replay = replayRuntimeTelemetry([3.5, 3.5, 3.5, 8.6], { minimumSamples: 4, windowSize: 4 });
assert.equal(replay.equivalent, true);
assert.deepEqual(replay.first, replay.second);

for (const set of [
  [0.016, 0.017, 0.018, 0.019],
  [0.1, 0.2, 0.15, 0.11],
  [1, 1.1, 1.2, 1.3],
  [5, 4, 6, 7],
  [NaN, Infinity, -1, 0.02],
]) {
  const state = appendRuntimeFrameSamples(createRuntimeTelemetryState({ maxSamples: 16 }), set);
  const report = deriveRuntimeTelemetry(state);
  assert.ok(report.summary.count >= 1);
  assert.ok(Number.isFinite(report.summary.fps));
  assert.ok(report.simulationWallRatio > 0 && report.simulationWallRatio <= 1);
}

console.log('player runtime telemetry regression: PASS');
