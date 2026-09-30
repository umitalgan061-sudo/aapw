import { describe, expect, it } from 'vitest';
import { StrictRuntimeHealthBudget } from '../../../src/3d/strict/runtimeHealthBudget.ts';

const sample = (frame: number, overrides: Partial<Parameters<StrictRuntimeHealthBudget['observe']>[0]> = {}) => ({
  frame,
  frameMs: 16,
  cpuMs: 7,
  gpuMs: 8,
  drawCalls: 220,
  triangles: 300_000,
  memoryPressure: 0.12,
  entityPressure: 0.1,
  assetBacklog: 2,
  networkJitterMs: 5,
  ...overrides,
});

describe('strict runtime health budget', () => {
  it('starts healthy for a bounded normal frame', () => {
    const health = new StrictRuntimeHealthBudget();
    const result = health.observe(sample(1));
    expect(result.state).toBe('healthy');
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.issueCount).toBe(0);
    expect(result.recoveryRecommended).toBe(false);
  });

  it('detects critical render pressure deterministically', () => {
    const health = new StrictRuntimeHealthBudget();
    const result = health.observe(sample(5, {
      frameMs: 60,
      cpuMs: 35,
      gpuMs: 42,
      drawCalls: 4_000,
      triangles: 6_000_000,
      memoryPressure: 1,
      entityPressure: 1,
      assetBacklog: 120,
      networkJitterMs: 160,
    }));
    expect(result.state).toBe('critical');
    expect(result.issueCount).toBe(9);
    expect(result.recoveryRecommended).toBe(true);
    expect(result.score).toBeLessThan(0.5);
  });

  it('captures per-metric deltas without wall-clock dependencies', () => {
    const health = new StrictRuntimeHealthBudget({ windowSize: 8 });
    health.observe(sample(10));
    const result = health.observe(sample(11, { frameMs: 30, cpuMs: 18 }));
    expect(result.issues.some(issue => issue.metric === 'frameMs' && issue.deltaFromPrevious === 14)).toBe(true);
    expect(result.issues.some(issue => issue.metric === 'cpuMs' && issue.deltaFromPrevious === 11)).toBe(true);
  });

  it('keeps history bounded and returns immutable snapshots', () => {
    const health = new StrictRuntimeHealthBudget({ windowSize: 4 });
    for (let frame = 1; frame <= 12; frame += 1) health.observe(sample(frame));
    expect(health.history()).toHaveLength(4);
    const latest = health.latest();
    expect(latest?.frame).toBe(12);
    expect(Object.isFrozen(latest)).toBe(true);
  });

  it('reports degradation trend while maintaining deterministic scoring', () => {
    const health = new StrictRuntimeHealthBudget({ windowSize: 8 });
    health.observe(sample(1));
    health.observe(sample(2, { frameMs: 24 }));
    const result = health.observe(sample(3, { frameMs: 32, memoryPressure: 0.9 }));
    expect(result.state).toBe('degraded');
    expect(result.trend).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  it('resets all state and restarts the healthy streak', () => {
    const health = new StrictRuntimeHealthBudget({ recoveryAfterHealthySamples: 2 });
    health.observe(sample(1, { frameMs: 30 }));
    health.observe(sample(2));
    health.observe(sample(3));
    expect(health.healthyStreak()).toBeGreaterThanOrEqual(2);
    health.reset();
    expect(health.latest()).toBeUndefined();
    expect(health.history()).toHaveLength(0);
    expect(health.healthyStreak()).toBe(0);
  });
});
