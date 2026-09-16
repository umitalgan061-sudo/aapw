/** Deterministic, budgeted utility-AI layer designed for large open worlds. */

import { clamp, distance3, normalize3, sub3, type Vec3 } from './deterministicMath';

export type AiMode = 'idle' | 'patrol' | 'investigate' | 'combat' | 'flee' | 'social' | 'dead';
export type StimulusType = 'visual' | 'audio' | 'damage' | 'threat' | 'goal' | 'social';

export interface AiStimulus {
  id: string;
  type: StimulusType;
  position: Vec3;
  intensity: number;
  sourceEntity: number | null;
  tick: number;
  ttlTicks: number;
}

export interface AiMemory {
  stimulusId: string;
  type: StimulusType;
  position: Vec3;
  confidence: number;
  lastSeenTick: number;
  expiresTick: number;
  sourceEntity: number | null;
}

export interface AiNeedSet {
  survival: number;
  combat: number;
  curiosity: number;
  social: number;
  duty: number;
  fatigue: number;
}

export interface AiContext {
  id: number;
  position: Vec3;
  forward: Vec3;
  healthRatio: number;
  staminaRatio: number;
  allyCount: number;
  enemyCount: number;
  memories: readonly AiMemory[];
  needs: AiNeedSet;
  mode: AiMode;
}

export interface AiAction {
  id: string;
  score: number;
  mode: AiMode;
  target: number | null;
  destination: Vec3 | null;
  reason: string;
}

export interface AiDecision {
  tick: number;
  action: AiAction;
  evaluatedActions: number;
  memoryCount: number;
}

export interface AiConfig {
  maxMemories: number;
  memoryDecayPerTick: number;
  minConfidence: number;
  thinkerBudgetActions: number;
  perceptionDistance: number;
  hearingDistance: number;
}

const DEFAULT_CONFIG: AiConfig = {
  maxMemories: 32,
  memoryDecayPerTick: 0.0125,
  minConfidence: 0.05,
  thinkerBudgetActions: 8,
  perceptionDistance: 80,
  hearingDistance: 120,
};

interface ActionDefinition {
  id: string;
  mode: AiMode;
  evaluate(context: AiContext): number;
  target(context: AiContext): number | null;
  destination(context: AiContext): Vec3 | null;
  reason(context: AiContext): string;
}

function copyPosition(position: Vec3): Vec3 { return { ...position }; }

export class AiBrain {
  readonly config: AiConfig;
  #mode: AiMode = 'idle';
  #memories = new Map<string, AiMemory>();
  #actions: ActionDefinition[];
  #lastDecision: AiDecision | null = null;

