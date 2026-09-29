import type {
  EntityId,
  QualityTier,
  RenderProfile,
  Vec3,
} from './contracts.ts';

export type RenderLayerR25 =
  | 'background'
  | 'terrain'
  | 'world'
  | 'character'
  | 'effect'
  | 'ui'
  | 'debug';

export interface RenderItemR25 {
  readonly id: EntityId;
  readonly position: Vec3;
  readonly radius: number;
  readonly layer: RenderLayerR25;
  readonly priority: number;
  readonly materialKey: string;
  readonly transparent: boolean;
  readonly castsShadow: boolean;
  readonly receivesShadow: boolean;
  readonly staticGeometry: boolean;
  readonly visible?: boolean;
  readonly alwaysVisible?: boolean;
}

export interface RenderSelectionR25 {
  readonly frame: number;
  readonly visible: readonly RenderItemR25[];
  readonly culled: readonly EntityId[];
  readonly overflow: readonly EntityId[];
  readonly layerCounts: Readonly<Record<RenderLayerR25, number>>;
  readonly materialBuckets: number;
  readonly shadowCasters: number;
  readonly transparentCount: number;
  readonly budgetUtilization: number;
}

export interface RenderQueueOptionsR25 {
  readonly maxVisible?: number;
  readonly maxShadowCasters?: number;
  readonly maxTransparent?: number;
  readonly maxMaterialBuckets?: number;
  readonly frustumTest?: (
    item: RenderItemR25,
    camera: Vec3,
    maxDistance: number,
  ) => boolean;
}

const LAYERS: readonly RenderLayerR25[] = Object.freeze([
  'background',
  'terrain',
  'world',
  'character',
  'effect',
  'ui',
  'debug',
]);

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function priorityScore(item: RenderItemR25, distanceSq: number): number {
  const distanceWeight = 1 / (1 + Math.sqrt(distanceSq) * 0.002);
  const layerWeight: Record<RenderLayerR25, number> = {
    background: 0.35,
    terrain: 1,
    world: 1.1,
    character: 1.7,
    effect: 1.35,
    ui: 2,
    debug: 0.2,
  };

  return item.priority * distanceWeight * layerWeight[item.layer];
}

export function createRenderItem(
  id: string,
  options: Omit<RenderItemR25, 'id'>,
): RenderItemR25 {
  const entityId = id.trim() as EntityId;
  if (!entityId) throw new Error('R25_RENDER_ITEM_ID_EMPTY');

  return freeze({
    ...options,
    id: entityId,
    position: freeze({
      x: finite(options.position.x, 0),
      y: finite(options.position.y, 0),
      z: finite(options.position.z, 0),
    }),
    radius: Math.max(0.01, finite(options.radius, 1)),
    priority: finite(options.priority, 1),
    materialKey: options.materialKey.trim().slice(0, 128),
    transparent: options.transparent === true,
    castsShadow: options.castsShadow === true,
    receivesShadow: options.receivesShadow !== false,
    staticGeometry: options.staticGeometry === true,
    visible: options.visible !== false,
    alwaysVisible: options.alwaysVisible === true,
  });
}

export class RenderQueueR25 {
  readonly #items = new Map<EntityId, RenderItemR25>();
  readonly #maxVisible: number;
  readonly #maxShadowCasters: number;
  readonly #maxTransparent: number;
  readonly #maxMaterialBuckets: number;
  readonly #frustumTest?: RenderQueueOptionsR25['frustumTest'];
  #disposed = false;
  #frame = 0;
  #lastSelection: RenderSelectionR25 | null = null;

  public constructor(options: RenderQueueOptionsR25 = {}) {
    this.#maxVisible = Math.max(100, Math.trunc(options.maxVisible ?? 100000));
    this.#maxShadowCasters = Math.max(0, Math.trunc(options.maxShadowCasters ?? 20000));
    this.#maxTransparent = Math.max(0, Math.trunc(options.maxTransparent ?? 12000));
    this.#maxMaterialBuckets = Math.max(1, Math.trunc(options.maxMaterialBuckets ?? 512));
    this.#frustumTest = options.frustumTest;
  }

  public get size(): number {
    return this.#items.size;
  }

