import assert from 'node:assert/strict';
import { applyFaunaTick, planFaunaTick } from '../src/3d/gameplay/livingWorldFaunaDirector.js';

const input = {
  worldSeed: 'westeros-demo',
  tick: 42,
  habitats: [
    { id: 'forest-west', biome: 'forest', score: 0.9, occupancy: 0.1, position: { x: 10, z: 20 } },
    { id: 'blocked', biome: 'forest', score: 0.95, occupancy: 0.99, position: { x: 0, z: 0 } },
    { id: 'low-score', biome: 'forest', score: 0.2, occupancy: 0.1, position: { x: 1, z: 1 } },
  ],
  candidates: [{ id: 'wolf-1', species: 'wolf', lod: 'distant' }],
  threats: [{ id: 'player-1', kind: 'player', distanceMeters: 20, ageSeconds: 0 }],
};

const first = planFaunaTick(input);
const second = planFaunaTick(input);
assert.deepEqual(first, second, 'same seed/tick/input must be deterministic');
assert.equal(first.spawn.length, 1, 'only viable habitat should spawn');
assert.equal(first.spawn[0].placementContract, 'WorldAssetPlacementPipeline');
assert.equal(first.spawn[0].materialContract, 'MaterialAssignmentCore');
assert.equal(first.updates[0].state, 'flee');
assert.equal(first.updates[0].tickIntervalSeconds, 0.75);
assert.ok(first.spawn.length <= 4);

const calls = [];
const applied = applyFaunaTick(first, {
  spawnGroup: (directive) => { calls.push(`spawn:${directive.id}`); return directive.id; },
  updateActor: (update) => calls.push(`update:${update.id}:${update.state}`),
});
assert.deepEqual(applied.spawned, [first.spawn[0].id]);
assert.equal(applied.updated, 1);
assert.deepEqual(calls, [`spawn:${first.spawn[0].id}`, 'update:wolf-1:flee']);

const stale = planFaunaTick({ ...input, threats: [{ id: 'old', kind: 'player', distanceMeters: 10, ageSeconds: 99 }] });
assert.equal(stale.updates[0].state, 'roam', 'expired threat memory must not drive flee');
console.log('LIVING_WORLD_FAUNA_DIRECTOR_OK');
