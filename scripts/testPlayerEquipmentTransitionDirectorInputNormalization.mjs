import {
  isPlayerEquipmentTransitionReceipt,
  resolvePlayerEquipmentTransitionReceipt,
  validatePlayerEquipmentTransitionReceipt,
} from '../src/3d/gameplay/playerEquipmentTransitionDirector.ts';
import { resolvePlayerEquipmentCombatProfile } from '../src/3d/gameplay/playerEquipmentCombatProfile.ts';

const equipment = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'arming-sword' },
  offHand: { id: 'buckler' },
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
});

const receipt = resolvePlayerEquipmentTransitionReceipt({
  previousEquipment: equipment,
  nextEquipment: equipment,
  movementState: 'sprint',
  attackKind: 'heavy',
  comboStep: Number.NaN,
  speedMps: Number.POSITIVE_INFINITY,
  grounded: true,
});

if (!isPlayerEquipmentTransitionReceipt(receipt)) throw new Error('normalized receipt failed shape guard');
const validation = validatePlayerEquipmentTransitionReceipt(receipt);
if (!validation.ok) throw new Error(`normalized receipt failed validation: ${validation.errors.join(',')}`);
if (receipt.changed) throw new Error('identical equipment unexpectedly changed');
if (receipt.animation.action !== 'idle') throw new Error(`unexpected normalized no-op action: ${receipt.animation.action}`);
if (receipt.animation.crossfadeSeconds !== 0) throw new Error('normalized no-op crossfade must be zero');
if (receipt.animation.preserveLocomotion !== true) throw new Error('normalized no-op locomotion must be preserved');

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-director-input-normalization',
  nonFiniteInputsNormalized: true,
  noOpAction: receipt.animation.action,
  noOpCrossfadeSeconds: receipt.animation.crossfadeSeconds,
  preserveLocomotion: receipt.animation.preserveLocomotion,
}));