  public add(item: RenderItemR25): void {
    this.#assertLive();
    if (this.#items.has(item.id)) {
      throw new Error(`R25_RENDER_ITEM_DUPLICATE:${String(item.id)}`);
    }
    this.#items.set(item.id, freeze({ ...item }));
  }

  public addMany(items: readonly RenderItemR25[]): void {
    for (const item of items) this.add(item);
  }

  public update(
    id: EntityId,
    patch: Partial<Omit<RenderItemR25, 'id'>>,
  ): boolean {
    const current = this.#items.get(id);
    if (!current) return false;

    const next = freeze({
      ...current,
      ...patch,
      id,
      ...(patch.position ? {
        position: freeze({
          x: finite(patch.position.x, current.position.x),
          y: finite(patch.position.y, current.position.y),
          z: finite(patch.position.z, current.position.z),
        }),
      } : {}),
      ...(patch.materialKey !== undefined ? {
        materialKey: patch.materialKey.trim().slice(0, 128),
      } : {}),
      ...(patch.radius !== undefined ? {
        radius: Math.max(0.01, finite(patch.radius, current.radius)),
      } : {}),
      ...(patch.priority !== undefined ? {
        priority: finite(patch.priority, current.priority),
      } : {}),
    });

    this.#items.set(id, next);
    return true;
  }

  public remove(id: EntityId): boolean {
    return this.#items.delete(id);
  }

  public clear(): void {
    this.#items.clear();
    this.#lastSelection = null;
  }

  public cull(
    camera: Vec3,
    profile: Pick<RenderProfile, 'drawDistanceMeters' | 'maxVisibleObjects' | 'shadowResolution' | 'tier'>,
    frame = this.#frame + 1,
  ): RenderSelectionR25 {
    this.#assertLive();
    this.#frame = Math.max(this.#frame + 1, Math.trunc(frame));

    const maxVisible = Math.max(
      1,
      Math.min(this.#maxVisible, profile.maxVisibleObjects),
    );

    const candidates: Array<{
      item: RenderItemR25;
      distanceSq: number;
      score: number;
    }> = [];
    const culled: EntityId[] = [];

    for (const item of this.#items.values()) {
      if (item.visible === false) {
        culled.push(item.id);
        continue;
      }

      const distanceSq = distanceSquared(camera, item.position);
      const distanceLimit = profile.drawDistanceMeters + item.radius;

      if (!item.alwaysVisible && distanceSq > distanceLimit * distanceLimit) {
        culled.push(item.id);
        continue;
      }

      if (this.#frustumTest && !this.#frustumTest(item, camera, profile.drawDistanceMeters)) {
        culled.push(item.id);
        continue;
      }

      candidates.push({
        item,
        distanceSq,
        score: priorityScore(item, distanceSq),
      });
    }

    candidates.sort((a, b) => {
      if (a.item.alwaysVisible !== b.item.alwaysVisible) {
        return a.item.alwaysVisible ? -1 : 1;
      }
      if (a.score !== b.score) return b.score - a.score;
      if (a.distanceSq !== b.distanceSq) return a.distanceSq - b.distanceSq;
      return String(a.item.id).localeCompare(String(b.item.id));
    });

    const visible: RenderItemR25[] = [];
    const overflow: EntityId[] = [];
    const materialKeys = new Set<string>();
    const shadowCasters: RenderItemR25[] = [];
    const transparent: RenderItemR25[] = [];
    const layerCounts: Record<RenderLayerR25, number> = {
      background: 0,
      terrain: 0,
      world: 0,
      character: 0,
      effect: 0,
      ui: 0,
      debug: 0,
    };

    for (const candidate of candidates) {
      const item = candidate.item;
      if (visible.length >= maxVisible && !item.alwaysVisible) {
        overflow.push(item.id);
        continue;
      }

      if (item.transparent && transparent.length >= this.#maxTransparent && !item.alwaysVisible) {
        overflow.push(item.id);
        continue;
      }

      if (
        item.staticGeometry &&
        materialKeys.size >= this.#maxMaterialBuckets &&
        !materialKeys.has(item.materialKey) &&
        !item.alwaysVisible
      ) {
        overflow.push(item.id);
        continue;
      }

      visible.push(item);
      layerCounts[item.layer] += 1;
      materialKeys.add(item.materialKey);

      if (
        item.castsShadow &&
        shadowCasters.length < this.#maxShadowCasters &&
        profile.tier !== 'safe'
      ) {
        shadowCasters.push(item);
      }

      if (item.transparent) {
        transparent.push(item);
      }
    }

    visible.sort((a, b) => (
      LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer) ||
      Number(a.transparent) - Number(b.transparent) ||
      a.materialKey.localeCompare(b.materialKey) ||
      String(a.id).localeCompare(String(b.id))
    ));

    const total = Math.max(1, candidates.length);
    this.#lastSelection = freeze({
      frame: this.#frame,
      visible: freeze(visible),
      culled: freeze([...culled].sort((a, b) => String(a).localeCompare(String(b)))),
      overflow: freeze([...overflow].sort((a, b) => String(a).localeCompare(String(b)))),
      layerCounts: freeze({ ...layerCounts }),
      materialBuckets: materialKeys.size,
      shadowCasters: shadowCasters.length,
      transparentCount: transparent.length,
      budgetUtilization: Math.min(1, visible.length / maxVisible),
    });

    return this.#lastSelection;
  }

  public snapshot(): RenderSelectionR25 | null {
    return this.#lastSelection;
  }

  public collectMaterialBuckets(): ReadonlyMap<string, readonly RenderItemR25[]> {
    const buckets = new Map<string, RenderItemR25[]>();

    for (const item of this.#items.values()) {
      const list = buckets.get(item.materialKey) ?? [];
      list.push(item);
      buckets.set(item.materialKey, list);
    }

    const sorted = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => [
        key,
        freeze([...items].sort((a, b) => String(a.id).localeCompare(String(b.id)))),
      ] as const);

    return new Map(sorted);
  }

  public shadowCasters(
    profile: Pick<RenderProfile, 'tier'>,
  ): readonly RenderItemR25[] {
    return freeze(
      [...this.#items.values()]
        .filter((item) => item.castsShadow && item.visible !== false)
        .filter((item) => profile.tier !== 'safe')
        .sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)))
        .slice(0, this.#maxShadowCasters),
    );
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#items.clear();
    this.#lastSelection = null;
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R25_RENDER_QUEUE_DISPOSED');
  }
}

