import { clamp, freeze, type EntityId, entityId } from '../domain/contracts.ts';

export type ComponentKey = string;
export type ComponentValue = Readonly<Record<string, unknown>> | object;

export interface EntitySnapshot {
  readonly id: EntityId;
  readonly generation: number;
  readonly alive: boolean;
  readonly components: readonly ComponentKey[];
  readonly tags: readonly string[];
}

export interface EntityQuery {
  readonly all?: readonly ComponentKey[];
  readonly any?: readonly ComponentKey[];
  readonly none?: readonly ComponentKey[];
  readonly tags?: readonly string[];
}

export interface EntityMetrics {
  readonly capacity: number;
  readonly alive: number;
  readonly recycled: number;
  readonly componentKinds: number;
  readonly queryCount: number;
  readonly queryMatches: number;
}

interface EntityRecord {
  readonly id: EntityId;
  readonly generation: number;
  alive: boolean;
  readonly components: Map<ComponentKey, ComponentValue>;
  readonly tags: Set<string>;
}

const normalizeKey = (value: string): string => value.trim().slice(0, 96);
const normalizeTags = (tags: readonly string[] = []): string[] => [...new Set(tags.map((tag) => normalizeKey(tag)).filter(Boolean))].slice(0, 64);

export class EntityStore {
  readonly #capacity: number;
  readonly #records = new Map<EntityId, EntityRecord>();
  readonly #free: EntityId[] = [];
  readonly #componentIndex = new Map<ComponentKey, Set<EntityId>>();
  #generation = 0;
  #recycled = 0;
  #queryCount = 0;
  #queryMatches = 0;
  #disposed = false;

