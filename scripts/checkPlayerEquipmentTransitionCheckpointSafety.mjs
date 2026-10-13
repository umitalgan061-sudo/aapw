import {
  resolvePlayerEquipmentTransitionCheckpoint,
  validatePlayerEquipmentTransitionCheckpoint,
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
if (!validatePlayerEquipmentTransitionCheckpoint(checkpoint).ok) throw new Error('baseline checkpoint must validate');

const badKey = Object.freeze({
  ...checkpoint,
  transitionKey: `${checkpoint.transitionKey}|tampered`,
});
const badKeyResult = validatePlayerEquipmentTransitionCheckpoint(badKey);
if (badKeyResult.ok || !badKeyResult.errors.includes('transition-key-mismatch')) throw new Error('tampered transition key was accepted');

const badRefreshOrder = Object.freeze({
  ...checkpoint,
  socketsToRefresh: Object.freeze([...checkpoint.socketsToRefresh].reverse()),
});
const badRefreshResult = validatePlayerEquipmentTransitionCheckpoint(badRefreshOrder);
if (badRefreshResult.ok || !badRefreshResult.errors.includes('refresh-slot-order')) throw new Error('tampered refresh order was accepted');

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-checkpoint-safety',
  baselineChangedSlots: checkpoint.changedSlots,
  transitionKeyTamperRejected: true,
  refreshOrderTamperRejected: true,
}));
