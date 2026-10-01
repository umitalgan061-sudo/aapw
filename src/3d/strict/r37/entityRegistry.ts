import type { EntityKind, EntityRecord, EntityTransform, Vec3 } from './types.ts';
import { clamp, finite, vec3 } from './math.ts';

export interface EntityRegistryConfig {
  readonly maxEntities: number;
  readonly maxTagsPerEntity: number;
}

const DEFAULT_CONFIG: EntityRegistryConfig = Object.freeze({
  maxEntities: 4096,
  maxTagsPerEntity: 16,
});

export interface EntityPatch {
  readonly transform?: Partial<EntityTransform>;
  readonly active?: boolean;
  readonly tags?: readonly string[];
  readonly data?: Readonly<Record<string, unknown>>;
}

export class EntityRegistryR37 {
  readonly config: EntityRegistryConfig;
  #entities = new Map<string, EntityRecord>();

  constructor(config: Partial<EntityRegistryConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      maxEntities: Math.max(1, Math.trunc(finite(config.maxEntities, DEFAULT_CONFIG.maxEntities))),
      maxTagsPerEntity: Math.max(1, Math.trunc(finite(config.maxTagsPerEntity, DEFAULT_CONFIG.maxTagsPerEntity))),
    });
  }

  create(input: {
    readonly id: string;
    readonly kind: EntityKind;
    readonly position?: Vec3;
    readonly rotation?: Vec3;
    readonly scale?: Vec3;
    readonly tags?: readonly string[];
    readonly data?: Readonly<Record<string, unknown>>;
  }): EntityRecord | null {
    const id = sanitizeId(input.id);
    if (!id || this.#entities.has(id) || this.#entities.size >= this.config.maxEntities) return null;
    const record = Object.freeze({
      id,
      kind: input.kind,
      transform: freezeTransform({
        position: input.position ?? vec3(),
        rotation: input.rotation ?? vec3(),
        scale: input.scale ?? vec3(1, 1, 1),
      }),
      active: true,
      version: 1,
      tags: Object.freeze((input.tags ?? []).slice(0, this.config.maxTagsPerEntity).map((tag) => String(tag).slice(0, 64))),
      data: Object.freeze({ ...(input.data ?? {}) }),
    });
    this.#entities.set(id, record);
    return record;
  }

  get(id: string): EntityRecord | undefined {
    return this.#entities.get(sanitizeId(id));
  }

  patch(id: string, patch: EntityPatch): EntityRecord | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const nextTransform = patch.transform
      ? freezeTransform({
          position: patch.transform.position ?? current.transform.position,
          rotation: patch.transform.rotation ?? current.transform.rotation,
          scale: patch.transform.scale ?? current.transform.scale,
        })
      : current.transform;
    const next: EntityRecord = Object.freeze({
      ...current,
      transform: nextTransform,
      active: patch.active ?? current.active,
      tags: patch.tags ? Object.freeze(patch.tags.slice(0, this.config.maxTagsPerEntity).map((tag) => String(tag).slice(0, 64))) : current.tags,
      data: patch.data ? Object.freeze({ ...patch.data }) : current.data,
      version: current.version + 1,
    });
    this.#entities.set(current.id, next);
    return next;
  }

  remove(id: string): boolean {
    return this.#entities.delete(sanitizeId(id));
  }

  clear(): void {
    this.#entities.clear();
  }

  values(): readonly EntityRecord[] {
    return Object.freeze([...this.#entities.values()]);
  }

  activeValues(): readonly EntityRecord[] {
    return Object.freeze([...this.#entities.values()].filter((entity) => entity.active));
  }

  byKind(kind: EntityKind): readonly EntityRecord[] {
    return Object.freeze([...this.#entities.values()].filter((entity) => entity.kind === kind));
  }

  count(): number {
    return this.#entities.size;
  }

  snapshot(): readonly EntityRecord[] {
    return Object.freeze([...this.#entities.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  restore(records: readonly EntityRecord[]): void {
    this.#entities.clear();
    for (const record of records.slice(0, this.config.maxEntities)) {
      const id = sanitizeId(record.id);
      if (!id) continue;
      this.#entities.set(id, Object.freeze({
        ...record,
        id,
        transform: freezeTransform(record.transform),
        tags: Object.freeze([...record.tags].slice(0, this.config.maxTagsPerEntity)),
        data: Object.freeze({ ...record.data }),
      }));
    }
  }
}

function sanitizeId(value: unknown): string {
  return String(value ?? '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 96);
}

function freezeTransform(transform: EntityTransform): EntityTransform {
  return Object.freeze({
    position: vec3(transform.position.x, transform.position.y, transform.position.z),
    rotation: vec3(transform.rotation.x, transform.rotation.y, transform.rotation.z),
    scale: vec3(
      clamp(finite(transform.scale.x, 1), -1000, 1000),
      clamp(finite(transform.scale.y, 1), -1000, 1000),
      clamp(finite(transform.scale.z, 1), -1000, 1000),
    ),
  });
}