  constructor(capacity = 50_000) { this.#capacity = Math.max(128, Math.floor(capacity)); }

  create(options: { id?: string; tags?: readonly string[] } = {}): EntityId {
    if (this.#disposed) throw new Error('Entity store is disposed.');
    const active = this.#records.size - this.#free.length;
    if (active >= this.#capacity && this.#free.length === 0) throw new Error('Entity capacity exceeded.');
    const recycled = this.#free.pop();
    const id = recycled ?? entityId(options.id ?? `entity-${this.#generation + 1}`);
    if (this.#records.has(id)) throw new Error(`Entity ${id} already exists.`);
    const record: EntityRecord = { id, generation: ++this.#generation, alive: true, components: new Map(), tags: new Set(normalizeTags(options.tags)) };
    this.#records.set(id, record);
    if (recycled) this.#recycled += 1;
    return id;
  }

  destroy(id: EntityId): boolean {
    const record = this.#records.get(id);
    if (!record?.alive) return false;
    for (const key of record.components.keys()) this.#componentIndex.get(key)?.delete(id);
    record.components.clear();
    record.tags.clear();
    record.alive = false;
    this.#free.push(id);
    return true;
  }

  add<T extends ComponentValue>(id: EntityId, key: ComponentKey, value: T): T {
    const record = this.#require(id);
    const normalized = normalizeKey(key);
    if (!normalized) throw new Error('Component key is required.');
    record.components.set(normalized, value);
    let index = this.#componentIndex.get(normalized);
    if (!index) { index = new Set(); this.#componentIndex.set(normalized, index); }
    index.add(id);
    return value;
  }

  remove(id: EntityId, key: ComponentKey): boolean {
    const record = this.#require(id);
    const normalized = normalizeKey(key);
    const removed = record.components.delete(normalized);
    if (removed) this.#componentIndex.get(normalized)?.delete(id);
    return removed;
  }

  get<T = ComponentValue>(id: EntityId, key: ComponentKey): T | undefined {
    return this.#records.get(id)?.components.get(normalizeKey(key)) as T | undefined;
  }

  has(id: EntityId, key: ComponentKey): boolean { return this.#records.get(id)?.components.has(normalizeKey(key)) ?? false; }

  addTag(id: EntityId, tag: string): boolean {
    const record = this.#require(id);
    const normalized = normalizeKey(tag);
    if (!normalized || record.tags.has(normalized)) return false;
    if (record.tags.size >= 64) return false;
    record.tags.add(normalized);
    return true;
  }

  removeTag(id: EntityId, tag: string): boolean { return this.#records.get(id)?.tags.delete(normalizeKey(tag)) ?? false; }
  hasTag(id: EntityId, tag: string): boolean { return this.#records.get(id)?.tags.has(normalizeKey(tag)) ?? false; }

  query(query: EntityQuery = {}): readonly EntityId[] {
    this.#queryCount += 1;
    const all = [...new Set(query.all?.map(normalizeKey).filter(Boolean) ?? [])];
    const any = [...new Set(query.any?.map(normalizeKey).filter(Boolean) ?? [])];
    const none = [...new Set(query.none?.map(normalizeKey).filter(Boolean) ?? [])];
    const tags = [...new Set(query.tags?.map(normalizeKey).filter(Boolean) ?? [])];
    let candidates: Iterable<EntityId>;
    if (all.length) {
      const firstSet = this.#componentIndex.get(all[0] ?? '');
      if (!firstSet) return [];
      candidates = [...firstSet].filter((id) => all.every((key) => this.#componentIndex.get(key)?.has(id)));
    } else if (any.length) {
      const merged = new Set<EntityId>();
      for (const key of any) for (const id of this.#componentIndex.get(key) ?? []) merged.add(id);
      candidates = merged;
    } else {
      candidates = [...this.#records.keys()];
    }
    const result: EntityId[] = [];
    for (const id of candidates) {
      const record = this.#records.get(id);
      if (!record?.alive) continue;
      if (none.some((key) => record.components.has(key))) continue;
      if (tags.some((tag) => !record.tags.has(tag))) continue;
      if (any.length && !any.some((key) => record.components.has(key))) continue;
      result.push(id);
    }
    result.sort((a, b) => String(a).localeCompare(String(b)));
    this.#queryMatches += result.length;
    return result;
  }

  each<T = ComponentValue>(key: ComponentKey, callback: (id: EntityId, component: T) => void): number {
    const ids = [...this.#componentIndex.get(normalizeKey(key)) ?? []].sort((a, b) => String(a).localeCompare(String(b)));
    for (const id of ids) {
      const component = this.get<T>(id, key);
      if (component !== undefined) callback(id, component);
    }
    return ids.length;
  }

  snapshot(id: EntityId): EntitySnapshot | undefined {
    const record = this.#records.get(id);
    if (!record?.alive) return undefined;
    return freeze({ id: record.id, generation: record.generation, alive: true, components: [...record.components.keys()].sort(), tags: [...record.tags].sort() });
  }

  snapshots(): readonly EntitySnapshot[] {
    return [...this.#records.values()].filter((record) => record.alive).sort((a, b) => String(a.id).localeCompare(String(b.id))).map((record) => this.snapshot(record.id)!).filter(Boolean);
  }

  metrics(): EntityMetrics {
    let alive = 0;
    for (const record of this.#records.values()) if (record.alive) alive += 1;
    return freeze({ capacity: this.#capacity, alive, recycled: this.#recycled, componentKinds: this.#componentIndex.size, queryCount: this.#queryCount, queryMatches: this.#queryMatches });
  }

  clear(): void {
    for (const record of this.#records.values()) {
      record.components.clear();
      record.tags.clear();
      record.alive = false;
    }
    this.#componentIndex.clear();
    this.#free.splice(0, this.#free.length, ...this.#records.keys());
  }

  dispose(): void { this.#disposed = true; this.clear(); this.#records.clear(); this.#free.length = 0; }

  #require(id: EntityId): EntityRecord {
    if (this.#disposed) throw new Error('Entity store is disposed.');
    const record = this.#records.get(id);
    if (!record?.alive) throw new Error(`Entity ${id} does not exist.`);
    return record;
  }
}

export interface SpatialComponent { readonly position: { readonly x: number; readonly y: number; readonly z: number }; readonly radius?: number; }
export const withinRadius = (store: EntityStore, ids: readonly EntityId[], center: { readonly x: number; readonly y: number; readonly z: number }, radius: number, componentKey = 'transform'): readonly EntityId[] => {
  const maxDistance = Math.max(0, radius);
  const result: EntityId[] = [];
  for (const id of ids) {
    const transform = store.get<SpatialComponent>(id, componentKey);
    if (!transform) continue;
    const dx = transform.position.x - center.x;
    const dy = transform.position.y - center.y;
    const dz = transform.position.z - center.z;
    const limit = maxDistance + Math.max(0, transform.radius ?? 0);
    if (dx * dx + dy * dy + dz * dz <= limit * limit) result.push(id);
  }
  return result.sort((a, b) => String(a).localeCompare(String(b)));
};

export const normalizedMass = (value: number): number => clamp(Number.isFinite(value) ? value : 0, 0, 1_000_000);
