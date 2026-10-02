export interface HeartbeatSample {
  readonly tick: number;
  readonly wallMs: number;
  readonly frameMs: number;
}

export interface HeartbeatState {
  readonly lastTick: number;
  readonly ageTicks: number;
  readonly missed: number;
  readonly healthy: boolean;
}

export class RuntimeHeartbeat {
  readonly timeoutTicks: number;
  #last: HeartbeatSample | null = null;
  #missed = 0;

  constructor(timeoutTicks = 120) {
    this.timeoutTicks = Math.max(
      1,
      Math.trunc(timeoutTicks),
    );
  }

  beat(sample: HeartbeatSample): void {
    if (
      this.#last
      && sample.tick <= this.#last.tick
    ) {
      return;
    }

    this.#last = Object.freeze({
      ...sample,
    });
    this.#missed = 0;
  }

  evaluate(
    currentTick: number,
  ): HeartbeatState {
    if (!this.#last) {
      return Object.freeze({
        lastTick: -1,
        ageTicks: Infinity,
        missed: this.#missed,
        healthy: false,
      });
    }

    const age = Math.max(
      0,
      currentTick
      - this.#last.tick,
    );

    if (
      age > this.timeoutTicks
    ) {
      this.#missed += 1;
    } else {
      this.#missed = 0;
    }

    return Object.freeze({
      lastTick: this.#last.tick,
      ageTicks: age,
      missed: this.#missed,
      healthy:
        age <= this.timeoutTicks,
    });
  }

  reset(): void {
    this.#last = null;
    this.#missed = 0;
  }
}
