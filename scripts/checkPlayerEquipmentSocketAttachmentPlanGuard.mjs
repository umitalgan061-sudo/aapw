import {
  isPlayerEquipmentSocketAttachmentPlan,
  resolvePlayerEquipmentSocketAttachmentPlan,
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

const plan = resolvePlayerEquipmentSocketAttachmentPlan(
  resolvePlayerEquipmentTransitionCheckpoint({ previousEquipment: previous, nextEquipment: next }),
);
if (!isPlayerEquipmentSocketAttachmentPlan(plan)) throw new Error('valid socket plan guard rejected plan');

const tampered = Object.freeze({
  ...plan,
  planKey: `${plan.planKey}|tampered`,
});
if (isPlayerEquipmentSocketAttachmentPlan(tampered)) throw new Error('socket plan guard accepted tampered plan');

const malformed = { changed: true, operations: [] };
if (isPlayerEquipmentSocketAttachmentPlan(malformed)) throw new Error('socket plan guard accepted malformed plan');

console.log(JSON.stringify({ ok: true, suite: 'player-equipment-socket-attachment-plan-guard', validAccepted: true, tamperedRejected: true, malformedRejected: true }));
