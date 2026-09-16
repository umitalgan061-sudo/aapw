import { clamp, freeze } from '../domain/contracts.ts';

export type SchedulePhase = 'input' | 'simulation' | 'world' | 'animation' | 'audio' | 'render' | 'telemetry' | 'background';
export type ScheduleCadence = 'everyFrame' | 'fixed' | 'adaptive' | 'idle';

export interface ScheduleContext {
  readonly frame: number;
  readonly dt: number;
  readonly elapsed: number;
  readonly budgetMs: number;
  readonly phase: SchedulePhase;
  readonly pressure: number;
}

export interface ScheduledSystem {
  readonly name: string;
  readonly phase: SchedulePhase;
  readonly priority?: number;
  readonly cadence?: ScheduleCadence;
  readonly intervalMs?: number;
  readonly budgetMs?: number;
  readonly maxBurst?: number;
  readonly visibleOnly?: boolean;
  readonly run: (context: ScheduleContext) => void;
  readonly dispose?: () => void;
}

export interface SchedulerMetrics {
  readonly frame: number;
  readonly elapsedMs: number;
  readonly systems: number;
  readonly executed: number;
  readonly skipped: number;
  readonly overBudget: number;
  readonly phaseTimeMs: Readonly<Record<SchedulePhase, number>>;
  readonly lastFrameMs: number;
}

interface RuntimeSystem extends ScheduledSystem {
  nextDueAt: number;
  executionCount: number;
  skippedCount: number;
}

const phases: readonly SchedulePhase[] = ['input', 'simulation', 'world', 'animation', 'audio', 'render', 'telemetry', 'background'];
const now = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();

export class FrameScheduler {
  readonly #systems: RuntimeSystem[] = [];
  readonly #phaseBudget: Record<SchedulePhase, number>;
  #frame = 0;
  #elapsedMs = 0;
  #lastFrameMs = 0;
  #executed = 0;
  #skipped = 0;
  #overBudget = 0;
  #disposed = false;

  constructor(options: { readonly phaseBudgets?: Partial<Record<SchedulePhase, number>> } = {}) {
    this.#phaseBudget = {
      input: 1.2,
      simulation: 5.5,
      world: 2.8,
      animation: 2.3,
      audio: 1.4,
      render: 4.5,
      telemetry: 0.7,
      background: 0.6,
      ...options.phaseBudgets,
    };
  }

  register(system: ScheduledSystem): () => void {
    if (this.#disposed) return () => undefined;
    if (this.#systems.some((candidate) => candidate.name === system.name)) throw new Error(`Duplicate scheduled system: ${system.name}`);
    const runtime: RuntimeSystem = { ...system, nextDueAt: 0, executionCount: 0, skippedCount: 0 };
    this.#systems.push(runtime);
    this.#systems.sort((a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase) || (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name));
    return () => {
      const index = this.#systems.indexOf(runtime);
      if (index < 0) return;
      this.#systems.splice(index, 1);
      runtime.dispose?.();
    };
  }

  tick(deltaMs: number, pressure = 0, visible = true): SchedulerMetrics {
    if (this.#disposed) return this.metrics();
    const frameStart = now();
    const safeDt = clamp(deltaMs, 0, 100);
    this.#frame += 1;
    this.#elapsedMs += safeDt;
    this.#executed = 0;
    this.#skipped = 0;
    this.#overBudget = 0;
    const phaseTime = {} as Record<SchedulePhase, number>;

    for (const phase of phases) {
      const phaseStart = now();
      let budgetRemaining = Math.max(0, this.#phaseBudget[phase]);
      const contextBase = { frame: this.#frame, dt: safeDt / 1000, elapsed: this.#elapsedMs / 1000, phase, pressure: clamp(pressure, 0, 1) } as const;
      const candidates = this.#systems.filter((system) => system.phase === phase);
      for (const system of candidates) {
        if (system.visibleOnly && !visible) { system.skippedCount += 1; this.#skipped += 1; continue; }
        if (!this.#shouldRun(system, pressure)) { system.skippedCount += 1; this.#skipped += 1; continue; }
        const started = now();
        const budget = clamp(system.budgetMs ?? Math.max(0.05, budgetRemaining), 0.05, Math.max(0.05, budgetRemaining));
        try {
          system.run(freeze({ ...contextBase, budgetMs: budget }));
          system.executionCount += 1;
          this.#executed += 1;
        } catch {
          system.skippedCount += 1;
          this.#skipped += 1;
        }
        const duration = Math.max(0, now() - started);
        budgetRemaining -= duration;
        if (duration > budget) this.#overBudget += 1;
        if (budgetRemaining <= 0) break;
      }
      phaseTime[phase] = Math.max(0, now() - phaseStart);
    }
    this.#lastFrameMs = Math.max(0, now() - frameStart);
    return this.metrics(phaseTime);
  }

  metrics(phaseTime: Partial<Record<SchedulePhase, number>> = {}): SchedulerMetrics {
    const normalized = {} as Record<SchedulePhase, number>;
    for (const phase of phases) normalized[phase] = Number((phaseTime[phase] ?? 0).toFixed(4));
    return freeze({ frame: this.#frame, elapsedMs: Number(this.#elapsedMs.toFixed(3)), systems: this.#systems.length, executed: this.#executed, skipped: this.#skipped, overBudget: this.#overBudget, phaseTimeMs: freeze(normalized), lastFrameMs: Number(this.#lastFrameMs.toFixed(4)) });
  }

  systemMetrics(): readonly Readonly<{ name: string; phase: SchedulePhase; executions: number; skipped: number; nextDueAt: number }> [] {
    return this.#systems.map((system) => freeze({ name: system.name, phase: system.phase, executions: system.executionCount, skipped: system.skippedCount, nextDueAt: system.nextDueAt }));
  }

  clear(): void {
    for (const system of this.#systems.splice(0)) system.dispose?.();
  }

  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.clear(); }

  #shouldRun(system: RuntimeSystem, pressure: number): boolean {
    const current = this.#elapsedMs;
    switch (system.cadence ?? 'everyFrame') {
      case 'everyFrame': return true;
      case 'fixed': {
        const interval = Math.max(1, system.intervalMs ?? 16.67);
        if (current + 0.001 < system.nextDueAt) return false;
        system.nextDueAt = current + interval;
        return true;
      }
      case 'adaptive': {
        const base = Math.max(1, system.intervalMs ?? 16.67);
        const multiplier = 1 + clamp(pressure, 0, 1) * 5;
        if (current + 0.001 < system.nextDueAt) return false;
        system.nextDueAt = current + base * multiplier;
        return true;
      }
      case 'idle': return typeof requestIdleCallback === 'function' && pressure < 0.6;
    }
  }
}

export interface BudgetWindow {
  readonly usedMs: number;
  readonly budgetMs: number;
  readonly remainingMs: number;
  readonly exhausted: boolean;
}

export const createBudgetWindow = (budgetMs: number): { consume: (durationMs: number) => BudgetWindow; snapshot: () => BudgetWindow } => {
  const budget = Math.max(0, budgetMs);
  let used = 0;
  return {
    consume(durationMs) {
      used = Math.min(Number.MAX_SAFE_INTEGER, used + Math.max(0, durationMs));
      return freeze({ usedMs: used, budgetMs: budget, remainingMs: Math.max(0, budget - used), exhausted: used >= budget });
    },
    snapshot() { return freeze({ usedMs: used, budgetMs: budget, remainingMs: Math.max(0, budget - used), exhausted: used >= budget }); },
  };
};
