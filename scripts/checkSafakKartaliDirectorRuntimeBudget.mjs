import assert from 'node:assert/strict';

const { createLivingWorldDirector } = await import('../src/3d/gameplay/livingWorldDirectorRuntimeAdapter.js');

function actor(id, x, z, calls) {
  return {
    id,
    object3D: { position: { x, z }, userData: {} },
    update(deltaSeconds) {
      calls.push({ id, deltaSeconds });
    },
  };
}

const calls = [];
const close = actor('close', 1, 1, calls);
const mid = actor('mid', 20, 20, calls);
const far = actor('far', 100, 100, calls);
const director = createLivingWorldDirector({ seed: 77 });

const snapshot = director.tick({
  deltaSeconds: 1,
  playerPosition: { x: 0, z: 0 },
  collections: { npcs: [far, mid, close] },
  eventContext: { biome: 'forest', weather: 'clear', threat: 0.2 },
});

assert.equal(snapshot.accepted, true);
assert.equal(snapshot.actorsUpdated, 3);
assert.deepEqual(calls.map((entry) => entry.id), ['close', 'mid', 'far']);
assert.ok(calls.every((entry) => entry.deltaSeconds === 0.25));

calls.length = 0;
const many = Array.from({ length: 140 }, (_, index) => actor(`npc-${String(index).padStart(3, '0')}`, index, index, calls));
const capped = director.tick({
  deltaSeconds: 0.1,
  playerPosition: { x: 0, z: 0 },
  collections: { npcs: many },
});
assert.equal(capped.actorsUpdated, 128);
assert.equal(calls.length, 128);
assert.equal(new Set(calls.map((entry) => entry.id)).size, 128);

const beforeDispose = director.audit();
assert.equal(beforeDispose.ok, true);
director.dispose();
const afterDispose = director.tick({ deltaSeconds: 0.1, collections: { npcs: [close] } });
assert.deepEqual(afterDispose, { accepted: false, reason: 'disposed' });

console.log(JSON.stringify({
  ok: true,
  boundedActors: capped.actorsUpdated,
  orderedUpdateIds: ['close', 'mid', 'far'],
  deltaClampSeconds: calls.length ? 0.1 : 0,
  disposedFailClosed: true,
}));
