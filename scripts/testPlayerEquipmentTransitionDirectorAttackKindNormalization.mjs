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

const baseline = resolvePlayerEquipmentTransitionReceipt({
  previousEquipment: equipment,
  nextEquipment: equipment,
  attackKind: 'none',
});
const invalid = resolvePlayerEquipmentTransitionReceipt({
  previousEquipment: equipment,
  nextEquipment: equipment,
  attackKind: 'teleport',
});

if (JSON.stringify(invalid) !== JSON.stringify(baseline)) {
  throw new Error('invalid attack kind was not normalized to the canonical none branch');
}
if (!isPlayerEquipmentTransitionReceipt(invalid)) throw new Error('normalized receipt shape invalid');
const validation = validatePlayerEquipmentTransitionReceipt(invalid);
if (!validation.ok) throw new Error(`normalized receipt failed validation: ${validation.errors.join(',')}`);

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-director-attack-kind-normalization',
  invalidInput: 'teleport',
  normalizedBranch: 'none',
  deterministic: true,
}));
