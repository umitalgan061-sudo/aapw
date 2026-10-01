/**
 * Deterministic presentation plan for equipment socket consumers.
 * It projects the existing transition checkpoint into ordered attach/detach work
 * without owning scene objects, sockets, mixer state or inventory mutation.
 */
import {
  PlayerEquipmentTransitionCheckpoint,
} from './playerEquipmentTransitionCheckpoint.ts';

export type PlayerEquipmentSocketAttachmentOperation = Readonly<{
  slot: string;
  operation: 'detach' | 'attach';
  order: number;
}>;

export type PlayerEquipmentSocketAttachmentPlan = Readonly<{
  changed: boolean;
  changedSlots: readonly string[];
  transitionKey: string;
  preserveLocomotion: boolean;
  animationAction: string;
  operations: readonly PlayerEquipmentSocketAttachmentOperation[];
  planKey: string;
}>;

const SLOT_ORDER = new Map([
  ['head', 0],
  ['chest', 1],
  ['back', 2],
  ['mainHand', 3],
  ['offHand', 4],
]);

const freezeOperation = (slot: string, operation: 'detach' | 'attach', order: number) => Object.freeze({ slot, operation, order });

const canonicalOperationsKey = (operations: readonly PlayerEquipmentSocketAttachmentOperation[]) => operations
  .map(({ slot, operation }) => `${slot}:${operation}`)
  .join(',');

const canonicalSlots = (slots: readonly string[]) => [...slots].sort((a, b) => (SLOT_ORDER.get(a) ?? 99) - (SLOT_ORDER.get(b) ?? 99));

const safeIsFrozen = (value: unknown) => {
  try {
    return Object.isFrozen(value);
  } catch {
    return false;
  }
};

const safeRead = <T>(read: () => T, fallback: T): T => {
  try {
    return read();
  } catch {
    return fallback;
  }
};

export function resolvePlayerEquipmentSocketAttachmentPlan(
  checkpoint: PlayerEquipmentTransitionCheckpoint,
): PlayerEquipmentSocketAttachmentPlan {
  const slots = canonicalSlots(checkpoint.socketsToRefresh);
  const operations = slots.flatMap((slot, index) => [
    freezeOperation(slot, 'detach', index * 2),
    freezeOperation(slot, 'attach', index * 2 + 1),
  ]);
  const planKey = [
    checkpoint.transitionKey,
    canonicalOperationsKey(operations),
  ].join('|');
  return Object.freeze({
    changed: checkpoint.changed,
    changedSlots: Object.freeze([...checkpoint.changedSlots]),
    transitionKey: checkpoint.transitionKey,
    preserveLocomotion: checkpoint.preserveLocomotion,
    animationAction: checkpoint.animationAction,
    operations: Object.freeze(operations),
    planKey,
  });
}

export function validatePlayerEquipmentSocketAttachmentPlan(value: unknown): Readonly<{ ok: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || !safeIsFrozen(value)) errors.push('plan-not-frozen');
  const candidate = safeRead(() => value as Partial<PlayerEquipmentSocketAttachmentPlan>, null);
  const changedSlots = safeRead(() => (Array.isArray(candidate?.changedSlots) ? candidate.changedSlots : []), []);
  const operations = safeRead(() => (Array.isArray(candidate?.operations) ? candidate.operations : []), []);
  if (!safeIsFrozen(changedSlots)) errors.push('changed-slots-not-frozen');
  if (!safeIsFrozen(operations)) errors.push('operations-not-frozen');
  const changed = safeRead(() => candidate?.changed, undefined);
  if (changed !== (changedSlots.length > 0)) errors.push('changed-flag-mismatch');
  if (changed === false && operations.length > 0) errors.push('noop-has-operations');
  if (changed === true && operations.length === 0) errors.push('changed-without-operations');
  if (operations.length % 2 !== 0) errors.push('operation-pair-mismatch');
  const seenSlots = new Set<string>();
  operations.forEach((operation, index) => {
    if (!operation || typeof operation !== 'object' || !safeIsFrozen(operation)) errors.push('operation-not-frozen');
    const expected = index % 2 === 0 ? 'detach' : 'attach';
    const slot = safeRead(() => (operation as any)?.slot, undefined);
    const operationKind = safeRead(() => (operation as any)?.operation, undefined);
    const order = safeRead(() => (operation as any)?.order, undefined);
    if (operationKind !== expected) errors.push('operation-order');
    if (order !== index) errors.push('operation-index-mismatch');
    if (typeof slot !== 'string' || !SLOT_ORDER.has(slot)) errors.push('unknown-slot');
    if (index % 2 === 0 && typeof slot === 'string') {
      if (seenSlots.has(slot)) errors.push('duplicate-slot');
      seenSlots.add(slot);
    }
    const previousSlot = index > 0 ? safeRead(() => (operations[index - 1] as any)?.slot, undefined) : undefined;
    const priorPairSlot = index > 1 ? safeRead(() => (operations[index - 2] as any)?.slot, undefined) : undefined;
    if (index > 0 && index % 2 === 1 && slot !== previousSlot) errors.push('pair-slot-mismatch');
    if (index > 1 && index % 2 === 0 && typeof slot === 'string' && typeof priorPairSlot === 'string') {
      if ((SLOT_ORDER.get(priorPairSlot) ?? 99) >= (SLOT_ORDER.get(slot) ?? 99)) errors.push('slot-order');
    }
  });
  if (changedSlots.some((slot) => typeof slot !== 'string' || !SLOT_ORDER.has(slot))) errors.push('unknown-changed-slot');
  if (new Set(changedSlots).size !== changedSlots.length) errors.push('duplicate-changed-slot');
  if (changedSlots.some((slot, index) => index > 0 && (SLOT_ORDER.get(changedSlots[index - 1]) ?? 99) > (SLOT_ORDER.get(slot) ?? 99))) errors.push('changed-slot-order');
  const operationSlots = operations.filter((_, index) => index % 2 === 0).map((operation) => safeRead(() => (operation as any)?.slot, undefined));
  if (operationSlots.length !== changedSlots.length || operationSlots.some((slot, index) => slot !== changedSlots[index])) errors.push('operation-slots-do-not-match-changes');
  const transitionKey = safeRead(() => candidate?.transitionKey, undefined);
  const animationAction = safeRead(() => candidate?.animationAction, undefined);
  const preserveLocomotion = safeRead(() => candidate?.preserveLocomotion, undefined);
  const planKey = safeRead(() => candidate?.planKey, undefined);
  if (typeof transitionKey !== 'string' || transitionKey.length === 0) errors.push('invalid-transition-key');
  if (typeof animationAction !== 'string' || animationAction.length === 0) errors.push('invalid-animation-action');
  if (typeof preserveLocomotion !== 'boolean') errors.push('invalid-locomotion-flag');
  if (typeof planKey !== 'string' || planKey.length === 0) errors.push('invalid-plan-key');
  if (typeof transitionKey === 'string' && transitionKey.length > 0 && planKey === `${transitionKey}|${canonicalOperationsKey(operations as readonly PlayerEquipmentSocketAttachmentOperation[])}`) {
    // canonical key matches
  } else if (planKey) {
    errors.push('plan-key-mismatch');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze([...new Set(errors)]) });
}

export function isPlayerEquipmentSocketAttachmentPlan(value: unknown): value is PlayerEquipmentSocketAttachmentPlan {
  return validatePlayerEquipmentSocketAttachmentPlan(value).ok;
}
