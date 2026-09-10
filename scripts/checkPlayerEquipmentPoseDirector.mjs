import assert from 'node:assert/strict';
import {
  resolvePlayerEquipmentPose,
  applyPlayerEquipmentPose,
  serializePlayerEquipmentPose,
} from '../src/3d/gameplay/playerEquipmentPoseDirector.js';

const input = {
  locomotionFamily: 'medium',
  items: [
    { id: 'arming sword', slot: 'mainHand', socket: 'RightHand', weight: 12 },
    { id: 'round shield', slot: 'offHand', socket: 'LeftHand', weight: 18 },
    { id: 'cape', slot: 'back', weight: 4 },
    { id: 'duplicate sword', slot: 'mainHand', weight: 99 },
  ],
};
const first = resolvePlayerEquipmentPose(input);
const second = resolvePlayerEquipmentPose(input);
assert.equal(first.occupied.mainHand.id, 'arming-sword');
assert.equal(first.occupied.offHand.id, 'round-shield');
assert.equal(first.occupied.back.id, 'cape');
assert.equal(first.occupiedCount, 3);
assert.deepEqual(first, second);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.items), true);
assert.equal(first.totalWeight, 133);
assert.equal(serializePlayerEquipmentPose(first), serializePlayerEquipmentPose(second));

const malformed = resolvePlayerEquipmentPose({ items: [{ id: null, slot: '??', weight: 'oops' }] });
assert.equal(malformed.items[0].slot, 'head');
assert.equal(malformed.items[0].weight, 0);
assert.equal(malformed.items[0].id, 'item-1');

const target = {};
assert.equal(applyPlayerEquipmentPose(target, first), true);
assert.equal(target.playerEquipmentPose, first);
assert.equal(applyPlayerEquipmentPose(null, first), false);

console.log(`PLAYER_EQUIPMENT_POSE_DIRECTOR_OK items=${first.items.length} occupied=${first.occupiedCount} weight=${first.totalWeight}`);
