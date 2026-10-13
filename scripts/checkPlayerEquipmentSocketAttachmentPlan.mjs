import {
  resolvePlayerEquipmentSocketAttachmentPlan,
  validatePlayerEquipmentSocketAttachmentPlan,
} from '../src/3d/gameplay/playerEquipmentSocketAttachmentPlan.ts';
import {
  resolvePlayerEquipmentTransitionCheckpoint,
} from '../src/3d/gameplay/playerEquipmentTransitionCheckpoint.ts';
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

const checkpoint = resolvePlayerEquipmentTransitionCheckpoint({
  previousEquipment: previous,
  nextEquipment: next,
  movementState: 'sprint',
  attackKind: 'heavy',
  comboStep: 2,
  speedMps: 5,
  grounded: true,
});
const plan = resolvePlayerEquipmentSocketAttachmentPlan(checkpoint);
if (!plan.changed || plan.operations.map(({ slot, operation }) => `${slot}:${operation}`).join(',') !== 'mainHand:detach,mainHand:attach,offHand:detach,offHand:attach') {
  throw new Error('socket operations were not canonical');
}
if (!plan.preserveLocomotion || plan.animationAction !== checkpoint.animationAction) throw new Error('animation semantics drifted');
if (!validatePlayerEquipmentSocketAttachmentPlan(plan).ok) throw new Error('valid socket plan rejected');
if (!Object.isFrozen(plan.operations) || !Object.isFrozen(plan.operations[0])) throw new Error('socket plan must be deeply frozen');

const noop = resolvePlayerEquipmentTransitionCheckpoint({ previousEquipment: previous, nextEquipment: previous });
const noopPlan = resolvePlayerEquipmentSocketAttachmentPlan(noop);
if (noopPlan.changed || noopPlan.operations.length !== 0 || !validatePlayerEquipmentSocketAttachmentPlan(noopPlan).ok) {
  throw new Error('no-op socket plan semantics drifted');
}

const tampered = Object.freeze({
  ...plan,
  operations: Object.freeze([
    plan.operations[0],
    Object.freeze({ ...plan.operations[1], operation: 'detach' }),
    ...plan.operations.slice(2),
  ]),
});
const tamperedResult = validatePlayerEquipmentSocketAttachmentPlan(tampered);
if (tamperedResult.ok || !tamperedResult.errors.includes('operation-order')) throw new Error('tampered operation order was accepted');

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-socket-attachment-plan',
  operations: plan.operations,
  tamperRejected: true,
}));
