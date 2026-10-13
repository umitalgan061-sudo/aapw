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

const duplicateSlot = Object.freeze({
  ...plan,
  operations: Object.freeze([
    ...plan.operations,
    Object.freeze({ slot: 'mainHand', operation: 'detach', order: plan.operations.length }),
    Object.freeze({ slot: 'mainHand', operation: 'attach', order: plan.operations.length + 1 }),
  ]),
});
const duplicateResult = validatePlayerEquipmentSocketAttachmentPlan(duplicateSlot);
if (duplicateResult.ok || !duplicateResult.errors.includes('duplicate-slot')) throw new Error('duplicate slot accepted');

const wrongPair = Object.freeze({
  ...plan,
  operations: Object.freeze([
    plan.operations[0],
    Object.freeze({ ...plan.operations[1], slot: 'offHand' }),
    ...plan.operations.slice(2),
  ]),
});
const wrongPairResult = validatePlayerEquipmentSocketAttachmentPlan(wrongPair);
if (wrongPairResult.ok || !wrongPairResult.errors.includes('pair-slot-mismatch')) throw new Error('mismatched pair accepted');

const wrongKey = Object.freeze({ ...plan, planKey: `${plan.planKey}|tampered` });
const wrongKeyResult = validatePlayerEquipmentSocketAttachmentPlan(wrongKey);
if (wrongKeyResult.ok || !wrongKeyResult.errors.includes('plan-key-mismatch')) throw new Error('tampered plan key accepted');

const noop = resolvePlayerEquipmentSocketAttachmentPlan(
  resolvePlayerEquipmentTransitionCheckpoint({ previousEquipment: previous, nextEquipment: previous }),
);
if (!validatePlayerEquipmentSocketAttachmentPlan(noop).ok || noop.operations.length !== 0) throw new Error('noop plan drifted');

console.log(JSON.stringify({ ok: true, suite: 'player-equipment-socket-attachment-plan-invariants', duplicateRejected: true, pairRejected: true, keyRejected: true }));
