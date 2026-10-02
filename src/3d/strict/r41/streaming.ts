
import type { AssetNode, Entity, Priority, QualityTier, WorkClass, WorkItem, Vec3 } from './types.ts';
import { clamp, finite, stableHash } from './types.ts';

export interface StreamInterest {
  readonly id: string;
  readonly position: Vec3;
  readonly radius: number;
  readonly weight: number;
  readonly class: 'player' | 'camera' | 'combat' | 'audio' | 'quest';
}

export interface StreamCandidate {
  readonly id: string;
  readonly position: Vec3;
  readonly distance: number;
  readonly score: number;
  readonly lod: 0 | 1 | 2 | 3;
  readonly priority: Priority;
  readonly estimatedMs: number;
  readonly resident: boolean;
}

export interface StreamLimits {
  readonly maxDistance: number;
  readonly maxRequests: number;
  readonly maxVisibleEntities: number;
  readonly maxConcurrentLoads: number;
  readonly hysteresisMeters: number;
}

export interface StreamPlan {
  readonly tick: number;
  readonly loads: readonly StreamCandidate[];
  readonly demotions: readonly StreamCandidate[];
  readonly sleeping: readonly StreamCandidate[];
  readonly digest: number;
}

export interface StreamTaskFactory {
  createLoadTask(candidate: StreamCandidate, tick: number): WorkItem<StreamCandidate>;
  createDemotionTask(candidate: StreamCandidate, tick: number): WorkItem<StreamCandidate>;
}

export class StreamingPlannerR41 {
  readonly limits: StreamLimits;

  constructor(limits: Partial<StreamLimits> = {}) {
    this.limits = Object.freeze({
      maxDistance: clamp(finite(limits.maxDistance, 1400), 100, 10000),
      maxRequests: Math.max(1, Math.trunc(finite(limits.maxRequests, 64))),
      maxVisibleEntities: Math.max(1, Math.trunc(finite(limits.maxVisibleEntities, 2048))),
      maxConcurrentLoads: Math.max(1, Math.trunc(finite(limits.maxConcurrentLoads, 16))),
      hysteresisMeters: clamp(finite(limits.hysteresisMeters, 18), 1, 200),
    });
  }

  plan(
    tick: number,
    interests: readonly StreamInterest[],
    entities: readonly Entity[],
    residentIds: ReadonlySet<string>,
    quality: QualityTier = 'balanced',
  ): StreamPlan {
    const strongestInterest = interests.length
      ? interests.slice().sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))[0]
      : null;

    if (!strongestInterest) {
      return Object.freeze({
        tick: Math.trunc(tick),
        loads: Object.freeze([]),
        demotions: Object.freeze([]),
        sleeping: Object.freeze(entities.map(entity => this.toCandidate(entity, Infinity, 0, quality, residentIds.has(entity.id), null))),
        digest: stableHash([]),
      });
    }

    const candidates = entities
      .map(entity => this.scoreEntity(entity, interests, residentIds, quality))
      .filter(candidate => candidate.distance <= this.limits.maxDistance)
      .sort(compareCandidates);

    const loads = candidates
      .filter(candidate => !candidate.resident && candidate.lod <= 2)
      .slice(0, Math.min(this.limits.maxRequests, this.limits.maxConcurrentLoads));

    const demotions = candidates
      .filter(candidate => candidate.resident && candidate.lod >= 3)
      .filter(candidate => candidate.distance > this.limits.maxDistance - this.limits.hysteresisMeters)
      .slice(0, this.limits.maxRequests);

    const sleeping = candidates
      .filter(candidate => candidate.lod === 3)
      .slice(this.limits.maxVisibleEntities);

    return Object.freeze({
      tick: Math.trunc(tick),
      loads: Object.freeze(loads),
      demotions: Object.freeze(demotions),
      sleeping: Object.freeze(sleeping),
      digest: stableHash({
        tick,
        loads: loads.map(candidate => candidate.id),
        demotions: demotions.map(candidate => candidate.id),
        sleeping: sleeping.map(candidate => candidate.id),
      }),
    });
  }

  scoreEntity(
    entity: Entity,
    interests: readonly StreamInterest[],
    residentIds: ReadonlySet<string>,
    quality: QualityTier,
  ): StreamCandidate {
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestWeight = 0;
    let bestClass: StreamInterest['class'] = 'quest';

    for (const interest of interests) {
      const distance = distance3(entity.transform.position, interest.position);
      const weighted = distance / Math.max(0.1, interest.weight);
      if (weighted < bestDistance) {
        bestDistance = weighted;
        bestWeight = interest.weight;
        bestClass = interest.class;
      }
    }

    const effectiveDistance = Number.isFinite(bestDistance) ? bestDistance : Number.MAX_SAFE_INTEGER;
    const lod = lodFor(effectiveDistance, quality);
    const priority = priorityFor(bestClass, lod);
    const score = scoreFor(effectiveDistance, bestWeight, priority, lod, entity.kind);
    return this.toCandidate(entity, effectiveDistance, score, quality, residentIds.has(entity.id), priority);
  }

  toWorkItems(plan: StreamPlan, factory: StreamTaskFactory): readonly WorkItem<StreamCandidate>[] {
    const tasks: WorkItem<StreamCandidate>[] = [];
    for (const candidate of plan.loads) tasks.push(factory.createLoadTask(candidate, plan.tick));
    for (const candidate of plan.demotions) tasks.push(factory.createDemotionTask(candidate, plan.tick));
    return Object.freeze(tasks);
  }
}

