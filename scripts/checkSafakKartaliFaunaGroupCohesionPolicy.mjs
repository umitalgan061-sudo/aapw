import assert from 'node:assert/strict';
import { auditFaunaAmbientLifePlan, planFaunaAmbientLife } from '../src/3d/gameplay/livingWorldFaunaAmbientLifePolicy.js';
import { auditFaunaGroupCohesionPlan, planFaunaGroupCohesion } from '../src/3d/gameplay/livingWorldFaunaGroupCohesionPolicy.js';

const actors = [
  { id: 'wolf-2', groupId: 'pack-alpha', species: 'wolf', role: 'predator', position: { x: 18, z: 2 }, activity: 'howl', groundValid: true, navReachable: true },
  { id: 'wolf-1', groupId: 'pack-alpha', species: 'wolf', role: 'predator', position: { x: 0, z: 0 }, activity: 'patrol', groundValid: true, navReachable: true },
  { id: 'deer-1', groupId: 'herd-7', species: 'deer', role: 'grazer', position: { x: 52, z: 4 }, activity: 'graze', groundValid: true, navReachable: true },
  { id: 'deer-2', groupId: 'herd-7', species: 'deer', role: 'grazer', position: { x: 61, z: 5 }, activity: 'drink', groundValid: true, navReachable: true },
];

const world = { hour: 18, weatherPressure: 0.2, tick: 42 };
const playerPosition = { x: 0, z: 0 };
const ambient = planFaunaAmbientLife({ actors, world, playerPosition, seed: 'cohesion-proof' });
assert.equal(auditFaunaAmbientLifePlan(ambient).ok, true);

const cohesion = planFaunaGroupCohesion({ intents: ambient.intents });
assert.equal(cohesion.accepted, true);
assert.equal(cohesion.audit.ok, true);
assert.equal(auditFaunaGroupCohesionPlan(cohesion).ok, true);
assert.deepEqual(cohesion.groups.map((group) => group.groupId), ['herd-7', 'pack-alpha']);
assert.deepEqual(cohesion.groups.find((group) => group.groupId === 'pack-alpha').memberIds, ['wolf-1', 'wolf-2']);
assert.equal(cohesion.signals.find((signal) => signal.groupId === 'pack-alpha').signal, 'call-and-response');
assert.equal(cohesion.signals.find((signal) => signal.groupId === 'pack-alpha').predatorGroup, true);

const reversed = planFaunaGroupCohesion({ intents: [...ambient.intents].reverse() });
assert.deepEqual(reversed, cohesion);
assert.equal(cohesion.groups.every((group) => group.execution === 'caller-owned-steering'), true);
assert.equal(cohesion.groups.every((group) => group.materialPlacement === true), true);

const oversized = planFaunaGroupCohesion({ intents: Array.from({ length: 40 }, (_, index) => ({
  actorId: `actor-${index}`,
  groupId: 'large-herd',
  species: 'deer',
  activity: 'graze',
  position: { x: index, z: 0 },
  assetFirst: true,
  placement: { materialContract: 'src/3d/materials/MaterialAssignmentCore.js', placementContract: 'src/3d/world/WorldAssetPlacementPipeline.js' },
})) });
assert.equal(oversized.groups[0].memberIds.length, 12);
assert.equal(oversized.groups.length, 1);

console.log(JSON.stringify({
  ok: true,
  policy: cohesion.policyId,
  groups: cohesion.groups.length,
  signals: cohesion.signals.length,
  deterministic: JSON.stringify(reversed) === JSON.stringify(cohesion),
  boundedMembers: oversized.groups[0].memberIds.length,
  sharedMaterialPlacement: cohesion.audit.sharedMaterialPlacement,
}));
