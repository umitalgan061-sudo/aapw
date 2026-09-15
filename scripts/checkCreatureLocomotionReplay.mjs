import assert from 'node:assert/strict';
import { replayCreatureLocomotionInputs, buildCreatureReplayReport, serializeCreatureLocomotionReplay, deserializeCreatureLocomotionReplay, compareCreatureLocomotionReplay, deterministicReplayFingerprint, replayMatchesResynthesis, calculateCreatureReplayTransitionCount, calculateCreatureReplayGaitChanges, extractCreatureReplayEvents, extractCreatureReplayFlightSegments } from '../src/3d/gameplay/creatureLocomotionStateReplay.js';

const sequence = [
  { speciesId: 'kedi', behaviour: 'wander', moving: false, speedMps: 0, targetSpeedMps: 0, grounded: true, deltaSeconds: 0.1 },
  { speciesId: 'kedi', behaviour: 'wander', moving: true, speedMps: 0.8, targetSpeedMps: 1.2, grounded: true, deltaSeconds: 0.1 },
  { speciesId: 'kedi', behaviour: 'flee-on-approach', moving: true, speedMps: 3, targetSpeedMps: 5, grounded: true, deltaSeconds: 0.1 },
  { speciesId: 'kuzgun', behaviour: 'flee-on-approach', moving: true, speedMps: 4, targetSpeedMps: 7, grounded: false, flightEnabled: true, flightPhase: 'climb', altitudeMeters: 6, targetAltitudeMeters: 12, deltaSeconds: 0.1 },
  { speciesId: 'kuzgun', behaviour: 'flee-on-approach', moving: true, speedMps: 7, targetSpeedMps: 7, grounded: false, flightEnabled: true, flightPhase: 'cruise', altitudeMeters: 12, targetAltitudeMeters: 12, deltaSeconds: 0.1 },
  { speciesId: 'kuzgun', behaviour: 'flee-on-approach', moving: true, speedMps: 4, targetSpeedMps: 5, grounded: false, flightEnabled: true, flightPhase: 'descend', altitudeMeters: 4, targetAltitudeMeters: 0, deltaSeconds: 0.1 },
  { speciesId: 'kuzgun', behaviour: 'wander', moving: false, speedMps: 0, targetSpeedMps: 0, grounded: true, flightEnabled: true, flightPhase: 'grounded', impactMps: 2, airTimeSeconds: 1.2, deltaSeconds: 0.1 },
];

const first = replayCreatureLocomotionInputs(sequence, { id: 'A' });
const second = replayCreatureLocomotionInputs(sequence, { id: 'B' });
assert.equal(replayMatchesResynthesis(first), true);
assert.equal(replayMatchesResynthesis(second), true);
assert.equal(deterministicReplayFingerprint(first), deterministicReplayFingerprint(second));
assert.equal(compareCreatureLocomotionReplay(first, second).equal, true);
assert.ok(calculateCreatureReplayTransitionCount(first) >= 4);
assert.ok(calculateCreatureReplayGaitChanges(first) >= 2);
assert.ok(extractCreatureReplayEvents(first).length >= 4);
assert.ok(extractCreatureReplayFlightSegments(first).length >= 1);

const report = buildCreatureReplayReport(first);
assert.equal(report.valid, true);
assert.equal(report.matchesResynthesis, true);
assert.equal(report.coverage.samples, sequence.length);
assert.ok(report.fingerprint.length === 8);

const serialized = serializeCreatureLocomotionReplay(first);
const restored = deserializeCreatureLocomotionReplay(serialized);
assert.equal(compareCreatureLocomotionReplay(first, restored).equal, true);
assert.equal(replayMatchesResynthesis(restored), true);

const altered = deserializeCreatureLocomotionReplay(serialized);
altered.states[1] = { ...altered.states[1], gait: 'trot' };
assert.equal(compareCreatureLocomotionReplay(first, altered).equal, false);
assert.notEqual(deterministicReplayFingerprint(first), deterministicReplayFingerprint(altered));

console.log('Creature locomotion replay checks passed');
