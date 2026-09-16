import type { ComponentSchema, ComponentStore, ComponentType, EngineResult, EntityId, EntityRecord, QueryFilter, QueryResult } from './types.js';
import { COMPONENT_TYPE, ENTITY_ID } from './types.js';
import { stableEntityList } from './collections.js';

const ok = <T>(value: T): EngineResult<T> => ({ ok: true, value, meta: { status: 'ok', code: 'OK' } });
const fail = <T>(code: string, message?: string, status: 'rejected' | 'invalid' | 'disposed' = 'rejected'): EngineResult<T> => ({ ok: false, meta: { status, code, ...(message ? { message } : {}) } });

export class DenseComponentStore<T extends object> implements ComponentStore<T> {
  public readonly schema: ComponentSchema<T>;
  private readonly values = new Map<EntityId, T>();
  private _disposed = false;

  public constructor(schema: ComponentSchema<T>) { this.schema = schema; }
  public get disposed(): boolean { return this._disposed; }
  public get size(): number { return this.values.size; }
  public has(entity: EntityId): boolean { return !this._disposed && this.values.has(entity); }
  public get(entity: EntityId): Readonly<T> | undefined { return this._disposed ? undefined : this.values.get(entity); }

  public set(entity: EntityId, value: T): EngineResult<void> {
    if (this._disposed) return fail('STORE_DISPOSED', undefined, 'disposed');
    if (!this.schema.validate(value)) return fail('COMPONENT_INVALID', `Component ${this.schema.type} failed validation`, 'invalid');
    this.values.set(entity, this.clone(value));
    return ok(undefined);
  }

  public patch(entity: EntityId, patch: Partial<T>): EngineResult<void> {
    if (this._disposed) return fail('STORE_DISPOSED', undefined, 'disposed');
    const current = this.values.get(entity);
    if (!current) return fail('ENTITY_COMPONENT_MISSING');
    const candidate = { ...current, ...patch } as T;
    if (!this.schema.validate(candidate)) return fail('COMPONENT_INVALID', undefined, 'invalid');
    this.values.set(entity, this.clone(candidate));
    return ok(undefined);
  }

  public remove(entity: EntityId): boolean { return !this._disposed && this.values.delete(entity); }
  public clear(): void { this.values.clear(); }
  public entries(): IterableIterator<readonly [EntityId, Readonly<T>]> { return this.values.entries(); }
  public dispose(): void { this.values.clear(); this._disposed = true; }
  private clone(value: T): T { return this.schema.clone ? this.schema.clone(value) : structuredClone(value); }
}

export class EntityManager {
  private readonly entities = new Map<EntityId, EntityRecord>();
  private readonly reusable: EntityId[] = [];
  private readonly generations = new Map<string, number>();
  private nextId = 1;
  private _disposed = false;

  public get disposed(): boolean { return this._disposed; }
  public get size(): number { return this.entities.size; }

  public create(prefix = 'e'): EntityId {
    if (this._disposed) return ENTITY_ID(`disposed:${this.nextId++}`);
    const id = this.reusable.pop() ?? ENTITY_ID(`${prefix}:${this.nextId++}`);
    const generation = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, generation);
    this.entities.set(id, Object.freeze({ id, generation, alive: true }));
    return id;
  }

  public destroy(id: EntityId): boolean {
    if (this._disposed || !this.entities.has(id)) return false;
    this.entities.delete(id);
    this.reusable.push(id);
    return true;
  }

  public alive(id: EntityId): boolean { return !this._disposed && this.entities.get(id)?.alive === true; }
  public record(id: EntityId): EntityRecord | undefined { return this.entities.get(id); }
  public all(): EntityId[] { return stableEntityList([...this.entities.keys()]); }
  public clear(): void { this.entities.clear(); this.reusable.length = 0; }
  public dispose(): void { this.clear(); this.generations.clear(); this._disposed = true; }
}

export class EcsWorld {
  private readonly entityManager = new EntityManager();
  private readonly stores = new Map<ComponentType, DenseComponentStore<object>>();
  private _disposed = false;
  private revision = 0;

  public get disposed(): boolean { return this._disposed; }
  public get entityCount(): number { return this.entityManager.size; }
  public get componentStoreCount(): number { return this.stores.size; }
  public get worldRevision(): number { return this.revision; }

  public registerComponent<T extends object>(schema: ComponentSchema<T>): ComponentStore<T> {
    if (this._disposed) throw new Error('World disposed');
    if (this.stores.has(schema.type)) throw new Error(`Component already registered: ${schema.type}`);
    const store = new DenseComponentStore(schema);
    this.stores.set(schema.type, store as DenseComponentStore<object>);
    this.revision += 1;
    return store;
  }

  public createEntity(prefix = 'e'): EntityId { const id = this.entityManager.create(prefix); this.revision += 1; return id; }
  public destroyEntity(id: EntityId): boolean {
    if (!this.entityManager.destroy(id)) return false;
    for (const store of this.stores.values()) store.remove(id);
    this.revision += 1;
    return true;
  }

