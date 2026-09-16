import assert from 'node:assert/strict';
import {
  createLivingWorldDirector,
  directorDigest,
  auditDirectorPolicy,
  LIVING_WORLD_DIRECTOR_POLICY,
} from '../src/3d/gameplay/livingWorldDirectorRuntimeAdapter.js';

const published = [];
const makeController = (id, x, z, state = 'patrol') => ({
  id,
  state,
  object3D: { position: { x, z }, userData: {} },
  updates: 0,
  update(delta) {
    assert.ok(Number.isFinite(delta));
    this.updates += 1;
  },
});

const npc = makeController('guard-01', 4, 2);
const wolf = makeController('wolf-01', 26, 8, 'roam');
const dragon = makeController('dragon-01', 72, 18, 'flee');

const director = createLivingWorldDirector({
  seed: 424242,
  worldEventPublisher: (event) => {
    published.push(event);
    return { accepted: true, id: event?.id ?? 'event' };
  },
});

const input = {
  deltaSeconds: 0.5,
  collections: { npcs: [npc], animals: [wolf], dragons: [dragon] },
  playerPosition: { x: 0, z: 0 },
  faunaRequests: [
    {
      species: 'wolf',
      centerX: 26,
      centerZ: 8,
      radiusMeters: 24,
      seed: 7,
      context: { biome: 'forest', waterDepth: 0, slope: 0.12, habitat: 'woodland' },
    },
  ],
  eventContext: { biome: 'forest', weather: 'clear', population: 3 },
  eventTypes: ['ambient-wildlife'],
};

const first = director.tick(input);
assert.equal(first.accepted, true);
assert.equal(first.actorsUpdated, 3);
assert.equal(npc.updates, 1);
assert.equal(wolf.updates, 1);
assert.equal(dragon.updates, 1);
assert.ok(Array.isArray(first.fauna));
assert.equal(first.fauna.length, 1);
assert.equal(first.policyId, LIVING_WORLD_DIRECTOR_POLICY.id);
assert.equal(auditDirectorPolicy(first).ok, true);
assert.equal(published.length, first.events.receipts.length);

const firstDigest = directorDigest(first);
director.reset();
const replay = director.tick(input);
assert.equal(directorDigest(replay), firstDigest);
assert.equal(auditDirectorPolicy(replay).ok, true);

const disposed = director.dispose();
assert.equal(disposed, true);
const rejected = director.tick(input);
assert.deepEqual(rejected, { accepted: false, reason: 'disposed' });

console.log(JSON.stringify({
  contract: 'safak-kartali-director-runtime-vertical-slice-v2',
  digest: firstDigest,
  actorsUpdated: first.actorsUpdated,
  faunaPlans: first.fauna.length,
  eventReceipts: first.events.receipts.length,
  policyId: first.policyId,
  disposedRejected: true,
}));
