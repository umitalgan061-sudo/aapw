import assert from 'node:assert/strict';
import {
  admitHabitatSpawn,
  admitHabitatSpawns,
  habitatSpawnTelemetry,
} from '../src/3d/gameplay/livingWorldHabitatSpawnBridge.js';

const groundCollider = { getGroundHeight: () => 7 };
const nav = { isReachable: (x, z) => x >= 0 && z >= 0 };
const farmer = { kind: 'npc', position: { x: 2, z: 3 }, userData: {} };
const deer = { kind: 'wildlife', position: { x: 4, z: 5 }, userData: {} };
const invalidWildlife = { kind: 'wildlife', position: { x: 4, z: 5 }, userData: {} };

const farmerResult = admitHabitatSpawn({ actor: farmer, sample: { biome: 'reach', roadDistance: 4, settlementDistance: 4 }, groundCollider, nav });
assert.equal(farmerResult.admitted, true);
assert.equal(farmer.userData.livingWorldHabitat.context.groundAligned, true);

const batch = admitHabitatSpawns([deer, invalidWildlife], {
  groundCollider,
  nav,
  sampleForActor: (actor) => actor === deer
    ? { biome: 'reach', roadDistance: 20, settlementDistance: 20 }
    : { biome: 'reach', surface: 'settlement-edge', roadDistance: 20, settlementDistance: 20 },
});
assert.equal(batch.total, 2);
assert.equal(batch.admitted.length, 1);
assert.equal(batch.rejected.length, 1);
assert.equal(batch.rejected[0].result.reason, 'settlement-edge-wildlife');
assert.deepEqual(habitatSpawnTelemetry(batch), {
  total: 2,
  admitted: 1,
  rejected: 1,
  rejectedReasons: { 'settlement-edge-wildlife': 1 },
});

console.log('living-world habitat spawn bridge checks passed');
