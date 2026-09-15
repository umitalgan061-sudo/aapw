import assert from 'node:assert/strict';
import { createCreatureLocomotionContract, buildCreatureLocomotionContractInput, synthesizeCreatureLocomotionContract, resolveCreatureLocomotionContractTransition, buildCreatureLocomotionAnimationIntent, buildCreatureLocomotionAudioIntent, buildCreatureLocomotionVfxIntent, validateCreatureLocomotionContract, compareCreatureLocomotionContractResults, cloneCreatureLocomotionContract, serializeCreatureLocomotionContract, hydrateCreatureLocomotionContract, buildCreatureLocomotionContractEnvelope, runCreatureLocomotionContractSequence, calculateCreatureLocomotionContractValidity, buildCreatureLocomotionContractHealth } from '../src/3d/gameplay/creatureLocomotionStateContract.js';

const contract = createCreatureLocomotionContract({ id: 'contract-test' });
const cleanInput = buildCreatureLocomotionContractInput({ speciesId: 'geyik', behaviour: 'wander', moving: true, speedMps: 1, targetSpeedMps: 1.5, deltaSeconds: 0.1 }, { grounded: true, surfaceConfidence: 1, normalConfidence: 1, slip: 0, forwardDistance: 5, forwardHeight: 0 });
const first = synthesizeCreatureLocomotionContract(contract, cleanInput, {});
assert.equal(first.state.state, 'wander');
assert.equal(first.state.gait, 'walk');
assert.deepEqual(validateCreatureLocomotionContract(first), []);
assert.deepEqual(first.validationErrors, []);

const second = synthesizeCreatureLocomotionContract(contract, { ...cleanInput, behaviour: 'flee-on-approach', moving: true, speedMps: 4, targetSpeedMps: 6 }, {});
assert.equal(second.state.state, 'flee');
assert.equal(second.state.gait, 'gallop');
const transition = resolveCreatureLocomotionContractTransition(first.state, second.state, 0.04);
assert.ok(transition.policy.durationSeconds > 0);
assert.ok(transition.weights.from + transition.weights.to <= 1.0001);

const animation = buildCreatureLocomotionAnimationIntent(second);
const audio = buildCreatureLocomotionAudioIntent(second);
const vfx = buildCreatureLocomotionVfxIntent(second);
assert.equal(animation.ownership.movement, 'caller');
assert.equal(animation.gait, 'gallop');
assert.equal(audio.state, 'flee');
assert.equal(vfx.state, 'flee');

const envelope = buildCreatureLocomotionContractEnvelope(second, { producer: 'test' });
assert.equal(envelope.schema, 'creature-locomotion-contract');
assert.equal(envelope.animation.gait, 'gallop');
assert.equal(envelope.audio.state, 'flee');

const clone = cloneCreatureLocomotionContract(contract);
assert.equal(clone.sampleIndex, contract.sampleIndex);
assert.equal(clone.id, contract.id);
const hydrated = hydrateCreatureLocomotionContract(serializeCreatureLocomotionContract(contract));
assert.equal(hydrated.sampleIndex, contract.sampleIndex);
assert.equal(hydrated.lastTimestamp, contract.lastTimestamp);

const sequence = runCreatureLocomotionContractSequence([
  { input: { speciesId: 'kedi', behaviour: 'wander', moving: false, speedMps: 0, targetSpeedMps: 0, deltaSeconds: 0.1 }, probe: { grounded: true } },
  { input: { speciesId: 'kedi', behaviour: 'wander', moving: true, speedMps: 0.8, targetSpeedMps: 1.2, deltaSeconds: 0.1 }, probe: { grounded: true } },
  { input: { speciesId: 'kedi', behaviour: 'flee-on-approach', moving: true, speedMps: 3, targetSpeedMps: 5, deltaSeconds: 0.1 }, probe: { grounded: true } },
]);
assert.equal(sequence.length, 3);
assert.equal(sequence[2].state.state, 'flee');
assert.equal(calculateCreatureLocomotionContractValidity(sequence), 1);
assert.equal(buildCreatureLocomotionContractHealth(sequence).label, 'healthy');
assert.equal(compareCreatureLocomotionContractResults(sequence[1], sequence[2]).sameState, false);

console.log('Creature locomotion contract checks passed');
