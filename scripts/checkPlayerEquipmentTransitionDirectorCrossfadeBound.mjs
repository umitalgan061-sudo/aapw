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

const boundedTamper = {
  ...receipt,
  animation: Object.freeze({ ...receipt.animation, crossfadeSeconds: 1.5 }),
};
if (isPlayerEquipmentTransitionReceipt(boundedTamper)) throw new Error('shape guard accepted bounded crossfade key tampering');
const boundedValidation = validatePlayerEquipmentTransitionReceipt(boundedTamper);
if (boundedValidation.ok || !boundedValidation.errors.includes('transition-key-mismatch')) {
  throw new Error(`bounded crossfade key tampering was not diagnosed: ${boundedValidation.errors.join(',')}`);
}

const overBound = {
  ...receipt,
  animation: Object.freeze({ ...receipt.animation, crossfadeSeconds: 2.01 }),
};
if (isPlayerEquipmentTransitionReceipt(overBound)) throw new Error('shape guard accepted over-bound crossfade');
const validation = validatePlayerEquipmentTransitionReceipt(overBound);
if (validation.ok || !validation.errors.includes('crossfade-too-long')) {
  throw new Error(`over-bound crossfade was not diagnosed: ${validation.errors.join(',')}`);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-director-crossfade-bound',
  maxCrossfadeSeconds: 2,
  boundedKeyTamperingRejected: true,
  overBoundRejected: true,
}));
