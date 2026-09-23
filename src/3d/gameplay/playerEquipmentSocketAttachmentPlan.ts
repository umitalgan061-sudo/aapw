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

export function resolvePlayerEquipmentSocketAttachmentPlan(
  checkpoint: PlayerEquipmentTransitionCheckpoint,
): PlayerEquipmentSocketAttachmentPlan {
  const slots = [...checkpoint.socketsToRefresh].sort((a, b) => (SLOT_ORDER.get(a) ?? 99) - (SLOT_ORDER.get(b) ?? 99));
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
    preserveLocomotion: checkpoint.preserveLocomotion,
    animationAction: checkpoint.animationAction,
    operations: Object.freeze(operations),
    planKey,
  });
}

export function validatePlayerEquipmentSocketAttachmentPlan(value: unknown): Readonly<{ ok: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) errors.push('plan-not-frozen');
  const candidate = value as Partial<PlayerEquipmentSocketAttachmentPlan> | null;
  const operations = Array.isArray(candidate?.operations) ? candidate.operations : [];
  if (!Object.isFrozen(operations)) errors.push('operations-not-frozen');
  if (candidate?.changed === false && operations.length > 0) errors.push('noop-has-operations');
  if (candidate?.changed === true && operations.length === 0) errors.push('changed-without-operations');
  if (operations.length % 2 !== 0) errors.push('operation-pair-mismatch');
  const seenSlots = new Set<string>();
  operations.forEach((operation, index) => {
    if (!operation || typeof operation !== 'object' || !Object.isFrozen(operation)) errors.push('operation-not-frozen');
    const expected = index % 2 === 0 ? 'detach' : 'attach';
    const slot = (operation as any)?.slot;
    if ((operation as any)?.operation !== expected) errors.push('operation-order');
    if ((operation as any)?.order !== index) errors.push('operation-index-mismatch');
    if (typeof slot !== 'string' || !SLOT_ORDER.has(slot)) errors.push('unknown-slot');
    if (index % 2 === 0 && typeof slot === 'string') {
      if (seenSlots.has(slot)) errors.push('duplicate-slot');
      seenSlots.add(slot);
    }
    if (index > 0 && index % 2 === 1 && slot !== operations[index - 1]?.slot) errors.push('pair-slot-mismatch');
    if (index > 1 && index % 2 === 0 && typeof slot === 'string' && typeof operations[index - 2]?.slot === 'string') {
      const previousSlot = operations[index - 2].slot;
      if ((SLOT_ORDER.get(previousSlot) ?? 99) >= (SLOT_ORDER.get(slot) ?? 99)) errors.push('slot-order');
    }
  });
  if (typeof candidate?.planKey !== 'string' || candidate.planKey.length === 0) errors.push('invalid-plan-key');
  if (candidate && typeof candidate.planKey === 'string' && typeof candidate.animationAction === 'string') {
    const transitionKey = candidate.planKey.split('|')[0];
    const expectedKey = `${transitionKey}|${canonicalOperationsKey(operations as readonly PlayerEquipmentSocketAttachmentOperation[])}`;
    if (candidate.planKey !== expectedKey) errors.push('plan-key-mismatch');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze([...new Set(errors)]) });
}
