import {
  isPlayerEquipmentTransitionReceipt,
  resolvePlayerEquipmentTransitionReceipt,
  validatePlayerEquipmentTransitionReceipt,
} from '../src/3d/gameplay/playerEquipmentTransitionDirector.ts';
import { resolvePlayerEquipmentCombatProfile } from '../src/3d/gameplay/playerEquipmentCombatProfile.ts';

const previousEquipment = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'arming-sword' },
  offHand: { id: 'buckler' },
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
});
const nextEquipment = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'greatsword' },
  offHand: null,
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
});
const receipt = resolvePlayerEquipmentTransitionReceipt({ previousEquipment, nextEquipment });
if (!isPlayerEquipmentTransitionReceipt(receipt)) throw new Error('live receipt shape invalid');
if (!validatePlayerEquipmentTransitionReceipt(receipt).ok) throw new Error('live receipt validation failed');
if (receipt.changedSlots.join(',') !== receipt.socketsToRefresh.join(',')) throw new Error('live socket refresh order is not canonical');

const reordered = {
  ...receipt,
  changedSlots: Object.freeze([...receipt.changedSlots].reverse()),
  socketsToRefresh: Object.freeze([...receipt.socketsToRefresh].reverse()),
};
if (isPlayerEquipmentTransitionReceipt(reordered)) throw new Error('shape guard accepted reordered socket receipt');
const reorderedValidation = validatePlayerEquipmentTransitionReceipt(reordered);
if (reorderedValidation.ok || !reorderedValidation.errors.includes('changed-slot-order-noncanonical')) {
  throw new Error(`reordered socket receipt was not rejected: ${reorderedValidation.errors.join(',')}`);
}

const missingRefresh = {
  ...receipt,
  socketsToRefresh: Object.freeze(receipt.socketsToRefresh.slice(0, -1)),
};
if (isPlayerEquipmentTransitionReceipt(missingRefresh)) throw new Error('shape guard accepted missing socket refresh');
const missingValidation = validatePlayerEquipmentTransitionReceipt(missingRefresh);
if (missingValidation.ok || !missingValidation.errors.includes('changed-slot-refresh-count-mismatch')) {
  throw new Error(`missing socket refresh was not rejected: ${missingValidation.errors.join(',')}`);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-director-socket-refresh-semantics',
  canonicalOrder: receipt.changedSlots,
  reorderedRejected: true,
  missingRefreshRejected: true,
}));
