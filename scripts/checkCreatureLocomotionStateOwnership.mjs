import assert from 'node:assert/strict';
import { synthesizeCreatureLocomotionState } from '../src/3d/gameplay/creatureLocomotionStateSynthesis.js';
import { projectCreatureGaitRequest } from '../src/3d/gameplay/creatureLocomotionStateSynthesis.js';

const inputs = [
  { behaviour: 'wander', moving: true, speedMps: 1, targetSpeedMps: 1.5 },
  { behaviour: 'flee-on-approach', moving: true, speedMps: 4, targetSpeedMps: 6 },
  { speciesId: 'kuzgun', flightEnabled: true, flightPhase: 'cruise', grounded: false, moving: true, speedMps: 7, targetSpeedMps: 7 },
  { grounded: true, impactMps: 6, airTimeSeconds: 1, moving: false },
];
for (const input of inputs) {
  const state = synthesizeCreatureLocomotionState(input);
  assert.equal(state.rootMotion.movementOwnedElsewhere, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(state, 'position'));
  assert.ok(!Object.prototype.hasOwnProperty.call(state, 'velocity'));
  assert.ok(!Object.prototype.hasOwnProperty.call(state, 'boneRotations'));
  assert.equal(projectCreatureGaitRequest(state).clockSeconds, state.timing.gaitClockSeconds);
}
console.log(`Creature locomotion ownership checks passed: ${inputs.length}`);
