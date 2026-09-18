import { ProductionRuntimeV7, ProductionRuntimeOptionsV7, createProductionRuntimeV7 } from './facade.ts';
import { FrameOrchestratorV7 } from './frameOrchestrator.ts';
import { RuntimePhaseV7, RuntimeModeV7, TickV7, RuntimeBudgetsV7 } from './types.ts';
import { RuntimeHealthV7 } from './types.ts';
import { platformProfileForTestsV7 } from './platform.ts';
import { budgetDefaultsV7 } from './renderPolicy.ts';

export interface ProductionBootstrapOptionsV7 extends ProductionRuntimeOptionsV7 {
  readonly autoBoot?: boolean;
  readonly diagnosticsEnabled?: boolean;
  readonly frameBudgetOverrides?: Partial<RuntimeBudgetsV7>;
}

export interface ProductionRuntimeHandleV7 {
  readonly runtime: ProductionRuntimeV7;
  readonly frame: FrameOrchestratorV7;
  readonly start: () => void;
  readonly stop: () => void;
  readonly step: (deltaSeconds: number) => ReturnType<ProductionRuntimeV7['step']>;
  readonly health: () => RuntimeHealthV7;
  readonly phase: () => RuntimePhaseV7;
  readonly mode: () => RuntimeModeV7;
  readonly tick: () => TickV7;
  readonly dispose: () => void;
}

const mergeBudgets = (runtime: ProductionRuntimeV7, overrides: Partial<RuntimeBudgetsV7>): RuntimeBudgetsV7 => {
  const base = budgetDefaultsV7(runtime.render.profile);
  return Object.freeze({
    ...base,
    ...overrides,
    render: Object.freeze({ ...base.render, ...(overrides.render ?? {}) }),
    simulation: Object.freeze({ ...base.simulation, ...(overrides.simulation ?? {}) }),
    network: Object.freeze({ ...base.network, ...(overrides.network ?? {}) }),
  });
};

export function bootstrapProductionRuntimeV7(options: ProductionBootstrapOptionsV7 = {}): ProductionRuntimeHandleV7 {
  const runtime = createProductionRuntimeV7(options);
  const budgets = mergeBudgets(runtime, options.frameBudgetOverrides ?? {});
  const frame = new FrameOrchestratorV7(runtime.scheduler, runtime.telemetry, runtime.diagnostics, runtime.recovery, budgets);

  const start = (): void => {
    runtime.boot();
    frame.start();
  };
  const stop = (): void => {
    frame.stop();
    runtime.stop();
  };
  const step = (deltaSeconds: number): ReturnType<ProductionRuntimeV7['step']> => {
    const report = runtime.step(deltaSeconds);
    frame.frame(report.tick, {
      input: () => 0,
      critical: () => 0,
      simulation: () => report.steps * 0.5,
      streaming: () => runtime.assets.stats().inFlight * 0.1,
      render: () => report.renderPressure * budgets.render.frameMs,
      telemetry: () => 0.1,
      background: () => runtime.scheduler.queuedCount() > 0 ? 0.1 : 0,
    });
    return report;
  };
  const health = (): RuntimeHealthV7 => runtime.telemetry.summarize(runtime.tick);
  const phase = (): RuntimePhaseV7 => runtime.phase;
  const mode = (): RuntimeModeV7 => runtime.mode;
  const tick = (): TickV7 => runtime.tick;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    stop();
    runtime.security.resetReplayWindow();
    runtime.render.reset();
    runtime.recovery.resetAttempts();
  };

  if (options.autoBoot !== false) start();
  return Object.freeze({ runtime, frame, start, stop, step, health, phase, mode, tick, dispose });
}

export function createHeadlessProductionRuntimeV7(seed = 0x77a11): ProductionRuntimeHandleV7 {
  return bootstrapProductionRuntimeV7({ seed, autoBoot: true, profile: platformProfileForTestsV7('headless') });
}

export function createConstrainedProductionRuntimeV7(seed = 0x77a11): ProductionRuntimeHandleV7 {
  return bootstrapProductionRuntimeV7({ seed, autoBoot: true, profile: platformProfileForTestsV7('constrained') });
}

export function advanceProductionRuntimeV7(handle: ProductionRuntimeHandleV7, deltaSeconds: number, repeat = 1): readonly ReturnType<ProductionRuntimeV7['step']>[] {
  const count = Math.max(1, Math.min(600, Math.trunc(repeat)));
  const results: ReturnType<ProductionRuntimeV7['step']>[] = [];
  for (let index = 0; index < count; index += 1) results.push(handle.step(deltaSeconds));
  return Object.freeze(results);
}

export function assertRuntimeHandleAliveV7(handle: ProductionRuntimeHandleV7): void {
  if (handle.phase() === 'stopped') throw new Error('Production runtime handle is stopped');
  if (!Number.isFinite(Number(handle.tick()))) throw new Error('Production runtime tick is invalid');
}

export function tickBudgetSecondsV7(fixedHz = 60): number {
  if (!Number.isFinite(fixedHz) || fixedHz <= 0) throw new RangeError('fixedHz must be positive');
  return 1 / fixedHz;
}

export function bootstrapSummaryV7(handle: ProductionRuntimeHandleV7): Readonly<{
  phase: RuntimePhaseV7; mode: RuntimeModeV7; tick: TickV7; healthScore: number; entities: number; queuedTasks: number;
}> {
  const diagnosis = handle.runtime.diagnose();
  return Object.freeze({
    phase: handle.phase(), mode: handle.mode(), tick: handle.tick(),
    healthScore: diagnosis.health.score, entities: diagnosis.entityCount, queuedTasks: diagnosis.queuedTasks,
  });
}
