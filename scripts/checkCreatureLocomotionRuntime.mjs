import assert from 'node:assert/strict';
import { createCreatureLocomotionRuntime, updateCreatureLocomotionRuntime, pauseCreatureLocomotionRuntime, resumeCreatureLocomotionRuntime, resetCreatureLocomotionRuntime, getCreatureLocomotionRuntimeSnapshot, buildCreatureLocomotionConsumerIntent, serializeCreatureLocomotionRuntime, hydrateCreatureLocomotionRuntime, cloneCreatureLocomotionRuntime, updateCreatureLocomotionRuntimeSafe } from '../src/3d/gameplay/creatureLocomotionStateRuntime.js';

const runtime = createCreatureLocomotionRuntime({ id: 'runtime-test', maxHistory: 16 });
assert.equal(runtime.id, 'runtime-test');
assert.equal(runtime.frame, 0);
assert.equal(runtime.paused, false);

const idle = updateCreatureLocomotionRuntime(runtime, { speciesId: 'kedi', behaviour: 'wander', moving: false, speedMps: 0, targetSpeedMps: 0, deltaSeconds: 0.1 });
assert.equal(idle.state.state, 'idle');
assert.equal(idle.gaitRequest.gait, 'walk');
assert.equal(runtime.frame, 1);

const walk = updateCreatureLocomotionRuntime(runtime, { speciesId: 'kedi', behaviour: 'wander', moving: true, speedMps: 0.8, targetSpeedMps: 1.2, deltaSeconds: 0.1 });
assert.equal(walk.state.state, 'wander');
assert.equal(walk.state.gait, 'walk');
assert.equal(runtime.frame, 2);
assert.ok(walk.timestamp > idle.timestamp);

pauseCreatureLocomotionRuntime(runtime);
const paused = updateCreatureLocomotionRuntime(runtime, { speciesId: 'kedi', behaviour: 'flee-on-approach', moving: true, speedMps: 3, targetSpeedMps: 5, deltaSeconds: 0.1 });
assert.equal(paused.paused, true);
assert.equal(paused.state.state, 'idle');
assert.equal(paused.state.pace.speedRatio, 0);
resumeCreatureLocomotionRuntime(runtime);
const fleeing = updateCreatureLocomotionRuntimeSafe(runtime, { speciesId: 'kedi', behaviour: 'flee-on-approach', moving: true, speedMps: 3, targetSpeedMps: 5, deltaSeconds: 0.1, ignoredObject: { nope: true } });
assert.equal(fleeing.state.state, 'flee');
assert.equal(fleeing.gaitRequest.gait, 'gallop');

const consumer = buildCreatureLocomotionConsumerIntent(runtime);
assert.equal(consumer.ownership.movement, 'caller');
assert.equal(consumer.ownership.skeleton, 'creatureGait');
assert.equal(consumer.gait.gait, 'gallop');

const snapshot = getCreatureLocomotionRuntimeSnapshot(runtime);
assert.equal(snapshot.id, 'runtime-test');
assert.equal(snapshot.frame, runtime.frame);
assert.ok(snapshot.summary.sampleCount >= 4);

const serialized = serializeCreatureLocomotionRuntime(runtime);
const hydrated = hydrateCreatureLocomotionRuntime(serialized);
assert.equal(hydrated.id, runtime.id);
assert.equal(hydrated.frame, runtime.frame);
assert.equal(hydrated.elapsedSeconds, runtime.elapsedSeconds);
const clone = cloneCreatureLocomotionRuntime(runtime);
assert.equal(clone.id, runtime.id);
assert.equal(clone.frame, runtime.frame);

resetCreatureLocomotionRuntime(runtime);
assert.equal(runtime.frame, 0);
assert.equal(runtime.elapsedSeconds, 0);
assert.equal(runtime.lastState, null);
assert.equal(runtime.timeline.history.length, 0);

console.log('Creature locomotion runtime checks passed');
