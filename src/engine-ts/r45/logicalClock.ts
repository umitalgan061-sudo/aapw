import { BoundedRing, RuntimeFault, clamp, integer } from "./contracts";

export type ClockMode = "running" | "paused";

export interface LogicalClockConfig {
  readonly fixedStepMs?: number;
  readonly maxRealDeltaMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxScheduledCallbacksPerAdvance?: number;
  readonly maxTimers?: number;
  readonly initialTick?: number;
  readonly initialMode?: ClockMode;
  readonly initialScale?: number;
}

export interface ClockSnapshot {
  readonly tick: number;
  readonly simulationTimeMs: number;
  readonly fixedStepMs: number;
  readonly accumulatorMs: number;
  readonly mode: ClockMode;
  readonly timeScale: number;
  readonly advances: number;
  readonly executedSteps: number;
  readonly discardedRealMs: number;
  readonly skippedSimulationMs: number;
  readonly pendingTimers: number;
}

export interface ClockCallbackFault {
  readonly timerId: number;
  readonly message: string;
}

export interface ClockAdvance {
  readonly tickBefore: number;
  readonly tickAfter: number;
  readonly steps: number;
  readonly acceptedRealMs: number;
  readonly discardedRealMs: number;
  readonly discardedSimulationMs: number;
  readonly timerCallbacks: number;
  readonly callbackFaults: readonly ClockCallbackFault[];
}

export interface LogicalTimerHandle {
  readonly id: number;
}

interface ScheduledTimer {
  readonly id: number;
  readonly dueTick: number;
  readonly callback: (tick: number) => void;
  cancelled: boolean;
}

const DEFAULT_FIXED_STEP_MS = 1000 / 60;

export class DeterministicLogicalClock {
  readonly fixedStepMs: number;
  readonly maxRealDeltaMs: number;
  readonly maxCatchUpSteps: number;
  readonly maxScheduledCallbacksPerAdvance: number;
  readonly maxTimers: number;
  #tick: number;
  #accumulatorMs = 0;
  #mode: ClockMode;
  #timeScale: number;
  #advances = 0;
  #executedSteps = 0;
  #discardedRealMs = 0;
  #skippedSimulationMs = 0;
  #nextTimerId = 1;
  #timers = new Map<number, ScheduledTimer>();
  #faults = new BoundedRing<ClockCallbackFault>(64);

  constructor(config: LogicalClockConfig = {}) {
    this.fixedStepMs = clamp(config.fixedStepMs ?? DEFAULT_FIXED_STEP_MS, 1, 1000);
    this.maxRealDeltaMs = clamp(config.maxRealDeltaMs ?? 250, this.fixedStepMs, 10_000);
    this.maxCatchUpSteps = integer(config.maxCatchUpSteps ?? 8, "clock.maxCatchUpSteps", 1, 240);
    this.maxScheduledCallbacksPerAdvance = integer(
      config.maxScheduledCallbacksPerAdvance ?? 128,
      "clock.maxScheduledCallbacksPerAdvance",
      1,
      10_000,
    );
    this.maxTimers = integer(config.maxTimers ?? 4096, "clock.maxTimers", 1, 1_000_000);
    this.#tick = integer(config.initialTick ?? 0, "clock.initialTick", 0, Number.MAX_SAFE_INTEGER - 10_000);
    this.#mode = config.initialMode ?? "running";
    this.#timeScale = clamp(config.initialScale ?? 1, 0, 4);
  }

  get tick(): number {
    return this.#tick;
  }

  get simulationTimeMs(): number {
    return this.#tick * this.fixedStepMs;
  }

  get mode(): ClockMode {
    return this.#mode;
  }

  setTimeScale(value: number): void {
    this.#timeScale = clamp(value, 0, 4);
  }

  pause(): boolean {
    if (this.#mode === "paused") return false;
    this.#mode = "paused";
    this.#accumulatorMs = 0;
    return true;
  }

  resume(): boolean {
    if (this.#mode === "running") return false;
    this.#mode = "running";
    return true;
  }

  schedule(delayTicks: number, callback: (tick: number) => void): LogicalTimerHandle {
    const delay = integer(delayTicks, "clock.schedule.delayTicks", 1, 10_000_000);
    if (typeof callback !== "function") {
      throw new RuntimeFault("INVALID_INPUT", "Timer callback must be callable", "clock.schedule");
    }
    if (this.#timers.size >= this.maxTimers) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Logical timer capacity is full", "clock.schedule", {
        details: { maxTimers: this.maxTimers },
      });
    }
    if (this.#nextTimerId >= Number.MAX_SAFE_INTEGER) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Timer identifier space exhausted", "clock.schedule");
    }
    const id = this.#nextTimerId++;
    this.#timers.set(id, { id, dueTick: this.#tick + delay, callback, cancelled: false });
    return Object.freeze({ id });
  }

