import {
  Tick,
  Vec3,
  ZERO_VEC3,
  asTick,
  asSimSeconds,
  SimSeconds,
  add3,
  clamp,
  hashString,
  stableJson,
  stableNumber,
} from './contracts.ts';

export interface SeededRandomSnapshot {
  readonly seed: number;
  readonly state: number;
  readonly calls: number;
}

export class SeededRandom {
  readonly #seed: number;
  #state: number;
  #calls = 0;

  constructor(seed: number) {
    this.#seed = seed >>> 0;
    this.#state = this.#seed || 0x6d2b79f5;
  }

  next(): number {
    let t = this.#state += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    this.#state = t >>> 0;
    this.#calls += 1;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  integer(min: number, maxInclusive: number): number { return Math.floor(this.range(min, maxInclusive + 1)); }
  chance(probability: number): boolean { return this.next() < clamp(probability, 0, 1); }
  snapshot(): SeededRandomSnapshot { return Object.freeze({ seed: this.#seed, state: this.#state, calls: this.#calls }); }
  restore(snapshot: SeededRandomSnapshot): void { if (snapshot.seed !== this.#seed) throw new Error('seed mismatch'); this.#state = snapshot.state >>> 0; this.#calls = snapshot.calls; }
}

export interface DeterministicClockOptions {
  readonly fixedStepMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxFrameDeltaMs?: number;
}

export interface ClockStepResult {
  readonly steps: number;
  readonly alpha: number;
  readonly droppedSteps: number;
  readonly state: Readonly<{
    tick: Tick;
    elapsedSeconds: SimSeconds;
    accumulatorMs: number;
  }>;
}

export class DeterministicClock {
  readonly #fixedStepMs: number;
  readonly #maxCatchUpSteps: number;
  readonly #maxFrameDeltaMs: number;
  #accumulatorMs = 0;
  #tick: Tick = asTick(0);
  #elapsedSeconds: SimSeconds = asSimSeconds(0);
  #droppedSteps = 0;

  constructor(options: DeterministicClockOptions = {}) {
    this.#fixedStepMs = Math.max(1, options.fixedStepMs ?? 16.667);
    this.#maxCatchUpSteps = Math.max(1, Math.floor(options.maxCatchUpSteps ?? 6));
    this.#maxFrameDeltaMs = Math.max(this.#fixedStepMs, options.maxFrameDeltaMs ?? 250);
  }

  advance(realDeltaMs: number, step: (dtSeconds: number, tick: Tick) => void): ClockStepResult {
    const delta = clamp(realDeltaMs, 0, this.#maxFrameDeltaMs);
    this.#accumulatorMs += delta;
    let steps = 0;
    while (this.#accumulatorMs >= this.#fixedStepMs && steps < this.#maxCatchUpSteps) {
      const nextTick = asTick(this.#tick + 1);
      step(this.#fixedStepMs / 1000, nextTick);
      this.#tick = nextTick;
      this.#elapsedSeconds = asSimSeconds(this.#elapsedSeconds + this.#fixedStepMs / 1000);
      this.#accumulatorMs -= this.#fixedStepMs;
      steps += 1;
    }
    if (this.#accumulatorMs >= this.#fixedStepMs) {
      const skipped = Math.floor(this.#accumulatorMs / this.#fixedStepMs);
      this.#accumulatorMs -= skipped * this.#fixedStepMs;
      this.#droppedSteps += skipped;
    }
    return Object.freeze({
      steps,
      alpha: this.#fixedStepMs > 0 ? this.#accumulatorMs / this.#fixedStepMs : 0,
      droppedSteps: this.#droppedSteps,
      state: Object.freeze({ tick: this.#tick, elapsedSeconds: this.#elapsedSeconds, accumulatorMs: stableNumber(this.#accumulatorMs) }),
    });
  }

  reset(): void { this.#accumulatorMs = 0; this.#tick = asTick(0); this.#elapsedSeconds = asSimSeconds(0); this.#droppedSteps = 0; }
  get tick(): Tick { return this.#tick; }
  get elapsedSeconds(): SimSeconds { return this.#elapsedSeconds; }
  get droppedSteps(): number { return this.#droppedSteps; }
}

export interface TransformFrame {
  readonly tick: Tick;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export interface DeterministicTransform {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly acceleration: Vec3;
  readonly maxSpeed: number;
  readonly damping: number;
}

export const integrateTransform = (state: DeterministicTransform, dtSeconds: number): DeterministicTransform => {
  const dt = clamp(dtSeconds, 0, 0.25);
  const velocity = add3(state.velocity, { x: state.acceleration.x * dt, y: state.acceleration.y * dt, z: state.acceleration.z * dt });
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const factor = speed > state.maxSpeed && speed > 1e-8 ? state.maxSpeed / speed : 1;
  const limited = { x: velocity.x * factor, y: velocity.y * factor, z: velocity.z * factor };
  const nextPosition = add3(state.position, { x: limited.x * dt, y: limited.y * dt, z: limited.z * dt });
  const damping = Math.pow(clamp(state.damping, 0, 1), dt * 60);
  return Object.freeze({
    ...state,
    position: nextPosition,
    velocity: { x: limited.x * damping, y: limited.y * damping, z: limited.z * damping },
  });
};

export interface DeterministicWorldState {
  readonly seed: number;
  readonly tick: Tick;
  readonly elapsedSeconds: SimSeconds;
  readonly origin: Vec3;
  readonly weatherIndex: number;
  readonly populationSeed: number;
  readonly revision: number;
}

export class DeterministicWorld {
  readonly #seed: number;
  readonly #random: SeededRandom;
  #state: DeterministicWorldState;

  constructor(seed = 1) {
    this.#seed = seed >>> 0;
    this.#random = new SeededRandom(this.#seed);
    this.#state = Object.freeze({ seed: this.#seed, tick: asTick(0), elapsedSeconds: asSimSeconds(0), origin: ZERO_VEC3, weatherIndex: 0, populationSeed: this.#random.integer(1, 0x7fffffff), revision: 0 });
  }

  step(dtSeconds: number): DeterministicWorldState {
    const tick = asTick(this.#state.tick + 1);
    const weatherIndex = this.#state.weatherIndex;
    if (tick % 300 === 0) {
      this.#random.integer(0, 15);
    }
    this.#state = Object.freeze({
      ...this.#state,
      tick,
      elapsedSeconds: asSimSeconds(this.#state.elapsedSeconds + clamp(dtSeconds, 0, 0.25)),
      weatherIndex,
      revision: this.#state.revision + 1,
    });
    return this.#state;
  }

  sampleNoise(x: number, z: number, scale = 1): number {
    const key = `${this.#seed}:${stableNumber(x * scale)}:${stableNumber(z * scale)}`;
    const hash = Number.parseInt(hashString(key), 16) >>> 0;
    return hash / 0xffffffff;
  }

  snapshot(): DeterministicWorldState { return this.#state; }
  serialize(): string { return stableJson(this.#state); }
  restore(value: DeterministicWorldState): void {
    if (value.seed !== this.#seed) throw new Error('world seed mismatch');
    if (value.tick < 0 || !Number.isFinite(value.elapsedSeconds)) throw new Error('invalid world snapshot');
    this.#state = Object.freeze({ ...value, tick: asTick(value.tick), elapsedSeconds: asSimSeconds(value.elapsedSeconds) });
  }
}

export const replayDigest = (frames: readonly TransformFrame[]): string => hashString(stableJson(frames.map((frame) => ({ tick: frame.tick, position: frame.position, velocity: frame.velocity }))));
