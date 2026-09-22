/** Deterministic presentation adapter for live equipment swaps. */
import { comparePlayerEquipmentProfiles, resolvePlayerEquipmentTransition } from './playerEquipmentCombatRules.ts';

export type PlayerEquipmentTransitionInput = Readonly<{
  previousEquipment?: Record<string, unknown>;
  nextEquipment?: Record<string, unknown>;
  movementState?: string;
  attackKind?: 'none' | 'light' | 'heavy';
  comboStep?: number;
  speedMps?: number;
  grounded?: boolean;
}>;

export type PlayerEquipmentTransitionReceipt = Readonly<{
  changed: boolean;
  changedSlots: readonly string[];
  weaponChanged: boolean;
  defenseChanged: boolean;
  rangedChanged: boolean;
  handednessChanged: boolean;
  movementDelta: number;
  staminaDrainDelta: number;
  poiseDelta: number;
  damageDelta: number;
  reachDelta: number;
  animation: Readonly<{
    compatible: boolean;
    hardReset: boolean;
    fromFamily: string;
    toFamily: string;
    action: string;
    preserveLocomotion: boolean;
    crossfadeSeconds: number;
  }>;
  socketsToRefresh: readonly string[];
  transitionKey: string;
}>;

const freeze = <T>(value: T): T => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return value;
};

const text = (value: unknown, fallback = '') => typeof value === 'string' && value.length > 0 ? value : fallback;
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

export function resolvePlayerEquipmentTransitionReceipt(input: PlayerEquipmentTransitionInput = {}): PlayerEquipmentTransitionReceipt {
  const previous = input.previousEquipment ?? {};
  const next = input.nextEquipment ?? {};
  const delta = comparePlayerEquipmentProfiles(previous, next);
  const transition = resolvePlayerEquipmentTransition(previous, next, {
    movementState: text(input.movementState, 'idle'),
    attackKind: input.attackKind ?? 'none',
    comboStep: Math.max(0, Math.floor(Number(input.comboStep) || 0)),
    speedMps: Number.isFinite(Number(input.speedMps)) ? Number(input.speedMps) : 0,
    grounded: input.grounded !== false,
  });
  const changedSlots = [...delta.changedSlots];
  const socketsToRefresh = transition.socketsToRefresh.filter((slot): slot is string => typeof slot === 'string');
  const transitionKey = [
    changedSlots.join(','),
    transition.animation.fromFamily,
    transition.animation.toFamily,
    transition.animation.hardReset ? 'reset' : 'blend',
  ].join('|');
  return freeze({
    ...delta,
    animation: freeze({ ...transition.animation }),
    socketsToRefresh: Object.freeze(socketsToRefresh),
    transitionKey,
  });
}

export function isPlayerEquipmentTransitionReceipt(value: unknown): value is PlayerEquipmentTransitionReceipt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as PlayerEquipmentTransitionReceipt;
  return Object.isFrozen(candidate)
    && Array.isArray(candidate.changedSlots)
    && Object.isFrozen(candidate.animation)
    && Array.isArray(candidate.socketsToRefresh)
    && typeof candidate.transitionKey === 'string';
}

export function validatePlayerEquipmentTransitionReceipt(value: unknown): Readonly<{ ok: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  if (!isPlayerEquipmentTransitionReceipt(value)) errors.push('receipt-not-frozen-or-shaped');
  if (value && typeof value === 'object') {
    const candidate = value as PlayerEquipmentTransitionReceipt;
    if (candidate.changed !== (candidate.changedSlots.length > 0)) errors.push('changed-flag-mismatch');
    if (candidate.weaponChanged && !candidate.changedSlots.includes('mainHand')) errors.push('weapon-slot-missing');
    if (candidate.rangedChanged && !candidate.changedSlots.includes('mainHand')) errors.push('ranged-slot-missing');
    if (candidate.handednessChanged && !candidate.changedSlots.includes('mainHand')) errors.push('handedness-slot-missing');
    for (const [name, numeric] of Object.entries({
      movementDelta: candidate.movementDelta,
      staminaDrainDelta: candidate.staminaDrainDelta,
      poiseDelta: candidate.poiseDelta,
      damageDelta: candidate.damageDelta,
      reachDelta: candidate.reachDelta,
      crossfadeSeconds: candidate.animation?.crossfadeSeconds,
    })) if (!finite(numeric)) errors.push(`${name}-not-finite`);
    if (candidate.animation?.crossfadeSeconds < 0) errors.push('negative-crossfade');
    if (candidate.changedSlots.some((slot) => typeof slot !== 'string' || slot.length === 0)) errors.push('invalid-changed-slot');
    if (candidate.socketsToRefresh.some((slot) => typeof slot !== 'string' || slot.length === 0)) errors.push('invalid-socket-slot');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
