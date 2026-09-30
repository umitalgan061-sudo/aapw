import { distanceSqR29, freezeR29, type R29EntityRecord, type R29EntityTransform, type R29StreamingPlan, type R29Vector3, type R29WorldInterest, type R29WorldZone } from './contracts.ts';

interface MutableZone {
  id: string;
  x: number;
  z: number;
  radiusMeters: number;
  estimatedBytes: number;
  priority: number;
  state: R29WorldZone['state'];
  lastTouchedTick: number;
  generation: number;
}

interface MutableEntity {
  id: number;
  generation: number;
  kind: string;
  transform: R29EntityTransform;
  importance: number;
  tags: readonly string[];
}

export interface R29WorldRuntimeOptions {
  readonly zoneSizeMeters?: number;
  readonly maxResidentBytes?: number;
  readonly loadBudgetBytesPerFrame?: number;
  readonly unloadGraceTicks?: number;
}

export interface R29WorldSnapshot {
  readonly revision: number;
  readonly zones: readonly R29WorldZone[];
  readonly entities: readonly R29EntityRecord[];
  readonly residentBytes: number;
  readonly activeEntities: number;
}

export class R29WorldRuntime {
  readonly zoneSizeMeters: number;
  readonly maxResidentBytes: number;
  readonly loadBudgetBytesPerFrame: number;
  readonly unloadGraceTicks: number;

  #zones = new Map<string, MutableZone>();
  #entities = new Map<number, MutableEntity>();
  #entityGenerations = new Map<number, number>();
  #nextEntityId = 1;
  #revision = 0;

  constructor(options: R29WorldRuntimeOptions = {}) {
    this.zoneSizeMeters = Math.max(16, options.zoneSizeMeters ?? 256);
    this.maxResidentBytes = Math.max(8 * 1024 * 1024, options.maxResidentBytes ?? 768 * 1024 * 1024);
    this.loadBudgetBytesPerFrame = Math.max(1 * 1024 * 1024, options.loadBudgetBytesPerFrame ?? 32 * 1024 * 1024);
    this.unloadGraceTicks = Math.max(1, Math.floor(options.unloadGraceTicks ?? 120));
  }