  cancel(handle: LogicalTimerHandle): boolean {
    const timer = this.#timers.get(handle.id);
    if (!timer || timer.cancelled) return false;
    timer.cancelled = true;
    this.#timers.delete(handle.id);
    return true;
  }

  advance(realDeltaMs: number): ClockAdvance {
    const tickBefore = this.#tick;
    this.#advances += 1;
    const safeDelta = clamp(realDeltaMs, 0, this.maxRealDeltaMs);
    const discardedRealMs = Math.max(0, realDeltaMs - safeDelta);
    this.#discardedRealMs += discardedRealMs;
    if (this.#mode === "paused" || this.#timeScale === 0) {
      return Object.freeze({
        tickBefore,
        tickAfter: this.#tick,
        steps: 0,
        acceptedRealMs: safeDelta,
        discardedRealMs,
        discardedSimulationMs: 0,
        timerCallbacks: 0,
        callbackFaults: Object.freeze([]),
      });
    }

    this.#accumulatorMs += safeDelta * this.#timeScale;
    let steps = 0;
    let discardedSimulationMs = 0;
    while (this.#accumulatorMs >= this.fixedStepMs && steps < this.maxCatchUpSteps) {
      if (this.#tick >= Number.MAX_SAFE_INTEGER - 1) {
        throw new RuntimeFault("CAPACITY_EXCEEDED", "Logical tick exhausted", "clock.advance");
      }
      this.#tick += 1;
      this.#accumulatorMs -= this.fixedStepMs;
      steps += 1;
      this.#executedSteps += 1;
    }
    if (this.#accumulatorMs >= this.fixedStepMs) {
      const retainedRemainder = this.#accumulatorMs % this.fixedStepMs;
      discardedSimulationMs = this.#accumulatorMs - retainedRemainder;
      this.#accumulatorMs = retainedRemainder;
      this.#skippedSimulationMs += discardedSimulationMs;
    }

    const callbackFaults: ClockCallbackFault[] = [];
    let timerCallbacks = 0;
    while (timerCallbacks < this.maxScheduledCallbacksPerAdvance) {
      const due = [...this.#timers.values()]
        .filter((timer) => !timer.cancelled && timer.dueTick <= this.#tick)
        .sort((left, right) => left.dueTick - right.dueTick || left.id - right.id)[0];
      if (!due) break;
      this.#timers.delete(due.id);
      timerCallbacks += 1;
      try {
        due.callback(this.#tick);
      } catch (error) {
        const fault = Object.freeze({
          timerId: due.id,
          message: error instanceof Error ? error.message : "Timer callback failed",
        });
        callbackFaults.push(fault);
        this.#faults.push(fault);
      }
    }

    return Object.freeze({
      tickBefore,
      tickAfter: this.#tick,
      steps,
      acceptedRealMs: safeDelta,
      discardedRealMs,
      discardedSimulationMs,
      timerCallbacks,
      callbackFaults: Object.freeze(callbackFaults),
    });
  }

  snapshot(): ClockSnapshot {
    return Object.freeze({
      tick: this.#tick,
      simulationTimeMs: this.simulationTimeMs,
      fixedStepMs: this.fixedStepMs,
      accumulatorMs: this.#accumulatorMs,
      mode: this.#mode,
      timeScale: this.#timeScale,
      advances: this.#advances,
      executedSteps: this.#executedSteps,
      discardedRealMs: this.#discardedRealMs,
      skippedSimulationMs: this.#skippedSimulationMs,
      pendingTimers: this.#timers.size,
    });
  }

  recentCallbackFaults(): readonly ClockCallbackFault[] {
    return this.#faults.snapshot().values;
  }

  clearTimers(): number {
    const count = this.#timers.size;
    this.#timers.clear();
    return count;
  }
}
