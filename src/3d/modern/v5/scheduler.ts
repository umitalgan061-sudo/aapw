import { RuntimeBudget, Tick, asTick, clamp } from './domain.ts';

export type SystemStage = 'input' | 'simulation' | 'ai' | 'physics' | 'network' | 'streaming' | 'animation' | 'render' | 'telemetry' | 'save';
export type SystemResult = void | { skipped?: boolean; costMs?: number };

export interface SystemContext {
  readonly tick: Tick;
  readonly deltaSeconds: number;
  readonly budget: RuntimeBudget;
  readonly signal?: AbortSignal;
}

export interface ScheduledSystem {
  readonly id: string;
  readonly stage: SystemStage;
  readonly priority: number;
  readonly intervalTicks: number;
  readonly run: (context: SystemContext) => SystemResult | Promise<SystemResult>;
}

export interface SystemExecution {
  readonly id: string;
  readonly stage: SystemStage;
  readonly tick: Tick;
  readonly skipped: boolean;
  readonly costMs: number;
}

const STAGE_ORDER: readonly SystemStage[] = ['input', 'simulation', 'ai', 'physics', 'network', 'streaming', 'animation', 'render', 'telemetry', 'save'];

export class FrameSchedulerV5 {
  readonly #systems = new Map<string, ScheduledSystem>();
  readonly #lastRun = new Map<string, Tick>();
  readonly #history: SystemExecution[] = [];
  readonly #stageBudgets = new Map<SystemStage, number>();
  #budget: RuntimeBudget;

  constructor(maxFrameMs = 16.67) {
    if (!Number.isFinite(maxFrameMs) || maxFrameMs <= 0) throw new RangeError('maxFrameMs must be positive');
    this.#budget = {
      simulationMs: 0, presentationMs: 0, assetMs: 0, networkMs: 0, persistenceMs: 0, workerMs: 0,
      totalMs: 0, maxTotalMs: maxFrameMs,
    };
    this.setStageBudget('input', 1);
    this.setStageBudget('simulation', 4);
    this.setStageBudget('ai', 2);
    this.setStageBudget('physics', 3);
    this.setStageBudget('network', 1.5);
    this.setStageBudget('streaming', 2);
    this.setStageBudget('animation', 1.5);
    this.setStageBudget('render', 6);
    this.setStageBudget('telemetry', 0.5);
    this.setStageBudget('save', 1);
  }

  register(system: ScheduledSystem): () => void {
    if (!system.id.trim()) throw new Error('system id is required');
    if (this.#systems.has(system.id)) throw new Error(`system already registered: ${system.id}`);
    if (!Number.isInteger(system.intervalTicks) || system.intervalTicks < 1) throw new RangeError('intervalTicks must be >= 1');
    this.#systems.set(system.id, system);
    return () => this.#systems.delete(system.id);
  }

  unregister(id: string): boolean {
    this.#lastRun.delete(id);
    return this.#systems.delete(id);
  }

  setStageBudget(stage: SystemStage, budgetMs: number): void {
    if (!Number.isFinite(budgetMs) || budgetMs < 0) throw new RangeError('stage budget must be >= 0');
    this.#stageBudgets.set(stage, budgetMs);
  }

  getBudget(): RuntimeBudget {
    return { ...this.#budget };
  }

  async run(tick: Tick | number, deltaSeconds: number, options: { signal?: AbortSignal; measure?: () => number } = {}): Promise<readonly SystemExecution[]> {
    const current = asTick(Number(tick));
    const context: SystemContext = { tick: current, deltaSeconds: Math.max(0, deltaSeconds), budget: this.#budget, signal: options.signal };
    const start = options.measure?.() ?? (typeof performance === 'undefined' ? 0 : performance.now());
    const executions: SystemExecution[] = [];

    for (const stage of STAGE_ORDER) {
      const systems = [...this.#systems.values()]
        .filter((system) => system.stage === stage)
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
      let estimatedStageCost = 0;
      for (const system of systems) {
        if (options.signal?.aborted) break;
        const previous = this.#lastRun.get(system.id);
        if (previous !== undefined && Number(current) - Number(previous) < system.intervalTicks) {
          executions.push({ id: system.id, stage, tick: current, skipped: true, costMs: 0 });
          continue;
        }
        const systemStart = options.measure?.() ?? (typeof performance === 'undefined' ? 0 : performance.now());
        const result = await system.run(context);
        const systemEnd = options.measure?.() ?? (typeof performance === 'undefined' ? 0 : performance.now());
        const cost = typeof result === 'object' && result && 'costMs' in result && Number.isFinite(result.costMs) ? Math.max(0, Number(result.costMs)) : Math.max(0, systemEnd - systemStart);
        const skipped = typeof result === 'object' && result?.skipped === true;
        executions.push({ id: system.id, stage, tick: current, skipped, costMs: cost });
        this.#lastRun.set(system.id, current);
        estimatedStageCost += cost;
        this.#applyBudget(stage, cost);
        if (estimatedStageCost > (this.#stageBudgets.get(stage) ?? Number.POSITIVE_INFINITY)) break;
      }
    }

    const end = options.measure?.() ?? (typeof performance === 'undefined' ? 0 : performance.now());
    if (start !== 0 || end !== 0) this.#budget.totalMs = Math.max(0, end - start);
    this.#history.push(...executions);
    if (this.#history.length > 4096) this.#history.splice(0, this.#history.length - 4096);
    return executions;
  }

  recent(limit = 128): readonly SystemExecution[] {
    return this.#history.slice(Math.max(0, this.#history.length - Math.max(1, limit)));
  }

  due(tick: Tick | number): readonly ScheduledSystem[] {
    const current = asTick(Number(tick));
    return [...this.#systems.values()].filter((system) => {
      const previous = this.#lastRun.get(system.id);
      return previous === undefined || Number(current) - Number(previous) >= system.intervalTicks;
    });
  }

  reset(): void {
    this.#lastRun.clear();
    this.#history.length = 0;
    this.#budget = { ...this.#budget, simulationMs: 0, presentationMs: 0, assetMs: 0, networkMs: 0, persistenceMs: 0, workerMs: 0, totalMs: 0 };
  }

  private #applyBudget(stage: SystemStage, cost: number): void {
    if (stage === 'simulation' || stage === 'ai' || stage === 'physics') this.#budget.simulationMs += cost;
    if (stage === 'render' || stage === 'animation') this.#budget.presentationMs += cost;
    if (stage === 'streaming') this.#budget.assetMs += cost;
    if (stage === 'network') this.#budget.networkMs += cost;
    if (stage === 'save') this.#budget.persistenceMs += cost;
    this.#budget.totalMs = clamp(
      this.#budget.simulationMs + this.#budget.presentationMs + this.#budget.assetMs + this.#budget.networkMs + this.#budget.persistenceMs + this.#budget.workerMs,
      0,
      Number.POSITIVE_INFINITY,
    );
  }
}

export const fixedStep = (tickRate = 60): number => {
  if (!Number.isFinite(tickRate) || tickRate <= 0) throw new RangeError('tickRate must be positive');
  return 1 / tickRate;
};

export const catchUpTicks = (accumulator: number, deltaSeconds: number, step: number, maxSteps: number): { ticks: number; remainder: number } => {
  if (step <= 0 || maxSteps < 1) throw new RangeError('invalid fixed-step configuration');
  let remaining = Math.max(0, accumulator) + Math.max(0, deltaSeconds);
  let ticks = 0;
  while (remaining >= step && ticks < Math.trunc(maxSteps)) { remaining -= step; ticks += 1; }
  return { ticks, remainder: remaining };
};
