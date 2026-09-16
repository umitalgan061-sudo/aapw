import assert from 'node:assert/strict';
import { applyEquipmentSocketsToObject3D, resolvePlayerEquipmentSockets } from '../src/3d/gameplay/playerEquipmentSocketResolver.js';

const resolved = resolvePlayerEquipmentSockets([
  { id: 'iron-sword', slot: 'weapon', priority: 1, assetUrl: '/assets/models/props/iron-sword.glb', stats: { attack: 12 } },
  { id: 'oak-shield', slot: 'shield', stats: { armor: 8, poise: 4 } },
  { id: 'better-sword', slot: 'weapon', priority: 2, stats: { attack: 18 } },
  { id: 'broken', slot: 'unknown' },
  { id: 'helm', slot: 'helmet', stats: { armor: 5 } },
]);

assert.equal(resolved.sockets.mainHand.id, 'better-sword');
assert.equal(resolved.sockets.offHand.id, 'oak-shield');
assert.equal(resolved.sockets.head.id, 'helm');
assert.deepEqual(resolved.occupiedSockets, ['head', 'mainHand', 'offHand']);
assert.deepEqual(resolved.totals, { armor: 13, attack: 18, poise: 4 });
assert.equal(resolved.sockets.mainHand.assetUrl, null);

const tied = resolvePlayerEquipmentSockets([
  { id: 'zeta', slot: 'back', priority: 1 },
  { id: 'alpha', slot: 'cloak', priority: 1 },
]);
assert.equal(tied.sockets.back.id, 'alpha');

const attached = [];
const count = applyEquipmentSocketsToObject3D({}, resolved, (_object, socket, item) => attached.push(`${socket}:${item.id}`));
assert.equal(count, 3);
assert.deepEqual(attached, ['head:helm', 'mainHand:better-sword', 'offHand:oak-shield']);

assert.equal(applyEquipmentSocketsToObject3D(null, resolved), 0);
console.log('player equipment socket resolver: PASS');
