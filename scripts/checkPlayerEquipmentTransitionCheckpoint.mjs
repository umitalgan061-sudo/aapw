import {
  resolvePlayerEquipmentTransitionCheckpoint,
  validatePlayerEquipmentTransitionCheckpoint,
} from '../src/3d/gameplay/playerEquipmentTransitionCheckpoint.ts';
import { resolvePlayerEquipmentCombatProfile } from '../src/3d/gameplay/playerEquipmentCombatProfile.ts';

const base = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'arming-sword' },
  offHand: { id: 'buckler' },
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
});
const next = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'greatsword' },
  offHand: null,
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
});

const changed = resolvePlayerEquipmentTransitionCheckpoint({
  previousEquipment: base,
  nextEquipment: next,
  movementState: 'sprint',
  attackKind: 'heavy',
  comboStep: 2,
  speedMps: 5,
  grounded: true,
});
if (!changed.changed) throw new Error('equipment delta was not observed');
if (changed.changedSlots.join(',') !== 'mainHand,offHand') throw new Error(`unexpected changed slots: ${changed.changedSlots.join(',')}`);
if (changed.socketsToRefresh.join(',') !== changed.changedSlots.join(',')) throw new Error('refresh slots diverged from changed slots');
if (!validatePlayerEquipmentTransitionCheckpoint(changed).ok) throw new Error('changed checkpoint did not validate');

const noop = resolvePlayerEquipmentTransitionCheckpoint({
  previousEquipment: base,
  nextEquipment: base,
  movementState: 'sprint',
  attackKind: 'heavy',
  comboStep: 3,
  speedMps: 5,
});
if (noop.changed || noop.animationAction !== 'idle' || noop.hardReset || !noop.preserveLocomotion || noop.socketsToRefresh.length !== 0) {
  throw new Error('no-op checkpoint semantics drifted');
}
if (!validatePlayerEquipmentTransitionCheckpoint(noop).ok) throw new Error('no-op checkpoint did not validate');

const tampered = Object.freeze({
  ...noop,
  animationAction: 'heavy',
});
const tamperedValidation = validatePlayerEquipmentTransitionCheckpoint(tampered);
if (tamperedValidation.ok || !tamperedValidation.errors.includes('invalid-noop-semantics')) throw new Error('tampered no-op was accepted');

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-checkpoint',
  changedSlots: changed.changedSlots,
  noopAction: noop.animationAction,
  tamperRejected: true,
}));
