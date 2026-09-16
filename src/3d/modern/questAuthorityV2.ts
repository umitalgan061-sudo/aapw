import { stableDigest, type Vec3 } from './deterministic.ts';

export type QuestStatus = 'locked' | 'available' | 'active' | 'completed' | 'failed' | 'abandoned';
export type QuestObjectiveKind = 'reach' | 'collect' | 'defeat' | 'interact' | 'escort' | 'survive';

export interface QuestObjective {
  readonly id: string;
  readonly kind: QuestObjectiveKind;
  readonly target: string;
  readonly amount: number;
  readonly progress: number;
  readonly optional: boolean;
}

export interface QuestDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly level: number;
  readonly prerequisites: readonly string[];
  readonly rewards: Readonly<Record<string, number>>;
  readonly objectives: readonly QuestObjective[];
}

export interface QuestRuntime {
  readonly id: string;
  readonly status: QuestStatus;
  readonly acceptedAt: number;
  readonly updatedAt: number;
  readonly objectives: readonly QuestObjective[];
  readonly revision: number;
}

export interface QuestEvent {
  readonly type: 'accept' | 'progress' | 'complete' | 'fail' | 'abandon';
  readonly questId: string;
  readonly objectiveId?: string;
  readonly amount?: number;
  readonly timestamp: number;
}

const clampCount = (value: number): number => Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
const normalizeId = (value: string): string => value.trim().slice(0, 96);

const normalizeObjective = (objective: QuestObjective): QuestObjective => Object.freeze({
  id: normalizeId(objective.id),
  kind: objective.kind,
  target: normalizeId(objective.target),
  amount: Math.max(1, clampCount(objective.amount)),
  progress: Math.min(Math.max(0, clampCount(objective.progress)), Math.max(1, clampCount(objective.amount))),
  optional: objective.optional === true,
});

export class QuestAuthorityV2 {
  readonly #definitions = new Map<string, QuestDefinition>();
  readonly #runtime = new Map<string, QuestRuntime>();
  readonly #events: QuestEvent[] = [];
  readonly #capacity: number;
  readonly #eventCapacity: number;
  #revision = 0;

  constructor(options: { capacity?: number; eventCapacity?: number } = {}) {
    this.#capacity = Math.max(32, Math.floor(options.capacity ?? 2048));
    this.#eventCapacity = Math.max(64, Math.floor(options.eventCapacity ?? 4096));
  }

  register(definition: QuestDefinition): boolean {
    const id = normalizeId(definition.id);
    if (!id || this.#definitions.has(id) || this.#definitions.size >= this.#capacity) return false;
    const objectives = definition.objectives.map(normalizeObjective);
    this.#definitions.set(id, Object.freeze({ ...definition, id, title: definition.title.slice(0, 160), description: definition.description.slice(0, 2000), level: Math.max(1, clampCount(definition.level)), prerequisites: [...new Set(definition.prerequisites.map(normalizeId).filter(Boolean))], rewards: Object.freeze({ ...definition.rewards }), objectives: Object.freeze(objectives) }));
    return true;
  }

  unlockable(id: string): boolean {
    const definition = this.#definitions.get(normalizeId(id));
    if (!definition) return false;
    return definition.prerequisites.every((prerequisite) => this.#runtime.get(prerequisite)?.status === 'completed');
  }

  accept(id: string, now: number): QuestRuntime | null {
    const cleanId = normalizeId(id);
    const definition = this.#definitions.get(cleanId);
    if (!definition || !this.unlockable(cleanId) || this.#runtime.get(cleanId)?.status === 'active') return null;
    const runtime = Object.freeze({ id: cleanId, status: 'active' as const, acceptedAt: now, updatedAt: now, objectives: definition.objectives.map((objective) => Object.freeze({ ...objective, progress: 0 })), revision: ++this.#revision });
    this.#runtime.set(cleanId, runtime);
    this.#record({ type: 'accept', questId: cleanId, timestamp: now });
    return runtime;
  }

  progress(id: string, objectiveId: string, amount: number, now: number): QuestRuntime | null {
    const cleanId = normalizeId(id);
    const cleanObjective = normalizeId(objectiveId);
    const current = this.#runtime.get(cleanId);
    if (!current || current.status !== 'active' || amount <= 0) return null;
    const objectives = current.objectives.map((objective) => objective.id === cleanObjective ? Object.freeze({ ...objective, progress: Math.min(objective.amount, objective.progress + clampCount(amount)) }) : objective);
    if (objectives.every((objective) => objective.optional || objective.progress >= objective.amount)) {
      const completed = Object.freeze({ ...current, status: 'completed' as const, objectives, updatedAt: now, revision: ++this.#revision });
      this.#runtime.set(cleanId, completed);
      this.#record({ type: 'complete', questId: cleanId, objectiveId: cleanObjective, amount: clampCount(amount), timestamp: now });
      return completed;
    }
    const next = Object.freeze({ ...current, objectives, updatedAt: now, revision: ++this.#revision });
    this.#runtime.set(cleanId, next);
    this.#record({ type: 'progress', questId: cleanId, objectiveId: cleanObjective, amount: clampCount(amount), timestamp: now });
    return next;
  }

  fail(id: string, now: number): boolean {
    return this.#transition(id, 'failed', now, 'fail');
  }

  abandon(id: string, now: number): boolean {
    return this.#transition(id, 'abandoned', now, 'abandon');
  }

  get(id: string): QuestRuntime | undefined { return this.#runtime.get(normalizeId(id)); }
  definitions(): readonly QuestDefinition[] { return [...this.#definitions.values()]; }
  active(): readonly QuestRuntime[] { return [...this.#runtime.values()].filter((quest) => quest.status === 'active'); }
  history(): readonly QuestEvent[] { return [...this.#events]; }

  snapshot(): Readonly<{ revision: number; runtime: readonly QuestRuntime[]; digest: string }> {
    const runtime = [...this.#runtime.values()].sort((a, b) => a.id.localeCompare(b.id));
    return Object.freeze({ revision: this.#revision, runtime, digest: stableDigest(runtime) });
  }

  restore(snapshot: Readonly<{ runtime: readonly QuestRuntime[] }>): void {
    this.#runtime.clear();
    for (const quest of snapshot.runtime.slice(0, this.#capacity)) this.#runtime.set(normalizeId(quest.id), Object.freeze({ ...quest, objectives: quest.objectives.map(normalizeObjective) }));
    this.#revision += 1;
  }

  #transition(id: string, status: Extract<QuestStatus, 'failed' | 'abandoned'>, now: number, type: 'fail' | 'abandon'): boolean {
    const cleanId = normalizeId(id);
    const current = this.#runtime.get(cleanId);
    if (!current || current.status !== 'active') return false;
    this.#runtime.set(cleanId, Object.freeze({ ...current, status, updatedAt: now, revision: ++this.#revision }));
    this.#record({ type, questId: cleanId, timestamp: now });
    return true;
  }

  #record(event: QuestEvent): void {
    this.#events.push(Object.freeze(event));
    if (this.#events.length > this.#eventCapacity) this.#events.splice(0, this.#events.length - this.#eventCapacity);
  }
}

export interface QuestLocationTrigger {
  readonly questId: string;
  readonly objectiveId: string;
  readonly center: Vec3;
  readonly radius: number;
}

export const insideQuestTrigger = (position: Vec3, trigger: QuestLocationTrigger): boolean => {
  const radius = Math.max(0, trigger.radius);
  const dx = position.x - trigger.center.x;
  const dy = position.y - trigger.center.y;
  const dz = position.z - trigger.center.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
};