export function mergeRenderSelectionsR25(
  selections: readonly RenderSelectionR25[],
): RenderSelectionR25 | null {
  if (selections.length === 0) return null;

  const visible = new Map<EntityId, RenderItemR25>();
  const culled = new Set<EntityId>();
  const overflow = new Set<EntityId>();
  const layerCounts: Record<RenderLayerR25, number> = {
    background: 0,
    terrain: 0,
    world: 0,
    character: 0,
    effect: 0,
    ui: 0,
    debug: 0,
  };

  let frame = 0;
  let materialBuckets = 0;
  let shadowCasters = 0;
  let transparentCount = 0;
  let budgetUtilization = 0;

  for (const selection of selections) {
    frame = Math.max(frame, selection.frame);
    for (const item of selection.visible) visible.set(item.id, item);
    for (const id of selection.culled) culled.add(id);
    for (const id of selection.overflow) overflow.add(id);
    for (const layer of LAYERS) layerCounts[layer] += selection.layerCounts[layer];
    materialBuckets += selection.materialBuckets;
    shadowCasters += selection.shadowCasters;
    transparentCount += selection.transparentCount;
    budgetUtilization += selection.budgetUtilization;
  }

  const visibleItems = [...visible.values()]
    .sort((a, b) => (
      LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer) ||
      a.materialKey.localeCompare(b.materialKey) ||
      String(a.id).localeCompare(String(b.id))
    ));

  return freeze({
    frame,
    visible: freeze(visibleItems),
    culled: freeze([...culled].sort((a,b)=>String(a).localeCompare(String(b)))),
    overflow: freeze([...overflow].sort((a,b)=>String(a).localeCompare(String(b)))),
    layerCounts: freeze(layerCounts),
    materialBuckets,
    shadowCasters,
    transparentCount,
    budgetUtilization: Math.min(1, budgetUtilization / selections.length),
  });
}
