import type { EntityId, Tick } from './contracts.ts';
import { asTick, clamp, hashString, stableJson } from './contracts.ts';

export type QuestStatus = 'locked' | 'available' | 'active' | 'completed' | 'failed' | 'abandoned';
export type ObjectiveType = 'kill' | 'collect' | 'reach' | 'interact' | 'escort' | 'dialogue' | 'custom';

export interface QuestObjective {
  readonly id: string;
  readonly type: ObjectiveType;
  readonly required: number;
  readonly description: string;
  readonly hidden?: boolean;
}

export interface QuestDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly prerequisites: readonly string[];
  readonly objectives: readonly QuestObjective[];
  readonly rewardXp: number;
  readonly rewardGold: number;
  readonly repeatable: boolean;
  readonly timeLimitTicks?: number;
}

export interface ObjectiveProgress {
  readonly current: number;
  readonly required: number;
  readonly completed: boolean;
}

export interface QuestState {
  readonly id: string;
  readonly status: QuestStatus;
  readonly startedAt: Tick | null;
  readonly completedAt: Tick | null;
  readonly revision: number;
  readonly objectives: Readonly<Record<string, ObjectiveProgress>>;
}

export interface QuestEvent {
  readonly tick: Tick;
  readonly questId: string;
  readonly objectiveId?: string;
  readonly actor?: EntityId;
  readonly amount?: number;
  readonly kind: 'start' | 'progress' | 'complete' | 'fail' | 'abandon';
}

export interface QuestJournalSnapshot {
  readonly quests: readonly QuestState[];
  readonly events: readonly QuestEvent[];
  readonly checksum: string;
}

const cloneProgress = (objective: QuestObjective): ObjectiveProgress => Object.freeze({ current: 0, required: Math.max(1, objective.required), completed: false });

export class QuestJournal {
  readonly #definitions = new Map<string, QuestDefinition>();
  readonly #states = new Map<string, QuestState>();
  readonly #events: QuestEvent[] = [];
  #tick: Tick = asTick(0);

  define(definition: QuestDefinition): void {
    if (!definition.id.trim() || this.#definitions.has(definition.id)) throw new Error(`quest exists: ${definition.id}`);
    if (definition.objectives.length === 0) throw new Error(`quest needs objectives: ${definition.id}`);
    const objectives = [...new Map(definition.objectives.map((item) => [item.id, Object.freeze({ ...item })])).values()];
    this.#definitions.set(definition.id, Object.freeze({ ...definition, prerequisites: Object.freeze([...definition.prerequisites]), objectives: Object.freeze(objectives) }));
  }

  setTick(tick: Tick): void { this.#tick = tick; }
  definition(id: string): QuestDefinition | undefined { return this.#definitions.get(id); }
  state(id: string): QuestState | undefined { return this.#states.get(id); }

  refreshAvailability(completedIds: ReadonlySet<string>): void {
    for (const [id, definition] of this.#definitions) {
      const current = this.#states.get(id);
      if (current && ['active', 'completed', 'failed'].includes(current.status)) continue;
      const unlocked = definition.prerequisites.every((required) => completedIds.has(required));
      const objectives = current?.objectives ?? Object.freeze(Object.fromEntries(definition.objectives.map((objective) => [objective.id, cloneProgress(objective)])));
      this.#states.set(id, Object.freeze({ id, status: unlocked ? 'available' : 'locked', startedAt: current?.startedAt ?? null, completedAt: current?.completedAt ?? null, revision: (current?.revision ?? 0) + 1, objectives }));
    }
  }

  start(id: string): boolean {
    const definition = this.#definitions.get(id);
    const current = this.#states.get(id);
    if (!definition || !current || current.status !== 'available') return false;
    const state = Object.freeze({ ...current, status: 'active' as const, startedAt: this.#tick, revision: current.revision + 1 });
    this.#states.set(id, state);
    this.#record({ tick: this.#tick, questId: id, kind: 'start' });
    return true;
  }

  progress(id: string, objectiveId: string, amount: number, actor?: EntityId): QuestState | null {
    const definition = this.#definitions.get(id);
    const current = this.#states.get(id);
    const objective = definition?.objectives.find((candidate) => candidate.id === objectiveId);
    if (!definition || !current || current.status !== 'active' || !objective) return null;
    const previous = current.objectives[objectiveId] ?? cloneProgress(objective);
    const nextCurrent = clamp(previous.current + Math.max(0, amount), 0, objective.required);
    const nextProgress = Object.freeze({ current: nextCurrent, required: objective.required, completed: nextCurrent >= objective.required });
    const objectives = Object.freeze({ ...current.objectives, [objectiveId]: nextProgress });
    const nextState = Object.freeze({ ...current, objectives, revision: current.revision + 1 });
    this.#states.set(id, nextState);
    this.#record({ tick: this.#tick, questId: id, objectiveId, actor, amount: Math.max(0, amount), kind: 'progress' });
    if (definition.objectives.filter((candidate) => !candidate.hidden).every((candidate) => nextState.objectives[candidate.id]?.completed)) this.complete(id);
    return nextState;
  }

  complete(id: string): boolean {
    const current = this.#states.get(id);
    if (!current || current.status !== 'active') return false;
    this.#states.set(id, Object.freeze({ ...current, status: 'completed', completedAt: this.#tick, revision: current.revision + 1 }));
    this.#record({ tick: this.#tick, questId: id, kind: 'complete' });
    return true;
  }

  fail(id: string): boolean { return this.#setTerminal(id, 'failed', 'fail'); }
  abandon(id: string): boolean { return this.#setTerminal(id, 'abandoned', 'abandon'); }

  tick(currentTick: Tick): readonly string[] {
    this.#tick = currentTick;
    const failed: string[] = [];
    for (const [id, state] of this.#states) {
      const definition = this.#definitions.get(id);
      if (state.status !== 'active' || !definition?.timeLimitTicks || !state.startedAt) continue;
      if (Number(currentTick) - Number(state.startedAt) > definition.timeLimitTicks) { this.fail(id); failed.push(id); }
    }
    return Object.freeze(failed);
  }

  snapshot(): QuestJournalSnapshot {
    const quests = Object.freeze([...this.#states.values()].sort((a, b) => a.id.localeCompare(b.id)));
    const events = Object.freeze([...this.#events]);
    const payload = { quests, events };
    return Object.freeze({ ...payload, checksum: hashString(stableJson(payload)) });
  }

  private #setTerminal(id: string, status: 'failed' | 'abandoned', kind: 'fail' | 'abandon'): boolean {
    const current = this.#states.get(id);
    if (!current || current.status !== 'active') return false;
    this.#states.set(id, Object.freeze({ ...current, status, revision: current.revision + 1 }));
    this.#record({ tick: this.#tick, questId: id, kind });
    return true;
  }

  #record(event: QuestEvent): void { this.#events.push(Object.freeze(event)); if (this.#events.length > 4096) this.#events.splice(0, this.#events.length - 4096); }
}
