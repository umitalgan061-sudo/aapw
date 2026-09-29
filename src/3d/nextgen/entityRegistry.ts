import type { EntityId, EntityRecord, LODLevel, StreamTier, Vec3 } from './kernelTypes.ts';
import { asEntityId, clamp, stableHash } from './kernelTypes.ts';

export interface EntityBudgetPolicy {
  readonly maxEntities: number;
  readonly maxResidentBytes: number;
  readonly maxUpdateMs: number;
  readonly lodNear: number;
  readonly lodMid: number;
  readonly lodFar: number;
}

export const DEFAULT_ENTITY_BUDGET_POLICY: EntityBudgetPolicy = Object.freeze({
  maxEntities: 4096,
  maxResidentBytes: 768 * 1024 * 1024,
  maxUpdateMs: 5,
  lodNear: 20,
  lodMid: 60,
  lodFar: 120,
});

export interface EntitySpec {
  readonly id: string;
  readonly position: Vec3;
  readonly importance?: number;
  readonly residentBytes?: number;
  readonly updateCostMs?: number;
  readonly tags?: readonly string[];
  readonly active?: boolean;
}

export interface EntityPlan {
  readonly resident: readonly EntityRecord[];
  readonly dormant: readonly EntityId[];
  readonly lodChanges: ReadonlyMap<EntityId, LODLevel>;
  readonly updateMs: number;
  readonly residentBytes: number;
  readonly digest: string;
}

const lodFor = (distance: number, policy: EntityBudgetPolicy): LODLevel =>
  distance <= policy.lodNear ? 0 : distance <= policy.lodMid ? 1 : distance <= policy.lodFar ? 2 : 3;

const tierFor = (distance: number, policy: EntityBudgetPolicy): StreamTier =>
  distance <= policy.lodNear ? 'critical'
    : distance <= policy.lodMid ? 'near'
    : distance <= policy.lodFar ? 'mid'
    : 'far';

export class EntityRegistry {
  readonly policy: EntityBudgetPolicy;
  #entities = new Map<EntityId, EntityRecord>();
  #disposed = false;

  constructor(policy: EntityBudgetPolicy = DEFAULT_ENTITY_BUDGET_POLICY) {
    this.policy = Object.freeze({ ...policy });
  }

  upsert(spec: EntitySpec): EntityId {
    if (this.#disposed) return asEntityId(spec.id);
    const id = asEntityId(spec.id);
    const previous = this.#entities.get(id);
    const next: EntityRecord = Object.freeze({
      id,
      position: spec.position,
      importance: clamp(spec.importance ?? previous?.importance ?? 1, 0, 100),
      lod: previous?.lod ?? 0,
      streamTier: previous?.streamTier ?? 'near',
      residentBytes: Math.max(0, Math.floor(spec.residentBytes ?? previous?.residentBytes ?? 0)),
      updateCostMs: Math.max(0, spec.updateCostMs ?? previous?.updateCostMs ?? 0.05),
      active: spec.active ?? previous?.active ?? true,
      tags: Object.freeze([...new Set(spec.tags ?? previous?.tags ?? [])].sort()),
    });
    this.#entities.set(id, next);
    return id;
  }

  remove(id: EntityId | string): boolean { return this.#entities.delete(asEntityId(String(id))); }
  get(id: EntityId | string): EntityRecord | null { return this.#entities.get(asEntityId(String(id))) ?? null; }
  values(): readonly EntityRecord[] { return Object.freeze([...this.#entities.values()].sort((a, b) => a.id.localeCompare(b.id))); }

  plan(center: Vec3): EntityPlan {
    if (this.#disposed) {
      return Object.freeze({ resident: [], dormant: [], lodChanges: new Map(), updateMs: 0, residentBytes: 0, digest: stableHash({ disposed: true }) });
    }

    const candidates = this.values().map((entity) => {
      const distance = Math.hypot(entity.position.x - center.x, entity.position.z - center.z);
      return { entity, distance };
    }).sort((a, b) =>
      b.entity.importance - a.entity.importance ||
      a.distance - b.distance ||
      a.entity.id.localeCompare(b.entity.id),
    );

    const resident: EntityRecord[] = [];
    const dormant: EntityId[] = [];
    const lodChanges = new Map<EntityId, LODLevel>();
    let updateMs = 0;
    let residentBytes = 0;

    for (const candidate of candidates) {
      const desiredLod = lodFor(candidate.distance, this.policy);
      const tier = tierFor(candidate.distance, this.policy);
      const next = Object.freeze({ ...candidate.entity, lod: desiredLod, streamTier: tier });
      const fits = resident.length < this.policy.maxEntities
        && residentBytes + next.residentBytes <= this.policy.maxResidentBytes
        && updateMs + next.updateCostMs <= this.policy.maxUpdateMs;

      if (fits || next.importance >= 90) {
        resident.push(next);
        residentBytes += next.residentBytes;
        updateMs += next.updateCostMs;
        if (desiredLod !== candidate.entity.lod) lodChanges.set(next.id, desiredLod);
      } else {
        dormant.push(next.id);
      }
    }

    return Object.freeze({
      resident: Object.freeze(resident),
      dormant: Object.freeze(dormant),
      lodChanges,
      updateMs,
      residentBytes,
      digest: stableHash({
        resident: resident.map((item) => [item.id, item.lod, item.streamTier]),
        dormant,
        updateMs,
        residentBytes,
      }),
    });
  }

  setActive(id: EntityId | string, active: boolean): boolean {
    const key = asEntityId(String(id));
    const entity = this.#entities.get(key);
    if (!entity) return false;
    this.#entities.set(key, Object.freeze({ ...entity, active }));
    return true;
  }

  move(id: EntityId | string, position: Vec3): boolean {
    const key = asEntityId(String(id));
    const entity = this.#entities.get(key);
    if (!entity) return false;
    this.#entities.set(key, Object.freeze({ ...entity, position }));
    return true;
  }

  queryRadius(center: Vec3, radius: number): readonly EntityRecord[] {
    const r = Math.max(0, radius);
    const r2 = r * r;
    return Object.freeze(this.values().filter((entity) => {
      const dx = entity.position.x - center.x;
      const dz = entity.position.z - center.z;
      return dx * dx + dz * dz <= r2;
    }));
  }

  queryTag(tag: string): readonly EntityRecord[] {
    return Object.freeze(this.values().filter((entity) => entity.tags.includes(tag)));
  }

  diagnostics() {
    return Object.freeze({
      count: this.#entities.size,
      active: this.values().filter((entity) => entity.active).length,
      residentBytes: this.values().reduce((sum, entity) => sum + entity.residentBytes, 0),
      digest: stableHash(this.values().map((entity) => ({
        id: entity.id,
        p: entity.position,
        lod: entity.lod,
        active: entity.active,
      }))),
    });
  }

  clear(): void { this.#entities.clear(); }
  dispose(): void { this.#disposed = true; this.clear(); }
}
