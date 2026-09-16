import {
  type EntityIdV4,
  type Vec3V4,
  type TickId,
  type OutcomeV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
  entityIdV4,
  vec3V4,
  distanceSquaredV4,
  clampV4,
} from './runtimeContractsV4';

export type InterestTierV5 = 'active' | 'near' | 'mid' | 'far' | 'sleeping';
export type StreamingRegionV5 = 'core' | 'nearby' | 'remote' | 'unloaded';

export interface WorldEntityV5 {
  readonly id: EntityIdV4;
  position: Vec3V4;
  radius: number;
  priority: number;
  region: string;
  tier: InterestTierV5;
  lastTouchedTick: TickId;
  loaded: boolean;
  visible: boolean;
}

export interface InterestConfigV5 {
  readonly activeRadius?: number;
  readonly nearRadius?: number;
  readonly midRadius?: number;
  readonly farRadius?: number;
  readonly maxActive?: number;
  readonly maxNear?: number;
  readonly maxMid?: number;
  readonly maxFar?: number;
  readonly sleepAfterTicks?: number;
}

export interface StreamingRegionConfigV5 {
  readonly id: string;
  readonly center: Vec3V4;
  readonly radius: number;
  readonly priority: number;
  readonly assetIds: readonly string[];
}

export interface InterestResultV5 {
  readonly active: readonly WorldEntityV5[];
  readonly near: readonly WorldEntityV5[];
  readonly mid: readonly WorldEntityV5[];
  readonly far: readonly WorldEntityV5[];
  readonly sleeping: readonly WorldEntityV5[];
  readonly considered: number;
}

export interface WorldStreamingMetricsV5 {
  readonly entities: number;
  readonly regions: number;
  readonly active: number;
  readonly near: number;
  readonly mid: number;
  readonly far: number;
  readonly sleeping: number;
  readonly loaded: number;
  readonly unloaded: number;
  readonly classified: number;
  readonly regionQueries: number;
}

export interface WorldStreamingOptionsV5 {
  readonly cellSize?: number;
  readonly maxEntities?: number;
  readonly maxRegions?: number;
  readonly interest?: InterestConfigV5;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const tierRank: Record<InterestTierV5, number> = { active: 5, near: 4, mid: 3, far: 2, sleeping: 1 };

export class WorldStreamingV5 {
  readonly cellSize: number;
  readonly maxEntities: number;
  readonly maxRegions: number;
  readonly interest: Required<InterestConfigV5>;
  #cells = new Map<string, Set<EntityIdV4>>();
  #entities = new Map<EntityIdV4, WorldEntityV5>();
  #regions = new Map<string, StreamingRegionConfigV5>();
  #classified = 0;
  #regionQueries = 0;

  constructor(options: WorldStreamingOptionsV5 = {}) {
    this.cellSize = Math.max(4, finite(options.cellSize ?? 32, 32));
    this.maxEntities = Math.max(32, Math.trunc(options.maxEntities ?? 100_000));
    this.maxRegions = Math.max(8, Math.trunc(options.maxRegions ?? 4096));
    this.interest = {
      activeRadius: Math.max(1, finite(options.interest?.activeRadius ?? 24, 24)),
      nearRadius: Math.max(1, finite(options.interest?.nearRadius ?? 80, 80)),
      midRadius: Math.max(1, finite(options.interest?.midRadius ?? 250, 250)),
      farRadius: Math.max(1, finite(options.interest?.farRadius ?? 900, 900)),
      maxActive: Math.max(1, Math.trunc(options.interest?.maxActive ?? 128)),
      maxNear: Math.max(1, Math.trunc(options.interest?.maxNear ?? 512)),
      maxMid: Math.max(1, Math.trunc(options.interest?.maxMid ?? 2048)),
      maxFar: Math.max(1, Math.trunc(options.interest?.maxFar ?? 4096)),
      sleepAfterTicks: Math.max(1, Math.trunc(options.interest?.sleepAfterTicks ?? 600)),
    };
  }