export class StreamingBudgetR41 {
  readonly class: WorkClass = 'streaming';
  readonly budgetMs: number;
  readonly maxLoads: number;
  #activeLoads = new Set<string>();
  #queued = new Map<string, number>();

  constructor(budgetMs = 2.5, maxLoads = 16) {
    this.budgetMs = Math.max(0.1, finite(budgetMs, 2.5));
    this.maxLoads = Math.max(1, Math.trunc(finite(maxLoads, 16)));
  }

  beginLoad(id: string, tick: number): boolean {
    if (this.#activeLoads.has(id)) return false;
    if (this.#activeLoads.size >= this.maxLoads) {
      this.#queued.set(id, Math.trunc(tick));
      return false;
    }
    this.#activeLoads.add(id);
    return true;
  }

  completeLoad(id: string): void {
    this.#activeLoads.delete(id);
    this.#queued.delete(id);
  }

  activeCount(): number { return this.#activeLoads.size; }
  queued(): ReadonlyMap<string, number> { return new Map(this.#queued); }

  reset(): void {
    this.#activeLoads.clear();
    this.#queued.clear();
  }
}

export function distance3(a: Vec3, b: Vec3): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return Math.sqrt(x * x + y * y + z * z);
}

export function lodForDistance(distance: number, quality: QualityTier = 'balanced'): 0 | 1 | 2 | 3 {
  const multiplier = quality === 'minimal' ? 0.7 : quality === 'low' ? 0.85 : quality === 'high' ? 1.1 : quality === 'ultra' ? 1.25 : 1;
  const value = distance / multiplier;
  if (value <= 60) return 0;
  if (value <= 180) return 1;
  if (value <= 600) return 2;
  return 3;
}

function scoreFor(distance: number, weight: number, priority: Priority, lod: number, kind: Entity['kind']): number {
  const priorityWeight = priority === 'critical' ? 1000 : priority === 'high' ? 700 : priority === 'normal' ? 400 : priority === 'low' ? 200 : 50;
  const kindWeight = kind === 'player' ? 500 : kind === 'npc' ? 150 : kind === 'vehicle' ? 125 : kind === 'dragon' ? 110 : 50;
  return priorityWeight + weight * 100 + kindWeight + (3 - lod) * 50 - distance;
}

function priorityFor(className: StreamInterest['class'], lod: number): Priority {
  if (className === 'player') return 'critical';
  if (className === 'combat') return lod <= 1 ? 'high' : 'normal';
  if (className === 'camera') return lod <= 1 ? 'high' : 'normal';
  if (className === 'quest') return 'normal';
  return lod <= 1 ? 'normal' : 'low';
}

function lodFor(distance: number, quality: QualityTier): 0 | 1 | 2 | 3 {
  return lodForDistance(distance, quality);
}

function compareCandidates(a: StreamCandidate, b: StreamCandidate): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.distance !== b.distance) return a.distance - b.distance;
  return a.id.localeCompare(b.id);
}

function estimateStreamCost(entity: Entity, quality: QualityTier): number {
  const base = entity.kind === 'dragon' || entity.kind === 'structure' ? 0.8 : entity.kind === 'npc' || entity.kind === 'animal' ? 0.35 : 0.2;
  const multiplier = quality === 'ultra' ? 1.5 : quality === 'high' ? 1.25 : quality === 'minimal' ? 0.75 : 1;
  return base * multiplier;
}
