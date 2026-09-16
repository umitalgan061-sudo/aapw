import { EntityId, clamp, hashString, mixHash, stableStringify } from './types.ts';

export type ItemKind = 'weapon' | 'armor' | 'consumable' | 'quest' | 'material' | 'currency' | 'tool' | 'misc';
export type EquipmentSlot = 'head' | 'chest' | 'legs' | 'hands' | 'weapon' | 'offhand' | 'accessory';

export interface ItemDefinition {
  id: string;
  kind: ItemKind;
  stackLimit: number;
  weight: number;
  value: number;
  tags: readonly string[];
  equipSlot?: EquipmentSlot;
  durabilityMax?: number;
  power?: number;
}

export interface ItemStack {
  uid: number;
  itemId: string;
  quantity: number;
  durability?: number;
  metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface InventoryConfig {
  slotCapacity: number;
  weightCapacity: number;
  transactionLimit: number;
}

export interface InventoryResult {
  ok: boolean;
  reason?: string;
  changed: boolean;
  quantity: number;
}

export interface EquipmentState {
  entity: EntityId;
  slots: Partial<Record<EquipmentSlot, ItemStack>>;
  revision: number;
}

export interface InventorySnapshot {
  owner: EntityId;
  revision: number;
  slots: readonly ItemStack[];
  equipment: EquipmentState;
  weight: number;
  checksum: number;
}

export interface InventoryTransaction {
  id: string;
  owner: EntityId;
  tick: number;
  kind: 'add' | 'remove' | 'equip' | 'unequip' | 'consume' | 'transfer';
  itemId?: string;
  quantity?: number;
  source?: EntityId;
  target?: EntityId;
  checksum: number;
}

const DEFAULT_CONFIG: InventoryConfig = {
  slotCapacity: 64,
  weightCapacity: 100,
  transactionLimit: 128,
};

function validItemDefinition(definition: ItemDefinition): boolean {
  return definition.id.trim().length > 0
    && definition.id.length <= 128
    && Number.isInteger(definition.stackLimit) && definition.stackLimit > 0
    && Number.isFinite(definition.weight) && definition.weight >= 0
    && Number.isFinite(definition.value) && definition.value >= 0;
}

function cloneStack(stack: ItemStack): ItemStack {
  return { ...stack, metadata: { ...stack.metadata } };
}

function cloneEquipment(equipment: EquipmentState): EquipmentState {
  return {
    entity: equipment.entity,
    slots: Object.fromEntries(Object.entries(equipment.slots).map(([slot, stack]) => [slot, stack ? cloneStack(stack) : stack])) as EquipmentState['slots'],
    revision: equipment.revision,
  };
}

export class ItemRegistryV2 {
  readonly #definitions = new Map<string, ItemDefinition>();

