import assert from 'node:assert/strict';
import { synthesizeCreatureLocomotionState } from '../src/3d/gameplay/creatureLocomotionStateSynthesis.js';
import { createCreatureLocomotionStateSchemaDefaults, normalizeCreatureLocomotionStateSchema, toCreatureLocomotionStateJson, fromCreatureLocomotionStateJson, validateCreatureLocomotionStateSchema, compareCreatureLocomotionStateSchema, roundTripCreatureLocomotionStateSchema, createCreatureLocomotionStatePatch, applyCreatureLocomotionStatePatch, estimateCreatureLocomotionStatePayloadCost } from '../src/3d/gameplay/creatureLocomotionStateSchema.js';

const defaults = createCreatureLocomotionStateSchemaDefaults();
assert.equal(defaults.state, 'idle');
assert.equal(defaults.gait, 'walk');
assert.equal(defaults.rootMotion.movementOwnedElsewhere, true);
assert.deepEqual(validateCreatureLocomotionStateSchema(defaults), []);

const state = synthesizeCreatureLocomotionState({ speciesId: 'geyik', behaviour: 'flee-on-approach', moving: true, speedMps: 4, targetSpeedMps: 7, deltaSeconds: 0.1 });
const normalized = normalizeCreatureLocomotionStateSchema(state);
assert.equal(normalized.state, 'flee');
assert.equal(normalized.gait, 'gallop');
assert.deepEqual(validateCreatureLocomotionStateSchema(normalized), []);
const roundTrip = roundTripCreatureLocomotionStateSchema(state);
assert.equal(compareCreatureLocomotionStateSchema(state, roundTrip).equal, true);

const json = toCreatureLocomotionStateJson(state);
assert.equal(fromCreatureLocomotionStateJson(json).state, 'flee');
assert.ok(estimateCreatureLocomotionStatePayloadCost(state) > 0);

const changed = synthesizeCreatureLocomotionState({ speciesId: 'geyik', behaviour: 'wander', moving: true, speedMps: 1, targetSpeedMps: 1.5, deltaSeconds: 0.1 });
const patch = createCreatureLocomotionStatePatch(state, changed);
assert.equal(patch.state, 'wander');
assert.equal(patch.gait, 'walk');
const applied = applyCreatureLocomotionStatePatch(state, patch);
assert.equal(applied.state, 'wander');
assert.equal(applied.gait, 'walk');

const malformed = normalizeCreatureLocomotionStateSchema({ state: 'not-a-state', event: 'not-an-event', source: 'not-a-source', gait: 'not-a-gait', confidence: 99, presentation: { locomotion: 7 } });
assert.equal(malformed.state, 'idle');
assert.equal(malformed.event, 'none');
assert.equal(malformed.source, 'fallback');
assert.equal(malformed.gait, 'walk');
assert.equal(malformed.confidence, 1);
assert.equal(malformed.presentation.locomotion, 1);
assert.deepEqual(validateCreatureLocomotionStateSchema(malformed), []);
console.log('Creature locomotion schema checks passed');
