import { RuntimeModeV7, RuntimePhaseV7, TickV7, RuntimeBudgetsV7 } from './types.ts';
import { BudgetSchedulerV7 } from './scheduler.ts';
import { RuntimeTelemetryV7 } from './observability.ts';
import { RuntimeDiagnosticsV7 } from './diagnostics.ts';
import { RuntimeRecoveryV7 } from './recovery.ts';

export type FrameStageV7 = 'input' | 'critical' | 'simulation' | 'streaming' | 'render' | 'telemetry' | 'background';
export interface FrameStageReceiptV7 {
  readonly stage: FrameStageV7;
  readonly enteredTick: TickV7;
  readonly executed: number;
  readonly spentMs: number;
  readonly failed: number;
}
export interface FrameOrchestratorReportV7 {
  readonly tick: TickV7;
  readonly phase: RuntimePhaseV7;
  readonly mode: RuntimeModeV7;
  readonly stages: readonly FrameStageReceiptV7[];
  readonly schedulerSpentMs: number;
  readonly healthScore: number;
  readonly recoveryRequired: boolean;
}
export interface FrameOrchestratorHooksV7 {
  readonly input?: () => number;
  readonly critical?: () => number;
  readonly simulation?: () => number;
  readonly streaming?: () => number;
  readonly render?: () => number;
  readonly telemetry?: () => number;
  readonly background?: () => number;
}

export class FrameOrchestratorV7 {
  readonly #scheduler: BudgetSchedulerV7;
  readonly #telemetry: RuntimeTelemetryV7;
  readonly #diagnostics: RuntimeDiagnosticsV7;
  readonly #recovery: RuntimeRecoveryV7;
  readonly #budgets: RuntimeBudgetsV7;
  #phase: RuntimePhaseV7 = 'booting';
  #mode: RuntimeModeV7 = 'full';

  constructor(scheduler: BudgetSchedulerV7, telemetry: RuntimeTelemetryV7, diagnostics: RuntimeDiagnosticsV7, recovery: RuntimeRecoveryV7, budgets: RuntimeBudgetsV7) {
    this.#scheduler = scheduler; this.#telemetry = telemetry; this.#diagnostics = diagnostics; this.#recovery = recovery; this.#budgets = Object.freeze(budgets);
  }

  start(): void { this.#phase = 'running'; this.#recovery.start(); }
  stop(): void { this.#phase = 'stopped'; this.#recovery.stop(); }

  frame(tick: TickV7, hooks: FrameOrchestratorHooksV7 = {}): FrameOrchestratorReportV7 {
    if (this.#phase !== 'running') this.start();
    const stages: FrameStageReceiptV7[] = [];
    const definitions: readonly [FrameStageV7, number, FrameOrchestratorHooksV7[keyof FrameOrchestratorHooksV7]][] = [
      ['input', 0.1, hooks.input], ['critical', 0.4, hooks.critical], ['simulation', this.#budgets.simulation.tickMs, hooks.simulation],
      ['streaming', 0.5, hooks.streaming], ['render', this.#budgets.render.frameMs, hooks.render],
      ['telemetry', 0.2, hooks.telemetry], ['background', 0.2, hooks.background],
    ];
    for (const [stage, cost, hook] of definitions) {
      const before = this.#telemetry.counters().find((counter) => counter.name === `frame.stage.${stage}`)?.value ?? 0;
      let failed = 0;
      let spent = 0;
      try {
        const result = hook ? Number(hook()) : 0;
        spent = Number.isFinite(result) ? Math.max(0, result) : cost;
      } catch {
        failed = 1;
        spent = cost;
      }
      this.#telemetry.sample(tick, `frame.stage.${stage}`, spent, 'ms');
      this.#telemetry.increment(`frame.stage.${stage}`, spent, 'ms');
      stages.push(Object.freeze({ stage, enteredTick: tick, executed: (hook ? 1 : 0) + (before > 0 ? 0 : 0), spentMs: spent, failed }));
    }

    const scheduler = this.#scheduler.runTick(tick, this.#budgets.schedulerMs);
    const health = this.#telemetry.summarize(tick);
    const recovery = this.#recovery.plan(health, this.#budgets);
    const recoveryRequired = health.degraded && recovery.steps.length > 0;
    if (recoveryRequired) this.#mode = health.mode;
    const diagnostic = this.#diagnostics.publish({
      tick, mode: this.#mode, phase: this.#phase, health,
      entityCount: 0, spatialCells: 0, queuedTasks: this.#scheduler.queuedCount(),
      assetBytes: 0, networkState: 'unknown',
    });
    void diagnostic;
    return Object.freeze({ tick, phase: this.#phase, mode: this.#mode, stages: Object.freeze(stages), schedulerSpentMs: scheduler.spentMs, healthScore: health.score, recoveryRequired });
  }
}
