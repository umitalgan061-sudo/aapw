import assert from 'node:assert/strict';
import { createCreatureLocomotionTimeline, tickCreatureLocomotionTimeline, summarizeCreatureLocomotionTimeline, listCreatureLocomotionStateSegments, detectCreatureLocomotionThrash, serializeCreatureLocomotionTimeline, deserializeCreatureLocomotionTimeline, validateCreatureLocomotionTimeline } from '../src/3d/gameplay/creatureLocomotionStateTimeline.js';

const timeline = createCreatureLocomotionTimeline({ maxHistory: 32 });
const calm = { speciesId: 'kedi', behaviour: 'wander', moving: false, speedMps: 0, targetSpeedMps: 0, grounded: true, deltaSeconds: 0.1 };
const walk = { ...calm, moving: true, speedMps: 0.8, targetSpeedMps: 1.2 };
const flee = { ...walk, behaviour: 'flee-on-approach', speedMps: 3, targetSpeedMps: 4 };
const birdClimb = { speciesId: 'kuzgun', behaviour: 'flee-on-approach', moving: true, speedMps: 4, targetSpeedMps: 7, flightEnabled: true, flightPhase: 'climb', grounded: false, altitudeMeters: 5, targetAltitudeMeters: 12, deltaSeconds: 0.1 };
const birdCruise = { ...birdClimb, flightPhase: 'cruise', altitudeMeters: 12 };
const birdLand = { ...birdClimb, flightPhase: 'descend', grounded: false, altitudeMeters: 4, targetAltitudeMeters: 0 };

for (const input of [calm, walk, flee, birdClimb, birdCruise, birdLand]) {
  const result = tickCreatureLocomotionTimeline(timeline, input);
  assert.ok(result.state.state);
  assert.ok(result.transition.durationSeconds >= 0);
  assert.ok(result.timestamp >= 0);
}

const summary = summarizeCreatureLocomotionTimeline(timeline);
assert.equal(summary.sampleCount, 6);
assert.ok(summary.stateCounts.idle >= 1);
assert.ok(summary.stateCounts.flee >= 1);
assert.ok(summary.stateCounts['flight-climb'] >= 1);
assert.ok(summary.gaitCounts.walk >= 1);
assert.ok(summary.gaitCounts.gallop >= 1);
assert.ok(summary.gaitCounts.flap >= 2);
assert.ok(summary.averageConfidence >= 0 && summary.averageConfidence <= 1);

const segments = listCreatureLocomotionStateSegments(timeline);
assert.ok(segments.length >= 5);
for (const segment of segments) assert.ok(segment.durationSeconds >= 0);

assert.equal(detectCreatureLocomotionThrash(timeline, 20, 1), false);
const serialized = serializeCreatureLocomotionTimeline(timeline);
const restored = deserializeCreatureLocomotionTimeline(serialized);
assert.deepEqual(validateCreatureLocomotionTimeline(restored), []);
assert.equal(restored.history.length, timeline.history.length);
assert.equal(restored.elapsedSeconds, timeline.elapsedSeconds);

const small = createCreatureLocomotionTimeline({ maxHistory: 4 });
for (let index = 0; index < 10; index += 1) tickCreatureLocomotionTimeline(small, { ...calm, deltaSeconds: 0.05 });
assert.equal(small.history.length, 4);
assert.equal(small.history[3].timestamp, small.elapsedSeconds);

console.log('Creature locomotion timeline checks passed');
