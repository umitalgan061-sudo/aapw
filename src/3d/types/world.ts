import type { NodeId, Vec3, Bounds, Tick, WorldId, AssetId, QualityTier } from './platform.js';

export type RegionId = string & { readonly __regionId: unique symbol };
export type EntityId = string & { readonly __entityId: unique symbol };
export type ComponentId = string & { readonly __componentId: unique symbol };
export type NavArea = 'walkable' | 'water' | 'climbable' | 'blocked' | 'hazard' | 'flight';
export type RegionState = 'unloaded' | 'queued' | 'loading' | 'active' | 'hibernating' | 'unloading' | 'failed';
export type EntityActivity = 'dormant' | 'simulated' | 'visible' | 'interactive';

export interface RegionBounds { readonly id: RegionId; readonly bounds: Bounds; readonly lod: number; }
export interface RegionDescriptor {
  readonly id: RegionId;
  readonly worldId: WorldId;
  readonly bounds: Bounds;
  readonly assets: readonly AssetId[];
  readonly neighbors: readonly RegionId[];
  readonly priority: number;
  readonly minQuality: QualityTier;
}

export interface RegionRuntimeRecord {
  readonly descriptor: RegionDescriptor;
  readonly state: RegionState;
  readonly lastVisibleTick: Tick;
  readonly lastActiveTick: Tick;
  readonly loadAttempts: number;
  readonly residentBytes: number;
  readonly error?: string;
}

export interface StreamRadiusPolicy {
  readonly preloadDistance: number;
  readonly activationDistance: number;
  readonly unloadDistance: number;
  readonly hysteresis: number;
}

export function shouldActivateRegion(region: RegionDescriptor, player: Vec3, policy: StreamRadiusPolicy): boolean {
  const dx = player.x - region.bounds.min.x;
  const dz = player.z - region.bounds.min.z;
  const radius = Math.max(region.bounds.radius, policy.activationDistance);
  return dx * dx + dz * dz <= radius * radius;
}

export function shouldUnloadRegion(region: RegionDescriptor, player: Vec3, policy: StreamRadiusPolicy): boolean {
  const dx = player.x - region.bounds.min.x;
  const dz = player.z - region.bounds.min.z;
  const radius = Math.max(region.bounds.radius, policy.unloadDistance + policy.hysteresis);
  return dx * dx + dz * dz > radius * radius;
}

export interface EntityTransformComponent { readonly position: Vec3; readonly rotation: readonly [number, number, number, number]; readonly scale: Vec3; }
export interface EntityRenderComponent { readonly nodeId: NodeId; readonly assetId: AssetId; readonly materialClass: string; readonly castsShadow: boolean; readonly visible: boolean; }
export interface EntityPhysicsComponent { readonly dynamic: boolean; readonly radius: number; readonly mass: number; readonly velocity: Vec3; }
export interface EntityAiComponent { readonly behavior: string; readonly alertness: number; readonly target?: EntityId; readonly nextThinkTick: Tick; }
export interface EntityGameplayComponent { readonly faction: string; readonly health: number; readonly maxHealth: number; readonly interactable: boolean; }

export interface WorldEntity {
  readonly id: EntityId;
  readonly regionId: RegionId;
  readonly activity: EntityActivity;
  readonly transform: EntityTransformComponent;
  readonly render?: EntityRenderComponent;
  readonly physics?: EntityPhysicsComponent;
  readonly ai?: EntityAiComponent;
  readonly gameplay?: EntityGameplayComponent;
  readonly tags: readonly string[];
}

export interface EntityQuery {
  readonly regionId?: RegionId;
  readonly center?: Vec3;
  readonly radius?: number;
  readonly activeOnly?: boolean;
  readonly requiredComponents?: readonly ComponentId[];
  readonly tags?: readonly string[];
  readonly limit?: number;
}

export interface WorldQueryIndex {
  insert(entity: WorldEntity): void;
  update(entity: WorldEntity): void;
  remove(id: EntityId): boolean;
  query(query: EntityQuery): readonly WorldEntity[];
  clear(): void;
}

const dist2 = (a: Vec3, b: Vec3): number => { const x = a.x - b.x; const y = a.y - b.y; const z = a.z - b.z; return x * x + y * y + z * z; };
const componentsOf = (entity: WorldEntity): Set<string> => {
  const set = new Set<string>(['transform']);
  if (entity.render) set.add('render');
  if (entity.physics) set.add('physics');
  if (entity.ai) set.add('ai');
  if (entity.gameplay) set.add('gameplay');
  return set;
};

export class DeterministicEntityIndex implements WorldQueryIndex {
  readonly #entities = new Map<EntityId, WorldEntity>();

