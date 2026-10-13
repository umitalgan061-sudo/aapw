import assert from 'node:assert/strict';
import {
  isPlayerEquipmentTransitionReceipt,
  resolvePlayerEquipmentTransitionReceipt,
  validatePlayerEquipmentTransitionReceipt,
} from '../src/3d/gameplay/playerEquipmentTransitionDirector.ts';

const receipt = resolvePlayerEquipmentTransitionReceipt({
  previousEquipment: { mainHand: { id: 'arming-sword' }, chest: { id: 'cloth' } },
  nextEquipment: { mainHand: { id: 'arming-sword' }, chest: { id: 'cloth' } },
  movementState: 'idle',
  attackKind: 'none',
  grounded: true,
});

assert.equal(receipt.changed, false);
assert.equal(receipt.animation.preserveLocomotion, true);
assert.equal(receipt.animation.hardReset, false);
assert.equal(receipt.animation.crossfadeSeconds, 0);
assert.equal(isPlayerEquipmentTransitionReceipt(receipt), true);
assert.deepEqual(validatePlayerEquipmentTransitionReceipt(receipt), { ok: true, errors: [] });

const tampered = structuredClone(receipt);
tampered.animation.preserveLocomotion = false;
Object.freeze(tampered.animation);
Object.freeze(tampered.changedSlots);
Object.freeze(tampered.socketsToRefresh);
Object.freeze(tampered);

assert.equal(isPlayerEquipmentTransitionReceipt(tampered), false);
assert.equal(validatePlayerEquipmentTransitionReceipt(tampered).ok, false);
assert.ok(validatePlayerEquipmentTransitionReceipt(tampered).errors.includes('receipt-not-frozen-or-shaped'));

console.log('Player equipment transition locomotion semantics: PASS');
