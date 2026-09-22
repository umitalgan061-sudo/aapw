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
const boolean = (value: unknown): value is boolean => typeof value === 'boolean';
const stringArray = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);

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
  const changedSlots = Object.freeze([...delta.changedSlots]);
  const socketsToRefresh = Object.freeze(transition.socketsToRefresh.filter((slot): slot is string => typeof slot === 'string'));
  const transitionKey = [
    changedSlots.join(','),
    transition.animation.fromFamily,
    transition.animation.toFamily,
    transition.animation.hardReset ? 'reset' : 'blend',
  ].join('|');
  return freeze({
    ...delta,
    changedSlots,
    animation: freeze({ ...transition.animation }),
    socketsToRefresh,
    transitionKey,
  });
}

export function isPlayerEquipmentTransitionReceipt(value: unknown): value is PlayerEquipmentTransitionReceipt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PlayerEquipmentTransitionReceipt>;
  const animation = candidate.animation;
  return Object.isFrozen(value)
    && stringArray(candidate.changedSlots)
    && Object.isFrozen(candidate.changedSlots)
    && boolean(candidate.changed)
    && boolean(candidate.weaponChanged)
    && boolean(candidate.defenseChanged)
    && boolean(candidate.rangedChanged)
    && boolean(candidate.handednessChanged)
    && finite(candidate.movementDelta)
    && finite(candidate.staminaDrainDelta)
    && finite(candidate.poiseDelta)
    && finite(candidate.damageDelta)
    && finite(candidate.reachDelta)
    && !!animation
    && typeof animation === 'object'
    && Object.isFrozen(animation)
    && boolean(animation.compatible)
    && boolean(animation.hardReset)
    && typeof animation.fromFamily === 'string'
    && typeof animation.toFamily === 'string'
    && typeof animation.action === 'string'
    && boolean(animation.preserveLocomotion)
    && finite(animation.crossfadeSeconds)
    && stringArray(candidate.socketsToRefresh)
    && Object.isFrozen(candidate.socketsToRefresh)
    && typeof candidate.transitionKey === 'string';
}

export function validatePlayerEquipmentTransitionReceipt(value: unknown): Readonly<{ ok: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  if (!isPlayerEquipmentTransitionReceipt(value)) errors.push('receipt-not-frozen-or-shaped');
  if (!value || typeof value !== 'object') return Object.freeze({ ok: false, errors: Object.freeze(errors) });

  const candidate = value as Partial<PlayerEquipmentTransitionReceipt>;
  const changedSlots = Array.isArray(candidate.changedSlots) ? candidate.changedSlots : [];
  const socketsToRefresh = Array.isArray(candidate.socketsToRefresh) ? candidate.socketsToRefresh : [];
  const animation = candidate.animation && typeof candidate.animation === 'object' ? candidate.animation : undefined;
  if (!animation) errors.push('animation-not-shaped');

  if (candidate.changed !== (changedSlots.length > 0)) errors.push('changed-flag-mismatch');
  if (candidate.weaponChanged && !changedSlots.includes('mainHand')) errors.push('weapon-slot-missing');
  if (candidate.rangedChanged && !changedSlots.includes('mainHand')) errors.push('ranged-slot-missing');
  if (candidate.handednessChanged && !changedSlots.includes('mainHand')) errors.push('handedness-slot-missing');
  for (const [name, numeric] of Object.entries({
    movementDelta: candidate.movementDelta,
    staminaDrainDelta: candidate.staminaDrainDelta,
    poiseDelta: candidate.poiseDelta,
    damageDelta: candidate.damageDelta,
    reachDelta: candidate.reachDelta,
    crossfadeSeconds: animation?.crossfadeSeconds,
  })) if (!finite(numeric)) errors.push(`${name}-not-finite`);
  if (typeof animation?.crossfadeSeconds === 'number' && animation.crossfadeSeconds < 0) errors.push('negative-crossfade');
  if (changedSlots.some((slot) => typeof slot !== 'string' || slot.length === 0)) errors.push('invalid-changed-slot');
  if (socketsToRefresh.some((slot) => typeof slot !== 'string' || slot.length === 0)) errors.push('invalid-socket-slot');
  for (const [name, flag] of Object.entries({
    changed: candidate.changed,
    weaponChanged: candidate.weaponChanged,
    defenseChanged: candidate.defenseChanged,
    rangedChanged: candidate.rangedChanged,
    handednessChanged: candidate.handednessChanged,
    animationCompatible: animation?.compatible,
    animationHardReset: animation?.hardReset,
    preserveLocomotion: animation?.preserveLocomotion,
  })) if (typeof flag !== 'boolean') errors.push(`${name}-not-boolean`);
  for (const [name, textValue] of Object.entries({
    fromFamily: animation?.fromFamily,
    toFamily: animation?.toFamily,
    action: animation?.action,
    transitionKey: candidate.transitionKey,
  })) if (typeof textValue !== 'string') errors.push(`${name}-not-string`);

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
