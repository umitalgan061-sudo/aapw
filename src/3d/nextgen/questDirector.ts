import type { EntityId, QuestId, RuntimeEvent } from './kernelTypes.ts';
import { asEntityId, asQuestId, clamp, stableHash } from './kernelTypes.ts';

export type QuestStatus = 'locked' | 'available' | 'active' | 'completed' | 'failed' | 'abandoned';
export type ObjectiveKind = 'kill' | 'collect' | 'reach' | 'interact' | 'survive' | 'escort';

export interface QuestObjective {
  readonly id: string;
  readonly kind: ObjectiveKind;
  readonly target: string;
  readonly required: number;
  readonly hidden?: boolean;
}

export interface QuestDefinition {
  readonly id: string;
  readonly title: string;
  readonly prerequisites?: readonly string[];
  readonly objectives: readonly QuestObjective[];
  readonly rewards?: Readonly<Record<string, number>>;
  readonly timeLimitTicks?: number;
}

export interface ObjectiveState {
  readonly id: string;
  readonly current: number;
  readonly required: number;
  readonly complete: boolean;
}

export interface QuestState {
  readonly id: QuestId;
  readonly status: QuestStatus;
  readonly startedTick: number | null;
  readonly updatedTick: number;
  readonly objectives: ReadonlyMap<string, ObjectiveState>;
  readonly failureReason?: string;
}

export interface QuestProgressEvent {
  readonly quest: QuestId;
  readonly objective: string;
  readonly amount: number;
  readonly tick: number;
}

export class QuestDirector {
  #definitions = new Map<QuestId, QuestDefinition>();
  #states = new Map<QuestId, QuestState>();
  #events: RuntimeEvent<unknown>[] = [];
  #eventCounter = 0;
  #disposed = false;

