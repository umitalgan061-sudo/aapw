import { stableDigest } from '../deterministic.ts';

export type SimulationPhaseR26 =
  | 'input'
  | 'preSimulation'
  | 'simulation'
  | 'postSimulation'
  | 'presentation'
  | 'telemetry';

export interface SimulationTaskR26 {
  readonly id: string;
  readonly phase: SimulationPhaseR26;
  readonly priority: number;
  readonly dependencies: readonly string[];
  readonly budgetMs: number;
  readonly cadenceTicks: number;
  readonly enabled: boolean;
  readonly run: (context: SimulationContextR26) => void | Promise<void>;
}

export interface SimulationContextR26 {
  readonly tick: number;
  readonly deltaSeconds: number;
  readonly frame: number;
  readonly phase: SimulationPhaseR26;
  readonly emit: (event: SimulationEventR26) => void;
  readonly getMetric: (name: string) => number;
}

export interface SimulationEventR26 {
  readonly tick: number;
  readonly type: string;
  readonly source: string;
  readonly payload: unknown;
}

export interface SimulationBudgetR26 {
  readonly maxFrameMs: number;
  readonly maxSimulationMs: number;
  readonly maxTasksPerTick: number;
  readonly maxEvents: number;
  readonly maxDeltaSeconds: number;
}

export interface SimulationTaskResultR26 {
  readonly id: string;
  readonly phase: SimulationPhaseR26;
  readonly durationMs: number;
  readonly skipped: boolean;
  readonly failed: boolean;
  readonly reason?: string;
}

