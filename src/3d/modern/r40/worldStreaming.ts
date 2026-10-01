import type { AssetId, AssetRequest, EntityState, InterestPoint, Tick, Vec3 } from './types';
import { AssetStreamingController } from './streaming';
import { SpatialEntityWorld, WorldSimulationBudget } from './world';
import { clamp, stableSort, vec3Distance } from './deterministic';

export interface WorldStreamingDecision {
  readonly entityId: string;
  readonly distance: number;
  readonly lod: EntityState['lod'];
  readonly asset: AssetId | null;
  readonly request: boolean;
  readonly score: number;
}
export interface WorldStreamingLimits {
  readonly maxRequestsPerTick: number;
  readonly maxDistance: number;
  readonly placeholderDistance: number;
}
export interface WorldStreamingReport {
  readonly tick: Tick;
  readonly decisions: readonly WorldStreamingDecision[];
  readonly requests: readonly AssetRequest[];
  readonly activeEntities: number;
}

export class WorldStreamingOrchestrator {
  readonly world: SpatialEntityWorld;
  readonly assets: AssetStreamingController;
  readonly budget: WorldSimulationBudget;
  readonly limits: WorldStreamingLimits;
  #entityAssets = new Map<string, AssetId>();

  constructor(
    world: SpatialEntityWorld,
    assets: AssetStreamingController,
    budget = new WorldSimulationBudget(),
    limits: Partial<WorldStreamingLimits> = {},
  ) {
    this.world = world;
    this.assets = assets;
    this.budget = budget;
    this.limits = Object.freeze({
      maxRequestsPerTick: 64,
      maxDistance: 1200,
      placeholderDistance: 90,
      ...limits,
    });
  }

  bindEntityAsset(entityId: string, asset: AssetId): void {
    if (entityId) this.#entityAssets.set(entityId, asset);
  }

  unbindEntityAsset(entityId: string): void {
    this.#entityAssets.delete(entityId);
  }

  plan(point: InterestPoint, tick: Tick): WorldStreamingReport {
    const interestRadius = clamp(point.radius, 0, this.limits.maxDistance);
    const entities = this.budget.select(this.world.queryRadius(point.position, interestRadius, this.limits.maxRequestsPerTick * 16), point.position);
    const decisions = stableSort(entities.map((entity) => {
      const distance = vec3Distance(entity.transform.position, point.position);
      const asset = this.#entityAssets.get(String(entity.id)) ?? null;
      const score = clamp((1 - distance / this.limits.maxDistance) * point.weight + (entity.lod === 'near' ? 2 : entity.lod === 'mid' ? 1 : 0), -100, 100);
      const request = asset !== null && distance <= this.limits.maxDistance && this.assets.residency(asset)?.state !== 'resident';
      return Object.freeze({
        entityId: String(entity.id),
        distance,
        lod: entity.lod,
        asset,
        request,
        score,
      });
    }), (a, b) => b.score - a.score || a.distance - b.distance || a.entityId.localeCompare(b.entityId));

    const requests: AssetRequest[] = [];
    for (const decision of decisions) {
      if (!decision.request || !decision.asset || requests.length >= this.limits.maxRequestsPerTick) continue;
      requests.push(Object.freeze({
        id: decision.asset,
        distance: decision.distance,
        priorityBias: decision.score,
        hardDeadlineTick: decision.lod === 'near' ? tick : null,
        allowPlaceholder: decision.distance > this.limits.placeholderDistance,
      }));
    }

    return Object.freeze({
      tick,
      decisions: Object.freeze(decisions),
      requests: Object.freeze(requests),
      activeEntities: this.world.activeCount(),
    });
  }

  requestAll(point: InterestPoint, tick: Tick): WorldStreamingReport {
    const report = this.plan(point, tick);
    for (const request of report.requests) this.assets.request(request, tick);
    return report;
  }

  clear(): void {
    this.#entityAssets.clear();
  }
}
