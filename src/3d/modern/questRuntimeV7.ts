import { checksumV7, type QuestDefinitionV7, type QuestIdV7, type QuestObjectiveV7, type QuestProgressV7, questIdV7 } from './runtimeContractsV7';

export interface QuestEventV7 {
  readonly type: 'accepted' | 'progress' | 'completed' | 'failed' | 'abandoned';
  readonly quest: QuestIdV7;
  readonly objective: string | null;
  readonly amount: number;
  readonly tick: number;
  readonly checksum: string;
}

export interface QuestRuntimeOptionsV7 {
  readonly maxQuests?: number;
  readonly maxEvents?: number;
}

const cloneDefinition = (definition: QuestDefinitionV7): QuestDefinitionV7 => Object.freeze({
  ...definition,
  objectives: Object.freeze(definition.objectives.map((objective) => Object.freeze({ ...objective }))),
  prerequisites: Object.freeze([...definition.prerequisites]),
  rewards: Object.freeze([...definition.rewards]),
});

const blankProgress = (definition: QuestDefinitionV7): QuestProgressV7 => Object.freeze({
  id: definition.id,
  accepted: false,
  completed: false,
  failed: false,
  progress: Object.freeze(Object.fromEntries(definition.objectives.map((objective) => [objective.id, 0]))),
});

export class QuestRuntimeV7 {
  readonly maxQuests: number;
  readonly maxEvents: number;
  #definitions = new Map<QuestIdV7, QuestDefinitionV7>();
  #progress = new Map<QuestIdV7, QuestProgressV7>();
  #events: QuestEventV7[] = [];

  constructor(options: QuestRuntimeOptionsV7 = {}) {
    this.maxQuests = Math.max(1, Math.trunc(options.maxQuests ?? 256));
    this.maxEvents = Math.max(16, Math.trunc(options.maxEvents ?? 512));
  }

  register(definition: QuestDefinitionV7): void {
    if (!definition.id || !definition.title.trim()) throw new Error('Quest id and title are required');
    if (definition.objectives.length === 0) throw new Error('Quest must contain at least one objective');
    if (this.#definitions.size >= this.maxQuests && !this.#definitions.has(definition.id)) throw new Error('Quest registry capacity exceeded');
    const normalized = cloneDefinition(definition);
    this.#definitions.set(normalized.id, normalized);
    if (!this.#progress.has(normalized.id)) this.#progress.set(normalized.id, blankProgress(normalized));
  }

  accept(id: QuestIdV7, completedPrerequisites: ReadonlySet<QuestIdV7>, tick: number): boolean {
    const definition = this.#definitions.get(id);
    const current = this.#progress.get(id);
    if (!definition || !current || current.completed || current.failed || current.accepted) return false;
    if (definition.prerequisites.some((prerequisite) => !completedPrerequisites.has(prerequisite))) return false;
    const next = Object.freeze({ ...current, accepted: true });
    this.#progress.set(id, next);
    this.#push('accepted', id, null, 0, tick);
    return true;
  }

  abandon(id: QuestIdV7, tick: number): boolean {
    const current = this.#progress.get(id);
    if (!current || !current.accepted || current.completed) return false;
    this.#progress.set(id, blankProgress(this.#definitions.get(id)!));
    this.#push('abandoned', id, null, 0, tick);
    return true;
  }

  fail(id: QuestIdV7, tick: number): boolean {
    const current = this.#progress.get(id);
    if (!current || !current.accepted || current.completed || current.failed) return false;
    this.#progress.set(id, Object.freeze({ ...current, failed: true }));
    this.#push('failed', id, null, 0, tick);
    return true;
  }

  apply(id: QuestIdV7, objectiveId: string, amount: number, tick: number): QuestProgressV7 | null {
    const definition = this.#definitions.get(id);
    const current = this.#progress.get(id);
    if (!definition || !current || !current.accepted || current.failed || current.completed) return null;
    const objective = definition.objectives.find((item) => item.id === objectiveId);
    if (!objective) return null;
    const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    const previous = current.progress[objective.id] ?? 0;
    const nextValue = Math.min(objective.required, previous + safeAmount);
    const progress = Object.freeze({ ...current.progress, [objective.id]: nextValue });
    const complete = definition.objectives.filter((item) => !item.optional).every((item) => (progress[item.id] ?? 0) >= item.required);
    const next = Object.freeze({ ...current, progress, completed: complete });
    this.#progress.set(id, next);
    this.#push(complete ? 'completed' : 'progress', id, objective.id, safeAmount, tick);
    return next;
  }

  definition(id: QuestIdV7): QuestDefinitionV7 | null { return this.#definitions.get(id) ?? null; }
  progress(id: QuestIdV7): QuestProgressV7 | null { return this.#progress.get(id) ?? null; }
  active(): readonly QuestProgressV7[] { return Object.freeze([...this.#progress.values()].filter((progress) => progress.accepted && !progress.completed && !progress.failed)); }
  events(): readonly QuestEventV7[] { return Object.freeze(this.#events.slice()); }
  snapshot(): Readonly<{ progress: readonly QuestProgressV7[]; checksum: string }> {
    const progress = Object.freeze([...this.#progress.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))));
    return Object.freeze({ progress, checksum: checksumV7(progress) });
  }

  #push(type: QuestEventV7['type'], quest: QuestIdV7, objective: string | null, amount: number, tick: number): void {
    const eventData = { type, quest, objective, amount, tick };
    this.#events.push(Object.freeze({ ...eventData, checksum: checksumV7(eventData) }));
    if (this.#events.length > this.maxEvents) this.#events.shift();
  }
}

export function createQuestDefinitionV7(id: string, title: string, objectives: readonly QuestObjectiveV7[], rewards: readonly string[] = [], prerequisites: readonly string[] = []): QuestDefinitionV7 {
  return Object.freeze({
    id: questIdV7(id),
    title: title.trim(),
    objectives: Object.freeze(objectives.map((objective) => Object.freeze({ ...objective }))),
    rewards: Object.freeze([...rewards]),
    prerequisites: Object.freeze(prerequisites.map(questIdV7)),
  });
}
