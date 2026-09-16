import { asEntityId, stableSort, type Disposable, type EntityId, type V7Result } from './primitives.js';

export interface ComponentSchema<T> { readonly name: string; readonly defaults: T; readonly validate?: (value: T) => boolean; }
export interface EntityRecord { readonly id: EntityId; readonly generation: number; readonly alive: boolean; }
export interface QuerySpec { readonly required: readonly string[]; readonly excluded?: readonly string[]; readonly limit?: number; }
export interface EcsStats { readonly entities: number; readonly components: number; readonly archetypes: number; readonly mutations: number; }

type ComponentValue = Record<string, unknown> | unknown;

export class TypedEcsWorld implements Disposable {
  readonly maxEntities: number; readonly maxComponentsPerEntity: number;
  #entities = new Map<EntityId, EntityRecord>(); #stores = new Map<string, Map<EntityId, ComponentValue>>(); #schemas = new Map<string, ComponentSchema<any>>(); #generation = new Map<EntityId, number>(); #mutations = 0; #disposed = false;
  constructor(maxEntities = 8192, maxComponentsPerEntity = 32) { this.maxEntities = Math.max(1, Math.min(100_000, Math.trunc(maxEntities))); this.maxComponentsPerEntity = Math.max(1, Math.min(128, Math.trunc(maxComponentsPerEntity))); }
  registerComponent<T>(schema: ComponentSchema<T>): V7Result<void> { if (this.#disposed) return this.fail('ECS_DISPOSED'); if (!schema.name || this.#schemas.has(schema.name)) return this.fail('COMPONENT_INVALID'); this.#schemas.set(schema.name, schema); this.#stores.set(schema.name, new Map()); return { ok: true, value: undefined }; }
  create(id?: string): V7Result<EntityId> { if (this.#disposed) return this.fail('ECS_DISPOSED'); if (this.#entities.size >= this.maxEntities) return this.fail('ENTITY_LIMIT'); const entity = asEntityId(id ?? `entity:${this.#entities.size + 1}`); if (this.#entities.has(entity)) return this.fail('ENTITY_DUPLICATE'); const generation = (this.#generation.get(entity) ?? 0) + 1; const record = Object.freeze({ id: entity, generation, alive: true }); this.#entities.set(entity, record); this.#generation.set(entity, generation); this.#mutations += 1; return { ok: true, value: entity }; }
  destroy(id: EntityId): boolean { if (!this.#entities.delete(id)) return false; for (const store of this.#stores.values()) store.delete(id); this.#mutations += 1; return true; }
  add<T>(id: EntityId, schemaName: string, value?: T): boolean { const entity = this.#entities.get(id); const schema = this.#schemas.get(schemaName); const store = this.#stores.get(schemaName); if (!entity || !schema || !store) return false; if (!schema.validate?.(value ?? schema.defaults) ?? false) return false; if (!store.has(id) && this.#componentCount(id) >= this.maxComponentsPerEntity) return false; store.set(id, structuredClone(value ?? schema.defaults)); this.#mutations += 1; return true; }
  remove(id: EntityId, schemaName: string): boolean { const store = this.#stores.get(schemaName); if (!store) return false; const removed = store.delete(id); if (removed) this.#mutations += 1; return removed; }
  get<T>(id: EntityId, schemaName: string): T | undefined { return this.#stores.get(schemaName)?.get(id) as T | undefined; }
  has(id: EntityId, schemaName: string): boolean { return this.#stores.get(schemaName)?.has(id) ?? false; }
  set<T>(id: EntityId, schemaName: string, value: T): boolean { if (!this.has(id, schemaName)) return false; const schema = this.#schemas.get(schemaName); if (schema?.validate && !schema.validate(value)) return false; this.#stores.get(schemaName)!.set(id, structuredClone(value)); this.#mutations += 1; return true; }
  query(spec: QuerySpec): readonly EntityId[] { if (this.#disposed) return []; const required = [...new Set(spec.required ?? [])]; const excluded = new Set(spec.excluded ?? []); const candidates = required.length ? [...(this.#stores.get(required[0]!)?.keys() ?? [])] : [...this.#entities.keys()]; const result = candidates.filter((id) => this.#entities.has(id) && required.every((name) => this.has(id, name)) && [...excluded].every((name) => !this.has(id, name))).sort((a, b) => String(a).localeCompare(String(b))); return Object.freeze(result.slice(0, Math.max(1, Math.min(100_000, Math.trunc(spec.limit ?? result.length))))); }
  components(id: EntityId): readonly string[] { return Object.freeze(stableSort([...this.#stores.entries()].filter(([, store]) => store.has(id)).map(([name]) => name), (a, b) => a.localeCompare(b))); }
  snapshot(): Readonly<{ entities: readonly EntityRecord[]; components: Readonly<Record<string, number>> }> { const components = Object.fromEntries([...this.#stores.entries()].map(([name, store]) => [name, store.size])); return Object.freeze({ entities: Object.freeze(stableSort([...this.#entities.values()], (a, b) => String(a.id).localeCompare(String(b.id)))), components: Object.freeze(components) }); }
  stats(): EcsStats { return Object.freeze({ entities: this.#entities.size, components: [...this.#stores.values()].reduce((sum, store) => sum + store.size, 0), archetypes: this.#stores.size, mutations: this.#mutations }); }
  dispose(): void { this.#disposed = true; this.#entities.clear(); this.#stores.clear(); this.#schemas.clear(); this.#generation.clear(); }
  #componentCount(id: EntityId): number { let count = 0; for (const store of this.#stores.values()) count += Number(store.has(id)); return count; }
  #fail<T>(code: string): V7Result<T> { return { ok: false, code, message: code, retryable: false }; }
}
