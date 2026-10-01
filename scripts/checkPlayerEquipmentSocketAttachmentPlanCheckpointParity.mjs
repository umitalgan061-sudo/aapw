import {
  resolvePlayerEquipmentSocketAttachmentPlan,
  validatePlayerEquipmentSocketAttachmentPlan,
} from '../src/3d/gameplay/playerEquipmentSocketAttachmentPlan.ts';
import { resolvePlayerEquipmentTransitionCheckpoint } from '../src/3d/gameplay/playerEquipmentTransitionCheckpoint.ts';
import { resolvePlayerEquipmentCombatProfile } from '../src/3d/gameplay/playerEquipmentCombatProfile.ts';

const previous = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'arming-sword' },
  offHand: { id: 'buckler' },
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
});
const next = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'greatsword' },
  offHand: null,
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
});

const checkpoint = resolvePlayerEquipmentTransitionCheckpoint({ previousEquipment: previous, nextEquipment: next });
const plan = resolvePlayerEquipmentSocketAttachmentPlan(checkpoint);
if (!validatePlayerEquipmentSocketAttachmentPlan(plan).ok) throw new Error('baseline plan rejected');
if (plan.changedSlots.join(',') !== checkpoint.changedSlots.join(',')) throw new Error('changed slot provenance drifted');
if (plan.transitionKey !== checkpoint.transitionKey) throw new Error('transition key provenance drifted');
if (plan.operations.filter((_, index) => index % 2 === 0).map(({ slot }) => slot).join(',') !== plan.changedSlots.join(',')) {
  throw new Error('operation slots do not match checkpoint changed slots');
}

const tampered = Object.freeze({
  ...plan,
  changedSlots: Object.freeze(['offHand']),
});
const result = validatePlayerEquipmentSocketAttachmentPlan(tampered);
if (result.ok || !result.errors.includes('operation-slots-do-not-match-changes')) throw new Error('changed-slot parity tamper accepted');

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-socket-attachment-plan-checkpoint-parity',
  changedSlots: plan.changedSlots,
  provenance: true,
  tamperRejected: true,
}));
