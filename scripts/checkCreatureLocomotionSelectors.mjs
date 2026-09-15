import assert from 'node:assert/strict';
import { synthesizeCreatureLocomotionState } from '../src/3d/gameplay/creatureLocomotionStateSynthesis.js';
import { selectCreatureState, selectCreatureGait, selectCreatureAlertIntensity, selectCreatureLocomotionIntensity, selectCreatureImpactIntensity, selectCreatureShouldSuppressGroundEffects, selectCreatureShouldUseReactiveGait, selectCreatureStateKnown, selectCreatureConsumerSnapshot, compareCreatureSelectorSnapshots } from '../src/3d/gameplay/creatureLocomotionStateSelectors.js';

const calm = synthesizeCreatureLocomotionState({ speciesId: 'kedi', behaviour: 'wander', moving: true, speedMps: 1, targetSpeedMps: 1.5, deltaSeconds: 0.1 });
assert.equal(selectCreatureState(calm), 'wander');
assert.equal(selectCreatureGait(calm), 'walk');
assert.equal(selectCreatureStateKnown(calm), true);
assert.equal(selectCreatureShouldSuppressGroundEffects(calm), false);
assert.equal(selectCreatureShouldUseReactiveGait(calm), false);
assert.ok(selectCreatureLocomotionIntensity(calm) > 0);
assert.equal(selectCreatureImpactIntensity(calm), 0);

const reactive = synthesizeCreatureLocomotionState({ speciesId: 'geyik', behaviour: 'flee-on-approach', moving: true, speedMps: 5, targetSpeedMps: 7, deltaSeconds: 0.1 });
assert.equal(selectCreatureState(reactive), 'flee');
assert.equal(selectCreatureGait(reactive), 'gallop');
assert.equal(selectCreatureShouldUseReactiveGait(reactive), true);
assert.ok(selectCreatureAlertIntensity(reactive) > 0);

const airborne = synthesizeCreatureLocomotionState({ speciesId: 'kuzgun', behaviour: 'flee-on-approach', flightEnabled: true, flightPhase: 'cruise', grounded: false, moving: true, speedMps: 7, targetSpeedMps: 7, deltaSeconds: 0.1 });
assert.equal(selectCreatureState(airborne), 'flight-cruise');
assert.equal(selectCreatureGait(airborne), 'flap');
assert.equal(selectCreatureShouldSuppressGroundEffects(airborne), true);
assert.equal(selectCreatureShouldUseReactiveGait(airborne), false);

const snapshot = selectCreatureConsumerSnapshot(reactive);
assert.equal(snapshot.rootMotionOwnedElsewhere, true);
assert.ok(Object.isFrozen(snapshot));
const comparison = compareCreatureSelectorSnapshots(calm, reactive);
assert.equal(comparison.sameState, false);
assert.notEqual(comparison.sameGait, true);
console.log('Creature locomotion selector checks passed');
