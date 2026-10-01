import {
  resolvePlayerEquipmentSocketAttachmentPlan,
  validatePlayerEquipmentSocketAttachmentPlan,
} from '../src/3d/gameplay/playerEquipmentSocketAttachmentPlan.ts';

const makeCheckpoint = (socketsToRefresh, changedSlots) => Object.freeze({
  changed: true,
  changedSlots: Object.freeze(changedSlots),
  socketsToRefresh: Object.freeze(socketsToRefresh),
  transitionKey: 'equip:mainHand:arming-sword->greatsword|offHand:buckler->none',
  preserveLocomotion: true,
  animationAction: 'equip-mainHand',
});

const first = resolvePlayerEquipmentSocketAttachmentPlan(
  makeCheckpoint(['offHand', 'mainHand'], ['mainHand', 'offHand']),
);
const second = resolvePlayerEquipmentSocketAttachmentPlan(
  makeCheckpoint(['mainHand', 'offHand'], ['mainHand', 'offHand']),
);

if (!validatePlayerEquipmentSocketAttachmentPlan(first).ok) throw new Error('first deterministic plan rejected');
if (!validatePlayerEquipmentSocketAttachmentPlan(second).ok) throw new Error('second deterministic plan rejected');
if (first.planKey !== second.planKey) throw new Error('plan key changed with runtime socket order');
if (JSON.stringify(first.operations) !== JSON.stringify(second.operations)) throw new Error('operation order changed with runtime socket order');
if (first.changedSlots.join(',') !== 'mainHand,offHand') throw new Error('changed slot order is not canonical');

const tampered = Object.freeze({
  ...second,
  planKey: `${second.planKey}|runtime-order-tamper`,
});
const tamperedResult = validatePlayerEquipmentSocketAttachmentPlan(tampered);
if (tamperedResult.ok || !tamperedResult.errors.includes('plan-key-mismatch')) throw new Error('tampered deterministic key accepted');

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-socket-attachment-plan-determinism',
  planKey: first.planKey,
  operations: first.operations,
  tamperRejected: true,
}));
