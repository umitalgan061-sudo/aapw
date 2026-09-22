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

const VALID_EQUIPMENT_SOCKETS = ['head', 'chest', 'back', 'mainHand', 'offHand'] as const;
const EQUIPMENT_SOCKET_ORDER = new Map(VALID_EQUIPMENT_SOCKETS.map((slot, index) => [slot, index]));

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

const buildTransitionKey = (changedSlots: readonly string[], animation: PlayerEquipmentTransitionReceipt['animation']) => [
  changedSlots.join(','),
  animation.fromFamily,
  animation.toFamily,
  animation.hardReset ? 'reset' : 'blend',
].join('|');

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
  const changedSlots = Object.freeze([...delta.changedSlots].sort((left, right) => (EQUIPMENT_SOCKET_ORDER.get(left as typeof VALID_EQUIPMENT_SOCKETS[number]) ?? Number.MAX_SAFE_INTEGER) - (EQUIPMENT_SOCKET_ORDER.get(right as typeof VALID_EQUIPMENT_SOCKETS[number]) ?? Number.MAX_SAFE_INTEGER)));
  const socketsToRefresh = Object.freeze(transition.socketsToRefresh.filter((slot): slot is string => typeof slot === 'string').sort((left, right) => (EQUIPMENT_SOCKET_ORDER.get(left as typeof VALID_EQUIPMENT_SOCKETS[number]) ?? Number.MAX_SAFE_INTEGER) - (EQUIPMENT_SOCKET_ORDER.get(right as typeof VALID_EQUIPMENT_SOCKETS[number]) ?? Number.MAX_SAFE_INTEGER)));
  const animation = freeze({ ...transition.animation });
  const transitionKey = buildTransitionKey(changedSlots, animation);
  return freeze({
    ...delta,
    changedSlots,
    animation,
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
    && animation.fromFamily.length > 0
    && typeof animation.toFamily === 'string'
    && animation.toFamily.length > 0
    && typeof animation.action === 'string'
    && animation.action.length > 0
    && boolean(animation.preserveLocomotion)
    && finite(animation.crossfadeSeconds)
    && stringArray(candidate.socketsToRefresh)
    && Object.isFrozen(candidate.socketsToRefresh)
    && typeof candidate.transitionKey === 'string'
    && candidate.transitionKey.length > 0;
}

const hasCanonicalSocketOrder = (slots: readonly string[]) => slots.every((slot, index) => index === 0 || (EQUIPMENT_SOCKET_ORDER.get(slots[index - 1] as typeof VALID_EQUIPMENT_SOCKETS[number]) ?? Number.MAX_SAFE_INTEGER) <= (EQUIPMENT_SOCKET_ORDER.get(slot as typeof VALID_EQUIPMENT_SOCKETS[number]) ?? Number.MAX_SAFE_INTEGER));

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
  if (!candidate.changed && (changedSlots.length > 0 || socketsToRefresh.length > 0)) errors.push('noop-transition-has-refreshes');
  if (candidate.changed && changedSlots.length === 0) errors.push('changed-transition-missing-slots');
  const changedSlotSet = new Set(changedSlots.filter((slot): slot is string => typeof slot === 'string'));
  const refreshSlotSet = new Set(socketsToRefresh.filter((slot): slot is string => typeof slot === 'string'));
  if (changedSlotSet.size !== changedSlots.length) errors.push('duplicate-changed-slot');
  if (refreshSlotSet.size !== socketsToRefresh.length) errors.push('duplicate-socket-refresh');
  if (!hasCanonicalSocketOrder(changedSlots.filter((slot): slot is string => typeof slot === 'string'))) errors.push('changed-slot-order-noncanonical');
  if (!hasCanonicalSocketOrder(socketsToRefresh.filter((slot): slot is string => typeof slot === 'string'))) errors.push('socket-refresh-order-noncanonical');
  for (const slot of socketsToRefresh) if (typeof slot === 'string' && !changedSlotSet.has(slot)) errors.push('socket-refresh-not-changed-slot');
  if (candidate.changed && refreshSlotSet.size !== changedSlotSet.size) errors.push('changed-slot-refresh-count-mismatch');
  for (const slot of changedSlots) if (typeof slot === 'string' && !refreshSlotSet.has(slot)) errors.push('changed-slot-missing-refresh');
  for (const slot of changedSlots) if (typeof slot === 'string' && !EQUIPMENT_SOCKET_ORDER.has(slot as typeof VALID_EQUIPMENT_SOCKETS[number])) errors.push('unknown-changed-slot');
  for (const slot of socketsToRefresh) if (typeof slot === 'string' && !EQUIPMENT_SOCKET_ORDER.has(slot as typeof VALID_EQUIPMENT_SOCKETS[number])) errors.push('unknown-socket-refresh');
  if (candidate.weaponChanged && !changedSlots.includes('mainHand')) errors.push('weapon-slot-missing');
  if (candidate.rangedChanged && !changedSlots.includes('mainHand')) errors.push('ranged-slot-missing');
  if (candidate.handednessChanged && !changedSlots.includes('mainHand')) errors.push('handedness-slot-missing');
  const semanticFlags = {
    weaponChanged: candidate.weaponChanged,
    defenseChanged: candidate.defenseChanged,
    rangedChanged: candidate.rangedChanged,
    handednessChanged: candidate.handednessChanged,
  };
  if (!candidate.changed && Object.values(semanticFlags).some((flag) => flag === true)) errors.push('noop-transition-has-semantic-flags');
  const numericValues = {
    movementDelta: candidate.movementDelta,
    staminaDrainDelta: candidate.staminaDrainDelta,
    poiseDelta: candidate.poiseDelta,
    damageDelta: candidate.damageDelta,
    reachDelta: candidate.reachDelta,
    crossfadeSeconds: animation?.crossfadeSeconds,
  };
  for (const [name, numeric] of Object.entries(numericValues)) if (!finite(numeric)) errors.push(`${name}-not-finite`);
  if (!candidate.changed && Object.entries(numericValues).some(([name, numeric]) => name !== 'crossfadeSeconds' && numeric !== 0)) errors.push('noop-transition-has-stat-deltas');
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
  })) if (typeof textValue !== 'string' || textValue.length === 0) errors.push(`${name}-not-string`);

  if (animation && typeof animation.fromFamily === 'string' && typeof animation.toFamily === 'string' && typeof animation.hardReset === 'boolean') {
    const expectedKey = buildTransitionKey(changedSlots.filter((slot): slot is string => typeof slot === 'string'), animation as PlayerEquipmentTransitionReceipt['animation']);
    if (candidate.transitionKey !== expectedKey) errors.push('transition-key-mismatch');
  }

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}