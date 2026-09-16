import { digest, stableSort, type Disposable } from './primitives.js';

export interface DeterminismRun<T = unknown> {
  readonly seed: number;
  readonly tick: number;
  readonly output: T;
  readonly digest: string;
}
export interface DeterminismComparison {
  readonly equal: boolean;
  readonly left: string;
  readonly right: string;
  readonly differingPaths: readonly string[];
}
export interface DeterminismStressReport {
  readonly iterations: number;
  readonly passed: number;
  readonly failed: number;
  readonly firstFailure: DeterminismComparison | null;
  readonly digest: string;
}

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  if (value === null || typeof value !== 'object') {
    result.set(prefix, JSON.stringify(value));
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      for (const [key, childValue] of flatten(child, `${prefix}[${index}]`)) result.set(key, childValue);
    });
    return result;
  }
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    for (const [childKey, childValue] of flatten((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key)) result.set(childKey, childValue);
  }
  return result;
}

export class DeterminismHarness implements Disposable {
  #disposed = false;
  #runs: DeterminismRun[] = [];
  #failures = 0;
  #limit: number;

  constructor(limit = 2048) {
    this.#limit = Math.max(16, Math.min(100_000, Math.trunc(limit)));
  }

  run<T>(seed: number, tick: number, producer: (seed: number, tick: number) => T): DeterminismRun<T> {
    if (this.#disposed) throw new Error('determinism-disposed');
    const safeSeed = Number.isFinite(seed) ? Math.trunc(seed) : 0;
    const safeTick = Number.isFinite(tick) ? Math.trunc(tick) : 0;
    const output = producer(safeSeed, safeTick);
    const record = Object.freeze({ seed: safeSeed, tick: safeTick, output, digest: digest(safeSeed, safeTick, output) });
    this.#runs.push(record);
    if (this.#runs.length > this.#limit) this.#runs.shift();
    return record;
  }

  compare<T>(left: DeterminismRun<T>, right: DeterminismRun<T>): DeterminismComparison {
    const leftFlat = flatten(left.output);
    const rightFlat = flatten(right.output);
    const paths = new Set<string>([...leftFlat.keys(), ...rightFlat.keys()]);
    const differences = stableSort([...paths].filter((path) => leftFlat.get(path) !== rightFlat.get(path)), (a, b) => a.localeCompare(b));
    return Object.freeze({ equal: differences.length === 0 && left.digest === right.digest, left: left.digest, right: right.digest, differingPaths: Object.freeze(differences) });
  }

  assertRepeatable<T>(seed: number, tick: number, producer: (seed: number, tick: number) => T): DeterminismComparison {
    const left = this.run(seed, tick, producer);
    const right = this.run(seed, tick, producer);
    const comparison = this.compare(left, right);
    if (!comparison.equal) this.#failures += 1;
    return comparison;
  }

  stress<T>(iterations: number, seed: number, producer: (seed: number, tick: number) => T): DeterminismStressReport {
    if (this.#disposed) return Object.freeze({ iterations: 0, passed: 0, failed: 0, firstFailure: null, digest: 'disposed' });
    const count = Math.max(1, Math.min(50_000, Math.trunc(iterations)));
    let passed = 0;
    let failed = 0;
    let firstFailure: DeterminismComparison | null = null;
    for (let index = 0; index < count; index += 1) {
      const comparison = this.assertRepeatable(seed + index, index, producer);
      if (comparison.equal) passed += 1;
      else { failed += 1; firstFailure ??= comparison; }
    }
    return Object.freeze({ iterations: count, passed, failed, firstFailure, digest: digest(count, passed, failed, firstFailure) });
  }

  runs(): readonly DeterminismRun[] {
    return Object.freeze([...this.#runs]);
  }

  failureCount(): number {
    return this.#failures;
  }

  clear(): void {
    this.#runs.length = 0;
    this.#failures = 0;
  }

  dispose(): void {
    this.#disposed = true;
    this.clear();
  }
}
