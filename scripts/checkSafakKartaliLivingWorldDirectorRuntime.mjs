import assert from 'node:assert/strict';
import { createLivingWorldDirector, directorDigest, auditDirectorPolicy, LIVING_WORLD_DIRECTOR_POLICY } from '../src/3d/gameplay/livingWorldDirectorRuntimeAdapter.js';

function controller(id, x, z, state = 'patrol', options = {}) {
  return {
    id,
    state,
    object3D: { name: id, position: { x, y: 0, z }, userData: {} },
    updates: 0,
    update(deltaSeconds) {
      if (options.throwOnUpdate) throw new Error('controller-failure');
      assert.equal(deltaSeconds, LIVING_WORLD_DIRECTOR_POLICY.maxDeltaSeconds);
      this.updates += 1;
    },
  };
}

const guard = controller('guard-1', 0, 0, 'chase');
const wolf = controller('wolf-1', 20, 10, 'roam');
const events = [];
const director = createLivingWorldDirector({
  seed: 'safak-kartali-2026-09-15',
  clockSeconds: 7200,
  worldEventPublisher: (event) => {
    events.push(event);
    return event;
  },
});

const context = {
  worldSeed: 'safak-kartali-2026-09-15', playerX: 0, playerZ: 0, biome: 'forest', threatLevel: 0.92,
  wildlifeActivity: 0.84, roadActivity: 0.4, populationDensity: 0.65,
  nearestSettlementDistanceMeters: 90, nearestRoadDistanceMeters: 18, clockSeconds: 7200,
};

const occupations = [{
  controller: guard,
  definition: { id: 'guard-watch', entries: [
    { startSeconds: 0, endSeconds: 21600, activityId: 'patrol', locationId: 'gate' },
    { startSeconds: 21600, endSeconds: 43200, activityId: 'rest', locationId: 'barracks' },
    { startSeconds: 43200, endSeconds: 86400, activityId: 'patrol', locationId: 'gate' },
  ] },
}];

const request = {
  species: 'wolf', centerX: 20, centerZ: 10, radiusMeters: 24, seed: 11,
  context: { biome: 'forest', waterAvailability: 0.8, preyAvailability: 0.9, humanPressure: 0.1 },
};

const tickInput = {
  deltaSeconds: 10, playerPosition: { x: 0, z: 0 }, collections: { npcs: [guard], animals: [wolf] },
  occupations, faunaRequests: [request], eventContext: context, eventTypes: ['guard_alert', 'wildlife_surge'],
};

const first = director.tick(tickInput);
assert.equal(first.accepted, true);
assert.equal(first.tick, 1);
assert.equal(guard.updates, 1);
assert.equal(wolf.updates, 1);
assert.equal(first.occupations.length, 1);
assert.equal(first.fauna.length, 1);
assert.equal(first.fauna[0].audit.ok, true);
assert.ok(Array.isArray(first.habitatSpecies));
assert.ok(first.events.receipts.length <= LIVING_WORLD_DIRECTOR_POLICY.maxEventsPerTick);
assert.equal(auditDirectorPolicy(first).ok, true);
assert.ok(guard.object3D.userData.livingWorldDirector);

const digestA = directorDigest(first);
director.reset();
const replay = director.tick(tickInput);
assert.equal(directorDigest(replay), digestA);
assert.equal(events.length, first.events.receipts.filter((receipt) => receipt.emitted.accepted).length * 2);

const overBudget = Array.from({ length: LIVING_WORLD_DIRECTOR_POLICY.maxActors + 9 }, (_, index) => controller(`extra-${index}`, index, index));
director.reset();
const bounded = director.tick({ ...tickInput, collections: { npcs: overBudget } });
assert.equal(bounded.actorsUpdated, LIVING_WORLD_DIRECTOR_POLICY.maxActors);
assert.equal(overBudget.filter((actor) => actor.updates > 0).length, LIVING_WORLD_DIRECTOR_POLICY.maxActors);

const caps = [0, 0.001, 0.01, 0.1, 0.25, 1, 5, 60, 999];
for (const inputDelta of caps) {
  director.reset();
  const boundedDelta = director.tick({ ...tickInput, deltaSeconds: inputDelta, collections: { npcs: [] } });
  assert.equal(boundedDelta.accepted, true);
  assert.equal(boundedDelta.tick, 1);
}

const hostile = controller('hostile-update', 2, 2, 'failure', { throwOnUpdate: true });
director.reset();
const failureSnapshot = director.tick({ ...tickInput, collections: { npcs: [hostile], animals: [] } });
assert.equal(failureSnapshot.accepted, true);
assert.equal(failureSnapshot.actorsUpdated, 1);
assert.equal(hostile.updates, 0);

const invalidOccupation = { controller: guard, definition: { id: 'broken', entries: [] } };
director.reset();
const invalidScheduleSnapshot = director.tick({ ...tickInput, collections: { npcs: [] }, occupations: [invalidOccupation], faunaRequests: [] });
assert.equal(invalidScheduleSnapshot.accepted, true);
assert.equal(invalidScheduleSnapshot.occupations.length, 1);
assert.equal(invalidScheduleSnapshot.occupations[0].accepted, false);
assert.ok(invalidScheduleSnapshot.occupations[0].errors.length > 0);

const unknownFauna = { ...request, species: 'not-a-real-species' };
director.reset();
const unknownSnapshot = director.tick({ ...tickInput, collections: { npcs: [] }, occupations: [], faunaRequests: [unknownFauna] });
assert.equal(unknownSnapshot.accepted, true);
assert.equal(unknownSnapshot.fauna.length, 1);
assert.equal(unknownSnapshot.fauna[0].habitat.accepted, false);
assert.equal(unknownSnapshot.fauna[0].habitat.reasons[0], 'unknown-species');

const iteratorControllers = new Set([controller('iter-a', 0, 0), controller('iter-b', 4, 4)]);
director.reset();
const iterableSnapshot = director.tick({ ...tickInput, collections: { npcs: iteratorControllers }, occupations: [], faunaRequests: [] });
assert.equal(iterableSnapshot.accepted, true);
assert.equal(iterableSnapshot.actorsUpdated, 2);

const nullCollections = director.tick({ ...tickInput, collections: null, occupations: null, faunaRequests: null, eventContext: null });
assert.equal(nullCollections.accepted, true);
assert.equal(nullCollections.actorsUpdated, 0);

const auditAfterNull = director.audit();
assert.equal(auditAfterNull.ok, true);
assert.equal(auditAfterNull.disposed, false);
assert.ok(auditAfterNull.tickCount > 0);

assert.equal(director.dispose(), true);
assert.equal(director.tick({ deltaSeconds: 0.25 }).accepted, false);
assert.equal(director.audit().ok, false);
assert.equal(director.audit().disposed, true);
assert.equal(director.dispose(), true);

console.log(JSON.stringify({
  ok: true,
  digest: digestA,
  actorUpdates: { guard: guard.updates, wolf: wolf.updates },
  boundedActors: bounded.actorsUpdated,
  faunaPlans: first.fauna.length,
  eventReceipts: first.events.receipts.length,
  rejectionCases: 4,
  deltaBoundaryCases: caps.length,
  disposedRejected: true,
}));
