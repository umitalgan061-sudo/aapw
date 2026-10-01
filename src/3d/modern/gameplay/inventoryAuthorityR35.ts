/**
 * R35 deterministic inventory authority.
 * Handles definitions, stack merging, weight limits, quick-access slots and
 * transaction-style mutation with stable ordering.
 */
import type { EntityId } from '../types.ts';

export type InventoryItemKind =
  | 'weapon'
  | 'armor'
  | 'consumable'
  | 'material'
  | 'quest'
  | 'tool'
  | 'currency'
  | 'key'
  | 'misc';

export interface InventoryItemDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: InventoryItemKind;
  readonly maxStack: number;
  readonly weight: number;
  readonly value: number;
  readonly tags: readonly string[];
  readonly unique: boolean;
  readonly usable: boolean;
}

export interface InventoryItem {
  readonly instanceId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly durability: number;
  readonly data: Readonly<Record<string, string | number | boolean>>;
}

export interface InventorySlot {
  readonly index: number;
  readonly item: InventoryItem | null;
}

export interface InventoryTransaction {
  readonly id: number;
  readonly type: 'add' | 'remove' | 'move' | 'split' | 'consume' | 'clear';
  readonly itemId?: string;
  readonly quantity: number;
  readonly from?: number;
  readonly to?: number;
  readonly reason: string;
}

export interface InventorySnapshotR35 {
  readonly version: 1;
  readonly ownerId: EntityId;
  readonly capacity: number;
  readonly maxWeight: number;
  readonly slots: readonly InventorySlot[];
  readonly quickSlots: readonly number[];
}

export interface InventoryConfigR35 {
  readonly ownerId: EntityId;
  readonly capacity?: number;
  readonly maxWeight?: number;
  readonly quickSlotCount?: number;
  readonly transactionLimit?: number;
}

export type InventoryMutationResult =
  | { readonly ok: true; readonly changed: number; readonly slot: number }
  | { readonly ok: false; readonly changed: 0; readonly reason: string };

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneItem(item: InventoryItem | null): InventoryItem | null {
  return item ? { ...item, data: { ...item.data } } : null;
}

export class InventoryAuthorityR35 {
  readonly ownerId: EntityId;
  readonly capacity: number;
  readonly maxWeight: number;

  #definitions = new Map<string, InventoryItemDefinition>();
  #slots: InventorySlot[];
  #quickSlots: number[];
  #transactions: InventoryTransaction[] = [];
  #nextTransaction = 1;
  #nextInstance = 1;
  #transactionLimit: number;

