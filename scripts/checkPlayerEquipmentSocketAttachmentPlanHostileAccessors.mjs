import assert from 'node:assert/strict';
import {
  resolvePlayerEquipmentSocketAttachmentPlan,
  validatePlayerEquipmentSocketAttachmentPlan,
} from '../src/3d/gameplay/playerEquipmentSocketAttachmentPlan.ts';

const checkpoint = Object.freeze({
  changed: true,
  changedSlots: Object.freeze(['mainHand']),
  socketsToRefresh: Object.freeze(['mainHand']),
  transitionKey: 'equip:mainHand:none->sword',
  preserveLocomotion: true,
  animationAction: 'equip-mainHand',
});

const plan = resolvePlayerEquipmentSocketAttachmentPlan(checkpoint);
assert.equal(validatePlayerEquipmentSocketAttachmentPlan(plan).ok, true);

const revoked = Proxy.revocable(plan, {});
revoked.revoke();
const revokedResult = validatePlayerEquipmentSocketAttachmentPlan(revoked.proxy);
assert.equal(revokedResult.ok, false);
assert.ok(revokedResult.errors.includes('plan-not-frozen'));

const hostile = new Proxy(plan, {
  get() {
    throw new Error('hostile accessor');
  },
});
const hostileResult = validatePlayerEquipmentSocketAttachmentPlan(hostile);
assert.equal(hostileResult.ok, false);
assert.ok(hostileResult.errors.includes('invalid-transition-key'));
assert.ok(Object.isFrozen(hostileResult));
assert.ok(Object.isFrozen(hostileResult.errors));

console.log('player equipment socket attachment hostile-accessor proof: ok');
