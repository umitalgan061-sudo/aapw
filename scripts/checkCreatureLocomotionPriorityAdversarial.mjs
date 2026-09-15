import assert from 'node:assert/strict';
import { synthesizeCreatureLocomotionState, normalizeCreatureLocomotionInput, resolveCreatureFlightState, resolveCreatureLandingState, resolveCreatureContactState, resolveCreatureSocialState, resolveCreatureBehaviourState, resolveCreatureTurnState } from '../src/3d/gameplay/creatureLocomotionStateSynthesis.js';

const cases = [
  ['unknown-behaviour', { behaviour: 'not-real', moving: true, speedMps: 2, targetSpeedMps: 3 }, 'wander'],
  ['flight-over-social', { flightEnabled: true, flightPhase: 'cruise', grounded: false, socialAlert: true, socialSameSpecies: true, behaviour: 'flee-on-approach', moving: true, speedMps: 7, targetSpeedMps: 7 }, 'flight-cruise'],
  ['hard-landing-over-reactive', { flightEnabled: true, flightPhase: 'grounded', grounded: true, impactMps: 8, airTimeSeconds: 2, behaviour: 'flee-on-approach', moving: false }, 'landing-hard'],
  ['slip-over-social', { socialAlert: true, socialSameSpecies: true, surfaceSlip: 0.99, moving: true, speedMps: 2, targetSpeedMps: 3 }, 'slip-recover'],
  ['unstable-over-turn', { directionChanged: true, turnRateRad: 8, surfaceConfidence: 0.1, moving: true, speedMps: 2, targetSpeedMps: 3 }, 'contact-unstable'],
  ['social-over-turn', { directionChanged: true, turnRateRad: 4, socialAlert: true, socialSameSpecies: true, moving: true, speedMps: 2, targetSpeedMps: 3 }, 'herd-flee'],
  ['turn-over-wander', { directionChanged: true, turnRateRad: 2, moving: true, speedMps: 1, targetSpeedMps: 2 }, 'turn'],
  ['idle-no-speed', { behaviour: 'wander', moving: false, speedMps: 50, targetSpeedMps: 50 }, 'idle'],
];

for (const [id, input, expected] of cases) {
  const state = synthesizeCreatureLocomotionState(input);
  assert.equal(state.state, expected, id);
  assert.ok(state.priority > 0, `${id}: priority`);
  assert.ok(state.confidence >= 0 && state.confidence <= 1, `${id}: confidence`);
}

const malformed = normalizeCreatureLocomotionInput({ speedMps: 'abc', turnRateRad: null, confidence: 'abc', surfaceSlip: -100, groundNormalConfidence: 100, deltaSeconds: 100 });
assert.equal(malformed.speedMps, 0);
assert.equal(malformed.turnRateRad, 0);
assert.equal(malformed.confidence, 0);
assert.equal(malformed.surfaceSlip, 0);
assert.equal(malformed.groundNormalConfidence, 1);
assert.equal(malformed.deltaSeconds, 0.2);

assert.equal(resolveCreatureFlightState({ flightEnabled: false }), null);
assert.ok(resolveCreatureFlightState({ flightEnabled: true, flightPhase: 'cruise', grounded: false }));
assert.ok(resolveCreatureLandingState({ grounded: true, impactMps: 5, airTimeSeconds: 1 }));
assert.ok(resolveCreatureContactState({ surfaceSlip: 0.8, moving: true, speedMps: 1 }));
assert.equal(resolveCreatureSocialState({ socialAlert: true, socialSameSpecies: false }), null);
assert.ok(resolveCreatureBehaviourState({ behaviour: 'wander', moving: true, speedMps: 1 }));
assert.ok(resolveCreatureTurnState({ directionChanged: true, turnRateRad: 2, moving: true, speedMps: 1 }));

console.log(`Creature locomotion adversarial checks passed: ${cases.length}`);
