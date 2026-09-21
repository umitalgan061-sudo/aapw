import {
  ComponentType,
  EntityId,
  QueryShape,
  Transform,
  createComponentType,
  distanceSquared,
  entityId,
  transformIdentity,
} from './types.ts';

export type ComponentValue = object;

interface Slot<T extends ComponentValue> {
  readonly component: ComponentType<T>;
  values: Map<EntityId, T>;
}

export interface EntityRecord {
  readonly id: EntityId;
  generation: number;
  alive: boolean;
  mask: number;
}

export interface QueryPlan {
  readonly required: readonly ComponentType<ComponentValue>[];
  readonly excluded: readonly ComponentType<ComponentValue>[];
  readonly shape?: QueryShape;
}

export const TransformComponent = createComponentType<Transform>('Transform');
export const NameComponent = createComponentType<{ value: string }>('Name');
export const ActiveComponent = createComponentType<{ value: boolean }>('Active');

const MAX_COMPONENT_TYPES = 30;

export class EntityComponentWorld {
  readonly #entities = new Map<EntityId, EntityRecord>();
  readonly #slots = new Map<ComponentType<ComponentValue>, Slot<ComponentValue>>();
  readonly #freeIds: EntityId[] = [];
  #nextId = 1;
  #revision = 0;

  get entityCount(): number { return this.#entities.size; }
  get revision(): number { return this.#revision; }

  spawn(initial: readonly [ComponentType<ComponentValue>, ComponentValue][] = []): EntityId {
    const recycled = this.#freeIds.pop();
    const id = recycled ?? entityId(this.#nextId++);
    const existing = this.#entities.get(id);
    const record: EntityRecord = existing ?? { id, generation: 0, alive: true, mask: 0 };
    record.alive = true;
    record.mask = 0;
    this.#entities.set(id, record);
    for (const [type, value] of initial) this.add(id, type, value);
    this.#revision += 1;
    return id;
  }

  destroy(id: EntityId): boolean {
    const record = this.#entities.get(id);
    if (!record?.alive) return false;
    for (const slot of this.#slots.values()) slot.values.delete(id);
    record.alive = false;
    record.generation += 1;
    record.mask = 0;
    this.#entities.delete(id);
    this.#freeIds.push(id);
    this.#revision += 1;
    return true;
  }

  add<T extends ComponentValue>(id: EntityId, type: ComponentType<T>, value: T): void {
    this.#requireEntity(id);
    let slot = this.#slots.get(type) as Slot<T> | undefined;
    if (!slot) {
      if (this.#slots.size >= MAX_COMPONENT_TYPES) throw new Error('Component type capacity exceeded');
      slot = { component: type, values: new Map<EntityId, T>() };
      this.#slots.set(type, slot as unknown as Slot<ComponentValue>);
    }
    slot.values.set(id, value);
    this.#entities.get(id)!.mask |= this.#bitFor(type);
    this.#revision += 1;
  }

  remove<T extends ComponentValue>(id: EntityId, type: ComponentType<T>): boolean {
    const record = this.#entities.get(id);
    const slot = this.#slots.get(type) as Slot<T> | undefined;
    if (!record || !slot || !slot.values.delete(id)) return false;
    record.mask &= ~this.#bitFor(type);
    this.#revision += 1;
    return true;
  }

  get<T extends ComponentValue>(id: EntityId, type: ComponentType<T>): T | undefined {
    return (this.#slots.get(type) as Slot<T> | undefined)?.values.get(id);
  }

  require<T extends ComponentValue>(id: EntityId, type: ComponentType<T>): T {
    const value = this.get(id, type);
    if (!value) throw new Error(`Missing component ${String(type.description)} on entity ${id}`);
    return value;
  }

  has<T extends ComponentValue>(id: EntityId, type: ComponentType<T>): boolean {
    return this.#slots.get(type)?.values.has(id) ?? false;
  }

  set<T extends ComponentValue>(id: EntityId, type: ComponentType<T>, updater: (current: T | undefined) => T): T {
    const next = updater(this.get(id, type));
    this.add(id, type, next);
    return next;
  }

  query(plan: QueryPlan): EntityId[] {
    const entities = [...this.#entities.values()]
      .filter((record) => record.alive)
      .filter((record) => plan.required.every((type) => (record.mask & this.#bitFor(type)) !== 0))
      .filter((record) => plan.excluded.every((type) => (record.mask & this.#bitFor(type)) === 0))
      .map((record) => record.id);
    if (!plan.shape) return entities;
    const center = plan.shape.center;
    const radiusSquared = plan.shape.radius * plan.shape.radius;
    return entities.filter((id) => {
      const transform = this.get(id, TransformComponent);
      if (!transform) return false;
      if (distanceSquared(transform.position, center) > radiusSquared) return false;
      return plan.shape?.predicate ? plan.shape.predicate(id) : true;
    });
  }

  upsertTransform(id: EntityId, position: Transform['position']): Transform {
    return this.set(id, TransformComponent, (current) => ({
      ...(current ?? transformIdentity()),
      position: { ...position },
    }));
  }

  snapshot(): { id: EntityId; generation: number; mask: number; components: Record<string, unknown> }[] {
    return [...this.#entities.values()].filter((record) => record.alive).map((record) => {
      const components: Record<string, unknown> = {};
      for (const [type, slot] of this.#slots.entries()) {
        const value = slot.values.get(record.id);
        if (value !== undefined) components[type.description ?? 'component'] = structuredClone(value);
      }
      return { id: record.id, generation: record.generation, mask: record.mask, components };
    });
  }

  clear(): void {
    for (const slot of this.#slots.values()) slot.values.clear();
    this.#entities.clear();
    this.#freeIds.length = 0;
    this.#nextId = 1;
    this.#revision += 1;
  }

  #requireEntity(id: EntityId): void {
    if (!this.#entities.get(id)?.alive) throw new Error(`Unknown entity ${id}`);
  }

  #bitFor(type: ComponentType<ComponentValue>): number {
    const types = [...this.#slots.keys()];
    const index = types.indexOf(type);
    return 1 << Math.max(0, index);
  }
}

export interface EntityCommand<T extends ComponentValue = ComponentValue> {
  readonly entity: EntityId;
  readonly component: ComponentType<T>;
  readonly operation: 'add' | 'remove' | 'set';
  readonly value?: T;
}

export function applyEntityCommands(world: EntityComponentWorld, commands: readonly EntityCommand[]): number {
  let applied = 0;
  for (const command of commands) {
    if (command.operation === 'remove') {
      applied += world.remove(command.entity, command.component) ? 1 : 0;
      continue;
    }
    if (!command.value) continue;
    if (command.operation === 'add') {
      world.add(command.entity, command.component, command.value);
      applied += 1;
      continue;
    }
    world.set(command.entity, command.component, () => command.value!);
    applied += 1;
  }
  return applied;
}

export function createTransformEntity(world: EntityComponentWorld, name: string, transform: Partial<Transform> = {}): EntityId {
  const id = world.spawn();
  world.add(id, TransformComponent, {
    ...transformIdentity(),
    ...transform,
    position: { ...transformIdentity().position, ...transform.position },
    rotation: { ...transformIdentity().rotation, ...transform.rotation },
    scale: { ...transformIdentity().scale, ...transform.scale },
  });
  world.add(id, NameComponent, { value: name });
  world.add(id, ActiveComponent, { value: true });
  return id;
}

export function activeQuery(): QueryPlan {
  return { required: [ActiveComponent], excluded: [] };
}
