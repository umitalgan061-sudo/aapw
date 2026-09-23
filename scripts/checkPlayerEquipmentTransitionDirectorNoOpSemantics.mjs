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
  comboStep: 3,
  speedMps: 5.2,
  grounded: true,
});

const failures = [];
if (!receipt.changed) {
  if (receipt.animation.action !== 'idle') failures.push('noop-action-not-idle');
  if (receipt.animation.preserveLocomotion !== true) failures.push('noop-locomotion-not-preserved');
  if (receipt.animation.compatible !== true) failures.push('noop-animation-incompatible');
  if (receipt.animation.hardReset !== false) failures.push('noop-animation-hard-reset');
  if (receipt.animation.crossfadeSeconds !== 0) failures.push('noop-crossfade-not-zero');
}
if (!isPlayerEquipmentTransitionReceipt(receipt)) failures.push('noop-receipt-shape-invalid');
const validation = validatePlayerEquipmentTransitionReceipt(receipt);
if (!validation.ok) failures.push(`noop-receipt-validation-failed:${validation.errors.join(',')}`);

const tamperedAction = {
  ...receipt,
  animation: Object.freeze({ ...receipt.animation, action: 'heavy' }),
};
if (isPlayerEquipmentTransitionReceipt(tamperedAction)) failures.push('shape-guard-accepted-noop-action-drift');
if (validatePlayerEquipmentTransitionReceipt(tamperedAction).ok) failures.push('validator-accepted-noop-action-drift');

const tamperedLocomotion = {
  ...receipt,
  animation: Object.freeze({ ...receipt.animation, preserveLocomotion: false }),
};
if (isPlayerEquipmentTransitionReceipt(tamperedLocomotion)) failures.push('shape-guard-accepted-noop-locomotion-drift');
if (validatePlayerEquipmentTransitionReceipt(tamperedLocomotion).ok) failures.push('validator-accepted-noop-locomotion-drift');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-director-noop-semantics',
  noOpAction: receipt.animation.action,
  preserveLocomotion: receipt.animation.preserveLocomotion,
  tamperRejected: true,
}));
