import type { EntityId, Vec3, StreamTier } from './kernelTypes.ts';
import { asEntityId, clamp, stableHash, vec3 } from './kernelTypes.ts';

export type NPCMode = 'idle' | 'patrol' | 'investigate' | 'flee' | 'pursue' | 'assist' | 'sleep';
export type GoalKind = 'survive' | 'combat' | 'follow' | 'patrol' | 'rest' | 'investigate' | 'trade';

export interface NPCPolicy {
  readonly perceptionRadius: number;
  readonly threatMemorySeconds: number;
  readonly decisionIntervalSeconds: number;
  readonly maxTargets: number;
  readonly maxThinkersPerTick: number;
  readonly lowDetailThinkIntervalSeconds: number;
  readonly fleeHealthRatio: number;
}

export const DEFAULT_NPC_POLICY: NPCPolicy = Object.freeze({
  perceptionRadius: 45,
  threatMemorySeconds: 8,
  decisionIntervalSeconds: 0.2,
  maxTargets: 12,
  maxThinkersPerTick: 64,
  lowDetailThinkIntervalSeconds: 1.25,
  fleeHealthRatio: 0.22,
});

export interface PerceivedTarget {
  readonly entity: EntityId;
  readonly position: Vec3;
  readonly threat: number;
  readonly distance: number;
  readonly faction: string;
}

export interface NPCSpec {
  readonly id: string;
  readonly faction: string;
  readonly position: Vec3;
  readonly health: number;
  readonly maxHealth: number;
  readonly home?: Vec3;
  readonly streamTier?: StreamTier;
}

export interface NPCState extends NPCSpec {
  readonly mode: NPCMode;
  readonly goal: GoalKind;
  readonly target?: EntityId;
  readonly decisionRemaining: number;
  readonly thinkBudgetUsed: number;
  readonly memory: ReadonlyMap<EntityId, ThreatMemory>;
}

export interface ThreatMemory {
  readonly entity: EntityId;
  readonly threat: number;
  readonly lastSeenTick: number;
  readonly lastPosition: Vec3;
}

export interface NPCDecision {
  readonly npc: EntityId;
  readonly mode: NPCMode;
  readonly goal: GoalKind;
  readonly target: EntityId | null;
  readonly score: number;
  readonly tick: number;
}

export class NPCBrain {
  readonly policy: NPCPolicy;
  #npcs = new Map<EntityId, NPCState>();
  #decisions = new Map<EntityId, NPCDecision>();
  #disposed = false;

  constructor(policy: NPCPolicy = DEFAULT_NPC_POLICY) {
    this.policy = Object.freeze({ ...policy });
  }

