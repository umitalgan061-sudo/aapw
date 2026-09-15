import assert from 'node:assert/strict';
import { CREATURE_LOCOMOTION_STATE_FIXTURES, CREATURE_LOCOMOTION_EDGE_FIXTURES } from '../src/3d/gameplay/fixtures/creatureLocomotionStateFixtures.js';
import { synthesizeCreatureLocomotionState, validateCreatureLocomotionState } from '../src/3d/gameplay/creatureLocomotionStateSynthesis.js';

let passed = 0;
for (const fixture of [...CREATURE_LOCOMOTION_STATE_FIXTURES, ...CREATURE_LOCOMOTION_EDGE_FIXTURES]) {
  const state = synthesizeCreatureLocomotionState(fixture.input);
  const validation = validateCreatureLocomotionState(state);
  assert.deepEqual(validation, [], `${fixture.id}: ${validation.join(', ')}`);
  if (fixture.expectedState) assert.equal(state.state, fixture.expectedState, `${fixture.id}: state`);
  if (fixture.expectedGait) assert.equal(state.gait, fixture.expectedGait, `${fixture.id}: gait`);
  assert.ok(Object.isFrozen(state), `${fixture.id}: output must be frozen`);
  assert.ok(state.confidence >= 0 && state.confidence <= 1, `${fixture.id}: confidence`);
  passed += 1;
}

const priorityCases = [
  { id: 'flight-beats-social', input: { speciesId: 'kuzgun', behaviour: 'flee-on-approach', socialAlert: true, socialSameSpecies: true, flightEnabled: true, flightPhase: 'cruise', grounded: false, moving: true, speedMps: 7, targetSpeedMps: 7 }, expected: 'flight-cruise' },
  { id: 'landing-beats-flee', input: { behaviour: 'flee-on-approach', grounded: true, impactMps: 6, airTimeSeconds: 2, moving: false }, expected: 'landing-hard' },
  { id: 'contact-beats-social', input: { behaviour: 'wander', socialAlert: true, socialSameSpecies: true, grounded: true, moving: true, speedMps: 1, targetSpeedMps: 2, surfaceSlip: 0.9 }, expected: 'slip-recover' },
  { id: 'social-beats-wander', input: { behaviour: 'wander', socialAlert: true, socialSameSpecies: true, grounded: true, moving: true, speedMps: 1, targetSpeedMps: 3 }, expected: 'herd-flee' },
  { id: 'turn-beats-wander', input: { behaviour: 'wander', directionChanged: true, turnRateRad: 3, moving: true, speedMps: 1, targetSpeedMps: 2 }, expected: 'turn' },
];
for (const fixture of priorityCases) {
  const state = synthesizeCreatureLocomotionState(fixture.input);
  assert.equal(state.state, fixture.expected, fixture.id);
  passed += 1;
}

const malformed = synthesizeCreatureLocomotionState({ speedMps: NaN, targetSpeedMps: Infinity, turnRateRad: 'broken', grounded: null });
assert.deepEqual(validateCreatureLocomotionState(malformed), []);
assert.equal(malformed.state, 'idle');
passed += 2;

console.log(`Creature locomotion synthesis checks passed: ${passed}`);
