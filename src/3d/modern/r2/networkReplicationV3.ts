import type { EntityId } from './simulationKernel.ts';
import { hashText, stableJson } from './ecsRuntime.ts';

export type ReplicationChannel = 'reliable' | 'unreliable' | 'state';
export type ReplicationKind = 'spawn' | 'update' | 'despawn' | 'event';

export interface NetworkTransform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface ReplicatedComponent {
  readonly type: string;
  readonly version: number;
  readonly value: unknown;
}

export interface ReplicatedEntity {
  readonly id: EntityId;
  readonly generation: number;
  readonly transform?: NetworkTransform;
  readonly components: readonly ReplicatedComponent[];
}

export interface ReplicationSnapshot {
  readonly protocol: 3;
  readonly tick: number;
  readonly baselineTick: number | null;
  readonly sequence: number;
  readonly entities: readonly ReplicatedEntity[];
  readonly events: readonly ReplicationEvent[];
  readonly digest: string;
}

export interface ReplicationEvent {
  readonly id: string;
  readonly tick: number;
  readonly channel: ReplicationChannel;
  readonly type: string;
  readonly payload: unknown;
}

export interface SnapshotDelta {
  readonly protocol: 3;
  readonly fromTick: number | null;
  readonly toTick: number;
  readonly sequence: number;
  readonly spawns: readonly ReplicatedEntity[];
  readonly updates: readonly EntityPatch[];
  readonly despawns: readonly EntityRef[];
  readonly events: readonly ReplicationEvent[];
  readonly digest: string;
}

export interface EntityRef {
  readonly id: EntityId;
  readonly generation: number;
}

