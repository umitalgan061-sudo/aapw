import assert from 'node:assert/strict';
import {
  buildPlayerEquipmentLoadout,
  serializePlayerEquipmentLoadout
} from '../src/3d/gameplay/playerEquipmentLoadoutDirector.js';

const sample = {
  items: [
    { id: 'sword', socket: 'mainHand', assetKey: 'weapons/sword.glb', stats: { damage: 18, weight: 6 } },
    { id: 'shield', socket: 'offHand', assetKey: 'weapons/shield.glb', stats: { armor: 12, poise: 5, weight: 8 } },
    { id: 'duplicate', socket: 'mainHand', stats: { damage: 99 } },
    { id: 'bad-socket', socket: 'back', stats: { damage: 1 } }
  ]
};

const first = buildPlayerEquipmentLoadout(sample);
const second = buildPlayerEquipmentLoadout(sample);
assert.deepEqual(first, second);
assert.equal(first.slots.find((slot) => slot.socket === 'mainHand').item.id, 'sword');
assert.equal(first.rejected.length, 2);
assert.equal(first.totals.damage, 18);
assert.equal(first.totals.armor, 12);
assert.equal(first.assetReadiness, 1);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.slots[0]), true);
assert.equal(serializePlayerEquipmentLoadout(first), serializePlayerEquipmentLoadout(second));

const malformed = buildPlayerEquipmentLoadout({ items: [{ id: 7, stats: { armor: Infinity, damage: -4 } }] });
assert.equal(malformed.totals.armor, 0);
assert.equal(malformed.totals.damage, 0);
assert.equal(malformed.rejected[0].reason, 'unknown-socket');

console.log('player equipment loadout director: PASS');