  insert(entity: WorldEntity): void { if (this.#entities.has(entity.id)) throw new Error(`Entity exists: ${entity.id}`); this.#entities.set(entity.id, entity); }
  update(entity: WorldEntity): void { if (!this.#entities.has(entity.id)) throw new Error(`Entity not found: ${entity.id}`); this.#entities.set(entity.id, entity); }
  remove(id: EntityId): boolean { return this.#entities.delete(id); }
  clear(): void { this.#entities.clear(); }

  query(query: EntityQuery): readonly WorldEntity[] {
    let result = [...this.#entities.values()];
    if (query.regionId) result = result.filter((entity) => entity.regionId === query.regionId);
    if (query.activeOnly) result = result.filter((entity) => entity.activity !== 'dormant');
    if (query.requiredComponents?.length) result = result.filter((entity) => { const components = componentsOf(entity); return query.requiredComponents.every((component) => components.has(component)); });
    if (query.tags?.length) result = result.filter((entity) => query.tags?.every((tag) => entity.tags.includes(tag)));
    if (query.center && query.radius !== undefined) {
      if (query.radius < 0 || !Number.isFinite(query.radius)) throw new RangeError('Entity query radius invalid');
      const radius2 = query.radius * query.radius;
      result = result.filter((entity) => dist2(query.center as Vec3, entity.transform.position) <= radius2);
    }
    result.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return query.limit === undefined ? result : result.slice(0, Math.max(0, Math.floor(query.limit)));
  }

  get size(): number { return this.#entities.size; }
  values(): readonly WorldEntity[] { return [...this.#entities.values()]; }
}

export interface NavNode { readonly id: string; readonly position: Vec3; readonly area: NavArea; readonly neighbors: readonly string[]; readonly cost: number; }
export interface NavPath { readonly nodes: readonly string[]; readonly cost: number; readonly complete: boolean; readonly expanded: number; }

export interface NavigationGraph {
  add(node: NavNode): void;
  remove(id: string): boolean;
  nearest(position: Vec3, area?: NavArea): NavNode | undefined;
  path(start: string, goal: string, maxExpansions?: number): NavPath;
}

const nodeDistance = (a: NavNode, b: NavNode): number => Math.sqrt(dist2(a.position, b.position));

export class DeterministicNavigationGraph implements NavigationGraph {
  readonly #nodes = new Map<string, NavNode>();

  add(node: NavNode): void { if (this.#nodes.has(node.id)) throw new Error(`Navigation node exists: ${node.id}`); this.#nodes.set(node.id, Object.freeze({ ...node, neighbors: [...node.neighbors] })); }
  remove(id: string): boolean { return this.#nodes.delete(id); }

  nearest(position: Vec3, area?: NavArea): NavNode | undefined {
    return [...this.#nodes.values()].filter((node) => !area || node.area === area).sort((a, b) => dist2(position, a.position) - dist2(position, b.position) || a.id.localeCompare(b.id))[0];
  }

  path(start: string, goal: string, maxExpansions = 4096): NavPath {
    const source = this.#nodes.get(start); const target = this.#nodes.get(goal);
    if (!source || !target) return { nodes: [], cost: Number.POSITIVE_INFINITY, complete: false, expanded: 0 };
    if (start === goal) return { nodes: [start], cost: 0, complete: true, expanded: 0 };
    const open = new Set<string>([start]);
    const cameFrom = new Map<string, string>();
    const cost = new Map<string, number>([[start, 0]]);
    const score = new Map<string, number>([[start, nodeDistance(source, target)]]);
    let expanded = 0;
    while (open.size > 0 && expanded < maxExpansions) {
      const current = [...open].sort((a, b) => (score.get(a) ?? Infinity) - (score.get(b) ?? Infinity) || a.localeCompare(b))[0] as string;
      if (current === goal) {
        const path: string[] = [goal];
        let cursor = goal;
        while (cameFrom.has(cursor)) { cursor = cameFrom.get(cursor) as string; path.push(cursor); }
        path.reverse();
        return { nodes: path, cost: cost.get(goal) ?? Infinity, complete: true, expanded };
      }
      open.delete(current);
      expanded += 1;
      const currentNode = this.#nodes.get(current) as NavNode;
      for (const neighborId of [...currentNode.neighbors].sort()) {
        const neighbor = this.#nodes.get(neighborId);
        if (!neighbor || neighbor.area === 'blocked') continue;
        const tentative = (cost.get(current) ?? Infinity) + Math.max(0, neighbor.cost) + nodeDistance(currentNode, neighbor);
        if (tentative >= (cost.get(neighborId) ?? Infinity)) continue;
        cameFrom.set(neighborId, current);
        cost.set(neighborId, tentative);
        score.set(neighborId, tentative + nodeDistance(neighbor, target));
        open.add(neighborId);
      }
    }
    return { nodes: [], cost: Number.POSITIVE_INFINITY, complete: false, expanded };
  }
}

export interface WorldTickContext { readonly worldId: WorldId; readonly tick: Tick; readonly deltaMs: number; readonly player: Vec3; readonly quality: QualityTier; }
export interface WorldSystem { readonly id: string; readonly phase: 'stream' | 'ai' | 'physics' | 'gameplay' | 'animation'; readonly priority: number; update(context: WorldTickContext): void | Promise<void>; dispose?(): void; }

export class WorldSystemScheduler {
  readonly #systems = new Map<string, WorldSystem>();
  add(system: WorldSystem): () => void { if (this.#systems.has(system.id)) throw new Error(`World system exists: ${system.id}`); this.#systems.set(system.id, system); return () => this.#systems.delete(system.id); }
  async update(context: WorldTickContext): Promise<void> { const systems = [...this.#systems.values()].sort((a, b) => a.phase.localeCompare(b.phase) || b.priority - a.priority || a.id.localeCompare(b.id)); for (const system of systems) await system.update(context); }
  dispose(): void { for (const system of this.#systems.values()) system.dispose?.(); this.#systems.clear(); }
  get size(): number { return this.#systems.size; }
}
