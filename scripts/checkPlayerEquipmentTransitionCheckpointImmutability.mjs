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
if (!Object.isFrozen(checkpoint.changedSlots) || !Object.isFrozen(checkpoint.socketsToRefresh)) {
  throw new Error('checkpoint slot arrays must be frozen');
}
if (!validatePlayerEquipmentTransitionCheckpoint(checkpoint).ok) throw new Error('baseline checkpoint must validate');

const mutableSlots = {
  ...checkpoint,
  changedSlots: [...checkpoint.changedSlots],
};
const mutableSlotsResult = validatePlayerEquipmentTransitionCheckpoint(mutableSlots);
if (mutableSlotsResult.ok || !mutableSlotsResult.errors.includes('changed-slots-not-frozen')) {
  throw new Error('mutable changedSlots array was accepted');
}

const mutableRefreshes = {
  ...checkpoint,
  socketsToRefresh: [...checkpoint.socketsToRefresh],
};
const mutableRefreshResult = validatePlayerEquipmentTransitionCheckpoint(mutableRefreshes);
if (mutableRefreshResult.ok || !mutableRefreshResult.errors.includes('refresh-slots-not-frozen')) {
  throw new Error('mutable socketsToRefresh array was accepted');
}

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-checkpoint-immutability',
  frozenChangedSlots: true,
  frozenRefreshSlots: true,
  mutableNestedArraysRejected: true,
}));
