import { EntityId, Vec3, clamp, distance3, stableNumber } from './contracts.ts';
import { SeededRandom } from './deterministicWorld.ts';

export type AiMode = 'idle' | 'patrol' | 'investigate' | 'follow' | 'combat' | 'flee' | 'work' | 'sleep';
export type StimulusKind = 'visual' | 'audio' | 'damage' | 'script';

export interface PerceptionStimulus {
  readonly source: EntityId;
  readonly position: Vec3;
  readonly kind: StimulusKind;
  readonly strength: number;
  readonly tick: number;
  readonly faction?: string;
}

export interface PerceptionMemory {
  readonly source: EntityId;
  readonly position: Vec3;
  readonly kind: StimulusKind;
  readonly confidence: number;
  readonly lastSeenTick: number;
}

export interface AiState {
  readonly entity: EntityId;
  readonly faction: string;
  readonly mode: AiMode;
  readonly healthRatio: number;
  readonly staminaRatio: number;
  readonly morale: number;
  readonly fatigue: number;
  readonly alertness: number;
  readonly position: Vec3;
  readonly memories: readonly PerceptionMemory[];
  readonly revision: number;
}

export interface AiDecision {
  readonly entity: EntityId;
  readonly mode: AiMode;
  readonly target: EntityId | null;
  readonly destination: Vec3 | null;
  readonly utility: number;
  readonly reason: string;
}

export interface AiBudget { readonly maxThinkers: number; readonly thinkIntervalTicks: number; readonly memoryLimit: number }

const ACTIONS: readonly AiMode[] = ['combat', 'flee', 'investigate', 'follow', 'work', 'sleep', 'patrol', 'idle'];
const utility = (state: AiState, stimulus: PerceptionMemory | undefined, mode: AiMode): number => {
  const threat = stimulus?.confidence ?? 0;
  const survival = (1 - state.healthRatio) * 0.9 + (1 - state.staminaRatio) * 0.1;
  if (mode === 'flee') return survival * 0.9 + threat * 0.65;
  if (mode === 'combat') return threat * state.healthRatio * 0.95;
  if (mode === 'investigate') return threat * 0.7 * state.alertness;
  if (mode === 'follow') return (stimulus ? 0.6 : 0) * state.alertness;
  if (mode === 'sleep') return state.fatigue * (1 - threat * 0.5);
  if (mode === 'work') return state.morale * state.staminaRatio * (1 - threat);
  if (mode === 'patrol') return 0.25 * state.morale * (1 - threat);
  return 0.12;
};

export class AiDirector {
  readonly #states = new Map<EntityId, AiState>();
  readonly #stimuli: PerceptionStimulus[] = [];
  readonly #lastThink = new Map<EntityId, number>();
  readonly #budget: AiBudget;
  readonly #random: SeededRandom;
  #tick = 0;
  #thoughts = 0;
  #skipped = 0;

  constructor(seed = 1, budget: AiBudget = { maxThinkers: 128, thinkIntervalTicks: 8, memoryLimit: 16 }) { this.#random = new SeededRandom(seed); this.#budget = Object.freeze({ maxThinkers: Math.max(1, Math.floor(budget.maxThinkers)), thinkIntervalTicks: Math.max(1, Math.floor(budget.thinkIntervalTicks)), memoryLimit: Math.max(1, Math.floor(budget.memoryLimit)) }); }

  register(state: AiState): void { this.#states.set(state.entity, Object.freeze({ ...state, memories: Object.freeze([...state.memories].slice(-this.#budget.memoryLimit)) })); }
  remove(entity: EntityId): void { this.#states.delete(entity); this.#lastThink.delete(entity); }
  emit(stimulus: PerceptionStimulus): void { this.#stimuli.push(Object.freeze({ ...stimulus, strength: clamp(stimulus.strength, 0, 1) })); if (this.#stimuli.length > 1024) this.#stimuli.splice(0, this.#stimuli.length - 1024); }

  private #perceive(state: AiState): AiState {
    const nearby = this.#stimuli.filter((stimulus) => stimulus.tick >= this.#tick - 60 && distance3(state.position, stimulus.position) <= 40 && stimulus.source !== state.entity);
    const nextMemory: PerceptionMemory[] = [...state.memories];
    for (const stimulus of nearby) {
      const confidence = clamp(stimulus.strength * (stimulus.kind === 'visual' ? 1 : stimulus.kind === 'damage' ? 1.1 : 0.75));
      const existingIndex = nextMemory.findIndex((memory) => memory.source === stimulus.source);
      const memory = Object.freeze({ source: stimulus.source, position: Object.freeze({ ...stimulus.position }), kind: stimulus.kind, confidence, lastSeenTick: stimulus.tick });
      if (existingIndex >= 0) nextMemory[existingIndex] = memory;
      else nextMemory.push(memory);
    }
    nextMemory.sort((a, b) => b.confidence - a.confidence || b.lastSeenTick - a.lastSeenTick || Number(a.source) - Number(b.source));
    return Object.freeze({ ...state, memories: Object.freeze(nextMemory.slice(0, this.#budget.memoryLimit)), revision: state.revision + 1 });
  }

  think(entity: EntityId): AiDecision | null {
    const initial = this.#states.get(entity);
    if (!initial) return null;
    const state = this.#perceive(initial);
    this.#states.set(entity, state);
    const hostile = state.memories.find((memory) => memory.confidence > 0.2);
    const candidates = ACTIONS.map((mode) => ({ mode, score: utility(state, hostile, mode) + this.#random.next() * 1e-7 }));
    candidates.sort((a, b) => b.score - a.score || a.mode.localeCompare(b.mode));
    const best = candidates[0]!;
    const decision = Object.freeze({ entity, mode: best.mode, target: best.mode === 'combat' || best.mode === 'flee' || best.mode === 'follow' ? hostile?.source ?? null : null, destination: hostile && (best.mode === 'combat' || best.mode === 'investigate' || best.mode === 'follow') ? hostile.position : null, utility: stableNumber(best.score), reason: hostile ? `${best.mode}: stimulus ${hostile.source}` : `${best.mode}: routine utility` });
    return decision;
  }

  tick(tick: number): readonly AiDecision[] {
    this.#tick = Math.max(this.#tick, Math.floor(tick));
    this.#thoughts = 0;
    this.#skipped = 0;
    const states = [...this.#states.values()].sort((a, b) => Number(a.entity) - Number(b.entity));
    const decisions: AiDecision[] = [];
    for (const state of states) {
      const last = this.#lastThink.get(state.entity) ?? -Infinity;
      if (this.#tick - last < this.#budget.thinkIntervalTicks || this.#thoughts >= this.#budget.maxThinkers) { this.#skipped += 1; continue; }
      this.#lastThink.set(state.entity, this.#tick);
      this.#thoughts += 1;
      const decision = this.think(state.entity);
      if (decision) decisions.push(decision);
    }
    return Object.freeze(decisions);
  }

  state(entity: EntityId): AiState | undefined { return this.#states.get(entity); }
  metrics(): Readonly<{ tick: number; thinkers: number; skipped: number; agents: number }> { return Object.freeze({ tick: this.#tick, thinkers: this.#thoughts, skipped: this.#skipped, agents: this.#states.size }); }
}
