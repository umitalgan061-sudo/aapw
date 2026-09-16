import { describe, expect, it } from 'vitest';
import { checkBenchmarkBudgets, runRuntimeBenchmarks } from '../../src/3d/modern/runtimeBenchmarksV2.ts';
import { scoreRuntimeHealth } from '../../src/3d/modern/healthScoringV2.ts';

describe('runtime budget contracts v2', () => {
  it('keeps benchmark reports structurally complete', () => {
    const report = runRuntimeBenchmarks({ now: () => 0 });
    expect(report.revision).toBe('v2');
    expect(report.samples).toHaveLength(3);
    for (const sample of report.samples) {
      expect(sample.iterations).toBeGreaterThan(0);
      expect(sample.averageMs).toBeGreaterThanOrEqual(0);
      expect(sample.operationsPerSecond).toBeGreaterThanOrEqual(0);
      expect(sample.digest).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('reports explicit budget failures rather than hiding them', () => {
    const report = runRuntimeBenchmarks({ now: () => 0 });
    const checks = checkBenchmarkBudgets(report, [
      { name: 'spatial-hash-upsert-query-remove', maxAverageMs: 0, minOpsPerSecond: Number.MAX_SAFE_INTEGER },
      { name: 'weighted-navigation-bounded-a-star', maxAverageMs: 0, minOpsPerSecond: Number.MAX_SAFE_INTEGER },
      { name: 'deterministic-digest', maxAverageMs: 0, minOpsPerSecond: Number.MAX_SAFE_INTEGER },
    ]);
    expect(checks.every((check) => !check.passed)).toBe(true);
    expect(checks.every((check) => check.reasons.length > 0)).toBe(true);
  });

  it('keeps health score bounded for pathological input', () => {
    const score = scoreRuntimeHealth({ frameTimeMs: Number.NaN, gpuTimeMs: Number.POSITIVE_INFINITY, droppedFrames: -4, residentBytes: -100, memoryBudgetBytes: 0, networkRttMs: Number.NaN, networkLoss01: 2, activeEntities: -1, entityBudget: 0 });
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(['excellent', 'good', 'degraded', 'critical']).toContain(score.grade);
  });
});
