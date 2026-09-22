import {
  isPlayerEquipmentTransitionReceipt,
  resolvePlayerEquipmentTransitionReceipt,
  validatePlayerEquipmentTransitionReceipt,
} from '../src/3d/gameplay/playerEquipmentTransitionDirector.ts';
import { resolvePlayerEquipmentCombatProfile } from '../src/3d/gameplay/playerEquipmentCombatProfile.ts';

const failures = [];
const baseSlots = {
  mainHand: { id: 'arming-sword' },
  offHand: { id: 'buckler' },
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
};
const bowSlots = {
  ...baseSlots,
  mainHand: { id: 'bow' },
  offHand: null,
};
const base = resolvePlayerEquipmentCombatProfile(baseSlots);
const bow = resolvePlayerEquipmentCombatProfile(bowSlots);

const input = {
  previousEquipment: base,
  nextEquipment: bow,
  movementState: 'sprint',
  attackKind: 'light',
  comboStep: 2,
  speedMps: 5.2,
  grounded: true,
};
const receipt = resolvePlayerEquipmentTransitionReceipt(input);

if (!isPlayerEquipmentTransitionReceipt(receipt)) failures.push('receipt-shape-invalid');
if (!validatePlayerEquipmentTransitionReceipt(receipt).ok) failures.push('receipt-validation-failed');
if (!receipt.changed || !receipt.weaponChanged || !receipt.rangedChanged || !receipt.handednessChanged) failures.push('weapon-transition-flags-invalid');
if (!receipt.changedSlots.includes('mainHand') || !receipt.changedSlots.includes('offHand')) failures.push('changed-slots-missing');
if (!receipt.socketsToRefresh.includes('mainHand') || !receipt.socketsToRefresh.includes('offHand')) failures.push('socket-refresh-missing');
if (!receipt.animation.hardReset) failures.push('hard-reset-not-required');
if (receipt.animation.crossfadeSeconds <= 0) failures.push('crossfade-not-positive');
if (!Object.isFrozen(receipt) || !Object.isFrozen(receipt.animation) || !Object.isFrozen(receipt.changedSlots) || !Object.isFrozen(receipt.socketsToRefresh)) failures.push('deep-freeze-missing');

const replay = resolvePlayerEquipmentTransitionReceipt(input);
if (JSON.stringify(receipt) !== JSON.stringify(replay)) failures.push('non-deterministic-replay');

const noOp = resolvePlayerEquipmentTransitionReceipt({ previousEquipment: base, nextEquipment: base });
if (noOp.changed || noOp.changedSlots.length !== 0 || !validatePlayerEquipmentTransitionReceipt(noOp).ok) failures.push('no-op-transition-invalid');

const tampered = { ...receipt, changed: false };
if (validatePlayerEquipmentTransitionReceipt(tampered).ok) failures.push('tampered-receipt-accepted');

const malformed = {
  ...receipt,
  animation: { ...receipt.animation, compatible: 'yes' },
};
if (validatePlayerEquipmentTransitionReceipt(malformed).ok) failures.push('malformed-animation-accepted');

const malformedShape = { changed: true };
let malformedShapeThrew = false;
try {
  if (validatePlayerEquipmentTransitionReceipt(malformedShape).ok) failures.push('malformed-shape-accepted');
} catch {
  malformedShapeThrew = true;
}
if (malformedShapeThrew) failures.push('malformed-shape-threw');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, suite: 'player-equipment-transition-director-runtime', changedSlots: receipt.changedSlots, transitionKey: receipt.transitionKey }));
