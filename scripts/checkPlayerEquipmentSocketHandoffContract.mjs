import assert from 'node:assert/strict';
import { buildPlayerEquipmentSocketHandoff, validatePlayerEquipmentSocketHandoff, serializePlayerEquipmentSocketHandoff } from '../src/3d/gameplay/playerEquipmentSocketHandoffContract.js';
const input = { items: [
  { id: 'shield', slot: 'offHand', ready: true },
  { id: 'sword-b', slot: 'mainHand', ready: true },
  { id: 'sword-a', slot: 'mainHand', ready: true },
  { id: 'cape', slot: 'back', ready: false },
] };
const a = buildPlayerEquipmentSocketHandoff(input);
const b = buildPlayerEquipmentSocketHandoff(input);
assert.deepEqual(a, b);
assert.equal(a.equipped.length, 3);
assert.deepEqual(a.rejectedItemIds, ['sword-b']);
assert.equal(a.equipped.find((row) => row.id === 'sword-a').socket, 'mixamorigRightHand');
assert.equal(validatePlayerEquipmentSocketHandoff(a).valid, true);
assert.equal(serializePlayerEquipmentSocketHandoff(a), serializePlayerEquipmentSocketHandoff(b));
assert.throws(() => a.equipped.push({}), TypeError);
console.log(JSON.stringify({ checks: 7, occupied: a.occupiedSocketCount, rejected: a.rejectedItemIds }));
