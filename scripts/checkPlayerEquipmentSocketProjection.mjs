import assert from 'node:assert/strict';
import { projectPlayerEquipmentSockets, validatePlayerEquipmentSocketProjection } from '../src/3d/gameplay/playerEquipmentSocketProjection.js';

const input = {
  activeSocket: 'weapon',
  grounded: true,
  placementConfidence: 0.8,
  items: [
    { id: 'sword', slot: 'weapon', priority: 2, weight: 0.3, materialRecipe: 'weapon-steel' },
    { id: 'axe', socket: 'main-hand', priority: 1, weight: 0.8 },
    { id: 'boots', slot: 'boots', priority: 1 }
  ]
};

const projection = projectPlayerEquipmentSockets(input);
assert.equal(validatePlayerEquipmentSocketProjection(projection), true);
assert.equal(projection.activeSocket, 'main-hand');
assert.equal(projection.activeItemId, 'sword');
assert.equal(projection.equippedCount, 3);
assert.equal(projection.sockets.find(s => s.socket === 'feet').activeItemId, undefined);
assert.equal(projection.sockets.find(s => s.socket === 'feet').selected.id, 'boots');
assert.equal(Object.isFrozen(projection), true);
assert.equal(Object.isFrozen(projection.sockets), true);
assert.equal(Object.isFrozen(projection.sockets[0]), true);

const malformed = projectPlayerEquipmentSockets({
  placementConfidence: Number.NaN,
  items: [{ id: 'bad', socket: 'unknown', priority: Number.POSITIVE_INFINITY, weight: Number.NaN }]
});
assert.equal(validatePlayerEquipmentSocketProjection(malformed), true);
assert.equal(malformed.sockets.find(s => s.socket === 'chest').selected.id, 'bad');
assert.equal(malformed.sockets.find(s => s.socket === 'chest').selected.priority, 0);
assert.equal(malformed.sockets.find(s => s.socket === 'chest').selected.weight, 0);

const reordered = projectPlayerEquipmentSockets({ ...input, items: [...input.items].reverse() });
assert.deepEqual(JSON.stringify(projection), JSON.stringify(reordered));

console.log('[checkPlayerEquipmentSocketProjection] PASS');
