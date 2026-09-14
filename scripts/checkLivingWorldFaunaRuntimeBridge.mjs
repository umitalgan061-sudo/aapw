import assert from 'node:assert/strict';
import { applyFaunaRuntimeTick, planFaunaRuntimeTick } from '../src/3d/gameplay/livingWorldFaunaRuntimeBridge.js';

const input = {
  seed: 'westeros', tick: 7, hour: 21,
  habitats: [
    { id: 'forest', biome: 'forest', score: 0.9, occupancy: 0.1, food: 0.8, cover: 0.9, position: { x: 10, z: 20 }, groundValid: true, navReachable: true },
    { id: 'ocean', biome: 'ocean', score: 1, occupancy: 0, position: { x: 0, z: 0 } },
    { id: 'cliff', biome: 'cliff', score: 1, occupancy: 0, position: { x: 2, z: 2 } },
  ],
  fauna: [
    { id: 'deer-seed', species: 'deer', habitatId: 'other-forest', position: { x: 40, z: 50 }, distanceMeters: 25, health: 1 },
    { id: 'wolf-1', species: 'wolf', habitatId: 'forest', groupId: 'pack-1', position: { x: 10, z: 20 }, distanceMeters: 25, health: 1 },
    { id: 'horse-1', species: 'horse', habitatId: 'forest', position: { x: 10, z: 20 }, distanceMeters: 120, health: 1 },
  ],
  threats: [{ id: 'player', kind: 'player', distanceMeters: 10, visible: true, confidence: 1, position: { x: 0, z: 0 } }],
};

const a = planFaunaRuntimeTick(input);
const b = planFaunaRuntimeTick(input);
assert.deepEqual(a, b);
assert.equal(a.deterministic, true);
assert.ok(a.spawn.length > 0);
assert.equal(a.spawn[0].placementContract, 'WorldAssetPlacementPipeline');
assert.equal(a.spawn[0].materialContract, 'MaterialAssignmentCore');
assert.ok(a.spawn.every((spawn) => spawn.assetFirst));
assert.equal(a.updates.find((u) => u.id === 'wolf-1').state, 'stalk');
assert.equal(a.updates.find((u) => u.id === 'wolf-1').tickIntervalSeconds, 0);
assert.equal(a.updates.find((u) => u.id === 'horse-1').lod, 'distant');
assert.equal(a.updates.find((u) => u.id === 'horse-1').tickIntervalSeconds, 0.75);
assert.ok(a.spawn.every((spawn) => spawn.habitatId !== 'ocean' && spawn.habitatId !== 'cliff'));

const calls = [];
const applied = applyFaunaRuntimeTick(a, {
  spawnGroup: (directive) => { calls.push(`spawn:${directive.id}`); return directive.id; },
  updateActor: (update) => calls.push(`update:${update.id}:${update.state}`),
  emitWorldEvent: (event) => calls.push(`event:${event.actorId}:${event.state}`),
});
assert.equal(applied.updated, a.updates.length);
assert.equal(applied.emitted, a.events.length);
assert.equal(calls.length, a.spawn.length + a.updates.length + a.events.length);
console.log('FAUNA_RUNTIME_BRIDGE_OK');
