import type { Result } from './contracts.ts';
import { fail, ok, stableHash } from './contracts.ts';

export interface SimulationInputR25<T = unknown> {
  readonly tick: number;
  readonly payload: T;
}

export interface SimulationStateR25 {
  readonly tick: number;
  readonly frame: number;
  readonly hash: string;
  readonly payload: unknown;
}

export interface SimulationStepContextR25<T = unknown> {
  readonly tick: number;
  readonly frame: number;
  readonly fixedDeltaMs: number;
  readonly input: T | undefined;
  readonly previous: SimulationStateR25;
}

export interface SimulationStepResultR25 {
  readonly state: SimulationStateR25;
  readonly consumedInput: boolean;
  readonly hash: string;
}

export interface SimulationAdapterR25<TInput = unknown, TState = unknown> {
  initialState(): TState;
  step(state: TState, input: TInput | undefined, context: SimulationStepContextR25<TInput>): TState;
  serialize(state: TState): unknown;
  deserialize(payload: unknown): TState;
}

export interface CheckpointR25 {
  readonly tick: number;
  readonly frame: number;
  readonly hash: string;
  readonly payload: unknown;
}

export interface SimulationSnapshotR25 {
  readonly tick: number;
  readonly frame: number;
  readonly accumulatorMs: number;
  readonly fixedDeltaMs: number;
  readonly droppedTicks: number;
  readonly checkpoints: readonly CheckpointR25[];
  readonly stateHash: string;
}

export interface DeterministicSimulationOptionsR25 {
  readonly fixedDeltaMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxAccumulatorMs?: number;
  readonly checkpointEveryTicks?: number;
  readonly maxCheckpoints?: number;
  readonly clock?: () => number;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function integer(value: unknown, fallback = 0): number {
  return Math.trunc(finite(value, fallback));
}

export class DeterministicSimulationR25<TInput = unknown, TState = unknown> {
  readonly #adapter: SimulationAdapterR25<TInput, TState>;
  readonly #fixedDeltaMs: number;
  readonly #maxCatchUpSteps: number;
  readonly #maxAccumulatorMs: number;
  readonly #checkpointEveryTicks: number;
  readonly #maxCheckpoints: number;
  readonly #clock: () => number;
  readonly #inputs = new Map<number, SimulationInputR25<TInput>[]>();
  readonly #checkpoints: CheckpointR25[] = [];

  #state: TState;
  #tick = 0;
  #frame = 0;
  #accumulatorMs = 0;
  #droppedTicks = 0;
  #disposed = false;

