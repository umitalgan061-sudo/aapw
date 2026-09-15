import assert from 'node:assert/strict';
import { synthesizeCreatureLocomotionState } from '../src/3d/gameplay/creatureLocomotionStateSynthesis.js';
import { createCreatureLocomotionRuntime, updateCreatureLocomotionRuntime } from '../src/3d/gameplay/creatureLocomotionStateRuntime.js';
import { createCreatureLocomotionPresentationBridge, consumeCreatureLocomotionState, createCreatureAnimationAdapterPayload } from '../src/3d/gameplay/creatureLocomotionPresentationBridge.js';
import { buildCreatureContactLocomotionInput } from '../src/3d/gameplay/creatureLocomotionContactPolicy.js';

const base = { speciesId: 'geyik', behaviour: 'flee-on-approach', moving: true, speedMps: 4, targetSpeedMps: 6, deltaSeconds: 0.1 };
const contactInput = buildCreatureContactLocomotionInput(base, { grounded: true, surfaceConfidence: 1, normalConfidence: 1, slip: 0, forwardDistance: 3, forwardHeight: 0 });
const state = synthesizeCreatureLocomotionState(contactInput);
assert.equal(state.state, 'flee');
assert.equal(state.gait, 'gallop');
assert.equal(state.rootMotion.movementOwnedElsewhere, true);

const runtime = createCreatureLocomotionRuntime({ id: 'integration' });
const tick = updateCreatureLocomotionRuntime(runtime, contactInput);
assert.equal(tick.state.state, state.state);
assert.equal(tick.state.gait, state.gait);
assert.equal(tick.gaitRequest.gait, 'gallop');

const bridge = createCreatureLocomotionPresentationBridge({ id: 'integration-bridge' });
const presentation = consumeCreatureLocomotionState(bridge, tick.state, tick.timestamp);
assert.equal(presentation.summary.state, 'flee');
assert.equal(presentation.summary.gait, 'gallop');
assert.equal(presentation.gait.gait, 'gallop');
assert.equal(createCreatureAnimationAdapterPayload(tick.state).ownership.rig, 'creatureGait');

const bird = buildCreatureContactLocomotionInput({ speciesId: 'kuzgun', behaviour: 'flee-on-approach', flightEnabled: true, flightPhase: 'cruise', moving: true, speedMps: 7, targetSpeedMps: 7 }, { grounded: false, surfaceConfidence: 0, normalConfidence: 0, slip: 1 });
const birdState = synthesizeCreatureLocomotionState(bird);
assert.equal(birdState.state, 'flight-cruise');
assert.equal(birdState.gait, 'flap');
assert.equal(birdState.contact.plant, 0);

console.log('Creature locomotion integration checks passed');
