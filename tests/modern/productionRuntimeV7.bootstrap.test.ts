import { describe, expect, it } from 'vitest';
import {
  advanceProductionRuntimeV7, bootstrapProductionRuntimeV7, bootstrapSummaryV7,
  createConstrainedProductionRuntimeV7, createHeadlessProductionRuntimeV7, tickBudgetSecondsV7,
} from '../../src/3d/modern/production-v7/index.ts';

describe('production runtime v7 bootstrap', () => {
  it('creates a booted handle with deterministic tick progression', () => {
    const handle = bootstrapProductionRuntimeV7({ seed: 12 });
    expect(handle.phase()).toBe('running');
    expect(handle.tick()).toBe(0);
    const reports = advanceProductionRuntimeV7(handle, 1 / 60, 3);
    expect(reports).toHaveLength(3);
    expect(Number(handle.tick())).toBe(3);
    expect(bootstrapSummaryV7(handle).phase).toBe('running');
    handle.dispose();
    expect(handle.phase()).toBe('stopped');
  });

  it('supports headless and constrained entry profiles', () => {
    const headless = createHeadlessProductionRuntimeV7(22);
    const constrained = createConstrainedProductionRuntimeV7(22);
    expect(headless.mode()).toBe('headless');
    expect(constrained.mode()).toBe('constrained');
    headless.dispose();
    constrained.dispose();
  });

  it('derives fixed-step duration safely', () => {
    expect(tickBudgetSecondsV7(60)).toBeCloseTo(1 / 60);
    expect(() => tickBudgetSecondsV7(0)).toThrow();
  });
});
