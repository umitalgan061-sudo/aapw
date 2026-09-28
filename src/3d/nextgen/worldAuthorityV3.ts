/** Large-world entity authority with deterministic spawning, interest tiers and lifecycle state. */

import { DeterministicRng, distance3, type Vec3 } from './deterministicMath';

export type WorldLod = 0 | 1 | 2 | 3;
export type WorldEntityKind = 'player' | 'npc' | 'creature' | 'prop' | 'resource' | 'vehicle';
export type WorldLifecycle = 'spawned' | 'active' | 'sleeping' | 'despawning' | 'despawned';

export interface WorldEntity { id: number; kind: WorldEntityKind; position: Vec3; lod: WorldLod; lifecycle: WorldLifecycle; seed: number; owner: number | null; }
export interface SpawnRequest { kind: WorldEntityKind; position: Vec3; seedSalt: number; owner?: number | null; }
export interface InterestViewer { id: number; position: Vec3; highRadius: number; mediumRadius: number; lowRadius: number; }
export interface WorldPolicy { maxEntities: number; maxActiveEntities: number; maxSpawnsPerTick: number; despawnGraceTicks: number; }
export interface WorldTickResult { tick: number; spawned: number[]; activated: number[]; slept: number[]; despawned: number[]; }

const DEFAULT_POLICY: WorldPolicy = { maxEntities: 10000, maxActiveEntities: 3000, maxSpawnsPerTick: 64, despawnGraceTicks: 90 };
const VIEW_RADIUSES = {
  tight: [20, 60, 120],
  standard: [35, 100, 220],
  large: [50, 160, 320],
} as const satisfies Record<'tight' | 'standard' | 'large', readonly [number, number, number]>;

function cloneEntity(entity: WorldEntity): WorldEntity { return { ...entity, position: { ...entity.position } }; }

export class WorldAuthorityV3 {
  readonly policy: WorldPolicy;
  #entities = new Map<number, WorldEntity>();
  #nextId = 1;
  #pendingSpawns: SpawnRequest[] = [];
  #outOfInterestSince = new Map<number, number>();
  #rng: DeterministicRng;
  #tick = 0;

  constructor(seed = 1, policy?: Partial<WorldPolicy>) { this.#rng = new DeterministicRng(seed); this.policy = { ...DEFAULT_POLICY, ...policy }; }
  get tick(): number { return this.#tick; }
  get size(): number { return this.#entities.size; }
  entities(): readonly WorldEntity[] { return [...this.#entities.values()].sort((a, b) => a.id - b.id).map(cloneEntity); }
  get(id: number): WorldEntity | undefined { const entity = this.#entities.get(id); return entity ? cloneEntity(entity) : undefined; }

  queueSpawn(request: SpawnRequest): boolean {
    if (this.#entities.size + this.#pendingSpawns.length >= this.policy.maxEntities) return false;
    this.#pendingSpawns.push({ ...request, position: { ...request.position } });
    return true;
  }

  despawn(id: number): boolean {
    const entity = this.#entities.get(id);
    if (!entity || entity.lifecycle === 'despawned') return false;
    entity.lifecycle = 'despawning';
    return true;
  }

  setPosition(id: number, position: Vec3): void { const entity = this.require(id); entity.position = { ...position }; }

  classify(viewer: InterestViewer, entity: WorldEntity): WorldLod {
    const distance = distance3(viewer.position, entity.position);
    if (distance <= viewer.highRadius) return 0;
    if (distance <= viewer.mediumRadius) return 1;
    if (distance <= viewer.lowRadius) return 2;
    return 3;
  }

  updateInterest(viewers: readonly InterestViewer[]): void {
    const ordered = [...viewers].sort((a, b) => a.id - b.id);
    for (const entity of this.#entities.values()) {
      if (entity.lifecycle === 'despawned') continue;
      let best: WorldLod = 3;
      for (const viewer of ordered) best = Math.min(best, this.classify(viewer, entity)) as WorldLod;
      entity.lod = best;
      if (best === 3) {
        if (!this.#outOfInterestSince.has(entity.id)) this.#outOfInterestSince.set(entity.id, this.#tick);
      } else {
        this.#outOfInterestSince.delete(entity.id);
        if (entity.lifecycle === 'sleeping') entity.lifecycle = 'active';
      }
    }
  }

  step(viewers: readonly InterestViewer[] = []): WorldTickResult {
    this.#tick += 1;
    const spawned: number[] = []; const activated: number[] = []; const slept: number[] = []; const despawned: number[] = [];
    let spawnBudget = this.policy.maxSpawnsPerTick;
    while (spawnBudget > 0 && this.#pendingSpawns.length > 0 && this.#entities.size < this.policy.maxEntities) {
      const request = this.#pendingSpawns.shift()!;
      const id = this.#nextId++;
      const entity: WorldEntity = { id, kind: request.kind, position: { ...request.position }, lod: 3, lifecycle: 'spawned', seed: this.#rng.nextUint() ^ request.seedSalt, owner: request.owner ?? null };
      this.#entities.set(id, entity); spawned.push(id); spawnBudget -= 1;
    }
    this.updateInterest(viewers);
    let activeCount = 0;
    for (const entity of this.#entities.values()) if (entity.lifecycle === 'active' || entity.lifecycle === 'spawned') activeCount += 1;
    const ordered = [...this.#entities.values()].sort((a, b) => a.id - b.id);
    for (const entity of ordered) {
      if (entity.lifecycle === 'spawned') { entity.lifecycle = activeCount <= this.policy.maxActiveEntities || entity.kind === 'player' ? 'active' : 'sleeping'; if (entity.lifecycle === 'active') activated.push(entity.id); else slept.push(entity.id); }
      else if (entity.lifecycle === 'active' && entity.lod >= 2 && activeCount > this.policy.maxActiveEntities && entity.kind !== 'player') { entity.lifecycle = 'sleeping'; activeCount -= 1; slept.push(entity.id); }
      else if (entity.lifecycle === 'sleeping' && entity.lod <= 1 && activeCount < this.policy.maxActiveEntities) { entity.lifecycle = 'active'; activeCount += 1; activated.push(entity.id); }
      const outside = this.#outOfInterestSince.get(entity.id);
      if (outside !== undefined && this.#tick - outside >= this.policy.despawnGraceTicks && entity.kind !== 'player') { entity.lifecycle = 'despawned'; despawned.push(entity.id); }
      if (entity.lifecycle === 'despawning') { entity.lifecycle = 'despawned'; despawned.push(entity.id); }
    }
    for (const id of despawned) { this.#entities.delete(id); this.#outOfInterestSince.delete(id); }
    return { tick: this.#tick, spawned, activated, slept, despawned };
  }

  snapshot(): WorldEntity[] { return this.entities().map(cloneEntity); }

  restore(entities: readonly WorldEntity[], tick = 0): void {
    this.#entities.clear(); this.#pendingSpawns.length = 0; this.#outOfInterestSince.clear(); this.#tick = tick;
    for (const entity of entities) this.#entities.set(entity.id, cloneEntity(entity));
    this.#nextId = Math.max(1, ...entities.map((entity) => entity.id + 1));
  }

  private require(id: number): WorldEntity { const entity = this.#entities.get(id); if (!entity) throw new Error(`unknown world entity ${id}`); return entity; }
}

export function createWorldViewer(id: number, position: Vec3, preset: 'tight' | 'standard' | 'large' = 'standard'): InterestViewer {
  const radii = VIEW_RADIUSES[preset];
  return { id, position: { ...position }, highRadius: radii[0], mediumRadius: radii[1], lowRadius: radii[2] };
}
