import { AiComponent, EntityId, Vec3, clamp, distanceSq3, normalize3 } from './domain.ts';
import { EcsWorldV5 } from './ecs.ts';
import { WorldQueryV5 } from './worldQuery.ts';

export type AiGoal = 'idle' | 'patrol' | 'investigate' | 'chase' | 'flee' | 'attack' | 'defend' | 'sleep';
export type UtilityAction = 'wander' | 'move-to-target' | 'keep-distance' | 'melee' | 'retreat' | 'guard' | 'rest';

export interface AiMemoryEntry {
  readonly entity: EntityId;
  readonly position: Vec3;
  readonly tick: number;
  readonly confidence: number;
  readonly kind: 'seen' | 'heard' | 'damaged' | 'lost';
}

export interface AiContext {
  readonly self: EntityId;
  readonly position: Vec3;
  readonly health: number;
  readonly stamina: number;
  readonly target: EntityId | null;
  readonly targetDistance: number;
  readonly targetVisible: boolean;
  readonly alertness: number;
  readonly memory: readonly AiMemoryEntry[];
}

export interface UtilityScore { readonly action: UtilityAction; readonly score: number; readonly reason: string; }

export interface AiDecision {
  readonly goal: AiGoal;
  readonly action: UtilityAction;
  readonly target: EntityId | null;
  readonly destination: Vec3 | null;
  readonly confidence: number;
  readonly scores: readonly UtilityScore[];
}

export interface AiPolicy {
  readonly sightRange: number;
  readonly hearingRange: number;
  readonly attackRange: number;
  readonly fleeHealthRatio: number;
  readonly combatHealthRatio: number;
  readonly memoryTicks: number;
  readonly thinkEveryTicks: number;
}

export const DEFAULT_AI_POLICY: AiPolicy = Object.freeze({ sightRange: 32, hearingRange: 48, attackRange: 2.8, fleeHealthRatio: 0.2, combatHealthRatio: 0.55, memoryTicks: 240, thinkEveryTicks: 6 });

export class AiMemoryV5 {
  readonly #entries: AiMemoryEntry[] = [];
  constructor(readonly maxEntries = 256) {}

  remember(entry: AiMemoryEntry): void {
    const index = this.#entries.findIndex((current) => current.entity === entry.entity && current.kind === entry.kind);
    if (index >= 0) this.#entries[index] = entry;
    else this.#entries.push(entry);
    this.#entries.sort((a, b) => b.tick - a.tick || b.confidence - a.confidence || Number(a.entity) - Number(b.entity));
    if (this.#entries.length > this.maxEntries) this.#entries.splice(this.maxEntries);
  }

  forgetOlderThan(tick: number, maxAge: number): number {
    const before = this.#entries.length;
    const cutoff = tick - Math.max(0, maxAge);
    while (this.#entries.at(-1) && this.#entries.at(-1)!.tick < cutoff) this.#entries.pop();
    return before - this.#entries.length;
  }

  entries(): readonly AiMemoryEntry[] { return this.#entries.map((entry) => ({ ...entry, position: { ...entry.position } })); }
  latest(entity: EntityId): AiMemoryEntry | undefined { return this.#entries.find((entry) => entry.entity === entity); }
  clear(): void { this.#entries.length = 0; }
}

export class UtilityAiV5 {
  readonly #policy: AiPolicy;
  readonly #memory = new AiMemoryV5();

  constructor(private readonly world: EcsWorldV5, private readonly queries: WorldQueryV5, policy: Partial<AiPolicy> = {}) {
    this.#policy = { ...DEFAULT_AI_POLICY, ...policy };
  }

  observe(self: EntityId, tick: number): readonly AiMemoryEntry[] {
    const transform = this.world.getComponent(self, 'transform');
    if (!transform) return [];
    const nearby = this.queries.entitiesNear(transform.position, this.#policy.sightRange)
      .filter((entity) => entity.id !== self)
      .map((entity): AiMemoryEntry | null => {
        const candidateTransform = entity.components.get('transform');
        if (candidateTransform?.kind !== 'transform') return null;
        const distance = Math.sqrt(distanceSq3(transform.position, candidateTransform.position));
        return { entity: entity.id, position: candidateTransform.position, tick, confidence: clamp(1 - distance / this.#policy.sightRange, 0.05, 1), kind: 'seen' };
      })
      .filter((entry): entry is AiMemoryEntry => !!entry);
    for (const entry of nearby) this.#memory.remember(entry);
    this.#memory.forgetOlderThan(tick, this.#policy.memoryTicks);
    return nearby;
  }

  decide(context: AiContext): AiDecision {
    const scores: UtilityScore[] = [];
    const healthRatio = context.health <= 0 ? 0 : context.health;
    const hasTarget = context.target !== null;
    const targetDistance = context.targetDistance;
    const confidence = context.targetVisible ? 1 : context.memory.length > 0 ? Math.max(...context.memory.map((entry) => entry.confidence)) : 0;
    scores.push({ action: 'retreat', score: healthRatio < this.#policy.fleeHealthRatio ? 1 : 0, reason: healthRatio < this.#policy.fleeHealthRatio ? 'critical-health' : 'health-stable' });
    scores.push({ action: 'melee', score: hasTarget && context.targetVisible && targetDistance <= this.#policy.attackRange ? 1 : 0, reason: targetDistance <= this.#policy.attackRange ? 'target-in-range' : 'target-out-of-range' });
    scores.push({ action: 'move-to-target', score: hasTarget ? 0.6 + confidence * 0.4 : 0, reason: hasTarget ? 'target-available' : 'no-target' });
    scores.push({ action: 'keep-distance', score: hasTarget && targetDistance < this.#policy.attackRange * 2 ? 0.35 : 0, reason: 'spacing-control' });
    scores.push({ action: 'guard', score: context.stamina < 20 ? 0.2 : context.alertness > 0.6 ? 0.4 : 0, reason: 'defensive-pressure' });
    scores.push({ action: 'rest', score: context.stamina < 10 && !hasTarget ? 0.8 : 0, reason: 'stamina-recovery' });
    scores.push({ action: 'wander', score: hasTarget ? 0.05 : 0.3, reason: hasTarget ? 'occupied' : 'no-threat' });
    const sorted = [...scores].sort((a, b) => b.score - a.score || a.action.localeCompare(b.action));
    const action = sorted[0]?.action ?? 'wander';
    const goal: AiGoal = action === 'retreat' ? 'flee' : action === 'melee' ? 'attack' : action === 'move-to-target' || action === 'keep-distance' ? 'chase' : action === 'guard' ? 'defend' : action === 'rest' ? 'sleep' : 'patrol';
    let destination: Vec3 | null = null;
    if (context.target !== null) {
      const target = this.world.getComponent(context.target, 'transform');
      if (target?.kind === 'transform') destination = target.position;
    }
    if (action === 'retreat' && destination) {
      destination = { x: context.position.x + (context.position.x - destination.x), y: context.position.y, z: context.position.z + (context.position.z - destination.z) };
    }
    return { goal, action, target: context.target, destination, confidence, scores: sorted };
  }

  steer(position: Vec3, decision: AiDecision): Vec3 {
    if (!decision.destination) return { x: 0, y: 0, z: 0 };
    return normalize3({ x: decision.destination.x - position.x, y: 0, z: decision.destination.z - position.z });
  }

  memory(): readonly AiMemoryEntry[] { return this.#memory.entries(); }
}

export const aiComponentFor = (archetype: string, target: EntityId | null = null): AiComponent => ({ kind: 'ai', archetype: archetype.trim() || 'neutral', target, alertness: 0, thinkDebt: 0 });
