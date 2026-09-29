import {
  DEFAULT_SCHEDULER_BUDGET_V15,
  clampV15,
  frameV15,
  tickV15,
  type FrameResultV15,
  type RuntimeModeV15,
  type SchedulerBudgetV15,
} from "./types.ts";

export interface FrameSchedulerOptionsV15 {
  readonly tickRate?: number;
  readonly maxFrameDeltaSeconds?: number;
  readonly maxCatchUpTicks?: number;
  readonly budget?: Partial<SchedulerBudgetV15>;
}

export interface SchedulerContextV15 {
  readonly frame: number;
  readonly tick: number;
  readonly deltaSeconds: number;
  readonly fixedDeltaSeconds: number;
  readonly alpha: number;
  readonly mode: RuntimeModeV15;
}

export class FixedFrameSchedulerV15 {
  readonly #tickRate: number;
  readonly #fixedDeltaSeconds: number;
  readonly #maxFrameDeltaSeconds: number;
  readonly #budget: SchedulerBudgetV15;
  #frame = frameV15(0);
  #tick = tickV15(0);
  #accumulator = 0;
  #mode: RuntimeModeV15 = "foreground";
  #droppedSeconds = 0;
  #lastDelta = 0;

  constructor(options: FrameSchedulerOptionsV15 = {}) {
    const tickRate = clampV15(options.tickRate ?? 60, 20, 240);
    const maxDelta = clampV15(options.maxFrameDeltaSeconds ?? 0.25, 0.05, 1);
    const maxCatchUp = Math.max(1, Math.floor(options.maxCatchUpTicks ?? DEFAULT_SCHEDULER_BUDGET_V15.maxCatchUpTicks));
    this.#tickRate = tickRate;
    this.#fixedDeltaSeconds = 1 / tickRate;
    this.#maxFrameDeltaSeconds = maxDelta;
    this.#budget = Object.freeze({ ...DEFAULT_SCHEDULER_BUDGET_V15, ...options.budget, maxCatchUpTicks: Math.min(32, maxCatchUp) });
  }

  get frame(): number { return Number(this.#frame); }
  get tick(): number { return Number(this.#tick); }
  get mode(): RuntimeModeV15 { return this.#mode; }
  get fixedDeltaSeconds(): number { return this.#fixedDeltaSeconds; }

  setMode(mode: RuntimeModeV15): void {
    this.#mode = mode;
    if (mode !== "foreground") this.#accumulator = Math.min(this.#accumulator, this.#fixedDeltaSeconds);
  }

  step(deltaSeconds: number, simulate: (context: SchedulerContextV15) => void): FrameResultV15 {
    this.#frame = frameV15(Number(this.#frame) + 1);
    const rawDelta = clampV15(deltaSeconds, 0, this.#maxFrameDeltaSeconds);
    this.#lastDelta = rawDelta;
    if (this.#mode !== "foreground") {
      return Object.freeze({
        frame: this.#frame,
        simulatedTicks: 0,
        alpha: 0,
        droppedSeconds: this.#droppedSeconds,
        mode: this.#mode,
        budget: this.#budget,
      });
    }
    this.#accumulator += rawDelta;
    let simulatedTicks = 0;
    while (this.#accumulator >= this.#fixedDeltaSeconds && simulatedTicks < this.#budget.maxCatchUpTicks) {
      this.#accumulator -= this.#fixedDeltaSeconds;
      this.#tick = tickV15(Number(this.#tick) + 1);
      simulatedTicks += 1;
      simulate({
        frame: Number(this.#frame),
        tick: Number(this.#tick),
        deltaSeconds: this.#fixedDeltaSeconds,
        fixedDeltaSeconds: this.#fixedDeltaSeconds,
        alpha: 0,
        mode: this.#mode,
      });
    }
    if (this.#accumulator >= this.#fixedDeltaSeconds) {
      const overflowTicks = Math.floor(this.#accumulator / this.#fixedDeltaSeconds);
      const dropped = overflowTicks * this.#fixedDeltaSeconds;
      this.#accumulator -= dropped;
      this.#droppedSeconds += dropped;
    }
    const alpha = this.#accumulator / this.#fixedDeltaSeconds;
    return Object.freeze({
      frame: this.#frame,
      simulatedTicks,
      alpha,
      droppedSeconds: this.#droppedSeconds,
      mode: this.#mode,
      budget: this.#budget,
    });
  }

  snapshot(): Readonly<{ frame: number; tick: number; accumulator: number; droppedSeconds: number; mode: RuntimeModeV15; lastDelta: number }> {
    return Object.freeze({
      frame: Number(this.#frame),
      tick: Number(this.#tick),
      accumulator: Number(this.#accumulator.toFixed(6)),
      droppedSeconds: Number(this.#droppedSeconds.toFixed(6)),
      mode: this.#mode,
      lastDelta: Number(this.#lastDelta.toFixed(6)),
    });
  }

  reset(): void {
    this.#frame = frameV15(0);
    this.#tick = tickV15(0);
    this.#accumulator = 0;
    this.#droppedSeconds = 0;
    this.#lastDelta = 0;
  }

  phaseBudgets(): readonly { name: string; budgetMs: number }[] {
    return Object.freeze([
      { name: "input", budgetMs: this.#budget.inputMs },
      { name: "simulation", budgetMs: this.#budget.simulationMs },
      { name: "network", budgetMs: this.#budget.networkMs },
      { name: "streaming", budgetMs: this.#budget.streamingMs },
      { name: "presentation", budgetMs: this.#budget.presentationMs },
      { name: "persistence", budgetMs: this.#budget.persistenceMs },
    ]);
  }

  pressureScore(): number {
    const overload = this.#droppedSeconds > 0 ? 0.75 : 0;
    return clampV15(overload + (this.#lastDelta / this.#maxFrameDeltaSeconds) * 0.25, 0, 1);
  }

  stateAt(tick: number): "before" | "at" | "after" {
    if (tick < Number(this.#tick)) return "before";
    if (tick === Number(this.#tick)) return "at";
    return "after";
  }

  private get tickRate(): number { return this.#tickRate; }
}
