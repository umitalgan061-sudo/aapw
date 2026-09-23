import {
  resolvePlayerEquipmentTransitionReceipt,
  validatePlayerEquipmentTransitionReceipt,
} from '../src/3d/gameplay/playerEquipmentTransitionDirector.ts';

const failures = [];
const base = {
  mainHand: { id: 'arming-sword' },
  offHand: { id: 'buckler' },
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
};
const bow = { ...base, mainHand: { id: 'bow' }, offHand: null };

const cases = [
  ['idle', 'none', 'idle'],
  ['sprint', 'light', 'attack-light'],
  ['sprint', 'heavy', 'attack-heavy'],
];

for (const [movementState, attackKind, expectedAction] of cases) {
  const input = {
    previousEquipment: base,
    nextEquipment: bow,
    movementState,
    attackKind,
    comboStep: attackKind === 'none' ? 0 : 2,
    speedMps: movementState === 'sprint' ? 5.2 : 0,
    grounded: true,
  };
  const receipt = resolvePlayerEquipmentTransitionReceipt(input);
  const replay = resolvePlayerEquipmentTransitionReceipt(input);
  if (!validatePlayerEquipmentTransitionReceipt(receipt).ok) failures.push(`${attackKind}:receipt-invalid`);
  if (receipt.animation.action !== expectedAction) failures.push(`${attackKind}:unexpected-action:${receipt.animation.action}`);
  if (receipt.animation.action !== replay.animation.action) failures.push(`${attackKind}:non-deterministic-action`);
  if (JSON.stringify(receipt) !== JSON.stringify(replay)) failures.push(`${attackKind}:non-deterministic-receipt`);

  const tamperedAction = structuredClone(receipt);
  tamperedAction.animation.action = tamperedAction.animation.action === 'attack-heavy' ? 'attack-light' : 'attack-heavy';
  if (validatePlayerEquipmentTransitionReceipt(tamperedAction).ok) failures.push(`${attackKind}:tampered-action-accepted`);
  if (!validatePlayerEquipmentTransitionReceipt(tamperedAction).errors.includes('transition-key-mismatch')) failures.push(`${attackKind}:tampered-action-missing-key-diagnostic`);
}

const noOp = resolvePlayerEquipmentTransitionReceipt({ previousEquipment: base, nextEquipment: base });
if (noOp.animation.action !== 'idle') failures.push(`noop:unexpected-action:${noOp.animation.action}`);
if (!validatePlayerEquipmentTransitionReceipt(noOp).ok) failures.push('noop:receipt-invalid');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-director-action-integrity',
  cases: cases.length,
  deterministic: true,
  transitionKeyBindsAction: true,
  noOpAction: noOp.animation.action,
}));