  registerZone(zone: Omit<R29WorldZone, 'state' | 'lastTouchedTick' | 'generation'>): void {
    const current = this.#zones.get(zone.id);
    if (current) {
      current.x = zone.x;
      current.z = zone.z;
      current.radiusMeters = zone.radiusMeters;
      current.estimatedBytes = zone.estimatedBytes;
      current.priority = zone.priority;
      current.lastTouchedTick = 0;
      this.#revision += 1;
      return;
    }
    this.#zones.set(zone.id, {
      ...zone,
      state: 'cold',
      lastTouchedTick: 0,
      generation: 0,
    });
    this.#revision += 1;
  }

  createEntity(input: {
    readonly kind: string;
    readonly position?: R29Vector3;
    readonly velocity?: R29Vector3;
    readonly rotationY?: number;
    readonly importance?: number;
    readonly tags?: readonly string[];
  }): number {
    const id = this.#nextEntityId++;
    const generation = this.#entityGenerations.get(id) ?? 0;
    this.#entities.set(id, {
      id,
      generation,
      kind: input.kind,
      transform: {
        entityId: id,
        position: freezeR29({ ...(input.position ?? { x: 0, y: 0, z: 0 }) }),
        velocity: freezeR29({ ...(input.velocity ?? { x: 0, y: 0, z: 0 }) }),
        rotationY: Number.isFinite(input.rotationY) ? input.rotationY ?? 0 : 0,
        scale: freezeR29({ x: 1, y: 1, z: 1 }),
        active: true,
        revision: 0,
      },
      importance: Math.max(0, input.importance ?? 1),
      tags: freezeR29([...(input.tags ?? [])]),
    });
    this.#revision += 1;
    return id;
  }

  destroyEntity(id: number): boolean {
    const existed = this.#entities.delete(id);
    if (existed) {
      this.#entityGenerations.set(id, (this.#entityGenerations.get(id) ?? 0) + 1);
      this.#revision += 1;
    }
    return existed;
  }

  updateTransform(id: number, patch: Partial<Omit<R29EntityTransform, 'entityId' | 'revision'>>): boolean {
    const entity = this.#entities.get(id);
    if (!entity) return false;
    const current = entity.transform;
    entity.transform = freezeR29({
      ...current,
      ...patch,
      entityId: id,
      revision: current.revision + 1,
    });
    this.#revision += 1;
    return true;
  }

  setEntityActive(id: number, active: boolean): boolean {
    return this.updateTransform(id, { active });
  }

  plan(interest: R29WorldInterest, frame: number): R29StreamingPlan {
    const desired = new Set<string>();
    const prefetch = new Set<string>();
    const radiusSq = interest.radiusMeters * interest.radiusMeters;
    const prefetchSq = (interest.radiusMeters + interest.prefetchMeters) ** 2;

    for (const zone of this.#zones.values()) {
      const dx = zone.x - interest.x;
      const dz = zone.z - interest.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq <= radiusSq) desired.add(zone.id);
      else if (distanceSq <= prefetchSq) prefetch.add(zone.id);
    }

    let bytes = [...this.#zones.values()]
      .filter((zone) => zone.state === 'ready' || zone.state === 'loading')
      .reduce((sum, zone) => sum + zone.estimatedBytes, 0);

    const load = [...desired]
      .filter((id) => this.#zones.get(id)?.state === 'cold')
      .sort((a, b) => this.#priority(b) - this.#priority(a));
    const selectedLoad: string[] = [];
    let frameLoadBytes = 0;
    for (const id of load) {
      const zone = this.#zones.get(id);
      if (!zone) continue;
      if (frameLoadBytes + zone.estimatedBytes > this.loadBudgetBytesPerFrame) continue;
      if (bytes + zone.estimatedBytes > this.maxResidentBytes) continue;
      selectedLoad.push(id);
      frameLoadBytes += zone.estimatedBytes;
      bytes += zone.estimatedBytes;
      zone.state = 'loading';
      zone.lastTouchedTick = frame;
      zone.generation += 1;
    }

    const retain = [...desired].filter((id) => this.#zones.get(id)?.state === 'ready');
    const selectedPrefetch = [...prefetch]
      .filter((id) => this.#zones.get(id)?.state === 'cold')
      .sort((a, b) => this.#priority(b) - this.#priority(a));

    const unload = [...this.#zones.values()]
      .filter((zone) =>
        (zone.state === 'ready' || zone.state === 'loading' || zone.state === 'cooling') &&
        !desired.has(zone.id) &&
        frame - zone.lastTouchedTick >= this.unloadGraceTicks,
      )
      .sort((a, b) => this.#priority(a) - this.#priority(b))
      .map((zone) => {
        zone.state = 'cooling';
        return zone.id;
      });

    this.#revision += selectedLoad.length + unload.length;
    return freezeR29({
      frame,
      load: selectedLoad,
      retain,
      unload,
      prefetch: selectedPrefetch,
      estimatedBytesAfter: bytes,
    });
  }

  markLoaded(id: string, tick: number): boolean {
    const zone = this.#zones.get(id);
    if (!zone) return false;
    zone.state = 'ready';
    zone.lastTouchedTick = tick;
    this.#revision += 1;
    return true;
  }

  markFailed(id: string): boolean {
    const zone = this.#zones.get(id);
    if (!zone) return false;
    zone.state = 'failed';
    this.#revision += 1;
    return true;
  }

  markUnloaded(id: string): boolean {
    const zone = this.#zones.get(id);
    if (!zone) return false;
    zone.state = 'cold';
    zone.lastTouchedTick = 0;
    this.#revision += 1;
    return true;
  }

  entitiesWithin(center: R29Vector3, radiusMeters: number, maxResults = 256): readonly R29EntityRecord[] {
    const limit = Math.max(1, Math.floor(maxResults));
    const radiusSq = radiusMeters * radiusMeters;
    return Object.freeze(
      [...this.#entities.values()]
        .filter((entity) => entity.transform.active && distanceSqR29(entity.transform.position, center) <= radiusSq)
        .sort((a, b) => {
          const da = distanceSqR29(a.transform.position, center);
          const db = distanceSqR29(b.transform.position, center);
          return da - db || b.importance - a.importance || a.id - b.id;
        })
        .slice(0, limit)
        .map((entity) => this.#toPublicEntity(entity)),
    );
  }

  entity(id: number): R29EntityRecord | null {
    const entity = this.#entities.get(id);
    return entity ? this.#toPublicEntity(entity) : null;
  }

  snapshot(): R29WorldSnapshot {
    const zones = [...this.#zones.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((zone) => ({ ...zone }));
    const entities = [...this.#entities.values()]
      .sort((a, b) => a.id - b.id)
      .map((entity) => this.#toPublicEntity(entity));
    return freezeR29({
      revision: this.#revision,
      zones: freezeR29(zones),
      entities: freezeR29(entities),
      residentBytes: zones.filter((zone) => zone.state === 'ready' || zone.state === 'loading')
        .reduce((sum, zone) => sum + zone.estimatedBytes, 0),
      activeEntities: entities.filter((entity) => entity.transform.active).length,
    });
  }

  reset(): void {
    this.#zones.clear();
    this.#entities.clear();
    this.#entityGenerations.clear();
    this.#nextEntityId = 1;
    this.#revision = 0;
  }

  #priority(id: string): number {
    return this.#zones.get(id)?.priority ?? 0;
  }

  #toPublicEntity(entity: MutableEntity): R29EntityRecord {
    return freezeR29({
      id: entity.id,
      generation: entity.generation,
      kind: entity.kind,
      transform: freezeR29({
        ...entity.transform,
        position: { ...entity.transform.position },
        velocity: { ...entity.transform.velocity },
        scale: { ...entity.transform.scale },
      }),
      importance: entity.importance,
      tags: freezeR29([...entity.tags]),
    });
  }
}
