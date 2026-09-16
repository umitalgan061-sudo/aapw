import assert from 'node:assert/strict';
import { auditFaunaHabitatPlan, planFaunaHabitat } from '../src/3d/gameplay/livingWorldFaunaHabitatPolicy.js';

const input = {
  playerPosition: { x: 0, z: 0 },
  actors: [
    { id: 'deer-1', species: 'deer', role: 'grazer', habitat: 'forest', position: { x: 48, z: 0 }, slope: 0.15, groundValid: true, navReachable: true },
    { id: 'otter-1', species: 'otter', habitat: 'water', position: { x: 88, z: 2 }, slope: 0.1, groundValid: true, navReachable: true },
    { id: 'water-wolf', species: 'wolf', habitat: 'water', position: { x: 34, z: 4 }, slope: 0.1, groundValid: true, navReachable: true },
    { id: 'cliff-goat', species: 'goat', role: 'grazer', habitat: 'mountain', position: { x: 22, z: 8 }, slope: 0.94, groundValid: true, navReachable: true },
    { id: 'far-boar', species: 'boar', habitat: 'forest', position: { x: 999, z: 999 }, groundValid: true, navReachable: true },
  ],
};

const left = planFaunaHabitat(input);
const right = planFaunaHabitat({ ...input, actors: [...input.actors].reverse() });
assert.deepEqual(left, right);
assert.equal(left.accepted, true);
assert.deepEqual(left.plans.map((plan) => plan.actorId), ['cliff-goat', 'deer-1', 'otter-1']);
assert.equal(left.rejected.find((item) => item.actorId === 'water-wolf')?.reason, 'habitat-mismatch');
assert.equal(left.plans.find((plan) => plan.actorId === 'deer-1').lod, 'near');
assert.equal(left.plans.find((plan) => plan.actorId === 'otter-1').lod, 'distant');
assert.equal(left.plans.find((plan) => plan.actorId === 'cliff-goat').expectedSurface, 'steep');
assert.equal(auditFaunaHabitatPlan(left).ok, true);
assert(left.plans.every((plan) => plan.assetFirst === true));
assert(left.plans.every((plan) => plan.placement.placementContract.endsWith('WorldAssetPlacementPipeline.js')));
console.log('SAFAK_KARTALI_FAUNA_HABITAT_POLICY_OK');
