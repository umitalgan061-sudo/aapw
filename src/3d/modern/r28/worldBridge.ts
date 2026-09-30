import type { CameraVolume, EntityId, Vec3, VisibilityCandidate, VisibilityDecision } from '../r27/contracts.ts';
import { WorldQueryIndex, type WorldQueryEntity } from '../r27/worldQueries.ts';
import { VisibilityOracle } from '../r27/visibility.ts';

export interface WorldBridgeSnapshot {
  readonly nearby: readonly WorldQueryEntity[];
  readonly visible: readonly VisibilityDecision[];
  readonly shadowCasters: readonly EntityId[];
}

export class BrowserWorldBridge {
  readonly queries: WorldQueryIndex;
  readonly visibility = new VisibilityOracle();
  #candidates: VisibilityCandidate[] = [];

  constructor(cellSize = 12) {
    this.queries = new WorldQueryIndex(cellSize);
  }

  upsert(entity: WorldQueryEntity): void {
    this.queries.upsert(entity);
    this.#candidates = this.queries.snapshot().map((item) => ({
      entity: item.entity,
      bounds: item.bounds,
      position: item.position,
      radius: Math.max(
        item.bounds.max.x - item.bounds.min.x,
        item.bounds.max.y - item.bounds.min.y,
        item.bounds.max.z - item.bounds.min.z,
      ) / 2,
      importance: item.tags.includes('player') ? 10 : item.tags.includes('quest') ? 6 : 1,
      distance: 0,
      occlusionHint: item.tags.includes('occluder') ? 1 : 0,
    }));
  }

  remove(entity: EntityId): boolean {
    const removed = this.queries.remove(entity);
    if (removed) this.#candidates = this.#candidates.filter((candidate) => candidate.entity !== entity);
    return removed;
  }

  frame(camera: CameraVolume, qualityLevel: number, center: Vec3, nearbyRadius = 60): WorldBridgeSnapshot {
    const nearby = this.queries.radius(center, { radius: nearbyRadius, limit: 512 });
    const visible = this.visibility.evaluate(camera, this.#candidates, qualityLevel);
    const shadowCasters = this.visibility.pickShadowCasters(visible);
    return Object.freeze({ nearby, visible, shadowCasters });
  }

  lineOfSight(origin: Vec3, target: Vec3, ignored?: EntityId): boolean {
    return this.queries.lineOfSight(origin, target, 0xffff_ffff, ignored);
  }
}