  register(spec: NPCSpec): EntityId {
    const id = asEntityId(spec.id);
    const current = this.#npcs.get(id);
    this.#npcs.set(id, Object.freeze({
      ...spec,
      id,
      mode: current?.mode ?? 'idle',
      goal: current?.goal ?? 'patrol',
      ...(current?.target ? { target: current.target } : {}),
      decisionRemaining: current?.decisionRemaining ?? 0,
      thinkBudgetUsed: 0,
      memory: current?.memory ?? new Map<EntityId, ThreatMemory>(),
    }));
    return id;
  }

  state(id: EntityId | string): NPCState | null {
    return this.#npcs.get(asEntityId(String(id))) ?? null;
  }

  perceive(
    observer: EntityId | string,
    targets: readonly PerceivedTarget[],
    tick: number,
  ): readonly PerceivedTarget[] {
    const state = this.#npcs.get(asEntityId(String(observer)));
    if (!state) return [];
    const inRange = targets
      .filter((target) => target.entity !== state.id)
      .filter((target) => target.distance <= this.policy.perceptionRadius)
      .sort((a, b) => b.threat - a.threat || a.distance - b.distance || a.entity.localeCompare(b.entity))
      .slice(0, this.policy.maxTargets);
    const memory = new Map(state.memory);
    for (const target of inRange) {
      memory.set(target.entity, Object.freeze({
        entity: target.entity,
        threat: clamp(target.threat, 0, 100),
        lastSeenTick: Math.max(0, Math.floor(tick)),
        lastPosition: target.position,
      }));
    }
    for (const [id, record] of memory) {
      if (tick - record.lastSeenTick > this.policy.threatMemorySeconds * 60) memory.delete(id);
    }
    this.#npcs.set(state.id, Object.freeze({ ...state, memory }));
    return Object.freeze(inRange);
  }

  decide(id: EntityId | string, tick: number, currentHealthRatio?: number): NPCDecision | null {
    const key = asEntityId(String(id));
    const state = this.#npcs.get(key);
    if (!state || this.#disposed) return null;
    if (state.decisionRemaining > 0) return this.#decisions.get(key) ?? null;

    const healthRatio = clamp(currentHealthRatio ?? state.health / Math.max(1, state.maxHealth), 0, 1);
    const memories = [...state.memory.values()]
      .sort((a, b) => b.threat - a.threat || a.entity.localeCompare(b.entity));
    const topThreat = memories[0];

    const candidates = [
      { goal: 'survive' as const, score: (1 - healthRatio) * 100 },
      { goal: 'combat' as const, score: topThreat ? topThreat.threat * (healthRatio > 0.22 ? 1 : 0.1) : 0 },
      { goal: 'investigate' as const, score: memories.length ? memories[0].threat * 0.55 : 0 },
      { goal: 'patrol' as const, score: state.home ? 25 : 10 },
      { goal: 'rest' as const, score: Math.max(0, 45 - healthRatio * 45) },
      { goal: 'trade' as const, score: state.mode === 'idle' ? 14 : 0 },
    ].map((candidate) => ({
      ...candidate,
      score: clamp(candidate.score, 0, 100),
    })).sort((a, b) => b.score - a.score || a.goal.localeCompare(b.goal));

    const winner = candidates[0]!;
    const mode: NPCMode =
      winner.goal === 'survive' && healthRatio < this.policy.fleeHealthRatio ? 'flee' :
      winner.goal === 'combat' && topThreat ? 'pursue' :
      winner.goal === 'investigate' ? 'investigate' :
      winner.goal === 'rest' ? 'sleep' :
      'patrol';

    const decision = Object.freeze({
      npc: key,
      mode,
      goal: winner.goal,
      target: topThreat?.entity ?? null,
      score: winner.score,
      tick: Math.max(0, Math.floor(tick)),
    });
    this.#decisions.set(key, decision);
    this.#npcs.set(key, Object.freeze({
      ...state,
      mode,
      goal: winner.goal,
      ...(topThreat ? { target: topThreat.entity } : {}),
      decisionRemaining: this.policy.decisionIntervalSeconds,
      thinkBudgetUsed: state.thinkBudgetUsed + 1,
    }));
    return decision;
  }

  tick(dt: number, tick: number): readonly NPCDecision[] {
    if (this.#disposed) return [];
    const delta = clamp(dt, 0, 0.25);
    const candidates = [...this.#npcs.values()]
      .sort((a, b) =>
        (a.streamTier === 'critical' ? 0 : a.streamTier === 'near' ? 1 : 2) -
        (b.streamTier === 'critical' ? 0 : b.streamTier === 'near' ? 1 : 2) ||
        a.id.localeCompare(b.id),
      )
      .slice(0, this.policy.maxThinkersPerTick);
    const decisions: NPCDecision[] = [];
    for (const state of this.#npcs.values()) {
      this.#npcs.set(state.id, Object.freeze({
        ...state,
        decisionRemaining: Math.max(0, state.decisionRemaining - delta),
        thinkBudgetUsed: 0,
      }));
    }
    for (const candidate of candidates) {
      const decision = this.decide(candidate.id, tick);
      if (decision) decisions.push(decision);
    }
    return Object.freeze(decisions);
  }

  decision(id: EntityId | string): NPCDecision | null {
    return this.#decisions.get(asEntityId(String(id))) ?? null;
  }

  setHealth(id: EntityId | string, health: number): boolean {
    const key = asEntityId(String(id));
    const state = this.#npcs.get(key);
    if (!state) return false;
    this.#npcs.set(key, Object.freeze({ ...state, health: clamp(health, 0, state.maxHealth), decisionRemaining: 0 }));
    return true;
  }

  move(id: EntityId | string, position: Vec3): boolean {
    const key = asEntityId(String(id));
    const state = this.#npcs.get(key);
    if (!state) return false;
    this.#npcs.set(key, Object.freeze({ ...state, position }));
    return true;
  }

  diagnostics() {
    const all = [...this.#npcs.values()];
    return Object.freeze({
      count: all.length,
      idle: all.filter((x) => x.mode === 'idle').length,
      combat: all.filter((x) => x.mode === 'pursue' || x.mode === 'assist').length,
      fleeing: all.filter((x) => x.mode === 'flee').length,
      memoryEntries: all.reduce((sum, x) => sum + x.memory.size, 0),
      digest: stableHash(all.map((x) => ({
        id: x.id,
        mode: x.mode,
        goal: x.goal,
        target: x.target ?? null,
        memory: [...x.memory.keys()].sort(),
      }))),
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#npcs.clear();
    this.#decisions.clear();
  }
}
