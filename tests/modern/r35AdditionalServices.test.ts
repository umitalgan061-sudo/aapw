import { describe, expect, it } from 'vitest';
import { createR35Clock } from '../../src/3d/nextgen/r35/deterministicClock';
import { createDefaultR35ResourceBudget } from '../../src/3d/nextgen/r35/resourceBudget';
import { createDefaultR35FeatureRegistry } from '../../src/3d/nextgen/r35/featureRegistry';

describe('R35 deterministic and capability services', () => {
  it('runs fixed steps with a bounded catch-up guard', () => {
    const clock = createR35Clock({ maxCatchUpSteps: 2 });
    const ticks: number[] = [];
    const result = clock.advance(0.2, (step) => ticks.push(step.tick));
    expect(ticks).toEqual([1, 2]);
    expect(result.droppedSeconds).toBeGreaterThan(0);
    expect(clock.tick).toBe(2);
  });

  it('restores a deterministic clock snapshot exactly', () => {
    const clock = createR35Clock();
    clock.advance(0.05, () => undefined);
    const snapshot = clock.snapshot();
    clock.advance(0.1, () => undefined);
    clock.restore(snapshot);
    expect(clock.snapshot()).toEqual(snapshot);
  });

  it('reserves and deterministically reclaims resource budget', () => {
    const budget = createDefaultR35ResourceBudget();
    expect(budget.reserve('simulation', { priority: 'critical', cpuMs: 2, memoryBytes: 1024, workItems: 2, tick: 1 })).not.toBeNull();
    expect(budget.reserve('simulation', { priority: 'low', cpuMs: 3, memoryBytes: 1024, workItems: 2, tick: 2 })).toBeNull();
    const available = budget.snapshot().availableCpuMs;
    expect(available).toBeGreaterThan(0);
  });

  it('resolves feature dependencies deterministically by seed', () => {
    const registry = createDefaultR35FeatureRegistry();
    const first = registry.resolve({ device: 'desktop', seed: 42 });
    const second = registry.resolve({ device: 'desktop', seed: 42 });
    expect(first).toEqual(second);
    expect(first.rollback).toBe(true);
  });
});