  register(definition: QuestDefinition): QuestId {
    const id = asQuestId(definition.id);
    this.#definitions.set(id, Object.freeze({
      ...definition,
      id: String(id),
      prerequisites: Object.freeze([...(definition.prerequisites ?? [])].sort()),
      objectives: Object.freeze(definition.objectives.map((objective) => Object.freeze({ ...objective }))),
    }));
    if (!this.#states.has(id)) {
      const objectives = new Map<string, ObjectiveState>();
      for (const objective of definition.objectives) {
        objectives.set(objective.id, Object.freeze({
          id: objective.id,
          current: 0,
          required: Math.max(1, Math.floor(objective.required)),
          complete: false,
        }));
      }
      this.#states.set(id, Object.freeze({
        id,
        status: this.#prerequisitesMet(id) ? 'available' : 'locked',
        startedTick: null,
        updatedTick: 0,
        objectives,
      }));
    }
    return id;
  }

  #prerequisitesMet(id: QuestId): boolean {
    const definition = this.#definitions.get(id);
    if (!definition) return false;
    return (definition.prerequisites ?? []).every((prerequisite) => this.#states.get(asQuestId(prerequisite))?.status === 'completed');
  }

  state(id: QuestId | string): QuestState | null {
    return this.#states.get(asQuestId(String(id))) ?? null;
  }

  definition(id: QuestId | string): QuestDefinition | null {
    return this.#definitions.get(asQuestId(String(id))) ?? null;
  }

  start(id: QuestId | string, tick: number): boolean {
    const key = asQuestId(String(id));
    const state = this.#states.get(key);
    if (!state || this.#disposed || (state.status !== 'available' && state.status !== 'locked')) return false;
    if (!this.#prerequisitesMet(key)) return false;
    this.#states.set(key, Object.freeze({ ...state, status: 'active', startedTick: Math.max(0, Math.floor(tick)), updatedTick: Math.max(0, Math.floor(tick)) }));
    this.#refreshAvailable(Math.max(0, Math.floor(tick)));
    return true;
  }

  progress(event: QuestProgressEvent): boolean {
    if (this.#disposed) return false;
    const state = this.#states.get(event.quest);
    const definition = this.#definitions.get(event.quest);
    if (!state || !definition || state.status !== 'active') return false;

    const objectiveDefinition = definition.objectives.find((objective) => objective.id === event.objective);
    const currentObjective = state.objectives.get(event.objective);
    if (!objectiveDefinition || !currentObjective) return false;

    const current = Math.min(
      currentObjective.required,
      currentObjective.current + Math.max(0, Math.floor(event.amount)),
    );
    const objective = Object.freeze({ ...currentObjective, current, complete: current >= currentObjective.required });
    const objectives = new Map(state.objectives);
    objectives.set(event.objective, objective);
    const allComplete = [...objectives.values()].every((item) => item.complete);

    this.#states.set(event.quest, Object.freeze({
      ...state,
      status: allComplete ? 'completed' : 'active',
      updatedTick: Math.max(state.updatedTick, Math.floor(event.tick)),
      objectives,
    }));
    this.#emit(event.tick, allComplete ? 'quest.completed' : 'quest.progress', { quest: event.quest, objective: event.objective, current });
    this.#refreshAvailable(Math.max(0, Math.floor(event.tick)));
    return true;
  }

  fail(id: QuestId | string, tick: number, reason = 'failed'): boolean {
    const key = asQuestId(String(id));
    const state = this.#states.get(key);
    if (!state || state.status !== 'active') return false;
    this.#states.set(key, Object.freeze({ ...state, status: 'failed', updatedTick: tick, failureReason: reason.slice(0, 256) }));
    this.#emit(tick, 'quest.failed', { quest: key, reason });
    this.#refreshAvailable(tick);
    return true;
  }

  abandon(id: QuestId | string, tick: number): boolean {
    const key = asQuestId(String(id));
    const state = this.#states.get(key);
    if (!state || state.status !== 'active') return false;
    this.#states.set(key, Object.freeze({ ...state, status: 'abandoned', updatedTick: tick }));
    this.#emit(tick, 'quest.abandoned', { quest: key });
    this.#refreshAvailable(tick);
    return true;
  }

  tick(tick: number): void {
    if (this.#disposed) return;
    for (const [id, state] of this.#states) {
      if (state.status !== 'active') continue;
      const definition = this.#definitions.get(id);
      if (!definition?.timeLimitTicks || state.startedTick === null) continue;
      if (tick - state.startedTick >= definition.timeLimitTicks) this.fail(id, tick, 'time-limit');
    }
  }

  private #emit(tick: number, type: string, payload: unknown): void {
    const event: RuntimeEvent = Object.freeze({
      id: (++this.#eventCounter) as RuntimeEvent['id'],
      tick,
      type,
      payload,
    });
    this.#events.push(event);
    if (this.#events.length > 1024) this.#events.splice(0, this.#events.length - 1024);
  }

  #refreshAvailable(tick: number): void {
    for (const [id, state] of this.#states) {
      if (state.status !== 'locked') continue;
      if (this.#prerequisitesMet(id)) this.#states.set(id, Object.freeze({ ...state, status: 'available', updatedTick: tick }));
    }
  }

  events(): readonly RuntimeEvent[] { return Object.freeze([...this.#events]); }
  drainEvents(): readonly RuntimeEvent[] { return Object.freeze(this.#events.splice(0)); }

  diagnostics() {
    const states = [...this.#states.values()].sort((a, b) => a.id.localeCompare(b.id));
    return Object.freeze({
      total: states.length,
      locked: states.filter((x) => x.status === 'locked').length,
      available: states.filter((x) => x.status === 'available').length,
      active: states.filter((x) => x.status === 'active').length,
      completed: states.filter((x) => x.status === 'completed').length,
      failed: states.filter((x) => x.status === 'failed').length,
      digest: stableHash(states.map((x) => ({
        id: x.id,
        status: x.status,
        objectives: [...x.objectives.values()],
      }))),
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#definitions.clear();
    this.#states.clear();
    this.#events = [];
  }
}
