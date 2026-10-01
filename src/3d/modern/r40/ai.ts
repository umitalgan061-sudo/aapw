import type { DecisionScore, EntityId, Stimulus, Tick, Vec3 } from './types';
import { clamp, decay, hashJson, stableSort, vec3Distance } from './deterministic';

export interface AiAction {
  readonly id: string;
  readonly baseUtility: number;
  readonly urgency: number;
  readonly energyCost: number;
  readonly cooldownTicks: number;
  readonly tags: readonly string[];
}
export interface AiContext {
  readonly actor: EntityId;
  readonly position: Vec3;
  readonly health: number;
  readonly energy: number;
  readonly threat: number;
  readonly objectives: readonly string[];
  readonly visible: readonly Stimulus[];
  readonly memories: readonly string[];
  readonly tick: Tick;
}
export interface AiDecision {
  readonly action: AiAction;
  readonly score: DecisionScore;
  readonly digest: string;
}
export interface AiLimits {
  readonly maxActions: number;
  readonly maxStimuli: number;
  readonly maxMemory: number;
  readonly memoryHalfLife: number;
}
const DEFAULT_LIMITS: AiLimits = Object.freeze({ maxActions: 64, maxStimuli: 128, maxMemory: 128, memoryHalfLife: 300 });

export class UtilityAi {
  readonly limits: AiLimits;
  #actions = new Map<string, AiAction>();
  constructor(limits: Partial<AiLimits> = {}) { this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits }); }

  register(action: AiAction): boolean {
    if (!action.id || action.id.length > 64 || this.#actions.size >= this.limits.maxActions && !this.#actions.has(action.id)) return false;
    this.#actions.set(action.id, Object.freeze({ ...action, tags: Object.freeze([...action.tags].slice(0, 16)) }));
    return true;
  }

  unregister(id: string): boolean { return this.#actions.delete(id); }

  evaluate(context: AiContext): readonly AiDecision[] {
    const decisions = [...this.#actions.values()].map((action) => {
      const healthFactor = 1 - clamp(context.health / 100, 0, 1);
      const energyFactor = clamp(context.energy / 100, 0, 1);
      const objectiveBoost = action.tags.some((tag) => context.objectives.includes(tag)) ? 1.35 : 1;
      const threatBoost = action.tags.includes('combat') ? 1 + clamp(context.threat, 0, 1) : 1;
      const urgency = clamp(action.urgency * (1 + healthFactor * 0.5), 0, 2);
      const costPenalty = action.energyCost > context.energy ? 2 : action.energyCost / 100;
      const utility = action.baseUtility * objectiveBoost * threatBoost + urgency - costPenalty;
      const confidence = clamp(0.5 + context.visible.length / Math.max(1, this.limits.maxStimuli), 0, 1);
      const score: DecisionScore = Object.freeze({ action: action.id, utility, urgency, cost: action.energyCost, confidence });
      return Object.freeze({ action, score, digest: hashJson({ actor: context.actor, tick: context.tick, score }) });
    });
    return Object.freeze(stableSort(decisions, (a, b) => b.score.utility - a.score.utility || a.action.id.localeCompare(b.action.id)));
  }

  choose(context: AiContext): AiDecision | null {
    const [best] = this.evaluate(context);
    return best && best.score.utility > 0 ? best : null;
  }
}

interface MemoryRecord { readonly key: string; value: number; lastTick: Tick; }
export class AiMemory {
  readonly maxEntries: number;
  readonly halfLifeTicks: number;
  #values = new Map<string, MemoryRecord>();
  constructor(maxEntries = 128, halfLifeTicks = 300) { this.maxEntries = Math.max(1, Math.trunc(maxEntries)); this.halfLifeTicks = Math.max(1, Math.trunc(halfLifeTicks)); }

  write(key: string, value: number, tick: Tick): void {
    if (!key || key.length > 128) return;
    this.#values.set(key, { key, value: clamp(value, -1, 1), lastTick: tick });
    while (this.#values.size > this.maxEntries) {
      const oldest = [...this.#values.values()].sort((a, b) => Number(a.lastTick) - Number(b.lastTick) || a.key.localeCompare(b.key))[0];
      if (oldest) this.#values.delete(oldest.key); else break;
    }
  }
  read(key: string, tick: Tick): number {
    const memory = this.#values.get(key);
    if (!memory) return 0;
    return decay(memory.value, this.halfLifeTicks, Math.max(0, Number(tick) - Number(memory.lastTick)));
  }
  top(tick: Tick, limit = 32): readonly { key: string; value: number }[] {
    return Object.freeze(stableSort([...this.#values.values()].map((m) => ({ key: m.key, value: this.read(m.key, tick) })), (a, b) => Math.abs(b.value) - Math.abs(a.value) || a.key.localeCompare(b.key)).slice(0, Math.max(1, Math.trunc(limit))));
  }
  forget(key: string): void { this.#values.delete(key); }
  clear(): void { this.#values.clear(); }
}

export interface PerceptionResult {
  readonly stimulusId: string;
  readonly distance: number;
  readonly visibility: number;
  readonly confidence: number;
}
export class PerceptionSystem {
  readonly visualRange: number;
  readonly soundRange: number;
  constructor(visualRange = 64, soundRange = 180) { this.visualRange = Math.max(1, visualRange); this.soundRange = Math.max(1, soundRange); }

  observe(position: Vec3, stimuli: readonly Stimulus[]): readonly PerceptionResult[] {
    return Object.freeze(stableSort(stimuli.map((stimulus) => {
      const distance = vec3Distance(position, stimulus.position);
      const range = stimulus.type === 'audio' ? this.soundRange : this.visualRange;
      const falloff = 1 - clamp(distance / range, 0, 1);
      return Object.freeze({ stimulusId: stimulus.id, distance, visibility: falloff, confidence: clamp(stimulus.confidence * falloff, 0, 1) });
    }).filter((item) => item.confidence > 0), (a, b) => b.confidence - a.confidence || a.stimulusId.localeCompare(b.stimulusId)));
  }

  best(position: Vec3, stimuli: readonly Stimulus[]): PerceptionResult | null { return this.observe(position, stimuli)[0] ?? null; }
}
