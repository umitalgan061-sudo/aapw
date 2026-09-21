import { resolvePlayerEquipmentTransitionReceipt, isPlayerEquipmentTransitionReceipt } from '../src/3d/gameplay/playerEquipmentTransitionDirector.ts';

const failures = [];
const base = {
  mainHand: { id: 'iron-sword', family: 'sword', damageMultiplier: 1, reachMultiplier: 1, poiseMultiplier: 1, projectile: false },
  offHand: { id: 'buckler', family: 'shield', damageMultiplier: 0.4, reachMultiplier: 0.8, poiseMultiplier: 0.8, projectile: false },
  chest: { id: 'leather', family: 'light', movementMultiplier: 1, staminaDrainMultiplier: 1, poiseBonus: 0 },
  head: { id: 'hood', family: 'cloth' },
  back: { id: 'empty', family: 'none' },
};
const bow = {
  ...base,
  mainHand: { id: 'hunter-bow', family: 'bow', damageMultiplier: 1.2, reachMultiplier: 1.1, poiseMultiplier: 0.9, projectile: true },
  offHand: { id: 'empty', family: 'none', damageMultiplier: 0, reachMultiplier: 0, poiseMultiplier: 0, projectile: false },
};

const receipt = resolvePlayerEquipmentTransitionReceipt({
  previousEquipment: base,
  nextEquipment: bow,
  movementState: 'sprint',
  attackKind: 'light',
  comboStep: 2,
  speedMps: 5.2,
  grounded: true,
});

if (!isPlayerEquipmentTransitionReceipt(receipt)) failures.push('receipt-shape-invalid');
if (!receipt.changed || !receipt.weaponChanged || !receipt.rangedChanged || !receipt.handednessChanged) failures.push('weapon-transition-flags-invalid');
if (!receipt.changedSlots.includes('mainHand') || !receipt.changedSlots.includes('offHand')) failures.push('changed-slots-missing');
if (!receipt.socketsToRefresh.includes('mainHand') || !receipt.socketsToRefresh.includes('offHand')) failures.push('socket-refresh-missing');
if (!receipt.animation.hardReset) failures.push('hard-reset-not-required');
if (receipt.animation.crossfadeSeconds <= 0) failures.push('crossfade-not-positive');
if (!Object.isFrozen(receipt) || !Object.isFrozen(receipt.animation) || !Object.isFrozen(receipt.changedSlots)) failures.push('deep-freeze-missing');
const replay = resolvePlayerEquipmentTransitionReceipt({
  previousEquipment: base,
  nextEquipment: bow,
  movementState: 'sprint',
  attackKind: 'light',
  comboStep: 2,
  speedMps: 5.2,
  grounded: true,
});
if (JSON.stringify(receipt) !== JSON.stringify(replay)) failures.push('non-deterministic-replay');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, suite: 'player-equipment-transition-director-runtime', changedSlots: receipt.changedSlots, transitionKey: receipt.transitionKey }));