export interface EntityPatch {
  readonly before: EntityRef;
  readonly after: EntityRef;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface ReplicationLimits {
  readonly maxEntities: number;
  readonly maxComponentsPerEntity: number;
  readonly maxEvents: number;
  readonly maxPayloadBytes: number;
  readonly historySize: number;
}

const DEFAULT_LIMITS: ReplicationLimits = {
  maxEntities: 50_000,
  maxComponentsPerEntity: 64,
  maxEvents: 512,
  maxPayloadBytes: 1_000_000,
  historySize: 32,
};

function validateEntity(entity: ReplicatedEntity, limits: ReplicationLimits): void {
  if (!Number.isInteger(entity.id) || entity.id <= 0) throw new Error('replicated entity id must be positive integer');
  if (!Number.isInteger(entity.generation) || entity.generation <= 0) throw new Error('replicated generation must be positive integer');
  if (entity.components.length > limits.maxComponentsPerEntity) throw new Error('component limit exceeded');
  if (entity.transform && ![entity.transform.x, entity.transform.y, entity.transform.z, entity.transform.yaw].every(Number.isFinite)) {
    throw new Error('invalid network transform');
  }
  for (const component of entity.components) {
    if (!component.type.trim() || component.type.length > 96) throw new Error('invalid component type');
    if (!Number.isInteger(component.version) || component.version < 1) throw new Error('invalid component version');
  }
}

function cloneEntity(entity: ReplicatedEntity): ReplicatedEntity {
  return {
    id: entity.id,
    generation: entity.generation,
    transform: entity.transform ? { ...entity.transform } : undefined,
    components: entity.components.map((component) => ({ ...component, value: structuredClone(component.value) })),
  };
}

function entityKey(entity: EntityRef): string {
  return `${entity.id}:${entity.generation}`;
}

function entityDigest(entity: ReplicatedEntity): string {
  return hashText(`${entity.id}:${entity.generation}:${stableJson(entity.transform)}:${stableJson(entity.components)}`);
}

export function normalizeReplicationLimits(partial: Partial<ReplicationLimits> = {}): ReplicationLimits {
  const limits = { ...DEFAULT_LIMITS, ...partial };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${key} must be positive integer`);
  }
  return Object.freeze(limits);
}

export class SnapshotBuilder {
  readonly #limits: ReplicationLimits;

  public constructor(limits: Partial<ReplicationLimits> = {}) {
    this.#limits = normalizeReplicationLimits(limits);
  }

  public build(
    tick: number,
    sequence: number,
    entities: readonly ReplicatedEntity[],
    events: readonly ReplicationEvent[] = [],
    baselineTick: number | null = null,
  ): ReplicationSnapshot {
    if (!Number.isInteger(tick) || tick < 0) throw new RangeError('invalid tick');
    if (!Number.isInteger(sequence) || sequence < 0) throw new RangeError('invalid sequence');
    if (entities.length > this.#limits.maxEntities) throw new Error('entity limit exceeded');
    if (events.length > this.#limits.maxEvents) throw new Error('event limit exceeded');
    const normalized = entities.map((entity) => {
      validateEntity(entity, this.#limits);
      return cloneEntity(entity);
    });
    normalized.sort((a, b) => a.id - b.id || a.generation - b.generation);
    const normalizedEvents = events.map((event) => ({ ...event, payload: structuredClone(event.payload) }));
    const digest = hashText(`${tick}:${sequence}:${normalized.map(entityDigest).join('|')}:${stableJson(normalizedEvents)}`);
    return Object.freeze({
      protocol: 3,
      tick,
      baselineTick,
      sequence,
      entities: normalized,
      events: normalizedEvents,
      digest,
    });
  }
}

export function diffSnapshots(before: ReplicationSnapshot | null, after: ReplicationSnapshot): SnapshotDelta {
  const previous = new Map<string, ReplicatedEntity>();
  for (const entity of before?.entities ?? []) previous.set(entityKey(entity), entity);
  const current = new Map<string, ReplicatedEntity>();
  for (const entity of after.entities) current.set(entityKey(entity), entity);

  const spawns: ReplicatedEntity[] = [];
  const updates: EntityPatch[] = [];
  for (const [key, entity] of current) {
    const prior = previous.get(key);
    if (!prior) {
      spawns.push(cloneEntity(entity));
      continue;
    }
    const fields = diffEntity(prior, entity);
    if (Object.keys(fields).length > 0) {
      updates.push({
        before: { id: prior.id, generation: prior.generation },
        after: { id: entity.id, generation: entity.generation },
        fields,
      });
    }
  }
  const despawns: EntityRef[] = [];
  for (const [key, entity] of previous) {
    if (!current.has(key)) despawns.push({ id: entity.id, generation: entity.generation });
  }
  const digest = hashText(`${after.tick}:${stableJson(spawns)}:${stableJson(updates)}:${stableJson(despawns)}:${stableJson(after.events)}`);
  return Object.freeze({
    protocol: 3,
    fromTick: before?.tick ?? null,
    toTick: after.tick,
    sequence: after.sequence,
    spawns,
    updates,
    despawns,
    events: after.events,
    digest,
  });
}

function diffEntity(before: ReplicatedEntity, after: ReplicatedEntity): Readonly<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};
  if (stableJson(before.transform) !== stableJson(after.transform)) fields.transform = after.transform;
  if (stableJson(before.components) !== stableJson(after.components)) fields.components = after.components;
  return fields;
}

export function applySnapshotDelta(base: ReplicationSnapshot | null, delta: SnapshotDelta): ReplicationSnapshot {
  const entities = new Map<string, ReplicatedEntity>();
  for (const entity of base?.entities ?? []) entities.set(entityKey(entity), cloneEntity(entity));
  for (const entity of delta.despawns) entities.delete(entityKey(entity));
  for (const entity of delta.spawns) entities.set(entityKey(entity), cloneEntity(entity));
  for (const patch of delta.updates) {
    const key = entityKey(patch.before);
    const existing = entities.get(key);
    if (!existing) continue;
    const next: ReplicatedEntity = {
      ...existing,
      ...(patch.fields.transform !== undefined ? { transform: structuredClone(patch.fields.transform) as NetworkTransform } : {}),
      ...(patch.fields.components !== undefined ? { components: structuredClone(patch.fields.components) as ReplicatedComponent[] } : {}),
    };
    entities.delete(key);
    entities.set(entityKey(patch.after), next);
  }
  const list = [...entities.values()].sort((a, b) => a.id - b.id || a.generation - b.generation);
  return Object.freeze({
    protocol: 3,
    tick: delta.toTick,
    baselineTick: delta.fromTick,
    sequence: delta.sequence,
    entities: list,
    events: delta.events.map((event) => ({ ...event, payload: structuredClone(event.payload) })),
    digest: hashText(`${delta.toTick}:${delta.sequence}:${list.map(entityDigest).join('|')}:${stableJson(delta.events)}`),
  });
}

export class ReplicationHistory {
  readonly #limit: number;
  readonly #snapshots: ReplicationSnapshot[] = [];

  public constructor(limit = DEFAULT_LIMITS.historySize) {
    if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('history limit must be positive integer');
    this.#limit = limit;
  }

  public push(snapshot: ReplicationSnapshot): void {
    const last = this.#snapshots.at(-1);
    if (last && snapshot.tick <= last.tick) throw new Error('snapshots must have increasing ticks');
    this.#snapshots.push(snapshot);
    while (this.#snapshots.length > this.#limit) this.#snapshots.shift();
  }

  public latest(): ReplicationSnapshot | undefined {
    return this.#snapshots.at(-1);
  }

  public find(tick: number): ReplicationSnapshot | undefined {
    return this.#snapshots.find((snapshot) => snapshot.tick === tick);
  }

  public range(fromTick: number, toTick: number): readonly ReplicationSnapshot[] {
    return this.#snapshots.filter((snapshot) => snapshot.tick >= fromTick && snapshot.tick <= toTick);
  }

  public size(): number {
    return this.#snapshots.length;
  }
}

export interface ReliableEventQueueItem extends ReplicationEvent {
  readonly sequence: number;
  acknowledged: boolean;
  attempts: number;
}

export class ReliableEventQueue {
  readonly #items = new Map<number, ReliableEventQueueItem>();
  #nextSequence = 1;

  public enqueue(event: Omit<ReplicationEvent, 'channel'>): ReliableEventQueueItem {
    const item: ReliableEventQueueItem = {
      ...event,
      channel: 'reliable',
      sequence: this.#nextSequence++,
      acknowledged: false,
      attempts: 0,
    };
    this.#items.set(item.sequence, item);
    return item;
  }

  public markSent(limit = 64): readonly ReliableEventQueueItem[] {
    const pending = [...this.#items.values()].filter((item) => !item.acknowledged).slice(0, Math.max(0, limit));
    for (const item of pending) item.attempts += 1;
    return pending;
  }

  public acknowledge(sequence: number): boolean {
    const item = this.#items.get(sequence);
    if (!item) return false;
    item.acknowledged = true;
    this.#items.delete(sequence);
    return true;
  }

  public pending(): readonly ReliableEventQueueItem[] {
    return [...this.#items.values()].filter((item) => !item.acknowledged);
  }

  public size(): number {
    return this.#items.size;
  }
}

export interface InterpolationSample {
  readonly tick: number;
  readonly transform: NetworkTransform;
}

export function interpolateTransform(a: InterpolationSample, b: InterpolationSample, tick: number): NetworkTransform {
  if (b.tick <= a.tick) throw new RangeError('sample ticks must increase');
  const t = Math.max(0, Math.min(1, (tick - a.tick) / (b.tick - a.tick)));
  return {
    x: a.transform.x + (b.transform.x - a.transform.x) * t,
    y: a.transform.y + (b.transform.y - a.transform.y) * t,
    z: a.transform.z + (b.transform.z - a.transform.z) * t,
    yaw: interpolateAngle(a.transform.yaw, b.transform.yaw, t),
  };
}

function interpolateAngle(a: number, b: number, t: number): number {
  let delta = (b - a + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

export interface NetworkJitterBufferConfig {
  readonly interpolationDelayTicks: number;
  readonly maxSamples: number;
}

export class NetworkJitterBuffer {
  readonly #config: NetworkJitterBufferConfig;
  readonly #samples = new Map<EntityId, InterpolationSample[]>();

  public constructor(config: NetworkJitterBufferConfig = { interpolationDelayTicks: 2, maxSamples: 32 }) {
    if (!Number.isInteger(config.interpolationDelayTicks) || config.interpolationDelayTicks < 0) throw new RangeError('invalid interpolation delay');
    if (!Number.isInteger(config.maxSamples) || config.maxSamples < 2) throw new RangeError('maxSamples must be >= 2');
    this.#config = Object.freeze(config);
  }

  public push(entity: EntityId, sample: InterpolationSample): void {
    const list = this.#samples.get(entity) ?? [];
    if (list.at(-1)?.tick === sample.tick) list[list.length - 1] = sample;
    else if (!list.at(-1) || sample.tick > list.at(-1)!.tick) list.push(sample);
    else return;
    while (list.length > this.#config.maxSamples) list.shift();
    this.#samples.set(entity, list);
  }

  public sample(entity: EntityId, renderTick: number): NetworkTransform | undefined {
    const list = this.#samples.get(entity);
    if (!list || list.length === 0) return undefined;
    const target = renderTick - this.#config.interpolationDelayTicks;
    if (list.length === 1) return { ...list[0]!.transform };
    for (let index = 1; index < list.length; index += 1) {
      const next = list[index]!;
      const previous = list[index - 1]!;
      if (target <= next.tick) return interpolateTransform(previous, next, target);
    }
    return { ...list.at(-1)!.transform };
  }

  public clear(entity?: EntityId): void {
    if (entity === undefined) this.#samples.clear();
    else this.#samples.delete(entity);
  }
}
