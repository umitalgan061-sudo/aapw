import { type SystemDefinition, type SystemId, type SystemPhase, type SystemReport, type WorkPriority } from './contracts.ts';

const PHASE_ORDER: readonly SystemPhase[] = [
  'input',
  'simulation',
  'gameplay',
  'navigation',
  'streaming',
  'network',
  'animation',
  'render-prep',
  'render',
  'post-frame',
];

const PRIORITY_WEIGHT: Record<WorkPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

export interface SchedulerClock {
  now(): number;
}

const DEFAULT_CLOCK: SchedulerClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : 0),
};

export class DeterministicScheduler {
  #systems = new Map<SystemId, SystemDefinition>();
  #clock: SchedulerClock;

  constructor(clock: SchedulerClock = DEFAULT_CLOCK) {
    this.#clock = clock;
  }

  add(system: SystemDefinition): void {
    if (this.#systems.has(system.id)) throw new Error('System already registered: ' + system.id);
    this.#systems.set(system.id, system);
  }

  remove(id: SystemId): boolean {
    return this.#systems.delete(id);
  }

  get(id: SystemId): SystemDefinition | undefined {
    return this.#systems.get(id);
  }

  list(): readonly SystemDefinition[] {
    return Object.freeze([...this.#systems.values()].sort(this.#compareSystems));
  }

  order(): readonly SystemDefinition[] {
    const systems = [...this.#systems.values()];
    const indegree = new Map<SystemId, number>(systems.map((system) => [system.id, 0]));
    const edges = new Map<SystemId, SystemId[]>();
    for (const system of systems) {
      for (const dependency of system.dependencies ?? []) {
        if (!this.#systems.has(dependency)) throw new Error('Missing system dependency: ' + dependency);
        indegree.set(system.id, (indegree.get(system.id) ?? 0) + 1);
        const list = edges.get(dependency) ?? [];
        list.push(system.id);
        edges.set(dependency, list);
      }
    }
    const ready = systems.filter((system) => (indegree.get(system.id) ?? 0) === 0).sort(this.#compareSystems);
    const result: SystemDefinition[] = [];
    while (ready.length > 0) {
      const current = ready.shift();
      if (!current) break;
      result.push(current);
      for (const dependent of edges.get(current.id) ?? []) {
        const next = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, next);
        if (next === 0) {
          const system = this.#systems.get(dependent);
          if (system) {
            ready.push(system);
            ready.sort(this.#compareSystems);
          }
        }
      }
    }
    if (result.length !== systems.length) throw new Error('Scheduler dependency cycle detected');
    return Object.freeze(result);
  }

  run(contextFactory: (phase: SystemPhase) => Parameters<SystemDefinition['update']>[0]): readonly SystemReport[] {
    const reports: SystemReport[] = [];
    const ordered = this.order();
    for (const system of ordered) {
      if (system.enabled && !system.enabled()) {
        reports.push(Object.freeze({
          id: system.id,
          phase: system.phase,
          elapsedMs: 0,
          budgetMs: system.budgetMs ?? Number.POSITIVE_INFINITY,
          overBudget: false,
          skipped: true,
          reason: 'disabled',
        }));
        continue;
      }
      const before = this.#clock.now();
      system.update(contextFactory(system.phase));
      const elapsedMs = Math.max(0, this.#clock.now() - before);
      const budgetMs = system.budgetMs ?? Number.POSITIVE_INFINITY;
      reports.push(Object.freeze({
        id: system.id,
        phase: system.phase,
        elapsedMs,
        budgetMs,
        overBudget: Number.isFinite(budgetMs) && elapsedMs > budgetMs,
        skipped: false,
      }));
    }
    return Object.freeze(reports);
  }

  phaseOrder(): readonly SystemPhase[] {
    return PHASE_ORDER;
  }

  #compareSystems = (a: SystemDefinition, b: SystemDefinition): number => {
    const phaseA = PHASE_ORDER.indexOf(a.phase);
    const phaseB = PHASE_ORDER.indexOf(b.phase);
    if (phaseA !== phaseB) return phaseA - phaseB;
    const priorityA = PRIORITY_WEIGHT[a.priority];
    const priorityB = PRIORITY_WEIGHT[b.priority];
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.id.localeCompare(b.id);
  };
}
