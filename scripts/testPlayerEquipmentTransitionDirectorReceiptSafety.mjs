import {
  isPlayerEquipmentTransitionReceipt,
  resolvePlayerEquipmentTransitionReceipt,
  validatePlayerEquipmentTransitionReceipt,
} from '../src/3d/gameplay/playerEquipmentTransitionDirector.ts';
import { resolvePlayerEquipmentCombatProfile } from '../src/3d/gameplay/playerEquipmentCombatProfile.ts';

const profile = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'arming-sword' },
  offHand: { id: 'buckler' },
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
});
const receipt = resolvePlayerEquipmentTransitionReceipt({
  previousEquipment: profile,
  nextEquipment: profile,
  movementState: 'sprint',
  attackKind: 'heavy',
  comboStep: 3,
  speedMps: 5.2,
  grounded: true,
});

if (!isPlayerEquipmentTransitionReceipt(receipt)) throw new Error('live no-op receipt rejected');
if (!validatePlayerEquipmentTransitionReceipt(receipt).ok) throw new Error('live no-op receipt failed validation');

const tamperedAction = {
  ...receipt,
  animation: Object.freeze({ ...receipt.animation, action: 'heavy' }),
};
const tamperedLocomotion = {
  ...receipt,
  animation: Object.freeze({ ...receipt.animation, preserveLocomotion: false }),
};

for (const [name, value] of [
  ['no-op action drift', tamperedAction],
  ['no-op locomotion drift', tamperedLocomotion],
]) {
  if (isPlayerEquipmentTransitionReceipt(value)) throw new Error(`shape guard accepted ${name}`);
  const validation = validatePlayerEquipmentTransitionReceipt(value);
  if (validation.ok) throw new Error(`validator accepted ${name}`);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-director-receipt-safety',
  liveNoOpAccepted: true,
  noOpActionDriftRejected: true,
  noOpLocomotionDriftRejected: true,
}));