  constructor(config?: Partial<AiConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.#actions = [
      { id: 'survive-flee', mode: 'flee', evaluate: (ctx) => ctx.needs.survival * (1 - ctx.healthRatio), target: () => null, destination: (ctx) => this.farthestMemory(ctx), reason: () => 'health pressure requires separation' },
      { id: 'attack-visible-threat', mode: 'combat', evaluate: (ctx) => ctx.needs.combat * clamp(ctx.enemyCount / 4, 0, 1), target: (ctx) => this.bestHostile(ctx), destination: () => null, reason: () => 'hostile contact is actionable' },
      { id: 'investigate-threat', mode: 'investigate', evaluate: (ctx) => ctx.needs.curiosity * this.bestMemoryConfidence(ctx, 'threat'), target: (ctx) => this.bestMemorySource(ctx, 'threat'), destination: (ctx) => this.bestMemoryPosition(ctx, 'threat'), reason: () => 'recent threat memory exceeds investigation threshold' },
      { id: 'investigate-audio', mode: 'investigate', evaluate: (ctx) => ctx.needs.curiosity * 0.75 * this.bestMemoryConfidence(ctx, 'audio'), target: (ctx) => this.bestMemorySource(ctx, 'audio'), destination: (ctx) => this.bestMemoryPosition(ctx, 'audio'), reason: () => 'unconfirmed sound warrants investigation' },
      { id: 'regroup-allies', mode: 'social', evaluate: (ctx) => ctx.needs.social * clamp((4 - ctx.allyCount) / 4, 0, 1), target: () => null, destination: (ctx) => this.bestMemoryPosition(ctx, 'social'), reason: () => 'social cohesion is below desired level' },
      { id: 'patrol', mode: 'patrol', evaluate: (ctx) => ctx.needs.duty * (ctx.enemyCount === 0 ? 0.8 : 0.2), target: () => null, destination: (ctx) => this.patrolDestination(ctx), reason: () => 'no urgent threat; continue duty route' },
      { id: 'rest', mode: 'idle', evaluate: (ctx) => ctx.needs.fatigue * (1 - ctx.staminaRatio), target: () => null, destination: () => null, reason: () => 'stamina recovery has priority' },
    ];
  }

  get mode(): AiMode { return this.#mode; }
  get memories(): readonly AiMemory[] { return [...this.#memories.values()].map((memory) => ({ ...memory, position: copyPosition(memory.position) })); }
  get lastDecision(): AiDecision | null { return this.#lastDecision ? { ...this.#lastDecision, action: { ...this.#lastDecision.action, destination: this.#lastDecision.action.destination ? copyPosition(this.#lastDecision.action.destination) : null } } : null; }

  perceive(stimulus: AiStimulus, currentTick: number): void {
    const distance = stimulus.intensity <= 0 ? Infinity : stimulus.type === 'audio' ? this.config.hearingDistance : this.config.perceptionDistance;
    if (stimulus.type === 'visual' && distance <= 0) return;
    const confidence = clamp(stimulus.intensity, 0, 1);
    const memory: AiMemory = {
      stimulusId: stimulus.id,
      type: stimulus.type,
      position: copyPosition(stimulus.position),
      confidence,
      lastSeenTick: currentTick,
      expiresTick: currentTick + Math.max(1, stimulus.ttlTicks),
      sourceEntity: stimulus.sourceEntity,
    };
    this.#memories.set(stimulus.id, memory);
    this.pruneMemories(currentTick);
  }

  damageReceived(sourceEntity: number | null, position: Vec3, tick: number, amount: number): void {
    this.perceive({ id: `damage:${sourceEntity ?? 'unknown'}:${tick}`, type: 'damage', position, intensity: clamp(amount / 100, 0, 1), sourceEntity, tick, ttlTicks: 90 }, tick);
  }

  tick(currentTick: number, context: Omit<AiContext, 'memories' | 'mode'>): AiDecision {
    this.pruneMemories(currentTick);
    const full: AiContext = { ...context, memories: this.memories, mode: this.#mode };
    const scored: AiAction[] = this.#actions.slice(0, this.config.thinkerBudgetActions).map((definition) => ({
      id: definition.id,
      score: clamp(definition.evaluate(full), 0, 1),
      mode: definition.mode,
      target: definition.target(full),
      destination: definition.destination(full),
      reason: definition.reason(full),
    })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const action = scored[0] ?? { id: 'idle', score: 0, mode: 'idle' as const, target: null, destination: null, reason: 'no action exceeded budget' };
    this.#mode = action.mode;
    const decision: AiDecision = { tick: currentTick, action, evaluatedActions: scored.length, memoryCount: this.#memories.size };
    this.#lastDecision = decision;
    return decision;
  }

  forget(stimulusId: string): boolean { return this.#memories.delete(stimulusId); }

  private pruneMemories(currentTick: number): void {
    for (const [id, memory] of this.#memories) {
      memory.confidence = Math.max(0, memory.confidence - this.config.memoryDecayPerTick);
      if (memory.expiresTick < currentTick || memory.confidence < this.config.minConfidence) this.#memories.delete(id);
    }
    while (this.#memories.size > this.config.maxMemories) {
      const oldest = [...this.#memories.values()].sort((a, b) => a.confidence - b.confidence || a.lastSeenTick - b.lastSeenTick)[0];
      if (!oldest) break;
      this.#memories.delete(oldest.stimulusId);
    }
  }

  private bestMemoryConfidence(ctx: AiContext, type: StimulusType): number { return Math.max(0, ...ctx.memories.filter((m) => m.type === type).map((m) => m.confidence)); }
  private bestMemorySource(ctx: AiContext, type: StimulusType): number | null { return ctx.memories.filter((m) => m.type === type).sort((a, b) => b.confidence - a.confidence || b.lastSeenTick - a.lastSeenTick)[0]?.sourceEntity ?? null; }
  private bestMemoryPosition(ctx: AiContext, type: StimulusType): Vec3 | null { return ctx.memories.filter((m) => m.type === type).sort((a, b) => b.confidence - a.confidence || b.lastSeenTick - a.lastSeenTick)[0]?.position ?? null; }
  private bestHostile(ctx: AiContext): number | null {
    const hostile = ctx.memories.filter((memory) => memory.type === 'visual' || memory.type === 'damage' || memory.type === 'threat').sort((a, b) => b.confidence - a.confidence || distance3(ctx.position, a.position) - distance3(ctx.position, b.position))[0];
    return hostile?.sourceEntity ?? null;
  }
  private farthestMemory(ctx: AiContext): Vec3 | null {
    const candidates = ctx.memories.filter((memory) => memory.type === 'threat' || memory.type === 'damage').sort((a, b) => distance3(ctx.position, b.position) - distance3(ctx.position, a.position));
    return candidates[0]?.position ?? null;
  }
  private patrolDestination(ctx: AiContext): Vec3 { return { x: ctx.position.x + Math.sin(ctx.id) * 12, y: ctx.position.y, z: ctx.position.z + Math.cos(ctx.id) * 12 }; }
}

export interface PerceptionTarget { id: number; position: Vec3; hostile: boolean; intensity?: number }
export function collectPerceptionStimuli(position: Vec3, targets: readonly PerceptionTarget[], tick: number, maxTargets = 32): AiStimulus[] {
  return targets
    .map((target) => ({ target, distance: distance3(position, target.position) }))
    .filter(({ distance }) => distance <= 100)
    .sort((a, b) => a.distance - b.distance || a.target.id - b.target.id)
    .slice(0, maxTargets)
    .map(({ target, distance }) => ({ id: `vision:${target.id}:${tick}`, type: target.hostile ? 'threat' as const : 'visual' as const, position: { ...target.position }, intensity: clamp(1 - distance / 100, 0, 1) * (target.intensity ?? 1), sourceEntity: target.id, tick, ttlTicks: 45 }));
}
