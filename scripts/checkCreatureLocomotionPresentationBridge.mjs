import assert from 'node:assert/strict';
import { synthesizeCreatureLocomotionState } from '../src/3d/gameplay/creatureLocomotionStateSynthesis.js';
import { createCreatureLocomotionPresentationBridge, consumeCreatureLocomotionState, consumeCreatureLocomotionSequence, getCreaturePresentationEmittedEvents, createCreatureAnimationAdapterPayload, createCreatureAudioAdapterPayload, createCreatureVfxAdapterPayload, validateCreaturePresentationPayload, serializeCreaturePresentationBridge, hydrateCreaturePresentationBridge } from '../src/3d/gameplay/creatureLocomotionPresentationBridge.js';

const state = synthesizeCreatureLocomotionState({ speciesId: 'kedi', behaviour: 'flee-on-approach', moving: true, speedMps: 3, targetSpeedMps: 5, deltaSeconds: 0.1 });
const bridge = createCreatureLocomotionPresentationBridge({ id: 'bridge-test' });
const output = consumeCreatureLocomotionState(bridge, state, 0.1);
assert.equal(output.summary.state, 'flee');
assert.equal(output.gait.gait, 'gallop');
assert.equal(validateCreaturePresentationPayload(createCreatureAnimationAdapterPayload(state)).length, 0);
assert.equal(validateCreaturePresentationPayload(createCreatureAudioAdapterPayload(state)).length, 0);
assert.equal(validateCreaturePresentationPayload(createCreatureVfxAdapterPayload(state)).length, 0);
assert.equal(getCreaturePresentationEmittedEvents(bridge).length, 1);

const idle = synthesizeCreatureLocomotionState({ speciesId: 'kedi', behaviour: 'wander', moving: false, speedMps: 0, targetSpeedMps: 0, deltaSeconds: 0.1 });
const sequence = consumeCreatureLocomotionSequence(bridge, [idle, state, idle], [0.2, 0.3, 0.4]);
assert.equal(sequence.length, 3);
assert.ok(sequence[1].channels.alert > sequence[0].channels.alert);

const serialized = serializeCreaturePresentationBridge(bridge);
const restored = hydrateCreaturePresentationBridge(serialized);
assert.equal(restored.id, bridge.id);
assert.equal(restored.eventSequence, bridge.eventSequence);
assert.deepEqual(getCreaturePresentationEmittedEvents(restored), getCreaturePresentationEmittedEvents(bridge));
console.log('Creature locomotion presentation bridge checks passed');
