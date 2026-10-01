import assert from 'node:assert/strict';
import { planFaunaEcologyTick, applyFaunaEcologyTick, auditFaunaEcologyPlan } from '../src/3d/gameplay/livingWorldFaunaEcologyBridge.js';

const input = {
  seed: 'ecology-proof', tick: 12, playerPosition: { x: 0, z: 0 }, species: ['kurt', 'geyik', 'at', 'kuzgun', 'ejderha'],
  habitats: [
    { id: 'forest-edge', canonicalBiome: 'forest', score: 0.95, food: 0.9, water: 0.8, cover: 0.9, occupancy: 0.1, position: { x: 80, z: 30 }, groundValid: true, navReachable: true },
    { id: 'meadow-road', canonicalBiome: 'meadow', score: 0.9, food: 0.8, water: 0.7, cover: 0.4, occupancy: 0.05, position: { x: 190, z: -20 }, groundValid: true, navReachable: true },
    { id: 'ocean', canonicalBiome: 'ocean', score: 1, position: { x: 4, z: 4 }, groundValid: true, navReachable: true },
    { id: 'cliff', canonicalBiome: 'cliff', score: 1, position: { x: 8, z: 8 }, groundValid: true, navReachable: true },
  ],
  fauna: [
    { id: 'wolf-1', speciesId: 'kurt', groupId: 'pack-1', habitatId: 'forest-edge', position: { x: 80, z: 30 }, distanceMeters: 25, health: 1 },
    { id: 'deer-1', speciesId: 'geyik', groupId: 'herd-1', habitatId: 'forest-edge', position: { x: 84, z: 28 }, distanceMeters: 180, health: 1 },
  ],
  threats: [{ id: 'player', position: { x: 75, z: 30 }, distanceMeters: 12, confidence: 1, visible: true, hostile: true }],
};

const a = planFaunaEcologyTick(input);
const b = planFaunaEcologyTick(input);
assert.deepEqual(a, b);
assert.equal(a.deterministic, true);
assert.ok(a.spawns.length > 0);
assert.ok(a.spawns.every((s) => s.assetFirst && s.materialContract === 'MaterialAssignmentCore' && s.placementContract === 'WorldAssetPlacementPipeline'));
assert.ok(a.spawns.every((s) => s.placement.groundAligned && s.placement.navAligned && s.placement.habitatAligned));
assert.ok(a.spawns.every((s) => s.habitatId !== 'ocean' && s.habitatId !== 'cliff'));
assert.equal(a.updates.find((u) => u.id === 'wolf-1').state, 'stalk');
assert.equal(a.updates.find((u) => u.id === 'deer-1').lod, 'mid');
assert.equal(auditFaunaEcologyPlan(a).ok, true);

const calls = [];
const applied = applyFaunaEcologyTick(a, {
  spawnConfiguredCreatures: (spawn) => calls.push(`spawn:${spawn.id}`),
  updateCreatureBeing: (update) => calls.push(`update:${update.id}:${update.state}`),
  emitWorldEvent: (event) => calls.push(`event:${event.type}`),
});
assert.equal(applied.accepted, true);
assert.equal(applied.delegated, calls.length);
assert.ok(applied.updated.length > 0);
console.log('FAUNA_ECOLOGY_BRIDGE_OK');
