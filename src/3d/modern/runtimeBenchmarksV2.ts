import { stableDigest, type Vec2, type Vec3 } from './deterministic.ts';
import { SpatialHash2D } from './worldSpatialIndex.ts';
import { findWeightedPath, type NavNode, type WeightedNavGrid } from './navigationRuntime.ts';

export interface BenchmarkSample {
  readonly name: string;
  readonly iterations: number;
  readonly totalMs: number;
  readonly averageMs: number;
  readonly operationsPerSecond: number;
  readonly digest: string;
}

export interface BenchmarkReport {
  readonly revision: 'v2';
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly samples: readonly BenchmarkSample[];
  readonly totalMs: number;
}

export interface BenchmarkClock { now(): number; }

const defaultClock: BenchmarkClock = { now: () => performance.now() };

const measure = (clock: BenchmarkClock, name: string, iterations: number, operation: (index: number) => unknown): BenchmarkSample => {
  const safeIterations = Math.max(1, Math.floor(iterations));
  const values: unknown[] = [];
  const started = clock.now();
  for (let index = 0; index < safeIterations; index += 1) values.push(operation(index));
  const totalMs = Math.max(0, clock.now() - started);
  const averageMs = totalMs / safeIterations;
  return Object.freeze({
    name,
    iterations: safeIterations,
    totalMs: Number(totalMs.toFixed(4)),
    averageMs: Number(averageMs.toFixed(6)),
    operationsPerSecond: totalMs > 0 ? Number((safeIterations * 1000 / totalMs).toFixed(2)) : Number.POSITIVE_INFINITY,
    digest: stableDigest(values),
  });
};

const makeGrid = (width: number, height: number): WeightedNavGrid => Object.freeze({
  width,
  height,
  origin: Object.freeze({ x: 0, y: 0 }),
  cellSize: 1,
  cells: Object.freeze(Array.from({ length: width * height }, (_, index) => Object.freeze({
    blocked: index % 37 === 0,
    cost: 1 + (index % 7) * 0.05,
    height: Math.sin(index * 0.07) * 0.5,
    slope: (index % 13) / 13,
    danger: (index % 11) / 11,
  }))),
});

export const benchmarkSpatialHash = (clock: BenchmarkClock = defaultClock, count = 10_000): BenchmarkSample => {
  return measure(clock, 'spatial-hash-upsert-query-remove', Math.max(1, Math.floor(count)), (index) => {
    const hash = new SpatialHash2D<{ active: boolean }>(16, 100_000);
    const points: Array<{ id: string; x: number; y: number; radius: number; value: { active: boolean } }> = [];
    for (let i = 0; i < 64; i += 1) points.push({ id: `e-${i}`, x: i * 4, y: (i * 7) % 40, radius: 1, value: { active: true } });
    for (const point of points) hash.set(point);
    const nearby = hash.queryCircle({ x: index % 128, y: (index * 3) % 128 }, 24).map((entry) => entry.id);
    hash.update('e-1', { x: index % 32, y: (index * 5) % 32 });
    hash.remove('e-63');
    return nearby;
  });
};

export const benchmarkNavigation = (clock: BenchmarkClock = defaultClock, count = 250): BenchmarkSample => {
  const grid = makeGrid(32, 32);
  return measure(clock, 'weighted-navigation-bounded-a-star', Math.max(1, Math.floor(count)), (index) => {
    const start: NavNode = { x: 1 + (index % 4), z: 1 };
    const goal: NavNode = { x: 28 - (index % 4), z: 28 };
    return findWeightedPath(grid, start, goal, { maxExpanded: 3500 })?.nodes.slice(-6) ?? [];
  });
};

export const benchmarkDigest = (clock: BenchmarkClock = defaultClock, count = 10_000): BenchmarkSample =>
  measure(clock, 'deterministic-digest', Math.max(1, Math.floor(count)), (index) => stableDigest({ index, position: { x: index % 97, y: index % 53, z: index % 31 }, flags: [index % 2 === 0, index % 3 === 0] }));

export const runRuntimeBenchmarks = (clock: BenchmarkClock = defaultClock): BenchmarkReport => {
  const startedAt = clock.now();
  const samples = [benchmarkSpatialHash(clock), benchmarkNavigation(clock), benchmarkDigest(clock)];
  const finishedAt = clock.now();
  return Object.freeze({ revision: 'v2', startedAt, finishedAt, samples, totalMs: Math.max(0, finishedAt - startedAt) });
};

export interface PerformanceBudget {
  readonly name: string;
  readonly maxAverageMs: number;
  readonly minOpsPerSecond: number;
}

export interface BudgetCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly averageMs: number;
  readonly operationsPerSecond: number;
  readonly reasons: readonly string[];
}

const budgets: readonly PerformanceBudget[] = Object.freeze([
  Object.freeze({ name: 'spatial-hash-upsert-query-remove', maxAverageMs: 0.08, minOpsPerSecond: 8000 }),
  Object.freeze({ name: 'weighted-navigation-bounded-a-star', maxAverageMs: 2.5, minOpsPerSecond: 300 }),
  Object.freeze({ name: 'deterministic-digest', maxAverageMs: 0.05, minOpsPerSecond: 12000 }),
]);

export const checkBenchmarkBudgets = (report: BenchmarkReport, expected: readonly PerformanceBudget[] = budgets): readonly BudgetCheck[] => {
  const checks: BudgetCheck[] = [];
  for (const budget of expected) {
    const sample = report.samples.find((candidate) => candidate.name === budget.name);
    const reasons: string[] = [];
    if (!sample) reasons.push('missing sample');
    if (sample && sample.averageMs > budget.maxAverageMs) reasons.push(`average ${sample.averageMs}ms > ${budget.maxAverageMs}ms`);
    if (sample && sample.operationsPerSecond < budget.minOpsPerSecond) reasons.push(`ops/s ${sample.operationsPerSecond} < ${budget.minOpsPerSecond}`);
    checks.push(Object.freeze({ name: budget.name, passed: reasons.length === 0, averageMs: sample?.averageMs ?? 0, operationsPerSecond: sample?.operationsPerSecond ?? 0, reasons }));
  }
  return Object.freeze(checks);
};

export const vectorFromIndex = (index: number): Vec3 => Object.freeze({ x: index % 97, y: Math.floor(index / 97) % 31, z: index % 53 });
export const chunkCenterFromCell = (x: number, z: number, cellSize = 64): Vec2 => Object.freeze({ x: x * cellSize + cellSize / 2, y: z * cellSize + cellSize / 2 });
