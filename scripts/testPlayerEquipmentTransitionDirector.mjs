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
const shieldSwapSlots = {
  ...baseSlots,
  offHand: { id: 'tower-shield' },
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
if (receipt.changedSlots.join(',') !== 'mainHand,offHand') failures.push('changed-slot-order-not-canonical');
if (receipt.socketsToRefresh.join(',') !== 'mainHand,offHand') failures.push('socket-refresh-order-not-canonical');
if (receipt.animation.hardReset !== true) failures.push('hard-reset-not-required');
if (receipt.animation.crossfadeSeconds <= 0) failures.push('crossfade-not-positive');
if (!Object.isFrozen(receipt) || !Object.isFrozen(receipt.animation) || !Object.isFrozen(receipt.changedSlots) || !Object.isFrozen(receipt.socketsToRefresh)) failures.push('deep-freeze-missing');

const replay = resolvePlayerEquipmentTransitionReceipt(input);
if (JSON.stringify(receipt) !== JSON.stringify(replay)) failures.push('non-deterministic-replay');

const noOp = resolvePlayerEquipmentTransitionReceipt({ previousEquipment: base, nextEquipment: base });
if (noOp.changed || noOp.changedSlots.length !== 0 || noOp.socketsToRefresh.length !== 0 || !validatePlayerEquipmentTransitionReceipt(noOp).ok) failures.push('no-op-transition-invalid');

const shieldSwap = resolvePlayerEquipmentTransitionReceipt({ previousEquipment: base, nextEquipment: shieldSwapSlots });
if (!shieldSwap.changed || !shieldSwap.changedSlots.includes('offHand') || !shieldSwap.defenseChanged) failures.push('offhand-defense-transition-flags-invalid');
if (!validatePlayerEquipmentTransitionReceipt(shieldSwap).ok) failures.push('offhand-defense-transition-rejected');

const tampered = { ...receipt, changed: false };
if (isPlayerEquipmentTransitionReceipt(tampered)) failures.push('shape-guard-accepted-tampered-changed-flag');
if (validatePlayerEquipmentTransitionReceipt(tampered).ok) failures.push('tampered-receipt-accepted');

const noOpSemanticTampered = { ...noOp, weaponChanged: true };
if (isPlayerEquipmentTransitionReceipt(noOpSemanticTampered)) failures.push('shape-guard-accepted-noop-semantic-flag');
if (validatePlayerEquipmentTransitionReceipt(noOpSemanticTampered).ok) failures.push('noop-semantic-flag-accepted');

const noOpDeltaTampered = { ...noOp, damageDelta: 1 };
if (isPlayerEquipmentTransitionReceipt(noOpDeltaTampered)) failures.push('shape-guard-accepted-noop-stat-delta');
if (validatePlayerEquipmentTransitionReceipt(noOpDeltaTampered).ok) failures.push('noop-stat-delta-accepted');

const noOpAnimationFamilyTampered = { ...noOp, animation: Object.freeze({ ...noOp.animation, toFamily: `${noOp.animation.toFamily}-drift` }) };
if (isPlayerEquipmentTransitionReceipt(noOpAnimationFamilyTampered)) failures.push('shape-guard-accepted-noop-animation-family-drift');
if (validatePlayerEquipmentTransitionReceipt(noOpAnimationFamilyTampered).ok) failures.push('noop-animation-family-drift-accepted');

const noOpAnimationResetTampered = { ...noOp, animation: Object.freeze({ ...noOp.animation, hardReset: true }) };
if (isPlayerEquipmentTransitionReceipt(noOpAnimationResetTampered)) failures.push('shape-guard-accepted-noop-hard-reset');
if (validatePlayerEquipmentTransitionReceipt(noOpAnimationResetTampered).ok) failures.push('noop-hard-reset-accepted');

const refreshTampered = { ...receipt, socketsToRefresh: Object.freeze(['head']) };
if (isPlayerEquipmentTransitionReceipt(refreshTampered)) failures.push('shape-guard-accepted-foreign-socket-refresh');
if (validatePlayerEquipmentTransitionReceipt(refreshTampered).ok) failures.push('foreign-socket-refresh-accepted');

const missingRefreshTampered = { ...receipt, socketsToRefresh: Object.freeze(['mainHand']) };
if (isPlayerEquipmentTransitionReceipt(missingRefreshTampered)) failures.push('shape-guard-accepted-missing-socket-refresh');
if (validatePlayerEquipmentTransitionReceipt(missingRefreshTampered).ok) failures.push('missing-socket-refresh-accepted');

const reorderedChangedSlots = { ...receipt, changedSlots: Object.freeze(['offHand', 'mainHand']) };
if (isPlayerEquipmentTransitionReceipt(reorderedChangedSlots)) failures.push('shape-guard-accepted-reordered-changed-slots');
if (validatePlayerEquipmentTransitionReceipt(reorderedChangedSlots).ok) failures.push('reordered-changed-slots-accepted');

const reorderedRefreshSlots = { ...receipt, socketsToRefresh: Object.freeze(['offHand', 'mainHand']) };
if (isPlayerEquipmentTransitionReceipt(reorderedRefreshSlots)) failures.push('shape-guard-accepted-reordered-refresh-slots');
if (validatePlayerEquipmentTransitionReceipt(reorderedRefreshSlots).ok) failures.push('reordered-socket-refresh-accepted');

const mismatchedRefreshOrder = { ...receipt, socketsToRefresh: Object.freeze(['offHand', 'mainHand']) };
if (isPlayerEquipmentTransitionReceipt(mismatchedRefreshOrder)) failures.push('shape-guard-accepted-mismatched-refresh-order');
if (!validatePlayerEquipmentTransitionReceipt(mismatchedRefreshOrder).errors.includes('socket-refresh-order-mismatch')) failures.push('mismatched-refresh-order-not-diagnosed');

const duplicateChangedSlots = { ...receipt, changedSlots: Object.freeze([...receipt.changedSlots, 'mainHand']) };
if (isPlayerEquipmentTransitionReceipt(duplicateChangedSlots)) failures.push('shape-guard-accepted-duplicate-changed-slot');
if (validatePlayerEquipmentTransitionReceipt(duplicateChangedSlots).ok) failures.push('duplicate-changed-slot-accepted');

const duplicateRefreshSlots = { ...receipt, socketsToRefresh: Object.freeze([...receipt.socketsToRefresh, 'mainHand']) };
if (isPlayerEquipmentTransitionReceipt(duplicateRefreshSlots)) failures.push('shape-guard-accepted-duplicate-refresh-slot');
if (validatePlayerEquipmentTransitionReceipt(duplicateRefreshSlots).ok) failures.push('duplicate-socket-refresh-accepted');

const unknownSlotTampered = { ...receipt, changedSlots: Object.freeze([...receipt.changedSlots, 'finger']) };
if (isPlayerEquipmentTransitionReceipt(unknownSlotTampered)) failures.push('shape-guard-accepted-unknown-slot');
if (validatePlayerEquipmentTransitionReceipt(unknownSlotTampered).ok) failures.push('unknown-socket-accepted');

const keyTampered = { ...receipt, transitionKey: 'tampered-key' };
if (isPlayerEquipmentTransitionReceipt(keyTampered)) failures.push('shape-guard-accepted-tampered-key');
if (validatePlayerEquipmentTransitionReceipt(keyTampered).ok) failures.push('transition-key-tampering-accepted');

const malformed = {
  ...receipt,
  animation: { ...receipt.animation, compatible: 'yes' },
};
if (isPlayerEquipmentTransitionReceipt(malformed)) failures.push('shape-guard-accepted-malformed-animation');
if (validatePlayerEquipmentTransitionReceipt(malformed).ok) failures.push('malformed-animation-accepted');

const armorWithoutFlag = { ...receipt, changedSlots: Object.freeze(['chest']), socketsToRefresh: Object.freeze(['chest']), weaponChanged: false, rangedChanged: false, handednessChanged: false, defenseChanged: false };
if (isPlayerEquipmentTransitionReceipt(armorWithoutFlag)) failures.push('shape-guard-accepted-armor-without-defense-flag');
if (validatePlayerEquipmentTransitionReceipt(armorWithoutFlag).ok) failures.push('armor-without-defense-flag-accepted');

const defenseWithoutArmor = { ...receipt, changedSlots: Object.freeze(['mainHand', 'offHand']), socketsToRefresh: Object.freeze(['mainHand', 'offHand']), defenseChanged: true };
if (isPlayerEquipmentTransitionReceipt(defenseWithoutArmor)) failures.push('shape-guard-accepted-defense-without-armor');
if (validatePlayerEquipmentTransitionReceipt(defenseWithoutArmor).ok) failures.push('defense-without-armor-flag-accepted');

const weaponSlotWithoutFlag = { ...receipt, weaponChanged: false };
if (isPlayerEquipmentTransitionReceipt(weaponSlotWithoutFlag)) failures.push('shape-guard-accepted-weapon-slot-without-weapon-flag');
if (validatePlayerEquipmentTransitionReceipt(weaponSlotWithoutFlag).ok) failures.push('weapon-slot-without-weapon-flag-accepted');

const weaponFlagWithoutSlot = { ...receipt, changedSlots: Object.freeze(['chest']), socketsToRefresh: Object.freeze(['chest']), weaponChanged: true, defenseChanged: true, rangedChanged: false, handednessChanged: false };
if (isPlayerEquipmentTransitionReceipt(weaponFlagWithoutSlot)) failures.push('shape-guard-accepted-weapon-flag-without-slot');
if (validatePlayerEquipmentTransitionReceipt(weaponFlagWithoutSlot).ok) failures.push('weapon-flag-without-weapon-slot-accepted');

const malformedShape = { changed: true };
let malformedShapeThrew = false;
try {
  if (isPlayerEquipmentTransitionReceipt(malformedShape)) failures.push('shape-guard-accepted-malformed-shape');
  if (validatePlayerEquipmentTransitionReceipt(malformedShape).ok) failures.push('malformed-shape-accepted');
} catch {
  malformedShapeThrew = true;
}
if (malformedShapeThrew) failures.push('malformed-shape-threw');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, suite: 'player-equipment-transition-director-runtime', changedSlots: receipt.changedSlots, transitionKey: receipt.transitionKey, shieldSwapSlots: shieldSwap.changedSlots }));