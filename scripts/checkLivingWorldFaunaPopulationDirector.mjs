import assert from 'node:assert/strict';
import {
  planFaunaPopulationTick,
  applyFaunaPopulationTick,
  auditFaunaPopulationPlan,
  createFaunaPopulationDirector,
} from '../src/3d/gameplay/livingWorldFaunaPopulationDirector.js';

const input = {
  seed: 'population-proof',
  tick: 17,
  hour: 11,
  playerPosition: { x: 0, z: 0 },
  species: ['deer', 'wolf', 'horse', 'dragon'],
  habitats: [
    { id: 'forest-edge', biome: 'forest', canonicalBiome: 'forest', score: 0.95, occupancy: 0.1, food: 0.9, cover: 0.9, position: { x: 80, z: 30 }, groundValid: true, navReachable: true, moisture: 0.7, distanceToSettlementMeters: 240, distanceToRoadMeters: 32 },
    { id: 'meadow-road', biome: 'meadow', canonicalBiome: 'meadow', score: 0.9, occupancy: 0.05, food: 0.8, cover: 0.4, position: { x: 190, z: -20 }, groundValid: true, navReachable: true, moisture: 0.5, distanceToSettlementMeters: 180, distanceToRoadMeters: 9 },
    { id: 'ocean', biome: 'ocean', canonicalBiome: 'ocean', score: 1, occupancy: 0, position: { x: 4, z: 4 }, groundValid: true, navReachable: true },
    { id: 'cliff', biome: 'cliff', canonicalBiome: 'cliff', score: 1, occupancy: 0, position: { x: 8, z: 8 }, groundValid: true, navReachable: true },
  ],
  fauna: [
    { id: 'wolf-1', species: 'wolf', groupId: 'pack-1', habitatId: 'forest-edge', position: { x: 80, z: 30 }, distanceMeters: 25, health: 1, active: true, visible: true },
    { id: 'deer-1', species: 'deer', groupId: 'herd-1', habitatId: 'forest-edge', position: { x: 84, z: 28 }, distanceMeters: 180, health: 1, active: true, visible: false },
  ],
  threats: [{ id: 'player', kind: 'player', position: { x: 75, z: 30 }, distanceMeters: 12, confidence: 1, visible: true, hostile: true }],
};

const a = planFaunaPopulationTick(input);
const b = planFaunaPopulationTick(input);
assert.deepEqual(a, b);
assert.equal(a.deterministic, true);
assert.ok(a.groups.length > 0);
assert.ok(a.groups.every((group) => group.assetManifest.assetFirst));
assert.ok(a.groups.every((group) => group.assetManifest.materialContract.endsWith('MaterialAssignmentCore.js')));
assert.ok(a.groups.every((group) => group.assetManifest.placementContract.endsWith('WorldAssetPlacementPipeline.js')));
assert.ok(a.groups.every((group) => group.placement.groundAligned && group.placement.navAligned && group.placement.habitatAligned));
assert.ok(a.groups.every((group) => group.habitatId !== 'ocean' && group.habitatId !== 'cliff'));
assert.ok(a.updates.some((update) => update.id === 'wolf-1' && update.state === 'stalk'));
assert.ok(a.updates.some((update) => update.id === 'deer-1' && update.lod === 'far'));
assert.equal(a.budget.habitats, 4);
assert.equal(a.budget.actors, 2);
assert.equal(auditFaunaPopulationPlan(a).ok, true);

const calls = [];
const applied = applyFaunaPopulationTick(a, {
  spawnGroup: (group) => { calls.push(`spawn:${group.groupId}`); return group.groupId; },
  updateActor: (update) => calls.push(`update:${update.id}:${update.state}`),
  emitWorldEvent: (event) => calls.push(`event:${event.type}`),
});
assert.equal(applied.delegated, calls.length);
assert.ok(applied.spawned.length >= 0);
assert.ok(applied.updated.length >= 1);
assert.ok(applied.emitted.length >= 1);

const director = createFaunaPopulationDirector(input);
assert.equal(director.read().disposed, false);
assert.equal(director.tick().accepted, true);
director.dispose();
assert.equal(director.tick().accepted, false);
console.log('FAUNA_POPULATION_DIRECTOR_OK');
