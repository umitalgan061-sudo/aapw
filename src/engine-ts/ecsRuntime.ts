import type { ComponentType, Disposable, EntityId, FrameContext, Result, SystemId } from './coreTypes.ts';
import { COMPONENT_TYPE, ENTITY_ID, err, ok, stableSort } from './coreTypes.ts';

export interface ComponentSchema<T extends object> {
  readonly type: ComponentType;
  readonly create: () => T;
  readonly validate: (value: unknown) => value is T;
  readonly clone?: (value: T) => T;
}

export interface QueryDescription {
  readonly all?: readonly ComponentType[];
  readonly any?: readonly ComponentType[];
  readonly none?: readonly ComponentType[];
}

export interface EntitySnapshot {
  readonly id: EntityId;
  readonly components: Readonly<Record<string, unknown>>;
}

export interface SystemDefinition {
  readonly id: SystemId;
  readonly order: number;
  readonly phase: string;
  readonly query?: QueryDescription;
  readonly update: (context: SystemContext) => void;
}

export interface SystemContext {
  readonly frame: FrameContext;
  readonly world: EcsWorld;
  readonly query: (description: QueryDescription) => readonly EntityId[];
}

export const defineComponent = <T extends object>(
  name: string,
  create: () => T,
  validate: (value: unknown) => value is T,
  clone: (value: T) => T = value => structuredClone(value),
): ComponentSchema<T> => Object.freeze({ type: COMPONENT_TYPE(name), create, validate, clone });

class ComponentStore<T extends object> {
  readonly values = new Map<EntityId, T>();
  constructor(readonly schema: ComponentSchema<T>) {}
  has(entity: EntityId): boolean { return this.values.has(entity); }
  get(entity: EntityId): T | undefined { return this.values.get(entity); }
  set(entity: EntityId, value: T): void {
    if (!this.schema.validate(value)) throw new TypeError(`invalid component ${String(this.schema.type)}`);
    this.values.set(entity, value);
  }
  remove(entity: EntityId): boolean { return this.values.delete(entity); }
  clear(): void { this.values.clear(); }
}

export class EcsWorld implements Disposable {
  private readonly entitiesValue = new Set<EntityId>();
  private readonly schemas = new Map<ComponentType, ComponentSchema<any>>();
  private readonly stores = new Map<ComponentType, ComponentStore<any>>();
  private disposed = false;

  registerComponent<T extends object>(schema: ComponentSchema<T>): void {
    if (this.disposed) throw new Error('ECS world disposed');
    if (this.schemas.has(schema.type)) throw new Error(`component collision: ${String(schema.type)}`);
    this.schemas.set(schema.type, schema);
    this.stores.set(schema.type, new ComponentStore(schema));
  }

  createEntity(id?: string): EntityId {
    if (this.disposed) throw new Error('ECS world disposed');
    const entity = ENTITY_ID(id ?? `entity:${this.entitiesValue.size.toString(36)}`);
    if (this.entitiesValue.has(entity)) throw new Error(`entity collision: ${String(entity)}`);
    this.entitiesValue.add(entity);
    return entity;
  }

  destroyEntity(entity: EntityId): boolean {
    if (!this.entitiesValue.delete(entity)) return false;
    for (const store of this.stores.values()) store.remove(entity);
    return true;
  }

  add<T extends object>(entity: EntityId, schema: ComponentSchema<T>, value?: T): T {
    this.assertEntity(entity);
    const registered = this.stores.get(schema.type) as ComponentStore<T> | undefined;
    if (!registered) throw new Error(`component not registered: ${String(schema.type)}`);
    const component = value ?? schema.create();
    registered.set(entity, component);
    return component;
  }

  get<T extends object>(entity: EntityId, schema: ComponentSchema<T>): T | undefined {
    return (this.stores.get(schema.type) as ComponentStore<T> | undefined)?.get(entity);
  }

  require<T extends object>(entity: EntityId, schema: ComponentSchema<T>): T {
    const component = this.get(entity, schema);
    if (!component) throw new Error(`component ${String(schema.type)} missing from ${String(entity)}`);
    return component;
  }

  remove<T extends object>(entity: EntityId, schema: ComponentSchema<T>): boolean {
    return (this.stores.get(schema.type) as ComponentStore<T> | undefined)?.remove(entity) ?? false;
  }

  has(entity: EntityId, schema: ComponentSchema<object>): boolean { return this.stores.get(schema.type)?.has(entity) ?? false; }

  query(description: QueryDescription): EntityId[] {
    const all = description.all ?? [];
    const any = description.any ?? [];
    const none = description.none ?? [];
    return stableSort([...this.entitiesValue].filter(entity => {
      const allMatch = all.every(type => this.stores.get(type)?.has(entity) === true);
      const anyMatch = any.length === 0 || any.some(type => this.stores.get(type)?.has(entity) === true);
      const noneMatch = none.every(type => this.stores.get(type)?.has(entity) !== true);
      return allMatch && anyMatch && noneMatch;
    }), (a, b) => String(a).localeCompare(String(b)));
  }