  constructor(config: InventoryConfigR35) {
    this.ownerId = config.ownerId;
    this.capacity = positiveInteger(config.capacity ?? 36, 36);
    this.maxWeight = finiteNonNegative(config.maxWeight ?? 180);
    this.#slots = Array.from(
      { length: this.capacity },
      (_, index) => ({ index, item: null }),
    );
    this.#quickSlots = Array.from(
      { length: positiveInteger(config.quickSlotCount ?? 8, 8) },
      () => -1,
    );
    this.#transactionLimit = Math.max(
      32,
      Math.floor(config.transactionLimit ?? 512),
    );
  }

  register(definition: InventoryItemDefinition): void {
    if (!definition.id.trim()) throw new Error('inventory item id is required');
    if (!definition.name.trim()) throw new Error('inventory item name is required');
    if (!Number.isInteger(definition.maxStack) || definition.maxStack < 1) {
      throw new Error('inventory item maxStack must be positive');
    }
    if (!Number.isFinite(definition.weight) || definition.weight < 0) {
      throw new Error('inventory item weight must be non-negative');
    }
    const normalized: InventoryItemDefinition = {
      ...definition,
      maxStack: Math.max(1, Math.floor(definition.maxStack)),
      weight: Math.max(0, definition.weight),
      value: Math.max(0, finiteNonNegative(definition.value)),
      tags: [...new Set(definition.tags.map((tag) => tag.trim()).filter(Boolean))].sort(),
    };
    this.#definitions.set(normalized.id, normalized);
  }

  registerMany(definitions: readonly InventoryItemDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  getDefinition(itemId: string): InventoryItemDefinition | undefined {
    return this.#definitions.get(itemId);
  }

  get slots(): readonly InventorySlot[] {
    return this.#slots.map((slot) => ({
      index: slot.index,
      item: cloneItem(slot.item),
    }));
  }

  get quickSlots(): readonly number[] {
    return [...this.#quickSlots];
  }

  get transactions(): readonly InventoryTransaction[] {
    return this.#transactions.map((transaction) => ({ ...transaction }));
  }

  get usedSlotCount(): number {
    return this.#slots.filter((slot) => slot.item !== null).length;
  }

  get totalItemCount(): number {
    return this.#slots.reduce((sum, slot) => sum + (slot.item?.quantity ?? 0), 0);
  }

  get totalWeight(): number {
    const weight = this.#slots.reduce((sum, slot) => {
      if (!slot.item) return sum;
      const definition = this.#definitions.get(slot.item.itemId);
      return sum + (definition?.weight ?? 0) * slot.item.quantity;
    }, 0);
    return Number(weight.toFixed(6));
  }

  get remainingWeight(): number {
    return Number(Math.max(0, this.maxWeight - this.totalWeight).toFixed(6));
  }

  private definitionOrThrow(itemId: string): InventoryItemDefinition {
    const definition = this.#definitions.get(itemId);
    if (!definition) throw new Error('unknown inventory item: ' + itemId);
    return definition;
  }

  private pushTransaction(
    transaction: Omit<InventoryTransaction, 'id'>,
  ): void {
    const entry: InventoryTransaction = {
      id: this.#nextTransaction++,
      ...transaction,
    };
    this.#transactions.push(entry);
    if (this.#transactions.length > this.#transactionLimit) {
      this.#transactions.splice(
        0,
        this.#transactions.length - this.#transactionLimit,
      );
    }
  }

  private createItem(
    itemId: string,
    quantity: number,
    durability: number,
    data: Readonly<Record<string, string | number | boolean>>,
  ): InventoryItem {
    const definition = this.definitionOrThrow(itemId);
    const instanceId =
      this.ownerId + ':item:' + this.#nextInstance.toString(36);
    this.#nextInstance += 1;
    return {
      instanceId,
      itemId,
      quantity: clamp(Math.floor(quantity), 1, definition.maxStack),
      durability: clamp(durability, 0, 1),
      data: { ...data },
    };
  }

  canAdd(itemId: string, quantity: number): boolean {
    const definition = this.#definitions.get(itemId);
    if (!definition || !Number.isInteger(quantity) || quantity <= 0) {
      return false;
    }
    const projectedWeight =
      this.totalWeight + definition.weight * quantity;
    if (projectedWeight > this.maxWeight + 1e-9) return false;
    if (definition.unique && this.count(itemId) > 0) return false;
    return this.availableCapacityFor(itemId, quantity) >= quantity;
  }

  private availableCapacityFor(itemId: string, quantity: number): number {
    const definition = this.#definitions.get(itemId);
    if (!definition) return 0;
    let capacity = 0;
    for (const slot of this.#slots) {
      if (slot.item?.itemId === itemId) {
        capacity += Math.max(0, definition.maxStack - slot.item.quantity);
      } else if (!slot.item) {
        capacity += definition.maxStack;
      }
    }
    return capacity;
  }

  count(itemId: string): number {
    return this.#slots.reduce(
      (sum, slot) =>
        sum + (slot.item?.itemId === itemId ? slot.item.quantity : 0),
      0,
    );
  }

  findFirst(itemId: string): number {
    return this.#slots.findIndex((slot) => slot.item?.itemId === itemId);
  }

  findAll(itemId: string): readonly number[] {
    return this.#slots
      .filter((slot) => slot.item?.itemId === itemId)
      .map((slot) => slot.index);
  }

  add(
    itemId: string,
    quantity: number,
    reason = 'pickup',
    data: Readonly<Record<string, string | number | boolean>> = {},
    durability = 1,
  ): InventoryMutationResult {
    const definition = this.#definitions.get(itemId);
    if (!definition || !Number.isInteger(quantity) || quantity <= 0) {
      return { ok: false, changed: 0, reason: 'invalid item or quantity' };
    }
    if (!this.canAdd(itemId, quantity)) {
      return { ok: false, changed: 0, reason: 'capacity or weight limit' };
    }

    let remaining = quantity;
    let firstSlot = -1;

    for (const slot of this.#slots) {
      if (remaining <= 0) break;
      if (slot.item?.itemId !== itemId) continue;
      const room = definition.maxStack - slot.item.quantity;
      const amount = Math.min(room, remaining);
      if (amount <= 0) continue;
      slot.item = {
        ...slot.item,
        quantity: slot.item.quantity + amount,
      };
      if (firstSlot < 0) firstSlot = slot.index;
      remaining -= amount;
      this.pushTransaction({
        type: 'add',
        itemId,
        quantity: amount,
        to: slot.index,
        reason: reason + ':merge',
      });
    }

    for (const slot of this.#slots) {
      if (remaining <= 0) break;
      if (slot.item) continue;
      const amount = Math.min(definition.maxStack, remaining);
      slot.item = this.createItem(itemId, amount, durability, data);
      if (firstSlot < 0) firstSlot = slot.index;
      remaining -= amount;
      this.pushTransaction({
        type: 'add',
        itemId,
        quantity: amount,
        to: slot.index,
        reason: reason + ':new',
      });
    }

    return remaining === 0
      ? { ok: true, changed: quantity, slot: firstSlot }
      : { ok: false, changed: 0, reason: 'unexpected inventory allocation failure' };
  }

  remove(
    itemId: string,
    quantity: number,
    reason = 'consume',
  ): InventoryMutationResult {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return { ok: false, changed: 0, reason: 'invalid quantity' };
    }
    if (this.count(itemId) < quantity) {
      return { ok: false, changed: 0, reason: 'insufficient quantity' };
    }

    let remaining = quantity;
    let firstSlot = -1;

    for (const slot of this.#slots) {
      if (remaining <= 0) break;
      if (slot.item?.itemId !== itemId) continue;
      const amount = Math.min(slot.item.quantity, remaining);
      if (firstSlot < 0) firstSlot = slot.index;
      const nextQuantity = slot.item.quantity - amount;
      slot.item =
        nextQuantity > 0 ? { ...slot.item, quantity: nextQuantity } : null;
      remaining -= amount;
      this.pushTransaction({
        type: 'remove',
        itemId,
        quantity: amount,
        from: slot.index,
        reason,
      });
    }

    return { ok: true, changed: quantity, slot: firstSlot };
  }

  move(
    fromIndex: number,
    toIndex: number,
    reason = 'reorder',
  ): InventoryMutationResult {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= this.capacity ||
      toIndex >= this.capacity
    ) {
      return { ok: false, changed: 0, reason: 'slot out of range' };
    }
    if (fromIndex === toIndex) {
      return { ok: true, changed: 0, slot: toIndex };
    }

    const source = this.#slots[fromIndex];
    const target = this.#slots[toIndex];
    if (!source?.item || !target) {
      return { ok: false, changed: 0, reason: 'source slot empty' };
    }

    const sourceItem = source.item;
    const targetItem = target.item;

    if (
      targetItem &&
      targetItem.itemId === sourceItem.itemId &&
      this.#definitions.get(sourceItem.itemId)
    ) {
      const definition = this.#definitions.get(sourceItem.itemId)!;
      const room = definition.maxStack - targetItem.quantity;
      const moved = Math.min(room, sourceItem.quantity);
      if (moved > 0) {
        target.item = { ...targetItem, quantity: targetItem.quantity + moved };
        source.item =
          moved === sourceItem.quantity
            ? null
            : { ...sourceItem, quantity: sourceItem.quantity - moved };
        this.pushTransaction({
          type: 'move',
          itemId: sourceItem.itemId,
          quantity: moved,
          from: fromIndex,
          to: toIndex,
          reason: reason + ':merge',
        });
        return { ok: true, changed: moved, slot: toIndex };
      }
    }

    source.item = targetItem;
    target.item = sourceItem;
    this.pushTransaction({
      type: 'move',
      itemId: sourceItem.itemId,
      quantity: sourceItem.quantity,
      from: fromIndex,
      to: toIndex,
      reason,
    });
    return { ok: true, changed: sourceItem.quantity, slot: toIndex };
  }

  split(
    index: number,
    quantity: number,
    reason = 'split',
  ): InventoryMutationResult {
    if (index < 0 || index >= this.capacity) {
      return { ok: false, changed: 0, reason: 'slot out of range' };
    }
    const source = this.#slots[index];
    if (
      !source?.item ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      quantity >= source.item.quantity
    ) {
      return { ok: false, changed: 0, reason: 'invalid split quantity' };
    }
    const empty = this.#slots.find((slot) => slot.item === null);
    if (!empty) return { ok: false, changed: 0, reason: 'inventory full' };

    empty.item = {
      ...source.item,
      instanceId:
        this.ownerId + ':item:' + this.#nextInstance.toString(36),
      quantity,
      data: { ...source.item.data },
    };
    this.#nextInstance += 1;
    source.item = {
      ...source.item,
      quantity: source.item.quantity - quantity,
    };

    this.pushTransaction({
      type: 'split',
      itemId: empty.item.itemId,
      quantity,
      from: index,
      to: empty.index,
      reason,
    });
    return { ok: true, changed: quantity, slot: empty.index };
  }

  setQuickSlot(quickIndex: number, inventoryIndex: number): boolean {
    if (
      quickIndex < 0 ||
      quickIndex >= this.#quickSlots.length ||
      inventoryIndex < -1 ||
      inventoryIndex >= this.capacity
    ) {
      return false;
    }
    if (inventoryIndex >= 0 && this.#slots[inventoryIndex]?.item === null) {
      return false;
    }
    this.#quickSlots[quickIndex] = inventoryIndex;
    return true;
  }

  resolveQuickSlot(quickIndex: number): InventorySlot | null {
    if (quickIndex < 0 || quickIndex >= this.#quickSlots.length) return null;
    const index = this.#quickSlots[quickIndex];
    if (index < 0) return null;
    return this.slots[index] ?? null;
  }

  consumeSlot(
    index: number,
    quantity = 1,
    reason = 'use',
  ): InventoryMutationResult {
    if (index < 0 || index >= this.capacity) {
      return { ok: false, changed: 0, reason: 'slot out of range' };
    }
    const slot = this.#slots[index];
    if (!slot?.item) return { ok: false, changed: 0, reason: 'slot empty' };

    const definition = this.#definitions.get(slot.item.itemId);
    if (!definition?.usable) {
      return { ok: false, changed: 0, reason: 'item is not usable' };
    }

    return this.remove(slot.item.itemId, quantity, reason);
  }

  clear(reason = 'clear'): void {
    for (const slot of this.#slots) {
      if (!slot.item) continue;
      this.pushTransaction({
        type: 'clear',
        itemId: slot.item.itemId,
        quantity: slot.item.quantity,
        from: slot.index,
        reason,
      });
      slot.item = null;
    }
    this.#quickSlots = this.#quickSlots.map(() => -1);
  }

  snapshot(): InventorySnapshotR35 {
    return {
      version: 1,
      ownerId: this.ownerId,
      capacity: this.capacity,
      maxWeight: this.maxWeight,
      slots: this.slots,
      quickSlots: this.quickSlots,
    };
  }

  restore(snapshot: InventorySnapshotR35): void {
    if (snapshot.version !== 1) throw new Error('unsupported inventory snapshot');
    if (snapshot.ownerId !== this.ownerId) throw new Error('inventory owner mismatch');
    if (snapshot.capacity !== this.capacity) throw new Error('inventory capacity mismatch');
    if (snapshot.slots.length !== this.capacity) throw new Error('inventory slot count mismatch');

    const nextSlots: InventorySlot[] = [];
    for (let index = 0; index < this.capacity; index += 1) {
      const source = snapshot.slots[index];
      if (!source || source.index !== index) {
        throw new Error('inventory slot index mismatch');
      }
      if (!source.item) {
        nextSlots.push({ index, item: null });
        continue;
      }
      const definition = this.definitionOrThrow(source.item.itemId);
      if (
        source.item.quantity < 1 ||
        source.item.quantity > definition.maxStack ||
        !Number.isInteger(source.item.quantity)
      ) {
        throw new Error('invalid inventory quantity');
      }
      nextSlots.push({
        index,
        item: {
          ...source.item,
          durability: clamp(source.item.durability, 0, 1),
          data: { ...source.item.data },
        },
      });
    }

    const weight = nextSlots.reduce((sum, slot) => {
      if (!slot.item) return sum;
      const definition = this.definitionOrThrow(slot.item.itemId);
      return sum + definition.weight * slot.item.quantity;
    }, 0);

    if (weight > this.maxWeight + 1e-9) {
      throw new Error('snapshot exceeds inventory weight');
    }

    this.#slots = nextSlots;
    this.#quickSlots = this.#quickSlots.map((_, index) => {
      const restored = snapshot.quickSlots[index] ?? -1;
      return restored >= 0 &&
        restored < this.capacity &&
        this.#slots[restored]?.item
        ? restored
        : -1;
    });
    this.#transactions = [];
  }

  compact(): void {
    const occupied = this.#slots
      .filter((slot) => slot.item !== null)
      .map((slot) => cloneItem(slot.item));
    for (let index = 0; index < this.capacity; index += 1) {
      this.#slots[index].item = occupied[index] ?? null;
    }
    this.#quickSlots = this.#quickSlots.map((slotIndex) => {
      if (slotIndex < 0) return -1;
      const item = this.#slots[slotIndex]?.item;
      if (!item) return -1;
      return this.#slots.findIndex((slot) => slot.item?.instanceId === item.instanceId);
    });
  }
}
