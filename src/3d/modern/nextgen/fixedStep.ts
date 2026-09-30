import { DEFAULT_SIMULATION_CONFIG, RuntimeFrame, SimulationConfig, Tick, tickValue } from './types.ts';

export interface FixedStepHooks {
  onTick: (tick: Tick, deltaSeconds: number) => void;
  onDrop?: (seconds: number) => void;
}

export class FixedStepClock {
  readonly #config: SimulationConfig;
  #tick: Tick = tickValue(0);
  #accumulator = 0;
  #droppedSeconds = 0;
  #simulatedTicks = 0;
  #lastFrameTimestamp = 0;
  #started = false;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.#config = { ...DEFAULT_SIMULATION_CONFIG, ...config };
    if (this.#config.tickRate <= 0) throw new RangeError('tickRate must be positive');
    if (this.#config.maxCatchUpTicks <= 0) throw new RangeError('maxCatchUpTicks must be positive');
  }

  get tick(): Tick { return this.#tick; }
  get stepSeconds(): number { return 1 / this.#config.tickRate; }
  get accumulator(): number { return this.#accumulator; }
  get droppedSeconds(): number { return this.#droppedSeconds; }

  reset(tick: Tick = tickValue(0)): void {
    this.#tick = tick;
    this.#accumulator = 0;
    this.#droppedSeconds = 0;
    this.#simulatedTicks = 0;
    this.#lastFrameTimestamp = 0;
    this.#started = false;
  }

  pushFrameDelta(frameDeltaSeconds: number, hooks: FixedStepHooks): RuntimeFrame {
    const clampedDelta = Math.min(this.#config.maxFrameDeltaSeconds, Math.max(0, frameDeltaSeconds));
    this.#accumulator += clampedDelta;
    this.#simulatedTicks = 0;
    while (this.#accumulator + Number.EPSILON >= this.stepSeconds && this.#simulatedTicks < this.#config.maxCatchUpTicks) {
      this.#accumulator -= this.stepSeconds;
      this.#tick = tickValue(this.#tick + 1);
      this.#simulatedTicks += 1;
      hooks.onTick(this.#tick, this.stepSeconds);
    }
    if (this.#accumulator >= this.stepSeconds) {
      const wholeSteps = Math.floor(this.#accumulator / this.stepSeconds);
      const dropped = wholeSteps * this.stepSeconds;
      this.#accumulator -= dropped;
      this.#droppedSeconds += dropped;
      hooks.onDrop?.(dropped);
    }
    return this.#frame(clampedDelta);
  }

  advanceToTimestamp(timestampMs: number, hooks: FixedStepHooks): RuntimeFrame {
    if (!this.#started) {
      this.#started = true;
      this.#lastFrameTimestamp = timestampMs;
      return this.#frame(0);
    }
    const deltaSeconds = Math.max(0, (timestampMs - this.#lastFrameTimestamp) / 1000);
    this.#lastFrameTimestamp = timestampMs;
    return this.pushFrameDelta(deltaSeconds, hooks);
  }

  #frame(deltaSeconds: number): RuntimeFrame {
    return {
      tick: this.#tick,
      deltaSeconds,
      alpha: this.#accumulator / this.stepSeconds,
      simulatedTicks: this.#simulatedTicks,
      droppedSeconds: this.#droppedSeconds,
    };
  }
}

export interface TickAccumulatorStats {
  ticks: number;
  seconds: number;
}

export function runDeterministicTicks(
  tickCount: number,
  config: Partial<SimulationConfig>,
  callback: (tick: Tick, deltaSeconds: number) => void,
): TickAccumulatorStats {
  if (!Number.isInteger(tickCount) || tickCount < 0) throw new RangeError('tickCount must be non-negative');
  const clock = new FixedStepClock(config);
  let ticks = 0;
  for (let index = 0; index < tickCount; index += 1) {
    const frame = clock.pushFrameDelta(clock.stepSeconds, {
      onTick: callback,
    });
    ticks += frame.simulatedTicks;
  }
  return { ticks, seconds: ticks * clock.stepSeconds };
}

export class SimulationAccumulator {
  #value = 0;
  #steps = 0;

  constructor(readonly stepSeconds: number) {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) throw new RangeError('stepSeconds must be positive');
  }

  add(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('seconds must be finite and non-negative');
    this.#value += seconds;
    return this.#consume();
  }

  consumeAll(limit = Number.POSITIVE_INFINITY): number {
    let consumed = 0;
    while (this.#value >= this.stepSeconds && consumed < limit) {
      this.#value -= this.stepSeconds;
      consumed += 1;
      this.#steps += 1;
    }
    return consumed;
  }

  get remainder(): number { return this.#value; }
  get totalSteps(): number { return this.#steps; }

  #consume(): number {
    const consumed = Math.floor(this.#value / this.stepSeconds);
    this.#value -= consumed * this.stepSeconds;
    this.#steps += consumed;
    return consumed;
  }
}

export function frameBudgetExceeded(elapsedMs: number, budgetMs: number): boolean {
  return Number.isFinite(elapsedMs) && Number.isFinite(budgetMs) && elapsedMs > budgetMs;
}

export function interpolationAlpha(accumulator: number, stepSeconds: number): number {
  if (stepSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, accumulator / stepSeconds));
}
