export interface RandomState {
  readonly seed: number;
  readonly state: number;
}

export class DeterministicRandomStream {
  readonly seed: number;
  #state: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.#state =
      this.seed || 0x9e3779b9;
  }

  nextUint(): number {
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    return this.#state;
  }

  next(): number {
    return (
      this.nextUint()
      / 0x100000000
    );
  }

  range(
    min: number,
    max: number,
  ): number {
    const low = Math.min(min, max);
    const high = Math.max(min, max);

    return (
      low + (high - low) * this.next()
    );
  }

  int(
    min: number,
    max: number,
  ): number {
    const low = Math.ceil(
      Math.min(min, max),
    );
    const high = Math.floor(
      Math.max(min, max),
    );

    if (high <= low) {
      return low;
    }

    return (
      low
      + Math.floor(
        this.next()
        * (high - low + 1),
      )
    );
  }

  fork(label: string):
    DeterministicRandomStream {
    let hash = this.nextUint();

    for (const char of label) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(
        hash,
        16777619,
      );
    }

    return new DeterministicRandomStream(
      hash >>> 0,
    );
  }

  capture(): RandomState {
    return Object.freeze({
      seed: this.seed,
      state: this.#state,
    });
  }

  restore(state: RandomState): void {
    if (
      (state.seed >>> 0)
      !== this.seed
    ) {
      throw new Error(
        'RANDOM_SEED_MISMATCH',
      );
    }

    this.#state =
      state.state >>> 0;
  }

  reset(): void {
    this.#state =
      this.seed || 0x9e3779b9;
  }
}