  register(definition: ItemDefinition): void {
    if (!validItemDefinition(definition)) throw new RangeError(`Invalid item definition ${definition.id}`);
    if (this.#definitions.has(definition.id)) throw new Error(`Item ${definition.id} already registered`);
    this.#definitions.set(definition.id, { ...definition, tags: [...definition.tags] });
  }

  get(id: string): ItemDefinition | undefined {
    const definition = this.#definitions.get(id);
    return definition ? { ...definition, tags: [...definition.tags] } : undefined;
  }

  require(id: string): ItemDefinition {
    const definition = this.get(id);
    if (!definition) throw new Error(`Unknown item ${id}`);
    return definition;
  }

  list(): ItemDefinition[] {
    return [...this.#definitions.values()].sort((a, b) => a.id.localeCompare(b.id)).map((definition) => ({ ...definition, tags: [...definition.tags] }));
  }

  digest(): number { return hashString(stableStringify(this.list())); }
}

export class InventoryRuntimeV2 {
  readonly #registry: ItemRegistryV2;
  readonly #config: InventoryConfig;
  readonly #inventories = new Map<EntityId, Map<number, ItemStack>>();
  readonly #equipment = new Map<EntityId, EquipmentState>();
  readonly #transactions: InventoryTransaction[] = [];
  readonly #nextUid = new Map<EntityId, number>();
  readonly #revisions = new Map<EntityId, number>();

  constructor(registry: ItemRegistryV2, config: Partial<InventoryConfig> = {}) {
    this.#registry = registry;
    this.#config = { ...DEFAULT_CONFIG, ...config };
    if (this.#config.slotCapacity <= 0 || this.#config.weightCapacity < 0) throw new RangeError('Invalid inventory capacity');
  }

  ensure(owner: EntityId): void {
    if (!this.#inventories.has(owner)) this.#inventories.set(owner, new Map());
    if (!this.#equipment.has(owner)) this.#equipment.set(owner, { entity: owner, slots: {}, revision: 0 });
    if (!this.#nextUid.has(owner)) this.#nextUid.set(owner, 1);
    if (!this.#revisions.has(owner)) this.#revisions.set(owner, 0);
  }

  weight(owner: EntityId): number {
    this.ensure(owner);
    let total = 0;
    for (const stack of this.#inventories.get(owner)!.values()) total += this.#registry.require(stack.itemId).weight * stack.quantity;
    return total;
  }

  capacity(owner: EntityId): { slotsUsed: number; slotsFree: number; weight: number; weightFree: number } {
    this.ensure(owner);
    const inventory = this.#inventories.get(owner)!;
    const currentWeight = this.weight(owner);
    return {
      slotsUsed: inventory.size,
      slotsFree: Math.max(0, this.#config.slotCapacity - inventory.size),
      weight: currentWeight,
      weightFree: Math.max(0, this.#config.weightCapacity - currentWeight),
    };
  }

  add(owner: EntityId, itemId: string, quantity: number, metadata: Record<string, string | number | boolean> = {}): InventoryResult {
    this.ensure(owner);
    const definition = this.#registry.get(itemId);
    if (!definition) return this.fail('unknown_item');
    const count = Math.floor(quantity);
    if (count <= 0) return this.fail('invalid_quantity');
    if (count > this.#config.transactionLimit) return this.fail('transaction_limit');
    const requiredWeight = definition.weight * count;
    if (this.weight(owner) + requiredWeight > this.#config.weightCapacity + 1e-9) return this.fail('weight_capacity');
    const inventory = this.#inventories.get(owner)!;
    let remaining = count;
    for (const stack of inventory.values()) {
      if (remaining <= 0) break;
      if (stack.itemId !== itemId || stack.quantity >= definition.stackLimit) continue;
      const room = definition.stackLimit - stack.quantity;
      const moved = Math.min(room, remaining);
      stack.quantity += moved;
      remaining -= moved;
    }
    while (remaining > 0) {
      if (inventory.size >= this.#config.slotCapacity) return this.fail('slot_capacity');
      const moved = Math.min(definition.stackLimit, remaining);
      const uid = this.#allocateUid(owner);
      const durability = definition.durabilityMax;
      inventory.set(uid, { uid, itemId, quantity: moved, durability, metadata: { ...metadata } });
      remaining -= moved;
    }
    this.#touch(owner);
    this.#record({ owner, kind: 'add', tick: 0, itemId, quantity: count });
    return { ok: true, changed: true, quantity: count };
  }

  remove(owner: EntityId, itemId: string, quantity: number): InventoryResult {
    this.ensure(owner);
    const definition = this.#registry.get(itemId);
    if (!definition) return this.fail('unknown_item');
    let remaining = Math.floor(quantity);
    if (remaining <= 0) return this.fail('invalid_quantity');
    const inventory = this.#inventories.get(owner)!;
    const stacks = [...inventory.values()].filter((stack) => stack.itemId === itemId).sort((a, b) => a.uid - b.uid);
    const available = stacks.reduce((sum, stack) => sum + stack.quantity, 0);
    if (available < remaining) return this.fail('insufficient_quantity');
    for (const stack of stacks) {
      if (remaining <= 0) break;
      const moved = Math.min(stack.quantity, remaining);
      stack.quantity -= moved;
      remaining -= moved;
      if (stack.quantity === 0) inventory.delete(stack.uid);
    }
    this.#touch(owner);
    this.#record({ owner, kind: 'remove', tick: 0, itemId, quantity: Math.floor(quantity) });
    return { ok: true, changed: true, quantity: Math.floor(quantity) };
  }

  consume(owner: EntityId, itemId: string, quantity = 1): InventoryResult {
    const result = this.remove(owner, itemId, quantity);
    if (result.ok) this.#record({ owner, kind: 'consume', tick: 0, itemId, quantity });
    return result;
  }

  equip(owner: EntityId, stackUid: number): InventoryResult {
    this.ensure(owner);
    const inventory = this.#inventories.get(owner)!;
    const stack = inventory.get(stackUid);
    if (!stack) return this.fail('missing_stack');
    const definition = this.#registry.require(stack.itemId);
    if (!definition.equipSlot) return this.fail('not_equippable');
    const equipment = this.#equipment.get(owner)!;
    const previous = equipment.slots[definition.equipSlot];
    equipment.slots[definition.equipSlot] = cloneStack(stack);
    inventory.delete(stackUid);
    if (previous) {
      const addResult = this.add(owner, previous.itemId, previous.quantity, { ...previous.metadata });
      if (!addResult.ok) {
        inventory.set(stackUid, stack);
        if (previous) equipment.slots[definition.equipSlot] = previous;
        return this.fail(`cannot_store_previous:${addResult.reason}`);
      }
    }
    equipment.revision += 1;
    this.#touch(owner);
    this.#record({ owner, kind: 'equip', tick: 0, itemId: stack.itemId, quantity: stack.quantity });
    return { ok: true, changed: true, quantity: stack.quantity };
  }

  unequip(owner: EntityId, slot: EquipmentSlot): InventoryResult {
    this.ensure(owner);
    const equipment = this.#equipment.get(owner)!;
    const stack = equipment.slots[slot];
    if (!stack) return this.fail('empty_slot');
    const result = this.add(owner, stack.itemId, stack.quantity, { ...stack.metadata });
    if (!result.ok) return result;
    equipment.slots[slot] = undefined;
    equipment.revision += 1;
    this.#touch(owner);
    this.#record({ owner, kind: 'unequip', tick: 0, itemId: stack.itemId, quantity: stack.quantity });
    return result;
  }

  transfer(source: EntityId, target: EntityId, itemId: string, quantity: number): InventoryResult {
    const removed = this.remove(source, itemId, quantity);
    if (!removed.ok) return removed;
    const added = this.add(target, itemId, quantity);
    if (!added.ok) {
      this.add(source, itemId, quantity);
      return this.fail(`target_rejected:${added.reason}`);
    }
    this.#record({ owner: source, target, source, kind: 'transfer', tick: 0, itemId, quantity });
    return { ok: true, changed: true, quantity };
  }

  stacks(owner: EntityId): ItemStack[] {
    this.ensure(owner);
    return [...this.#inventories.get(owner)!.values()].sort((a, b) => a.uid - b.uid).map(cloneStack);
  }

  equipment(owner: EntityId): EquipmentState {
    this.ensure(owner);
    return cloneEquipment(this.#equipment.get(owner)!);
  }

  snapshot(owner: EntityId): InventorySnapshot {
    this.ensure(owner);
    const snapshotBody = {
      owner,
      revision: this.#revisions.get(owner) ?? 0,
      slots: this.stacks(owner),
      equipment: this.equipment(owner),
      weight: this.weight(owner),
    };
    return { ...snapshotBody, checksum: stableChecksum(snapshotBody) };
  }

  restore(snapshot: InventorySnapshot): void {
    if (stableChecksum({ owner: snapshot.owner, revision: snapshot.revision, slots: snapshot.slots, equipment: snapshot.equipment, weight: snapshot.weight }) !== snapshot.checksum) {
      throw new Error('Inventory snapshot checksum mismatch');
    }
    this.ensure(snapshot.owner);
    const inventory = this.#inventories.get(snapshot.owner)!;
    inventory.clear();
    for (const stack of snapshot.slots) inventory.set(stack.uid, cloneStack(stack));
    this.#equipment.set(snapshot.owner, cloneEquipment(snapshot.equipment));
    this.#revisions.set(snapshot.owner, snapshot.revision);
  }

  transactions(): InventoryTransaction[] { return this.#transactions.map((transaction) => ({ ...transaction })); }

  digest(owner: EntityId): number { return stableChecksum(this.snapshot(owner)); }

  #allocateUid(owner: EntityId): number {
    const next = this.#nextUid.get(owner) ?? 1;
    this.#nextUid.set(owner, next + 1);
    return next;
  }

  #touch(owner: EntityId): void { this.#revisions.set(owner, (this.#revisions.get(owner) ?? 0) + 1); }

  #record(input: Omit<InventoryTransaction, 'id' | 'checksum'>): void {
    const sequence = this.#transactions.length + 1;
    const id = `inv-${input.owner}-${sequence}`;
    const body = { ...input, id };
    this.#transactions.push({ ...body, checksum: hashString(stableStringify(body)) });
    if (this.#transactions.length > 2048) this.#transactions.splice(0, this.#transactions.length - 2048);
  }

  fail(reason: string): InventoryResult { return { ok: false, changed: false, quantity: 0, reason }; }
}

export function defineCurrency(id: string, value = 1): ItemDefinition {
  return { id, kind: 'currency', stackLimit: 999999, weight: 0, value, tags: ['currency'] };
}

export function defineEquipment(
  id: string,
  kind: Extract<ItemKind, 'weapon' | 'armor' | 'tool'>,
  equipSlot: EquipmentSlot,
  options: Partial<Pick<ItemDefinition, 'stackLimit' | 'weight' | 'value' | 'durabilityMax' | 'power' | 'tags'>> = {},
): ItemDefinition {
  return {
    id,
    kind,
    equipSlot,
    stackLimit: options.stackLimit ?? 1,
    weight: options.weight ?? 1,
    value: options.value ?? 0,
    durabilityMax: options.durabilityMax ?? 100,
    power: options.power ?? 1,
    tags: options.tags ?? [kind, equipSlot],
  };
}
