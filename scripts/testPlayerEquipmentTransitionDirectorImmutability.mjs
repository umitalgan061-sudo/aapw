import {
  isPlayerEquipmentTransitionReceipt,
  resolvePlayerEquipmentTransitionReceipt,
  validatePlayerEquipmentTransitionReceipt,
} from '../src/3d/gameplay/playerEquipmentTransitionDirector.ts';
import { resolvePlayerEquipmentCombatProfile } from '../src/3d/gameplay/playerEquipmentCombatProfile.ts';

const previous = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'arming-sword' },
  offHand: { id: 'buckler' },
  chest: { id: 'leather' },
});
const next = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'longsword' },
  offHand: { id: 'buckler' },
  chest: { id: 'mail' },
});
const receipt = resolvePlayerEquipmentTransitionReceipt({
  previousEquipment: previous,
  nextEquipment: next,
  movementState: 'locomotion',
  attackKind: 'light',
  comboStep: 1,
  speedMps: 2.4,
  grounded: true,
});

if (!isPlayerEquipmentTransitionReceipt(receipt)) throw new Error('live changed receipt rejected');
if (!validatePlayerEquipmentTransitionReceipt(receipt).ok) throw new Error('live changed receipt failed validation');
if (!Object.isFrozen(receipt) || !Object.isFrozen(receipt.animation) || !Object.isFrozen(receipt.changedSlots) || !Object.isFrozen(receipt.socketsToRefresh)) {
  throw new Error('receipt graph is not deeply frozen');
}

const before = JSON.stringify(receipt);
let mutationBlocked = 0;
for (const mutate of [
  () => { receipt.animation.action = 'tampered'; },
  () => { receipt.changedSlots.push('head'); },
  () => { receipt.socketsToRefresh.push('head'); },
]) {
  try {
    mutate();
  } catch {
    mutationBlocked += 1;
  }
}
if (mutationBlocked !== 3) throw new Error(`expected 3 blocked mutations, got ${mutationBlocked}`);
if (JSON.stringify(receipt) !== before) throw new Error('receipt changed after blocked mutation attempts');
if (!isPlayerEquipmentTransitionReceipt(receipt)) throw new Error('receipt lost validity after mutation attempts');
if (!validatePlayerEquipmentTransitionReceipt(receipt).ok) throw new Error('receipt failed validation after mutation attempts');

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-director-immutability',
  deeplyFrozen: true,
  mutationAttemptsBlocked: mutationBlocked,
  stableAfterMutationAttempts: true,
}));
