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
if (!receipt.changed || !receipt.weaponChanged || !receipt.animation.hardReset) {
  throw new Error('live weapon transition did not require hard reset');
}
if (!isPlayerEquipmentTransitionReceipt(receipt) || !validatePlayerEquipmentTransitionReceipt(receipt).ok) {
  throw new Error('live hard-reset receipt was not valid');
}

const tampered = {
  ...receipt,
  animation: Object.freeze({ ...receipt.animation, hardReset: false }),
};
if (isPlayerEquipmentTransitionReceipt(tampered)) throw new Error('shape guard accepted hard-reset drift');
const validation = validatePlayerEquipmentTransitionReceipt(tampered);
if (validation.ok || !validation.errors.includes('hard-reset-flag-mismatch')) {
  throw new Error(`hard-reset drift was not diagnosed: ${validation.errors.join(',')}`);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-director-hard-reset-semantics',
  liveHardReset: receipt.animation.hardReset,
  tamperRejected: true,
}));