export interface SimulationFrameResultR26 {
  readonly frame: number;
  readonly tick: number;
  readonly simulationMs: number;
  readonly taskResults: readonly SimulationTaskResultR26[];
  readonly eventCount: number;
  readonly overBudget: boolean;
  readonly digest: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const cleanId = (value: string): string =>
  value.trim().slice(0, 128);

const now = (): number =>
  globalThis.performance?.now?.() ?? Date.now();

export class SimulationKernelR26 {
  readonly #tasks = new Map<string, SimulationTaskR26>();
  readonly #metrics = new Map<string, number>();
  readonly #events: SimulationEventR26[] = [];
  readonly #budget: SimulationBudgetR26;
  readonly #phaseOrder: readonly SimulationPhaseR26[] = Object.freeze([
    'input',
    'preSimulation',
    'simulation',
    'postSimulation',
    'presentation',
    'telemetry',
  ]);
  #frame = 0;
  #tick = 0;
  #disposed = false;
  #eventSequence = 0;

  constructor(budget: Partial<SimulationBudgetR26> = {}) {
    this.#budget = Object.freeze({
      maxFrameMs: Math.max(1, budget.maxFrameMs ?? 16.67),
      maxSimulationMs: Math.max(1, budget.maxSimulationMs ?? 11),
      maxTasksPerTick: Math.max(1, Math.floor(budget.maxTasksPerTick ?? 256)),
      maxEvents: Math.max(32, Math.floor(budget.maxEvents ?? 8192)),
      maxDeltaSeconds: Math.max(1 / 30, budget.maxDeltaSeconds ?? 0.1),
    });
  }

  register(task: SimulationTaskR26): void {
    this.#assertLive();
    const id = cleanId(task.id);
    if (!id) throw new Error('R26_TASK_ID_EMPTY');
    if (this.#tasks.has(id)) throw new Error(`R26_TASK_DUPLICATE:${id}`);
    const normalized = Object.freeze({
      ...task,
      id,
      priority: Math.floor(Number.isFinite(task.priority) ? task.priority : 0),
      dependencies: Object.freeze([...new Set(task.dependencies.map(cleanId).filter(Boolean))].sort()),
      budgetMs: Math.max(0.01, Number.isFinite(task.budgetMs) ? task.budgetMs : 0.1),
      cadenceTicks: Math.max(1, Math.floor(task.cadenceTicks || 1)),
      enabled: task.enabled !== false,
    });
    this.#tasks.set(id, normalized);
    this.#assertNoCycle();
  }

  registerMany(tasks: readonly SimulationTaskR26[]): void {
    for (const task of tasks) this.register(task);
  }

  remove(id: string): boolean {
    this.#assertLive();
    return this.#tasks.delete(cleanId(id));
  }

  setEnabled(id: string, enabled: boolean): boolean {
    this.#assertLive();
    const current = this.#tasks.get(cleanId(id));
    if (!current) return false;
    this.#tasks.set(current.id, Object.freeze({ ...current, enabled }));
    return true;
  }

  setMetric(name: string, value: number): void {
    this.#metrics.set(name.trim().slice(0, 128), Number.isFinite(value) ? value : 0);
  }

  addMetric(name: string, delta: number): number {
    const key = name.trim().slice(0, 128);
    const next = (this.#metrics.get(key) ?? 0) + (Number.isFinite(delta) ? delta : 0);
    this.#metrics.set(key, next);
    return next;
  }

  getMetric(name: string): number {
    return this.#metrics.get(name.trim().slice(0, 128)) ?? 0;
  }

  emit(source: string, type: string, payload: unknown): void {
    if (this.#events.length >= this.#budget.maxEvents) {
      this.#events.shift();
    }
    this.#events.push(Object.freeze({
      tick: this.#tick,
      type: type.trim().slice(0, 128),
      source: cleanId(source),
      payload,
    }));
    this.#eventSequence += 1;
  }

  consumeEvents(): readonly SimulationEventR26[] {
    const events = Object.freeze([...this.#events]);
    this.#events.length = 0;
    return events;
  }

  async step(deltaSeconds: number): Promise<SimulationFrameResultR26> {
    this.#assertLive();
    this.#frame += 1;
    this.#tick += 1;
    const delta = clamp(deltaSeconds, 0, this.#budget.maxDeltaSeconds);
    const started = now();
    const results: SimulationTaskResultR26[] = [];
    let simulationMs = 0;
    let executed = 0;

    for (const phase of this.#phaseOrder) {
      const tasks = this.#orderedTasks(phase);
      for (const task of tasks) {
        if (executed >= this.#budget.maxTasksPerTick) {
          results.push(Object.freeze({
            id: task.id,
            phase,
            durationMs: 0,
            skipped: true,
            failed: false,
            reason: 'task-capacity',
          }));
          continue;
        }

        if (!task.enabled || this.#tick % task.cadenceTicks !== 0) {
          results.push(Object.freeze({
            id: task.id,
            phase,
            durationMs: 0,
            skipped: true,
            failed: false,
            reason: task.enabled ? 'cadence' : 'disabled',
          }));
          continue;
        }

        if (task.dependencies.some((dependency) => !this.#tasks.get(dependency)?.enabled)) {
          results.push(Object.freeze({
            id: task.id,
            phase,
            durationMs: 0,
            skipped: true,
            failed: false,
            reason: 'dependency-disabled',
          }));
          continue;
        }

        if (now() - started >= this.#budget.maxFrameMs) {
          results.push(Object.freeze({
            id: task.id,
            phase,
            durationMs: 0,
            skipped: true,
            failed: false,
            reason: 'frame-budget',
          }));
          continue;
        }

        const taskStarted = now();
        let failed = false;
        let failureReason: string | undefined;
        try {
          await task.run({
            tick: this.#tick,
            deltaSeconds: delta,
            frame: this.#frame,
            phase,
            emit: (event) => this.emit(event.source, event.type, event.payload),
            getMetric: (name) => this.getMetric(name),
          });
        } catch (error) {
          failed = true;
          failureReason = String(error instanceof Error ? error.message : error).slice(0, 256);
          this.emit(task.id, 'simulation.task.failed', { error: failureReason });
        }

        const durationMs = Math.max(0, now() - taskStarted);
        simulationMs += phase === 'simulation' ? durationMs : 0;
        executed += 1;
        results.push(Object.freeze({
          id: task.id,
          phase,
          durationMs,
          skipped: false,
          failed,
          ...(failureReason ? { reason: failureReason } : {}),
        }));

        this.setMetric(`r26.task.${task.id}.lastMs`, durationMs);
        this.setMetric(`r26.task.${task.id}.runs`, this.getMetric(`r26.task.${task.id}.runs`) + 1);
      }
    }

    const eventCount = this.#events.length;
    const overBudget = simulationMs > this.#budget.maxSimulationMs ||
      now() - started > this.#budget.maxFrameMs;

    this.setMetric('r26.frame.ms', now() - started);
    this.setMetric('r26.simulation.ms', simulationMs);
    this.setMetric('r26.events', eventCount);
    this.setMetric('r26.overBudget', overBudget ? 1 : 0);

    const digest = stableDigest({
      tick: this.#tick,
      frame: this.#frame,
      simulationMs,
      taskResults: results.map(({ id, phase, durationMs, skipped, failed, reason }) => ({
        id,
        phase,
        durationMs: Number(durationMs.toFixed(4)),
        skipped,
        failed,
        reason,
      })),
      eventSequence: this.#eventSequence,
    });

    return Object.freeze({
      frame: this.#frame,
      tick: this.#tick,
      simulationMs,
      taskResults: Object.freeze(results),
      eventCount,
      overBudget,
      digest,
    });
  }

  snapshot(): Readonly<{
    frame: number;
    tick: number;
    tasks: readonly SimulationTaskR26[];
    metrics: Readonly<Record<string, number>>;
    events: readonly SimulationEventR26[];
    digest: string;
  }> {
    const metrics = Object.fromEntries([...this.#metrics.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const tasks = [...this.#tasks.values()].sort((a, b) => a.phase.localeCompare(b.phase) || b.priority - a.priority || a.id.localeCompare(b.id));
    const payload = {
      frame: this.#frame,
      tick: this.#tick,
      tasks,
      metrics,
      events: this.#events,
    };
    return Object.freeze({
      ...payload,
      digest: stableDigest(payload),
    });
  }

  reset(): void {
    this.#assertLive();
    this.#events.length = 0;
    this.#metrics.clear();
    this.#frame = 0;
    this.#tick = 0;
    this.#eventSequence = 0;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#tasks.clear();
    this.#metrics.clear();
    this.#events.length = 0;
  }

  #orderedTasks(phase: SimulationPhaseR26): readonly SimulationTaskR26[] {
    const phaseTasks = [...this.#tasks.values()].filter((task) => task.phase === phase);
    const ids = new Set(phaseTasks.map((task) => task.id));
    const indegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const task of phaseTasks) {
      const dependencies = task.dependencies.filter((dependency) => ids.has(dependency));
      indegree.set(task.id, dependencies.length);
      for (const dependency of dependencies) {
        const list = dependents.get(dependency) ?? [];
        list.push(task.id);
        dependents.set(dependency, list);
      }
    }

    const ready = phaseTasks
      .filter((task) => (indegree.get(task.id) ?? 0) === 0)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const ordered: SimulationTaskR26[] = [];

    while (ready.length) {
      const next = ready.shift()!;
      ordered.push(next);
      for (const dependentId of [...(dependents.get(next.id) ?? [])].sort()) {
        const nextDegree = (indegree.get(dependentId) ?? 0) - 1;
        indegree.set(dependentId, nextDegree);
        if (nextDegree !== 0) continue;
        const dependent = this.#tasks.get(dependentId);
        if (!dependent) continue;
        ready.push(dependent);
        ready.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
      }
    }

    if (ordered.length !== phaseTasks.length) {
      throw new Error('R26_TASK_PHASE_CYCLE');
    }
    return Object.freeze(ordered);
  }

  #assertNoCycle(): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error(`R26_TASK_CYCLE:${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      const task = this.#tasks.get(id);
      for (const dependency of task?.dependencies ?? []) {
        if (!this.#tasks.has(dependency)) continue;
        visit(dependency);
      }
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of this.#tasks.keys()) visit(id);
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R26_SIMULATION_DISPOSED');
  }
}

export function createSimulationTaskR26(
  id: string,
  run: SimulationTaskR26['run'],
  options: Partial<Omit<SimulationTaskR26, 'id' | 'run'>> = {},
): SimulationTaskR26 {
  return Object.freeze({
    id: cleanId(id),
    run,
    phase: options.phase ?? 'simulation',
    priority: options.priority ?? 0,
    dependencies: Object.freeze(options.dependencies ?? []),
    budgetMs: options.budgetMs ?? 0.5,
    cadenceTicks: Math.max(1, Math.floor(options.cadenceTicks ?? 1)),
    enabled: options.enabled !== false,
  });
}

export const simulationPhaseOrderR26: readonly SimulationPhaseR26[] = Object.freeze([
  'input',
  'preSimulation',
  'simulation',
  'postSimulation',
  'presentation',
  'telemetry',
]);