  registerRegion(config: StreamingRegionConfigV5): OutcomeV4<StreamingRegionConfigV5> {
    if (!config.id.trim()) return failV4(createRuntimeErrorV4('WORLD_REGION_ID', 'Region id is required', false));
    if (!this.#regions.has(config.id) && this.#regions.size >= this.maxRegions) return failV4(createRuntimeErrorV4('WORLD_REGION_CAP', 'Region capacity reached', true));
    const normalized = Object.freeze({ ...config, center: vec3V4(config.center.x, config.center.y, config.center.z), radius: Math.max(1, finite(config.radius, 1)), priority: Math.trunc(finite(config.priority)), assetIds: Object.freeze([...new Set(config.assetIds.map(String))]) });
    this.#regions.set(config.id, normalized);
    return okV4(normalized);
  }

  unregisterRegion(id: string): boolean { return this.#regions.delete(id); }

  spawn(position: Vec3V4, id?: number, priority = 0, region = 'core', radius = 0.5): OutcomeV4<WorldEntityV5> {
    if (this.#entities.size >= this.maxEntities) return failV4(createRuntimeErrorV4('WORLD_ENTITY_CAP', 'World entity capacity reached', true));
    const numeric = id === undefined ? this.#nextId() : Math.max(1, Math.trunc(id));
    const entity: WorldEntityV5 = { id: entityIdV4(numeric), position: vec3V4(position.x, position.y, position.z), radius: Math.max(0, finite(radius, 0.5)), priority: Math.trunc(finite(priority)), region, tier: 'sleeping', lastTouchedTick: 0 as TickId, loaded: false, visible: false };
    this.#entities.set(entity.id, entity);
    this.#insertCell(entity.id, entity.position);
    return okV4(entity);
  }

  despawn(id: EntityIdV4): boolean {
    const entity = this.#entities.get(id);
    if (!entity) return false;
    this.#entities.delete(id);
    this.#removeCell(id, entity.position);
    return true;
  }

  update(id: EntityIdV4, position: Vec3V4, tick: TickId, patch: Partial<Pick<WorldEntityV5, 'priority' | 'region' | 'visible' | 'loaded'>> = {}): boolean {
    const entity = this.#entities.get(id);
    if (!entity) return false;
    const before = entity.position;
    const next = vec3V4(position.x, position.y, position.z);
    if (this.#cellOf(before) !== this.#cellOf(next)) { this.#removeCell(id, before); this.#insertCell(id, next); }
    entity.position = next;
    entity.lastTouchedTick = tick;
    if (patch.priority !== undefined) entity.priority = Math.trunc(patch.priority);
    if (patch.region !== undefined) entity.region = patch.region;
    if (patch.visible !== undefined) entity.visible = Boolean(patch.visible);
    if (patch.loaded !== undefined) entity.loaded = Boolean(patch.loaded);
    return true;
  }

  classify(center: Vec3V4, tick: TickId): InterestResultV5 {
    const active: WorldEntityV5[] = [];
    const near: WorldEntityV5[] = [];
    const mid: WorldEntityV5[] = [];
    const far: WorldEntityV5[] = [];
    const sleeping: WorldEntityV5[] = [];
    const candidates = this.#candidateEntities(center, this.interest.farRadius);
    for (const entity of candidates) {
      const distance = Math.sqrt(distanceSquaredV4(center, entity.position));
      const idleTicks = Number(tick) - Number(entity.lastTouchedTick);
      const tier: InterestTierV5 = idleTicks >= this.interest.sleepAfterTicks ? 'sleeping' : distance <= this.interest.activeRadius ? 'active' : distance <= this.interest.nearRadius ? 'near' : distance <= this.interest.midRadius ? 'mid' : distance <= this.interest.farRadius ? 'far' : 'sleeping';
      entity.tier = tier;
      entity.loaded = tier !== 'sleeping';
      if (tier === 'active') active.push(entity);
      else if (tier === 'near') near.push(entity);
      else if (tier === 'mid') mid.push(entity);
      else if (tier === 'far') far.push(entity);
      else sleeping.push(entity);
      this.#classified += 1;
    }
    const trim = (list: WorldEntityV5[], limit: number): readonly WorldEntityV5[] => Object.freeze(list.sort((a, b) => b.priority - a.priority || distanceSquaredV4(center, a.position) - distanceSquaredV4(center, b.position) || a.id - b.id).slice(0, limit));
    return Object.freeze({ active: trim(active, this.interest.maxActive), near: trim(near, this.interest.maxNear), mid: trim(mid, this.interest.maxMid), far: trim(far, this.interest.maxFar), sleeping: trim(sleeping, Number.POSITIVE_INFINITY), considered: candidates.length });
  }

  updateVisibility(center: Vec3V4, tick: TickId): InterestResultV5 {
    const result = this.classify(center, tick);
    const visible = new Set([...result.active, ...result.near].map((entity) => entity.id));
    for (const entity of this.#entities.values()) entity.visible = visible.has(entity.id);
    return result;
  }

  nearbyRegions(center: Vec3V4, radius: number, limit = 64): readonly StreamingRegionConfigV5[] {
    this.#regionQueries += 1;
    const maxSquared = Math.max(0, finite(radius)) ** 2;
    const regions = [...this.#regions.values()].filter((region) => distanceSquaredV4(center, region.center) <= (radius + region.radius) ** 2).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    return Object.freeze(regions.slice(0, Math.max(0, Math.trunc(limit))));
  }

  regionFor(position: Vec3V4): StreamingRegionConfigV5 | null {
    const regions = this.nearbyRegions(position, this.cellSize * 2, 8);
    return regions.find((region) => distanceSquaredV4(position, region.center) <= region.radius * region.radius) ?? null;
  }

  cellOf(position: Vec3V4): Readonly<{ x: number; y: number; z: number; key: string }> {
    const x = Math.floor(position.x / this.cellSize), y = Math.floor(position.y / this.cellSize), z = Math.floor(position.z / this.cellSize);
    return Object.freeze({ x, y, z, key: `${x},${y},${z}` });
  }

  entities(): readonly WorldEntityV5[] { return Object.freeze([...this.#entities.values()].sort((a, b) => tierRank[b.tier] - tierRank[a.tier] || b.priority - a.priority || a.id - b.id)); }

  metrics(): WorldStreamingMetricsV5 {
    const counts = { active: 0, near: 0, mid: 0, far: 0, sleeping: 0, loaded: 0, unloaded: 0 };
    for (const entity of this.#entities.values()) { counts[entity.tier] += 1; entity.loaded ? counts.loaded += 1 : counts.unloaded += 1; }
    return Object.freeze({ entities: this.#entities.size, regions: this.#regions.size, ...counts, classified: this.#classified, regionQueries: this.#regionQueries });
  }

  evictSleeping(max = 256): readonly EntityIdV4[] {
    const sleeping = [...this.#entities.values()].filter((entity) => entity.tier === 'sleeping').sort((a, b) => Number(a.lastTouchedTick) - Number(b.lastTouchedTick) || a.id - b.id).slice(0, Math.max(0, Math.trunc(max)));
    const ids: EntityIdV4[] = [];
    for (const entity of sleeping) if (this.despawn(entity.id)) ids.push(entity.id);
    return Object.freeze(ids);
  }

  clear(): void { this.#cells.clear(); this.#entities.clear(); this.#regions.clear(); this.#classified = 0; this.#regionQueries = 0; }

  #candidateEntities(center: Vec3V4, radius: number): WorldEntityV5[] {
    const range = Math.max(1, Math.ceil(radius / this.cellSize));
    const cell = this.cellOf(center);
    const result: WorldEntityV5[] = [];
    for (let x = cell.x - range; x <= cell.x + range; x += 1) for (let y = cell.y - range; y <= cell.y + range; y += 1) for (let z = cell.z - range; z <= cell.z + range; z += 1) {
      const ids = this.#cells.get(`${x},${y},${z}`);
      if (!ids) continue;
      for (const id of ids) {
        const entity = this.#entities.get(id);
        if (entity) result.push(entity);
      }
    }
    return result;
  }

  #insertCell(id: EntityIdV4, position: Vec3V4): void { const key = this.#cellOf(position); let ids = this.#cells.get(key); if (!ids) { ids = new Set(); this.#cells.set(key, ids); } ids.add(id); }
  #removeCell(id: EntityIdV4, position: Vec3V4): void { const key = this.#cellOf(position); const ids = this.#cells.get(key); if (!ids) return; ids.delete(id); if (!ids.size) this.#cells.delete(key); }
  #cellOf(position: Vec3V4): string { return `${Math.floor(position.x / this.cellSize)},${Math.floor(position.y / this.cellSize)},${Math.floor(position.z / this.cellSize)}`; }
  #nextId(): number { let max = 0; for (const id of this.#entities.keys()) max = Math.max(max, Number(id)); return max + 1; }
}

export function createWorldStreamingV5(options: WorldStreamingOptionsV5 = {}): WorldStreamingV5 { return new WorldStreamingV5(options); }