  snapshot(): readonly EntitySnapshot[] {
    return stableSort([...this.entitiesValue].map(id => {
      const components: Record<string, unknown> = {};
      for (const [type, store] of this.stores) {
        const component = store.get(id);
        if (component !== undefined) components[String(type)] = this.schemas.get(type)?.clone ? this.schemas.get(type)!.clone!(component) : component;
      }
      return Object.freeze({ id, components: Object.freeze(components) });
    }), (a, b) => String(a.id).localeCompare(String(b.id)));
  }

  restore(snapshots: readonly EntitySnapshot[]): Result<void, string> {
    try {
      for (const entity of [...this.entitiesValue]) this.destroyEntity(entity);
      for (const snapshot of snapshots) {
        const entity = this.createEntity(String(snapshot.id));
        for (const [typeName, rawValue] of Object.entries(snapshot.components)) {
          const schema = [...this.schemas.entries()].find(([type]) => String(type) === typeName)?.[1];
          if (!schema || !schema.validate(rawValue)) continue;
          this.add(entity, schema, rawValue);
        }
      }
      return ok(undefined);
    } catch (cause) {
      return err(cause instanceof Error ? cause.message : 'ECS restore failed');
    }
  }

  get entityCount(): number { return this.entitiesValue.size; }
  get componentTypeCount(): number { return this.schemas.size; }

  clear(): void {
    for (const entity of [...this.entitiesValue]) this.destroyEntity(entity);
  }

  dispose(): void { if (!this.disposed) { this.clear(); this.schemas.clear(); this.stores.clear(); this.disposed = true; } }
  private assertEntity(entity: EntityId): void { if (!this.entitiesValue.has(entity)) throw new Error(`unknown entity: ${String(entity)}`); }
}

export class EcsScheduler implements Disposable {
  private readonly systems = new Map<SystemId, SystemDefinition>();
  private disposed = false;

  add(system: SystemDefinition): void {
    if (this.disposed) throw new Error('scheduler disposed');
    if (this.systems.has(system.id)) throw new Error(`system collision: ${String(system.id)}`);
    this.systems.set(system.id, Object.freeze({ ...system, order: Math.trunc(system.order) }));
  }

  remove(id: SystemId): boolean { return this.systems.delete(id); }

  run(world: EcsWorld, frame: FrameContext): number {
    const systems = stableSort([...this.systems.values()], (left, right) => left.order - right.order || String(left.id).localeCompare(String(right.id)));
    let ran = 0;
    for (const system of systems) {
      const context: SystemContext = Object.freeze({ frame, world, query: description => world.query(description) });
      system.update(context);
      ran += 1;
    }
    return ran;
  }

  snapshot(): readonly SystemDefinition[] { return stableSort([...this.systems.values()], (a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id))); }
  dispose(): void { this.systems.clear(); this.disposed = true; }
}

export interface TransformComponent { position: [number, number, number]; rotation: [number, number, number, number]; scale: [number, number, number]; }
export interface VelocityComponent { linear: [number, number, number]; angular: [number, number, number]; }
export interface HealthComponent { current: number; maximum: number; invulnerableUntil: number; }
export interface NameComponent { value: string; }

export const TRANSFORM = defineComponent<TransformComponent>('transform', () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }), value => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as TransformComponent;
  return Array.isArray(candidate.position) && candidate.position.length === 3 && candidate.position.every(Number.isFinite)
    && Array.isArray(candidate.rotation) && candidate.rotation.length === 4 && candidate.rotation.every(Number.isFinite)
    && Array.isArray(candidate.scale) && candidate.scale.length === 3 && candidate.scale.every(Number.isFinite);
});

export const VELOCITY = defineComponent<VelocityComponent>('velocity', () => ({ linear: [0, 0, 0], angular: [0, 0, 0] }), value => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as VelocityComponent;
  return Array.isArray(candidate.linear) && candidate.linear.length === 3 && candidate.linear.every(Number.isFinite) && Array.isArray(candidate.angular) && candidate.angular.length === 3 && candidate.angular.every(Number.isFinite);
});

export const HEALTH = defineComponent<HealthComponent>('health', () => ({ current: 100, maximum: 100, invulnerableUntil: 0 }), value => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as HealthComponent;
  return Number.isFinite(candidate.current) && Number.isFinite(candidate.maximum) && Number.isFinite(candidate.invulnerableUntil) && candidate.maximum >= 0 && candidate.current >= 0 && candidate.current <= candidate.maximum;
});

export const NAME = defineComponent<NameComponent>('name', () => ({ value: 'entity' }), value => !!value && typeof value === 'object' && typeof (value as NameComponent).value === 'string');
