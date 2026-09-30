import { checksumV15, stableStringifyV15 } from "./types.ts";

export interface DeterministicStepV15<S, I> {
  readonly step: number;
  readonly input: I;
  readonly state: S;
  readonly checksum: number;
}

export interface DeterministicTraceV15<S, I> {
  readonly seed: number;
  readonly initial: S;
  readonly steps: readonly DeterministicStepV15<S, I>[];
  readonly finalChecksum: number;
}

export interface DeterministicHarnessOptionsV15 {
  readonly seed?: number;
  readonly maxSteps?: number;
  readonly clone?: <T>(value: T) => T;
}

function cloneDefault<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export class DeterministicHarnessV15<S, I> {
  readonly #seed: number;
  readonly #maxSteps: number;
  readonly #clone: <T>(value: T) => T;
  #state: S;
  readonly #initial: S;
  #step = 0;
  readonly #trace: DeterministicStepV15<S, I>[] = [];

  constructor(initial: S, options: DeterministicHarnessOptionsV15 = {}) {
    this.#seed = Number.isInteger(options.seed) ? Number(options.seed) : 0xC0FFEE;
    this.#maxSteps = Math.max(1, Math.min(1_000_000, Math.floor(options.maxSteps ?? 100_000)));
    this.#clone = options.clone ?? cloneDefault;
    this.#state = this.#clone(initial);
    this.#initial = this.#clone(initial);
  }

  get seed(): number { return this.#seed; }
  get step(): number { return this.#step; }
  get state(): S { return this.#clone(this.#state); }

  advance(
    input: I,
    evolve: (state: S, input: I, context: { readonly step: number; readonly seed: number }) => S,
  ): DeterministicStepV15<S, I> {
    if (this.#step >= this.#maxSteps) throw new RangeError("deterministic step budget exhausted");
    const nextStep = this.#step + 1;
    const nextState = this.#clone(evolve(this.#clone(this.#state), this.#clone(input), { step: nextStep, seed: this.#seed }));
    this.#state = nextState;
    this.#step = nextStep;
    const record = Object.freeze({
      step: nextStep,
      input: this.#clone(input),
      state: this.#clone(nextState),
      checksum: checksumV15({ step: nextStep, input, state: nextState }),
    });
    this.#trace.push(record);
    return record;
  }

  trace(): DeterministicTraceV15<S, I> {
    const steps = Object.freeze(this.#trace.map(item => Object.freeze({
      step: item.step,
      input: this.#clone(item.input),
      state: this.#clone(item.state),
      checksum: item.checksum,
    })));
    return Object.freeze({
      seed: this.#seed,
      initial: this.#clone(this.#initial),
      steps,
      finalChecksum: checksumV15(steps),
    });
  }

  traceFromInitial(initial: S): DeterministicTraceV15<S, I> {
    return Object.freeze({
      seed: this.#seed,
      initial: this.#clone(initial),
      steps: Object.freeze(this.#trace.map(item => Object.freeze({
        step: item.step,
        input: this.#clone(item.input),
        state: this.#clone(item.state),
        checksum: item.checksum,
      }))),
      finalChecksum: checksumV15(this.#trace),
    });
  }

  verifyTrace(
    trace: DeterministicTraceV15<S, I>,
    evolve: (state: S, input: I, context: { readonly step: number; readonly seed: number }) => S,
  ): { readonly ok: boolean; readonly mismatchStep: number | null; readonly expected: number; readonly actual: number } {
    let state = this.#clone(trace.initial);
    for (const item of trace.steps) {
      state = this.#clone(evolve(this.#clone(state), this.#clone(item.input), { step: item.step, seed: trace.seed }));
      const actual = checksumV15({ step: item.step, input: item.input, state });
      if (actual !== item.checksum) {
        return Object.freeze({ ok: false, mismatchStep: item.step, expected: item.checksum, actual });
      }
    }
    return Object.freeze({
      ok: checksumV15(trace.steps) === trace.finalChecksum,
      mismatchStep: null,
      expected: trace.finalChecksum,
      actual: checksumV15(trace.steps),
    });
  }

  digest(): number {
    return checksumV15({ seed: this.#seed, step: this.#step, state: this.#state, trace: this.#trace.map(item => item.checksum) });
  }
}

export function compareDeterministicTracesV15<S, I>(
  left: DeterministicTraceV15<S, I>,
  right: DeterministicTraceV15<S, I>,
): Readonly<{ equal: boolean; firstDifferentStep: number | null; leftChecksum: number; rightChecksum: number }> {
  const length = Math.max(left.steps.length, right.steps.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.steps[index];
    const b = right.steps[index];
    if (!a || !b || a.checksum !== b.checksum) {
      return Object.freeze({
        equal: false,
        firstDifferentStep: index + 1,
        leftChecksum: a?.checksum ?? left.finalChecksum,
        rightChecksum: b?.checksum ?? right.finalChecksum,
      });
    }
  }
  return Object.freeze({
    equal: left.finalChecksum === right.finalChecksum && left.seed === right.seed,
    firstDifferentStep: left.finalChecksum === right.finalChecksum ? null : length,
    leftChecksum: left.finalChecksum,
    rightChecksum: right.finalChecksum,
  });
}

export function deterministicSeededValueV15(seed: number, step: number): number {
  let value = (Math.trunc(seed) ^ Math.imul(Math.trunc(step), 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return value / 0x1_0000_0000;
}

export function deterministicChoiceV15<T>(values: readonly T[], seed: number, step: number): T | undefined {
  if (!values.length) return undefined;
  const index = Math.min(values.length - 1, Math.floor(deterministicSeededValueV15(seed, step) * values.length));
  return values[index];
}

export function canonicalTraceTextV15<S, I>(trace: DeterministicTraceV15<S, I>): string {
  return stableStringifyV15(trace);
}
