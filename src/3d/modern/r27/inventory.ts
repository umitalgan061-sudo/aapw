import {
  itemId,
  type EquipmentState,
  type EntityId,
  type InventoryState,
  type ItemDefinition,
  type ItemId,
  type ItemStack,
} from './contracts.ts';

export type InventoryEvent =
  | { readonly type: 'added'; readonly item: ItemId; readonly quantity: number }
  | { readonly type: 'removed'; readonly item: ItemId; readonly quantity: number }
  | { readonly type: 'equipped'; readonly item: ItemId; readonly slot: string }
  | { readonly type: 'unequipped'; readonly item: ItemId; readonly slot: string }
  | { readonly type: 'rejected'; readonly reason: string };

export interface InventoryTransaction {
  readonly entity: EntityId;
  readonly before: InventoryState;
  readonly after: InventoryState;
  readonly events: readonly InventoryEvent[];
}

function totalWeight(
  stacks: readonly ItemStack[],
  definitions: ReadonlyMap<ItemId, ItemDefinition>,
): number {
  return stacks.reduce((total, stack) => total + (definitions.get(stack.item)?.weight ?? 0) * stack.quantity, 0);
}

function normalizeStacks(stacks: readonly ItemStack[]): readonly ItemStack[] {
  const grouped = new Map<ItemId, number>();
  for (const stack of stacks) {
    if (stack.quantity <= 0) continue;
    grouped.set(stack.item, (grouped.get(stack.item) ?? 0) + Math.floor(stack.quantity));
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([item, quantity]) => ({ item, quantity }));
}

function cloneInventory(state: InventoryState): InventoryState {
  const equipment: EquipmentState = {
    slots: Object.fromEntries(
      Object.entries(state.equipment.slots).map(([slot, stack]) => [
        slot,
        stack ? { ...stack } : undefined,
      ]),
    ),
  };
  return {
    capacity: state.capacity,
    stacks: state.stacks.map((stack) => ({ ...stack })),
    equipment,
  };
}

export class InventoryRuntime {
  #definitions = new Map<ItemId, ItemDefinition>();

  register(definition: ItemDefinition): void {
    if (definition.stackLimit < 1 || definition.weight < 0) {
      throw new RangeError('Invalid item definition limits');
    }
    const id = itemId(String(definition.id));
    this.#definitions.set(id, {
      ...definition,
      id,
      stackLimit: Math.floor(definition.stackLimit),
      weight: Math.max(0, definition.weight),
      tags: [...definition.tags].sort(),
    });
  }

  defineMany(definitions: readonly ItemDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  getDefinition(id: ItemId): ItemDefinition | undefined {
    return this.#definitions.get(id);
  }

  add(state: InventoryState, item: ItemId, quantity: number): InventoryTransaction {
    const definition = this.#definitions.get(item);
    if (!definition) return this.reject(state, `Unknown item: ${String(item)}`);
    const requested = Math.max(0, Math.floor(quantity));
    if (requested === 0) return this.reject(state, 'Quantity must be positive');

    const working = cloneInventory(state);
    const events: InventoryEvent[] = [];
    let remaining = requested;
    const stacks = working.stacks.map((stack) => ({ ...stack }));

    for (let index = 0; index < stacks.length && remaining > 0; index++) {
      const stack = stacks[index];
      if (!stack || stack.item !== item) continue;
      const space = Math.max(0, definition.stackLimit - stack.quantity);
      if (space === 0) continue;
      const amount = Math.min(space, remaining);
      stacks[index] = { item, quantity: stack.quantity + amount };
      remaining -= amount;
    }

    while (remaining > 0) {
      const amount = Math.min(definition.stackLimit, remaining);
      stacks.push({ item, quantity: amount });
      remaining -= amount;
    }

    const normalized = normalizeStacks(stacks);
    if (normalized.length > working.capacity) {
      return this.reject(state, 'Inventory slot capacity exceeded');
    }

    const after: InventoryState = {
      ...working,
      stacks: normalized,
    };

    events.push({ type: 'added', item, quantity: requested });
    return { entity: 0 as EntityId, before: state, after, events };
  }

  remove(state: InventoryState, item: ItemId, quantity: number): InventoryTransaction {
    const requested = Math.max(0, Math.floor(quantity));
    const available = state.stacks
      .filter((stack) => stack.item === item)
      .reduce((sum, stack) => sum + stack.quantity, 0);
    if (requested === 0 || available < requested) return this.reject(state, 'Not enough items');

    let remaining = requested;
    const next: ItemStack[] = [];
    for (const stack of state.stacks) {
      if (stack.item !== item || remaining === 0) {
        next.push({ ...stack });
        continue;
      }
      const amount = Math.min(stack.quantity, remaining);
      const left = stack.quantity - amount;
      if (left > 0) next.push({ item: stack.item, quantity: left });
      remaining -= amount;
    }

    return {
      entity: 0 as EntityId,
      before: state,
      after: { ...cloneInventory(state), stacks: normalizeStacks(next) },
      events: [{ type: 'removed', item, quantity: requested }],
    };
  }

  equip(state: InventoryState, item: ItemId): InventoryTransaction {
    const definition = this.#definitions.get(item);
    if (!definition?.equipSlot) return this.reject(state, 'Item is not equippable');

    const hasItem = state.stacks.some((stack) => stack.item === item && stack.quantity > 0);
    if (!hasItem) return this.reject(state, 'Item is not in inventory');

    const slot = definition.equipSlot;
    const next = cloneInventory(state);
    const previous = next.equipment.slots[slot];
    const slots = { ...next.equipment.slots, [slot]: { item, quantity: 1 } };
    next.equipment = { slots };

    const events: InventoryEvent[] = [{ type: 'equipped', item, slot }];
    if (previous && previous.item !== item) {
      events.push({ type: 'unequipped', item: previous.item, slot });
    }

    return { entity: 0 as EntityId, before: state, after: next, events };
  }

  unequip(state: InventoryState, slot: string): InventoryTransaction {
    const existing = state.equipment.slots[slot];
    if (!existing) return this.reject(state, 'Equipment slot is empty');
    const next = cloneInventory(state);
    next.equipment = {
      slots: { ...next.equipment.slots, [slot]: undefined },
    };
    return {
      entity: 0 as EntityId,
      before: state,
      after: next,
      events: [{ type: 'unequipped', item: existing.item, slot }],
    };
  }

  weight(state: InventoryState): number {
    return totalWeight(state.stacks, this.#definitions) +
      totalWeight(
        Object.values(state.equipment.slots).filter((stack): stack is ItemStack => Boolean(stack)),
        this.#definitions,
      );
  }

  hasTag(state: InventoryState, tag: string): boolean {
    return state.stacks.some((stack) => this.#definitions.get(stack.item)?.tags.includes(tag) ?? false);
  }

  reject(state: InventoryState, reason: string): InventoryTransaction {
    return {
      entity: 0 as EntityId,
      before: state,
      after: cloneInventory(state),
      events: [{ type: 'rejected', reason }],
    };
  }
}

export function emptyInventory(capacity = 24): InventoryState {
  return {
    capacity: Math.max(1, Math.floor(capacity)),
    stacks: [],
    equipment: { slots: {} },
  };
}

export function inventoryFingerprint(state: InventoryState): string {
  const stacks = normalizeStacks(state.stacks)
    .map((stack) => `${String(stack.item)}x${stack.quantity}`)
    .join('|');
  const equipment = Object.entries(state.equipment.slots)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, stack]) => `${slot}=${stack ? String(stack.item) : '-'}`)
    .join('|');
  return `${state.capacity};${stacks};${equipment}`;
}