  public constructor(
    adapter: SimulationAdapterR25<TInput, TState>,
    options: DeterministicSimulationOptionsR25 = {},
  ) {
    this.#adapter = adapter;
    this.#fixedDeltaMs = Math.max(1, finite(options.fixedDeltaMs, 1000 / 60));
    this.#maxCatchUpSteps = Math.max(1, Math.trunc(finite(options.maxCatchUpSteps, 6)));
    this.#maxAccumulatorMs = Math.max(
      this.#fixedDeltaMs,
      finite(options.maxAccumulatorMs, this.#fixedDeltaMs * 12),
    );
    this.#checkpointEveryTicks = Math.max(
      1,
      Math.trunc(finite(options.checkpointEveryTicks, 30)),
    );
    this.#maxCheckpoints = Math.max(
      2,
      Math.trunc(finite(options.maxCheckpoints, 64)),
    );
    this.#clock = options.clock ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.#state = adapter.initialState();
    this.#captureCheckpoint();
  }

  public get tick(): number {
    return this.#tick;
  }

  public get frame(): number {
    return this.#frame;
  }

  public get state(): TState {
    return this.#state;
  }

  public enqueue(input: SimulationInputR25<TInput>): Result<true, string> {
    this.#assertLive();
    const tick = integer(input.tick, this.#tick + 1);
    if (tick < this.#tick) {
      return fail('R25_SIMULATION_LATE_INPUT');
    }

    const list = this.#inputs.get(tick) ?? [];
    list.push(freeze({
      tick,
      payload: cloneJson(input.payload),
    }));
    list.sort((a, b) => stableHash(a.payload).localeCompare(stableHash(b.payload)));
    this.#inputs.set(tick, list);
    return ok(true);
  }

  public advance(deltaMs: number): readonly SimulationStepResultR25[] {
    this.#assertLive();
    const delta = Math.max(
      0,
      Math.min(this.#maxAccumulatorMs, finite(deltaMs, this.#fixedDeltaMs)),
    );

    this.#accumulatorMs = Math.min(
      this.#maxAccumulatorMs,
      this.#accumulatorMs + delta,
    );

    const steps: SimulationStepResultR25[] = [];
    let catchUp = 0;

    while (
      this.#accumulatorMs >= this.#fixedDeltaMs &&
      catchUp < this.#maxCatchUpSteps
    ) {
      this.#accumulatorMs -= this.#fixedDeltaMs;
      steps.push(this.step());
      catchUp += 1;
    }

    if (this.#accumulatorMs >= this.#fixedDeltaMs) {
      const dropped = Math.floor(this.#accumulatorMs / this.#fixedDeltaMs);
      this.#droppedTicks += dropped;
      this.#accumulatorMs %= this.#fixedDeltaMs;
    }

    this.#frame += 1;
    return freeze(steps);
  }

  public step(): SimulationStepResultR25 {
    this.#assertLive();
    const nextTick = this.#tick + 1;
    const inputs = this.#inputs.get(nextTick);
    const input = inputs?.[0]?.payload;

    const previousPayload = this.#adapter.serialize(this.#state);
    const previous: SimulationStateR25 = freeze({
      tick: this.#tick,
      frame: this.#frame,
      hash: stableHash(previousPayload),
      payload: previousPayload,
    });

    const context: SimulationStepContextR25<TInput> = freeze({
      tick: nextTick,
      frame: this.#frame,
      fixedDeltaMs: this.#fixedDeltaMs,
      input,
      previous,
    });

    const nextState = this.#adapter.step(
      this.#state,
      input,
      context,
    );

    this.#state = nextState;
    this.#tick = nextTick;

    if (inputs?.length) {
      inputs.shift();
      if (inputs.length === 0) {
        this.#inputs.delete(nextTick);
      }
    }

    const payload = this.#adapter.serialize(this.#state);
    const hash = stableHash(payload);

    if (this.#tick % this.#checkpointEveryTicks === 0) {
      this.#captureCheckpoint(payload, hash);
    }

    return freeze({
      state: freeze({
        tick: this.#tick,
        frame: this.#frame,
        hash,
        payload: cloneJson(payload),
      }),
      consumedInput: Boolean(input !== undefined),
      hash,
    });
  }

  public rollbackTo(tick: number): Result<CheckpointR25, string> {
    this.#assertLive();
    const target = Math.max(0, Math.trunc(tick));
    const checkpoint = [...this.#checkpoints]
      .filter((item) => item.tick <= target)
      .sort((a, b) => b.tick - a.tick)[0];

    if (!checkpoint) {
      return fail('R25_NO_ROLLBACK_CHECKPOINT');
    }

    this.#state = this.#adapter.deserialize(cloneJson(checkpoint.payload));
    this.#tick = checkpoint.tick;
    this.#frame = checkpoint.frame;
    this.#accumulatorMs = 0;

    for (const inputTick of [...this.#inputs.keys()]) {
      if (inputTick <= checkpoint.tick) this.#inputs.delete(inputTick);
    }

    return ok(checkpoint);
  }

  public replayFrom(
    startTick: number,
    endTick: number,
    inputs: readonly SimulationInputR25<TInput>[],
  ): Result<readonly SimulationStepResultR25[], string> {
    this.#assertLive();
    const start = Math.max(0, Math.trunc(startTick));
    const end = Math.max(start, Math.trunc(endTick));

    const rollback = this.rollbackTo(start);
    if (!rollback.ok) return rollback;

    for (const input of inputs) {
      if (input.tick > start && input.tick <= end) {
        const queued = this.enqueue(input);
        if (!queued.ok) return fail(queued.error);
      }
    }

    const results: SimulationStepResultR25[] = [];
    while (this.#tick < end) {
      results.push(this.step());
    }

    return ok(freeze(results));
  }

  public verifyDeterminism(
    inputs: readonly SimulationInputR25<TInput>[],
    ticks: number,
  ): Readonly<{
    equal: boolean;
    firstHash: string;
    secondHash: string;
    tick: number;
  }> {
    this.#assertLive();

    const start = this.#tick;
    const firstRun = this.#simulateDetached(inputs, ticks);
    const secondRun = this.#simulateDetached(inputs, ticks);

    return freeze({
      equal: firstRun.hash === secondRun.hash,
      firstHash: firstRun.hash,
      secondHash: secondRun.hash,
      tick: start + Math.max(0, Math.trunc(ticks)),
    });
  }

  public snapshot(): SimulationSnapshotR25 {
    const payload = this.#adapter.serialize(this.#state);
    return freeze({
      tick: this.#tick,
      frame: this.#frame,
      accumulatorMs: Number(this.#accumulatorMs.toFixed(6)),
      fixedDeltaMs: this.#fixedDeltaMs,
      droppedTicks: this.#droppedTicks,
      checkpoints: freeze([...this.#checkpoints]),
      stateHash: stableHash(payload),
    });
  }

  public clearCheckpoints(): void {
    this.#checkpoints.length = 0;
    this.#captureCheckpoint();
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#inputs.clear();
    this.#checkpoints.length = 0;
  }

  #captureCheckpoint(payload?: unknown, hash?: string): void {
    const serialized = payload ?? this.#adapter.serialize(this.#state);
    const checkpoint = freeze({
      tick: this.#tick,
      frame: this.#frame,
      hash: hash ?? stableHash(serialized),
      payload: cloneJson(serialized),
    });

    this.#checkpoints.push(checkpoint);
    if (this.#checkpoints.length > this.#maxCheckpoints) {
      this.#checkpoints.splice(0, this.#checkpoints.length - this.#maxCheckpoints);
    }
  }

  #simulateDetached(
    inputs: readonly SimulationInputR25<TInput>[],
    ticks: number,
  ): CheckpointR25 {
    let state = this.#adapter.initialState();
    const inputMap = new Map<number, SimulationInputR25<TInput>[]>();

    for (const input of inputs) {
      const list = inputMap.get(input.tick) ?? [];
      list.push(input);
      inputMap.set(input.tick, list);
    }

    for (let offset = 1; offset <= Math.max(0, Math.trunc(ticks)); offset += 1) {
      const tick = this.#tick + offset;
      const list = inputMap.get(tick);
      const currentInput = list?.[0]?.payload;
      const previousPayload = this.#adapter.serialize(state);
      const previous: SimulationStateR25 = freeze({
        tick: tick - 1,
        frame: this.#frame + offset - 1,
        hash: stableHash(previousPayload),
        payload: previousPayload,
      });

      state = this.#adapter.step(state, currentInput, {
        tick,
        frame: this.#frame + offset - 1,
        fixedDeltaMs: this.#fixedDeltaMs,
        input: currentInput,
        previous,
      });
    }

    const payload = this.#adapter.serialize(state);
    return freeze({
      tick: this.#tick + Math.max(0, Math.trunc(ticks)),
      frame: this.#frame + Math.max(0, Math.trunc(ticks)),
      hash: stableHash(payload),
      payload: cloneJson(payload),
    });
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R25_SIMULATION_DISPOSED');
  }
}

export interface ReplayEventR25<T = unknown> {
  readonly tick: number;
  readonly payload: T;
}

export interface ReplayTapeR25<T = unknown> {
  readonly version: 1;
  readonly initialHash: string;
  readonly events: readonly ReplayEventR25<T>[];
}

export function createReplayTapeR25<T>(
  initialState: unknown,
  events: readonly ReplayEventR25<T>[],
): ReplayTapeR25<T> {
  return freeze({
    version: 1,
    initialHash: stableHash(initialState),
    events: freeze(
      [...events]
        .map((event) => freeze({
          tick: Math.max(0, Math.trunc(event.tick)),
          payload: cloneJson(event.payload),
        }))
        .sort((a, b) => a.tick - b.tick || stableHash(a.payload).localeCompare(stableHash(b.payload))),
    ),
  });
}

export function replayTapeDigestR25<T>(
  tape: ReplayTapeR25<T>,
): string {
  return stableHash({
    version: tape.version,
    initialHash: tape.initialHash,
    events: tape.events,
  });
}
