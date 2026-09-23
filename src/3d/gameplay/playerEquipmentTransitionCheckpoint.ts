/**
 * Deterministic checkpoint adapter for the existing equipment/combat rules.
 * It observes transition semantics without owning player state, sockets or mixer mutation.
 */
import {
  comparePlayerEquipmentProfiles,
  resolvePlayerEquipmentTransition,
} from './playerEquipmentCombatRules.ts';

type EquipmentLike = Record<string, unknown>;

export type PlayerEquipmentTransitionCheckpoint = Readonly<{
  changed: boolean;
  changedSlots: readonly string[];
  animationAction: string;
  hardReset: boolean;
  preserveLocomotion: boolean;
  socketsToRefresh: readonly string[];
  transitionKey: string;
}>;

const SOCKET_ORDER = new Map([
  ['head', 0],
  ['chest', 1],
  ['back', 2],
  ['mainHand', 3],
  ['offHand', 4],
]);

const stableSlots = (slots: readonly string[]) => Object.freeze([...new Set(slots)].sort((a, b) => (SOCKET_ORDER.get(a) ?? 99) - (SOCKET_ORDER.get(b) ?? 99)));
const finiteNumber = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value: unknown, fallback: string) => typeof value === 'string' && value.length > 0 ? value : fallback;

const keyFor = (changedSlots: readonly string[], action: string, hardReset: boolean, preserveLocomotion: boolean) => [
  changedSlots.join(','),
  action,
  hardReset ? 'reset' : 'blend',
  preserveLocomotion ? 'preserve' : 'rebind',
].join('|');

export function resolvePlayerEquipmentTransitionCheckpoint({
  previousEquipment = {},
  nextEquipment = {},
  movementState = 'idle',
  attackKind = 'none',
  comboStep = 0,
  speedMps = 0,
  grounded = true,
}: {
  previousEquipment?: EquipmentLike;
  nextEquipment?: EquipmentLike;
  movementState?: string;
  attackKind?: string;
  comboStep?: number;
  speedMps?: number;
  grounded?: boolean;
} = {}): PlayerEquipmentTransitionCheckpoint {
  const delta = comparePlayerEquipmentProfiles(previousEquipment, nextEquipment);
  const transition = resolvePlayerEquipmentTransition(previousEquipment, nextEquipment, {
    movementState: text(movementState, 'idle'),
    attackKind,
    comboStep: Math.max(0, Math.floor(finiteNumber(comboStep))),
    speedMps: finiteNumber(speedMps),
    grounded: grounded !== false,
  });
  const changedSlots = stableSlots(delta.changedSlots);
  const socketsToRefresh = stableSlots(transition.socketsToRefresh);
  const animationAction = text(transition.animation.action, 'idle');
  const hardReset = Boolean(transition.animation.hardReset);
  const preserveLocomotion = Boolean(transition.animation.preserveLocomotion);
  return Object.freeze({
    changed: changedSlots.length > 0,
    changedSlots,
    animationAction,
    hardReset,
    preserveLocomotion,
    socketsToRefresh,
    transitionKey: keyFor(changedSlots, animationAction, hardReset, preserveLocomotion),
  });
}

export function validatePlayerEquipmentTransitionCheckpoint(value: unknown): Readonly<{ ok: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) errors.push('checkpoint-not-frozen');
  const candidate = value as Partial<PlayerEquipmentTransitionCheckpoint> | null;
  const changedSlots = Array.isArray(candidate?.changedSlots) ? candidate.changedSlots : [];
  const socketsToRefresh = Array.isArray(candidate?.socketsToRefresh) ? candidate.socketsToRefresh : [];
  if (candidate?.changed !== (changedSlots.length > 0)) errors.push('changed-flag-mismatch');
  if (new Set(changedSlots).size !== changedSlots.length) errors.push('duplicate-changed-slot');
  if (new Set(socketsToRefresh).size !== socketsToRefresh.length) errors.push('duplicate-refresh-slot');
  if (changedSlots.some((slot) => typeof slot !== 'string' || !SOCKET_ORDER.has(slot))) errors.push('unknown-changed-slot');
  if (socketsToRefresh.some((slot) => typeof slot !== 'string' || !SOCKET_ORDER.has(slot))) errors.push('unknown-refresh-slot');
  if (changedSlots.some((slot, index) => index > 0 && (SOCKET_ORDER.get(changedSlots[index - 1]) ?? 99) > (SOCKET_ORDER.get(slot) ?? 99))) errors.push('changed-slot-order');
  if (socketsToRefresh.some((slot, index) => index > 0 && (SOCKET_ORDER.get(socketsToRefresh[index - 1]) ?? 99) > (SOCKET_ORDER.get(slot) ?? 99))) errors.push('refresh-slot-order');
  if (candidate?.changed && (changedSlots.length !== socketsToRefresh.length || changedSlots.some((slot, index) => socketsToRefresh[index] !== slot))) errors.push('refreshes-do-not-match-changes');
  if (!candidate?.changed && socketsToRefresh.length > 0) errors.push('noop-has-refreshes');
  if (typeof candidate?.animationAction !== 'string' || candidate.animationAction.length === 0) errors.push('invalid-animation-action');
  if (typeof candidate?.hardReset !== 'boolean') errors.push('invalid-hard-reset');
  if (typeof candidate?.preserveLocomotion !== 'boolean') errors.push('invalid-locomotion-flag');
  if (typeof candidate?.transitionKey !== 'string' || candidate.transitionKey.length === 0) errors.push('invalid-transition-key');
  if (candidate?.changed === false && (candidate.hardReset || candidate.animationAction !== 'idle' || candidate.preserveLocomotion !== true)) errors.push('invalid-noop-semantics');
  if (candidate && typeof candidate.animationAction === 'string' && typeof candidate.hardReset === 'boolean' && typeof candidate.preserveLocomotion === 'boolean') {
    const expected = keyFor(changedSlots.filter((slot): slot is string => typeof slot === 'string'), candidate.animationAction, candidate.hardReset, candidate.preserveLocomotion);
    if (candidate.transitionKey !== expected) errors.push('transition-key-mismatch');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze([...new Set(errors)]) });
}
