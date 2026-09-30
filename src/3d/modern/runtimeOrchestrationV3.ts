/**
 * Runtime orchestration supervisor for AAPW v3.
 *
 * Coordinates simulation, streaming, presentation, persistence and diagnostics using explicit stage
 * contracts. The supervisor is intentionally small in policy and large in observability: every stage
 * has a budget, dependency list, failure policy and deterministic execution order.
 */

export type RuntimeStageV3 = 'input' | 'simulation' | 'network' | 'streaming' | 'presentation' | 'save' | 'telemetry';
export type StageFailurePolicyV3 = 'stop' | 'continue' | 'disable';

export interface StageContextV3 {
  readonly tick: number;
  readonly dt: number;
  readonly frameBudgetMs: number;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface StageResultV3 {
  readonly stage: RuntimeStageV3;
  readonly executed: boolean;
  readonly durationMs: number;
  readonly error: string | null;
}

export interface RuntimeStageSpecV3 {
  readonly stage: RuntimeStageV3;
  readonly priority: number;
  readonly budgetMs: number;
  readonly dependsOn: readonly RuntimeStageV3[];
  readonly failurePolicy: StageFailurePolicyV3;
  readonly run: (context: StageContextV3) => void | Promise<void>;
}

export interface OrchestrationResultV3 {
  readonly tick: number;
  readonly stages: readonly StageResultV3[];
  readonly aborted: boolean;
  readonly reason: string | null;
  readonly totalDurationMs: number;
}

const stageOrder: readonly RuntimeStageV3[] = ['input', 'simulation', 'network', 'streaming', 'presentation', 'save', 'telemetry'];

export class RuntimeOrchestratorV3 {
  #stages = new Map<RuntimeStageV3, RuntimeStageSpecV3>();
  #disabled = new Set<RuntimeStageV3>();
  #lastResult: OrchestrationResultV3 | null = null;

  register(spec: RuntimeStageSpecV3): void {
    if (this.#stages.has(spec.stage)) throw new Error(`Stage already registered: ${spec.stage}`);
    if (!Number.isFinite(spec.budgetMs) || spec.budgetMs < 0) throw new RangeError(`Invalid stage budget: ${spec.stage}`);
    if (!Number.isFinite(spec.priority)) throw new RangeError(`Invalid stage priority: ${spec.stage}`);
    this.#stages.set(spec.stage, Object.freeze({ ...spec, dependsOn: Object.freeze([...spec.dependsOn]) }));
  }

  disable(stage: RuntimeStageV3): void { this.#disabled.add(stage); }
  enable(stage: RuntimeStageV3): void { this.#disabled.delete(stage); }
  isEnabled(stage: RuntimeStageV3): boolean { return !this.#disabled.has(stage); }

  validate(): void {
    for (const spec of this.#stages.values()) {
      for (const dependency of spec.dependsOn) {
        if (!this.#stages.has(dependency)) throw new Error(`Stage ${spec.stage} depends on missing stage ${dependency}`);
        if (dependency === spec.stage) throw new Error(`Stage ${spec.stage} cannot depend on itself`);
      }
    }
    const visiting = new Set<RuntimeStageV3>();
    const visited = new Set<RuntimeStageV3>();
    const visit = (stage: RuntimeStageV3): void => {
      if (visited.has(stage)) return;
      if (visiting.has(stage)) throw new Error(`Stage dependency cycle detected at ${stage}`);
      visiting.add(stage);
      for (const dependency of this.#stages.get(stage)?.dependsOn ?? []) visit(dependency);
      visiting.delete(stage);
      visited.add(stage);
    };
    for (const stage of this.#stages.keys()) visit(stage);
  }

  async run(context: StageContextV3): Promise<OrchestrationResultV3> {
    if (!Number.isInteger(context.tick) || context.tick < 0) throw new RangeError('Invalid orchestration tick');
    if (!Number.isFinite(context.dt) || context.dt < 0) throw new RangeError('Invalid orchestration dt');
    this.validate();
    const start = performance.now();
    const stages = [...this.#stages.values()]
      .filter((spec) => !this.#disabled.has(spec.stage))
      .sort((a, b) => a.priority - b.priority || stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage));
    const completed = new Set<RuntimeStageV3>();
    const results: StageResultV3[] = [];
    let aborted = false;
    let reason: string | null = null;

    for (const spec of stages) {
      if (spec.dependsOn.some((dependency) => !completed.has(dependency))) {
        const message = `dependency-not-ready:${spec.stage}`;
        results.push(Object.freeze({ stage: spec.stage, executed: false, durationMs: 0, error: message }));
        if (spec.failurePolicy === 'stop') { aborted = true; reason = message; break; }
        continue;
      }
      const stageStart = performance.now();
      try {
        await spec.run(context);
        const durationMs = Math.max(0, performance.now() - stageStart);
        results.push(Object.freeze({ stage: spec.stage, executed: true, durationMs, error: null }));
        completed.add(spec.stage);
        if (durationMs > spec.budgetMs && spec.failurePolicy === 'stop') {
          aborted = true;
          reason = `budget-exceeded:${spec.stage}:${durationMs.toFixed(2)}>${spec.budgetMs.toFixed(2)}`;
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const durationMs = Math.max(0, performance.now() - stageStart);
        results.push(Object.freeze({ stage: spec.stage, executed: false, durationMs, error: message }));
        if (spec.failurePolicy === 'stop') { aborted = true; reason = `stage-failed:${spec.stage}`; break; }
        if (spec.failurePolicy === 'disable') this.#disabled.add(spec.stage);
      }
    }

    const result = Object.freeze({ tick: context.tick, stages: Object.freeze(results), aborted, reason, totalDurationMs: Math.max(0, performance.now() - start) });
    this.#lastResult = result;
    return result;
  }

  lastResult(): OrchestrationResultV3 | null { return this.#lastResult; }
  describe(): readonly RuntimeStageSpecV3[] { return Object.freeze([...this.#stages.values()].sort((a, b) => a.priority - b.priority)); }
}

export const createDefaultOrchestratorV3 = (handlers: Partial<Record<RuntimeStageV3, RuntimeStageSpecV3['run']>>): RuntimeOrchestratorV3 => {
  const orchestrator = new RuntimeOrchestratorV3();
  orchestrator.register({ stage: 'input', priority: 10, budgetMs: 1, dependsOn: [], failurePolicy: 'stop', run: handlers.input ?? (() => undefined) });
  orchestrator.register({ stage: 'simulation', priority: 20, budgetMs: 6, dependsOn: ['input'], failurePolicy: 'stop', run: handlers.simulation ?? (() => undefined) });
  orchestrator.register({ stage: 'network', priority: 30, budgetMs: 2, dependsOn: ['simulation'], failurePolicy: 'continue', run: handlers.network ?? (() => undefined) });
  orchestrator.register({ stage: 'streaming', priority: 40, budgetMs: 4, dependsOn: ['simulation'], failurePolicy: 'continue', run: handlers.streaming ?? (() => undefined) });
  orchestrator.register({ stage: 'presentation', priority: 50, budgetMs: 10, dependsOn: ['simulation', 'streaming'], failurePolicy: 'continue', run: handlers.presentation ?? (() => undefined) });
  orchestrator.register({ stage: 'save', priority: 60, budgetMs: 2, dependsOn: ['simulation'], failurePolicy: 'disable', run: handlers.save ?? (() => undefined) });
  orchestrator.register({ stage: 'telemetry', priority: 70, budgetMs: 1, dependsOn: ['input', 'simulation'], failurePolicy: 'continue', run: handlers.telemetry ?? (() => undefined) });
  return orchestrator;
};
