import assert from 'node:assert/strict';
import {
  faunaEcologyHabitatSafety,
  faunaEcologyAssetPlacementOrder,
  faunaEcologyDeterministicDoubleRun,
  faunaEcologyContractAudit,
  faunaEcologyOffscreenPolicy,
  faunaEcologyThreatMemory,
  faunaEcologyModelSurfaceRoles,
} from '../src/3d/gameplay/livingWorldFaunaEcologyDirector.js';

const habitat = {
  id: 'forest-edge',
  biome: 'forest',
  canonicalBiome: 'forest',
  position: { x: 14, z: -8 },
  score: 0.86,
  food: 0.72,
  water: 0.68,
  cover: 0.7,
  danger: 0.12,
  slopeDegrees: 18,
  waterDepthMeters: 0,
  distanceToSettlementMeters: 260,
  distanceToRoadMeters: 48,
  groundValid: true,
  navReachable: true,
  waterAccess: 0.9,
};

const input = {
  seed: 'safak-kartali-fauna-contract',
  tick: 42,
  clockSeconds: 13 * 3600,
  hour: 13,
  season: 'summer',
  weather: 'clear',
  playerPosition: { x: 0, z: 0 },
  species: ['wolf', 'deer', 'horse'],
  habitats: [habitat],
  actors: [
    { id: 'wolf-1', species: 'wolf', groupId: 'pack-1', habitatId: 'forest-edge', position: { x: 18, z: -7 }, hunger: 0.65, thirst: 0.3, fatigue: 0.15, health: 1 },
    { id: 'deer-1', species: 'deer', groupId: 'herd-1', habitatId: 'forest-edge', position: { x: 22, z: -5 }, hunger: 0.42, thirst: 0.4, fatigue: 0.2, health: 1 },
    { id: 'horse-1', species: 'horse', groupId: 'stable-1', habitatId: 'forest-edge', position: { x: 30, z: -4 }, hunger: 0.4, thirst: 0.35, fatigue: 0.2, health: 1 },
  ],
  resources: [
    { id: 'food-1', habitatId: 'forest-edge', kind: 'food', position: { x: 20, z: -6 }, amount: 0.8, regeneration: 0.5 },
    { id: 'water-1', habitatId: 'forest-edge', kind: 'water', position: { x: 12, z: -9 }, amount: 0.8, regeneration: 0.6 },
  ],
  maxSpawns: 2,
  maxTicksPerSecond: 220,
};

const safe = faunaEcologyHabitatSafety(habitat);
assert.equal(safe.ok, true, `canonical habitat must be safe: ${safe.reasons.join(',')}`);

const blocked = faunaEcologyHabitatSafety({ ...habitat, canonicalBiome: 'ocean' });
assert.equal(blocked.ok, false);
assert.ok(blocked.reasons.includes('ocean'));

const roles = faunaEcologyModelSurfaceRoles('horse');
assert.deepEqual(roles, ['coat', 'mane', 'tail', 'hoof', 'saddle', 'harness']);
assert.deepEqual(faunaEcologyModelSurfaceRoles('dragon'), ['scale', 'wing', 'eye', 'horn', 'claw']);

const order = faunaEcologyAssetPlacementOrder();
assert.equal(order[0], 'load-real-asset');
assert.equal(order.at(-1), 'attach-world-asset');
assert.ok(order.indexOf('validateMaterialAssignment') > order.indexOf('apply-material-recipe'));
assert.ok(order.indexOf('ground-height') > order.indexOf('create-material-manifest'));

const replay = faunaEcologyDeterministicDoubleRun(input);
assert.equal(replay.equal, true);
assert.equal(replay.firstDigest, replay.secondDigest);

const contract = faunaEcologyContractAudit(input);
assert.equal(contract.ok, true, JSON.stringify(contract));

const malformed = faunaEcologyContractAudit({
  ...input,
  actors: [{ ...input.actors[0], position: { x: Number.NaN, z: 0 } }],
});
assert.equal(malformed.ok, false, 'malformed actor coordinates must fail closed');

const distant = faunaEcologyOffscreenPolicy(180);
assert.equal(distant.lod, 'far');
assert.equal(distant.simulatePerception, false);
assert.equal(distant.simulateNeeds, true);

const culled = faunaEcologyOffscreenPolicy(5000);
assert.equal(culled.lod, 'culled');
assert.equal(culled.simulateMovement, false);
assert.equal(culled.allowAmbientAnimation, false);

const activeMemory = faunaEcologyThreatMemory(4);
assert.equal(activeMemory.active, true);
const expiredMemory = faunaEcologyThreatMemory(19);
assert.equal(expiredMemory.active, false);

console.log(JSON.stringify({
  contract: 'safak-kartali-fauna-ecology',
  deterministic: replay.equal,
  habitatSafety: safe,
  blockedHabitat: blocked,
  placementOrder: order,
  malformedInputRejected: malformed.ok === false,
  distantLod: distant,
  culledLod: culled,
  threatMemory: { active: activeMemory, expired: expiredMemory },
}));