  public attach<T extends object>(entity: EntityId, type: ComponentType, value: T): EngineResult<void> {
    if (!this.entityManager.alive(entity)) return fail('ENTITY_DEAD');
    const store = this.stores.get(type) as DenseComponentStore<T> | undefined;
    if (!store) return fail('COMPONENT_UNKNOWN', String(type), 'invalid');
    const result = store.set(entity, value);
    if (result.ok) this.revision += 1;
    return result;
  }

  public patch<T extends object>(entity: EntityId, type: ComponentType, patch: Partial<T>): EngineResult<void> {
    if (!this.entityManager.alive(entity)) return fail('ENTITY_DEAD');
    const store = this.stores.get(type) as DenseComponentStore<T> | undefined;
    if (!store) return fail('COMPONENT_UNKNOWN', String(type), 'invalid');
    const result = store.patch(entity, patch);
    if (result.ok) this.revision += 1;
    return result;
  }

  public detach(entity: EntityId, type: ComponentType): boolean {
    const store = this.stores.get(type);
    const removed = store?.remove(entity) ?? false;
    if (removed) this.revision += 1;
    return removed;
  }

  public has(entity: EntityId, type: ComponentType): boolean { return this.stores.get(type)?.has(entity) ?? false; }

  public get<T extends object>(entity: EntityId, type: ComponentType): Readonly<T> | undefined {
    return (this.stores.get(type) as DenseComponentStore<T> | undefined)?.get(entity);
  }

  public query(filter: QueryFilter, maxResults = Number.MAX_SAFE_INTEGER): QueryResult {
    const all = filter.all ?? [];
    const any = filter.any ?? [];
    const none = filter.none ?? [];
    const candidates = this.selectCandidateStore(all, any);
    const result: EntityId[] = [];
    let scanned = 0;
    for (const entity of candidates) {
      scanned += 1;
      if (!this.matches(entity, all, any, none)) continue;
      if (result.length >= Math.max(0, Math.trunc(maxResults))) return { entities: result, scanned, matched: result.length, truncated: true };
      result.push(entity);
    }
    result.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    return { entities: result, scanned, matched: result.length, truncated: false };
  }

  public snapshotEntities(): readonly EntityRecord[] {
    return this.entityManager.all().map(id => this.entityManager.record(id)).filter((value): value is EntityRecord => value !== undefined);
  }

  public snapshotComponents(entity: EntityId): Readonly<Record<string, unknown>> {
    const snapshot: Record<string, unknown> = {};
    for (const [type, store] of this.stores) {
      const value = store.get(entity);
      if (value !== undefined) snapshot[String(type)] = structuredClone(value);
    }
    return Object.freeze(snapshot);
  }

  public clear(): void {
    this.entityManager.clear();
    for (const store of this.stores.values()) store.clear();
    this.revision += 1;
  }

  public dispose(): void {
    for (const store of this.stores.values()) store.dispose();
    this.stores.clear();
    this.entityManager.dispose();
    this._disposed = true;
  }

  private selectCandidateStore(all: readonly ComponentType[], any: readonly ComponentType[]): readonly EntityId[] {
    const candidates = all.length > 0 ? this.stores.get(all[0]!) : any.length > 0 ? this.stores.get(any[0]!) : undefined;
    if (candidates) return [...candidates.entries()].map(([entity]) => entity);
    return this.entityManager.all();
  }

  private matches(entity: EntityId, all: readonly ComponentType[], any: readonly ComponentType[], none: readonly ComponentType[]): boolean {
    if (all.some(type => !this.has(entity, type))) return false;
    if (any.length > 0 && !any.some(type => this.has(entity, type))) return false;
    if (none.some(type => this.has(entity, type))) return false;
    return true;
  }
}

export const defineComponent = <T extends object>(
  name: string,
  defaults: () => T,
  validate: (value: unknown) => value is T,
  clone?: (value: T) => T,
): ComponentSchema<T> => Object.freeze({ type: COMPONENT_TYPE(name), version: 1, defaults, validate, clone });

export interface TransformComponent { position: { x: number; y: number; z: number }; rotationY: number; scale: number; }
export const transformComponent = defineComponent<TransformComponent>('transform',
  () => ({ position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 }),
  (value): value is TransformComponent => {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as TransformComponent;
    return Number.isFinite(candidate.rotationY)
      && Number.isFinite(candidate.scale)
      && candidate.position !== null
      && Number.isFinite(candidate.position.x)
      && Number.isFinite(candidate.position.y)
      && Number.isFinite(candidate.position.z);
  },
  value => ({ position: { ...value.position }, rotationY: value.rotationY, scale: value.scale }),
);

export interface TagsComponent { tags: readonly string[]; }
export const tagsComponent = defineComponent<TagsComponent>('tags',
  () => ({ tags: [] }),
  (value): value is TagsComponent => Boolean(value && typeof value === 'object' && Array.isArray((value as TagsComponent).tags) && (value as TagsComponent).tags.every(tag => typeof tag === 'string')),
  value => ({ tags: [...value.tags].sort() }),
);
