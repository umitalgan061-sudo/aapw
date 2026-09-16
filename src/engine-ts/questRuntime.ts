import type { Disposable, EntityId } from './coreTypes.js';

export type QuestStatus = 'locked' | 'available' | 'active' | 'completed' | 'failed' | 'abandoned';
export type ObjectiveKind = 'reach' | 'talk' | 'collect' | 'defeat' | 'survive' | 'escort' | 'interact';

export interface ObjectiveDefinition { readonly id: string; readonly kind: ObjectiveKind; readonly target: string; readonly required: number; readonly hidden?: boolean; }
export interface ObjectiveState { readonly id: string; readonly current: number; readonly required: number; readonly complete: boolean; }
export interface QuestDefinition { readonly id: string; readonly title: string; readonly description: string; readonly prerequisites: readonly string[]; readonly objectives: readonly ObjectiveDefinition[]; readonly rewardXp: number; readonly rewardItems: readonly string[]; readonly optional?: boolean; }
export interface QuestState { readonly id: string; readonly status: QuestStatus; readonly startedAtTick: number; readonly completedAtTick: number | null; readonly objectives: readonly ObjectiveState[]; readonly xp: number; readonly rewards: readonly string[]; }
export interface ProgressEvent { readonly type: 'objective' | 'quest'; readonly questId: string; readonly objectiveId?: string; readonly delta?: number; readonly detail: string; readonly tick: number; }
export interface QuestStats { readonly defined: number; readonly active: number; readonly completed: number; readonly failed: number; readonly events: number; readonly xpAwarded: number; }

function validId(value: string): boolean { return value.trim().length > 0 && value.length <= 128; }
function normalizeDefinition(definition: QuestDefinition): QuestDefinition { return Object.freeze({ ...definition, prerequisites: Object.freeze([...new Set(definition.prerequisites)]), objectives: Object.freeze(definition.objectives.map(objective => Object.freeze({ ...objective, required: Math.max(1, Math.trunc(objective.required)) }))), rewardItems: Object.freeze([...new Set(definition.rewardItems)]), rewardXp: Math.max(0, Math.trunc(definition.rewardXp)) }); }

export class QuestRuntime implements Disposable {
  #definitions = new Map<string, QuestDefinition>();
  #states = new Map<string, QuestState>();
  #events: ProgressEvent[] = [];
  #completed = new Set<string>();
  #tick = 0;
  #xpAwarded = 0;
  #disposed = false;

  define(definition: QuestDefinition): boolean {
    if (this.#disposed || !validId(definition.id) || this.#definitions.has(definition.id) || definition.objectives.length === 0) return false;
    this.#definitions.set(definition.id, normalizeDefinition(definition));
    this.#states.set(definition.id, this.#initial(definition.id, 'locked'));
    return true;
  }

  setTick(tick: number): void { this.#tick = Math.max(this.#tick, Math.trunc(tick)); }

  activate(id: string): boolean {
    const definition = this.#definitions.get(id); const state = this.#states.get(id);
    if (!definition || !state || (state.status !== 'locked' && state.status !== 'available')) return false;
    if (!definition.prerequisites.every(prerequisite => this.#completed.has(prerequisite))) return false;
    const next = Object.freeze({ ...state, status: 'active' as const, startedAtTick: this.#tick });
    this.#states.set(id, next);
    this.#events.push(Object.freeze({ type: 'quest', questId: id, detail: 'activated', tick: this.#tick }));
    return true;
  }

  abandon(id: string): boolean {
    const state = this.#states.get(id);
    if (!state || state.status !== 'active') return false;
    this.#states.set(id, Object.freeze({ ...state, status: 'abandoned' }));
    this.#events.push(Object.freeze({ type: 'quest', questId: id, detail: 'abandoned', tick: this.#tick }));
    return true;
  }

  fail(id: string, reason = 'failed'): boolean {
    const state = this.#states.get(id);
    if (!state || state.status !== 'active') return false;
    this.#states.set(id, Object.freeze({ ...state, status: 'failed' }));
    this.#events.push(Object.freeze({ type: 'quest', questId: id, detail: reason, tick: this.#tick }));
    return true;
  }

  progress(questId: string, objectiveId: string, delta = 1): boolean {
    const definition = this.#definitions.get(questId); const state = this.#states.get(questId);
    if (!definition || !state || state.status !== 'active') return false;
    const objective = state.objectives.find(item => item.id === objectiveId); if (!objective || objective.complete) return false;
    const amount = Math.max(0, Number.isFinite(delta) ? delta : 0);
    const objectives = state.objectives.map(item => item.id === objectiveId ? Object.freeze({ ...item, current: Math.min(item.required, item.current + amount), complete: item.current + amount >= item.required }) : item);
    const complete = objectives.every(item => item.complete);
    const next: QuestState = Object.freeze({ ...state, objectives: Object.freeze(objectives), status: complete ? 'completed' : state.status, completedAtTick: complete ? this.#tick : null, xp: complete ? definition.rewardXp : state.xp, rewards: complete ? definition.rewardItems : state.rewards });
    this.#states.set(questId, next);
    this.#events.push(Object.freeze({ type: 'objective', questId, objectiveId, delta: amount, detail: complete ? 'objective-complete-quest-complete' : 'objective-progress', tick: this.#tick }));
    if (complete) { this.#completed.add(questId); this.#xpAwarded += definition.rewardXp; this.#events.push(Object.freeze({ type: 'quest', questId, detail: 'completed', tick: this.#tick })); }
    return true;
  }

  state(id: string): QuestState | undefined { return this.#states.get(id); }
  definitions(): readonly QuestDefinition[] { return Object.freeze([...this.#definitions.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  states(): readonly QuestState[] { return Object.freeze([...this.#states.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  events(): readonly ProgressEvent[] { return Object.freeze(this.#events.slice()); }
  stats(): QuestStats { let active = 0; let completed = 0; let failed = 0; for (const state of this.#states.values()) { if (state.status === 'active') active += 1; else if (state.status === 'completed') completed += 1; else if (state.status === 'failed') failed += 1; } return Object.freeze({ defined: this.#definitions.size, active, completed, failed, events: this.#events.length, xpAwarded: this.#xpAwarded }); }
  clearEvents(): void { this.#events.length = 0; }
  resetProgress(): void { for (const definition of this.#definitions.values()) this.#states.set(definition.id, this.#initial(definition.id, 'locked')); this.#completed.clear(); this.#xpAwarded = 0; }
  dispose(): void { this.#disposed = true; this.#definitions.clear(); this.#states.clear(); this.#events.length = 0; this.#completed.clear(); }

  #initial(id: string, status: QuestStatus): QuestState { const definition = this.#definitions.get(id); return Object.freeze({ id, status, startedAtTick: 0, completedAtTick: null, objectives: Object.freeze((definition?.objectives ?? []).map(objective => Object.freeze({ id: objective.id, current: 0, required: objective.required, complete: false }))), xp: 0, rewards: Object.freeze([]) }); }
}

export const questActor = (id: string): EntityId => id as EntityId;
