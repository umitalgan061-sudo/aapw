import type { EntityId, EntityLod, InterestPoint, Vec3 } from './types';
import { clamp, stableSort, vec3DistanceSquared } from './deterministic';

export interface InterestBudget { readonly near: number; readonly mid: number; readonly far: number; readonly sleeping: number; }
export interface InterestDecision { readonly id: EntityId; readonly lod: EntityLod; readonly score: number; readonly distanceSquared: number; }
interface IndexedEntity { readonly id: EntityId; readonly position: Vec3; readonly priority: number; }

export class InterestManager {
  readonly budget: InterestBudget;
  #entities = new Map<EntityId, IndexedEntity>();
  #points = new Map<string, InterestPoint>();
  constructor(budget: Partial<InterestBudget> = {}) { this.budget = Object.freeze({ near: 512, mid: 1024, far: 2048, sleeping: 4096, ...budget }); }
  upsert(id: EntityId, position: Vec3, priority = 1): void { this.#entities.set(id, Object.freeze({ id, position: Object.freeze({ ...position }), priority: clamp(priority, 0, 100) })); }
  remove(id: EntityId): void { this.#entities.delete(id); }
  setPoint(point: InterestPoint): void { this.#points.set(point.id, Object.freeze({ ...point, radius: Math.max(1, point.radius), weight: Math.max(0.01, point.weight) })); }
  removePoint(id: string): void { this.#points.delete(id); }
  evaluate(primary: InterestPoint): readonly InterestDecision[] {
    const scores = [...this.#entities.values()].map((entity) => {
      const distanceSquared = vec3DistanceSquared(entity.position, primary.position);
      const distance = Math.sqrt(distanceSquared);
      const score = entity.priority * Math.max(0, 1 - distance / Math.max(1, primary.radius)) * Math.max(0.01, primary.weight);
      const lod: EntityLod = distance <= 75 ? 'near' : distance <= 250 ? 'mid' : distance <= 800 ? 'far' : 'sleeping';
      return Object.freeze({ id: entity.id, lod, score, distanceSquared });
    });
    const limits = this.budget; const used: Record<EntityLod, number> = { near: 0, mid: 0, far: 0, sleeping: 0 };
    return Object.freeze(stableSort(scores, (a, b) => b.score - a.score || a.distanceSquared - b.distanceSquared || a.id.localeCompare(b.id))
      .filter((item) => used[item.lod]++ < limits[item.lod]));
  }
  activePoints(): readonly InterestPoint[] { return Object.freeze([...this.#points.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  count(): number { return this.#entities.size; }
  clear(): void { this.#entities.clear(); this.#points.clear(); }
}
