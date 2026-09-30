import type { RuntimeFrameR31, RuntimePhase } from './applicationTypesR31.ts';
import { DeterministicClockR31 } from './deterministicClockR31.ts';
import { PerformanceBudgetR31 } from './performanceBudgetR31.ts';

export interface SimulationSystemR31 {
  readonly id: string;
  readonly phase: RuntimePhase;
  readonly order: number;
  readonly update: (frame: RuntimeFrameR31) => void;
}

export interface SimulationPipelineReportR31 {
  readonly tick: number;
  readonly steps: number;
  readonly droppedSeconds: number;
  readonly systemsRun: number;
  readonly failures: number;
  readonly budgetViolations: number;
}

const BASE_BUDGET = Object.freeze({
  frameMs: 16.67,
  simulationMs: 6,
  renderMs: 7,
  networkMs: 1.5,
  persistenceMs: 0.5,
  maxCommandsPerFrame: 256,
  maxEventsPerFrame: 512,
});

export class SimulationPipelineR31 {
  readonly #clock: DeterministicClockR31;
  readonly #budget: PerformanceBudgetR31;
  readonly #systems: SimulationSystemR31[] = [];
  #frame = 0;
  #failures = 0;
  #systemsRun = 0;

  constructor(clock = new DeterministicClockR31(), budget = new PerformanceBudgetR31(BASE_BUDGET)) {
    this.#clock = clock;
    this.#budget = budget;
  }

  register(system: SimulationSystemR31): () => void {
    if (!system.id.trim()) throw new Error('Simulation system id cannot be empty');
    if (!Number.isFinite(system.order)) throw new Error('Simulation system order must be finite');
    if (this.#systems.some((current) => current.id === system.id)) throw new Error(`Duplicate system: ${system.id}`);
    this.#systems.push(Object.freeze({ ...system }));
    this.#systems.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return () => {
      const index = this.#systems.findIndex((current) => current.id === system.id);
      if (index >= 0) this.#systems.splice(index, 1);
    };
  }

  advance(deltaSeconds: number, frameNumber?: number): SimulationPipelineReportR31 {
    const frame = frameNumber === undefined ? ++this.#frame : Math.max(0, Math.floor(frameNumber));
    this.#frame = frame;
    const result = this.#clock.advance(deltaSeconds, (step, tick) => {
      for (const system of this.#systems) {
        const frameState: RuntimeFrameR31 = Object.freeze({
          frame,
          simulationTick: tick,
          deltaSeconds: step,
          elapsedSeconds: this.#clock.elapsedSeconds,
          alpha: 0,
          phase: system.phase,
        });
        const start = performance.now();
        try {
          system.update(frameState);
          this.#systemsRun++;
        } catch {
          this.#failures++;
        }
        this.#budget.record(system.phase, performance.now() - start);
      }
    });
    return Object.freeze({
      tick: result.tick,
      steps: result.steps,
      droppedSeconds: result.droppedSeconds,
      systemsRun: this.#systemsRun,
      failures: this.#failures,
      budgetViolations: this.#budget.violations(),
    });
  }

  pause(): void { this.#clock.pause(); }
  resume(): void { this.#clock.resume(); }

  reset(tick = 0): void {
    this.#frame = 0;
    this.#failures = 0;
    this.#systemsRun = 0;
    this.#clock.reset(tick);
    this.#budget.reset();
  }

  clock(): DeterministicClockR31 { return this.#clock; }
  budget(): PerformanceBudgetR31 { return this.#budget; }
  systems(): readonly SimulationSystemR31[] { return Object.freeze([...this.#systems]); }
}
