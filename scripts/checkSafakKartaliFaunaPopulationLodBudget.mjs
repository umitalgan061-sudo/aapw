import assert from 'node:assert/strict';
import {
  planFaunaPopulationTick,
  auditFaunaPopulationPlan,
} from '../src/3d/gameplay/livingWorldFaunaPopulationDirector.js';

const input = {
  seed: 'safak-kartali-lod-budget',
  tick: 23,
  hour: 14,
  playerPosition: { x: 0, z: 0 },
  species: ['deer'],
  habitats: [
    {
      id: 'forest-habitat',
      biome: 'forest',
      canonicalBiome: 'forest',
      score: 0.95,
      occupancy: 0.1,
      food: 0.9,
      cover: 0.8,
      position: { x: 80, z: 30 },
      groundValid: true,
      navReachable: true,
      moisture: 0.7,
      distanceToSettlementMeters: 240,
      distanceToRoadMeters: 32,
    },
  ],
  fauna: [
    { id: 'near-deer', species: 'deer', groupId: 'herd-1', habitatId: 'forest-habitat', position: { x: 10, z: 0 }, distanceMeters: 20, active: true, visible: true },
    { id: 'distant-deer', species: 'deer', groupId: 'herd-1', habitatId: 'forest-habitat', position: { x: 80, z: 0 }, distanceMeters: 100, active: true, visible: true },
    { id: 'far-deer', species: 'deer', groupId: 'herd-1', habitatId: 'forest-habitat', position: { x: 300, z: 0 }, distanceMeters: 300, active: true, visible: false },
    { id: 'offscreen-deer', species: 'deer', groupId: 'herd-1', habitatId: 'forest-habitat', position: { x: 600, z: 0 }, distanceMeters: 600, active: true, visible: false },
    { id: 'culled-deer', species: 'deer', groupId: 'herd-1', habitatId: 'forest-habitat', position: { x: 900, z: 0 }, distanceMeters: 900, active: true, visible: false },
  ],
  threats: [],
};

const first = planFaunaPopulationTick(input);
const second = planFaunaPopulationTick(input);
assert.deepEqual(first, second);
assert.equal(first.deterministic, true);
assert.equal(first.budget.habitats, 1);
assert.equal(first.budget.actors, 5);
assert.equal(auditFaunaPopulationPlan(first).ok, true);

const updates = new Map(first.updates.map((update) => [update.id, update]));
assert.equal(updates.get('near-deer')?.lod, 'near');
assert.equal(updates.get('near-deer')?.tickIntervalSeconds, 0);
assert.equal(updates.get('distant-deer')?.lod, 'distant');
assert.equal(updates.get('distant-deer')?.tickIntervalSeconds, 0.75);
assert.equal(updates.get('far-deer')?.lod, 'far');
assert.equal(updates.get('far-deer')?.tickIntervalSeconds, 2);
assert.equal(updates.get('offscreen-deer')?.lod, 'offscreen');
assert.equal(updates.get('offscreen-deer')?.tickIntervalSeconds, 5);
assert.equal(updates.get('offscreen-deer')?.simulatedOffscreen, true);
assert.equal(updates.get('culled-deer')?.lod, 'culled');
assert.equal(updates.get('culled-deer')?.tickIntervalSeconds, Infinity);
assert.equal(updates.get('culled-deer')?.simulatedOffscreen, false);

const allMembers = first.groups.flatMap((group) => group.members || []);
assert.equal(allMembers.length, 5);
assert.equal(new Set(allMembers.map((member) => member.id)).size, 5);
assert.ok(first.groups.every((group) => group.assetManifest.assetFirst));
assert.ok(first.groups.every((group) => group.assetManifest.materialContract.endsWith('MaterialAssignmentCore.js')));
assert.ok(first.groups.every((group) => group.assetManifest.placementContract.endsWith('WorldAssetPlacementPipeline.js')));
assert.ok(first.groups.every((group) => group.placement.groundAligned && group.placement.navAligned && group.placement.habitatAligned));

const budgeted = first.updates.reduce((sum, update) => sum + (Number.isFinite(update.tickIntervalSeconds) ? 1 / Math.max(1, update.tickIntervalSeconds) : 0), 0);
assert.ok(budgeted <= 1 + (1 / 0.75) + 0.5 + 0.25);

console.log(JSON.stringify({
  pass: true,
  lods: Object.fromEntries([...updates].map(([id, update]) => [id, update.lod])),
  intervals: Object.fromEntries([...updates].map(([id, update]) => [id, update.tickIntervalSeconds])),
  actorCount: first.budget.actors,
  budgetedTicksPerSecond: budgeted,
}, null, 2));
