import assert from 'node:assert/strict';
import { createLivingWorldFaunaPerceptionPolicy } from '../src/3d/gameplay/livingWorldFaunaPerceptionPolicy.js';
import { createLivingWorldFaunaPerceptionMemoryPolicy } from '../src/3d/gameplay/livingWorldFaunaPerceptionMemoryPolicy.js';

const perception = createLivingWorldFaunaPerceptionPolicy();
const memory = createLivingWorldFaunaPerceptionMemoryPolicy({ retentionSeconds: 6, decayPerSecond: 0.1 });

const first = perception.evaluate({
  actors: [{ id: 'wolf-1', position: { x: 0, y: 0, z: 0 }, headingDegrees: 90, lineOfSight: true }],
  stimuli: [{ id: 'traveller', type: 'actor', sourceId: 'player', position: { x: 8, y: 0, z: 0 }, intensity: 1, channel: 'vision' }],
  nowSeconds: 1,
});
const acquired = memory.project({ perception: first, nowSeconds: 1 });
assert.equal(acquired.memories.length, 1);
assert.equal(acquired.memories[0].response, 'engage');

const retained = memory.project({ perception: { observations: [] }, nowSeconds: 3 });
assert.equal(retained.memories.length, 1);
assert.equal(retained.memories[0].ageSeconds, 2);
assert.equal(retained.memories[0].score < acquired.memories[0].score, true);
assert.equal(retained.memories[0].response, 'investigate');

const expired = memory.project({ perception: { observations: [] }, nowSeconds: 8 });
assert.equal(expired.memories.length, 0);

memory.reset();
assert.equal(memory.project({ perception: { observations: [] }, nowSeconds: 8 }).memories.length, 0);
memory.dispose();
assert.throws(() => memory.project({ perception: { observations: [] }, nowSeconds: 9 }), /disposed/);

console.log('Safak Kartali fauna perception memory policy proof: PASS');
