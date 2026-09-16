import { describe, expect, it } from 'vitest';
import { HealthWindowV2, scoreRuntimeHealth } from '../../src/3d/modern/healthScoringV2.ts';

describe('health scoring v2', () => {
  it('grades a healthy runtime without recommendations', () => {
    const score = scoreRuntimeHealth({ frameTimeMs: 12, gpuTimeMs: 8, droppedFrames: 0, residentBytes: 100, memoryBudgetBytes: 1000, networkRttMs: 30, networkLoss01: 0, activeEntities: 100, entityBudget: 1000 });
    expect(score.score).toBeGreaterThanOrEqual(90);
    expect(score.recommendations).toHaveLength(0);
  });

  it('surfaces actionable performance recommendations', () => {
    const score = scoreRuntimeHealth({ frameTimeMs: 55, gpuTimeMs: 45, droppedFrames: 50, residentBytes: 950, memoryBudgetBytes: 1000, networkRttMs: 500, networkLoss01: 0.2, activeEntities: 1900, entityBudget: 1000 });
    expect(score.grade).toBe('critical');
    expect(score.recommendations.length).toBeGreaterThanOrEqual(3);
  });

  it('maintains bounded rolling health history', () => {
    const window = new HealthWindowV2(3);
    const sample = { frameTimeMs: 16, gpuTimeMs: 10, droppedFrames: 0, residentBytes: 100, memoryBudgetBytes: 1000, networkRttMs: 20, networkLoss01: 0, activeEntities: 20, entityBudget: 100 };
    window.push(sample); window.push(sample); window.push(sample); window.push({ ...sample, frameTimeMs: 40 });
    expect(window.snapshot().samples).toHaveLength(3);
    expect(window.latest()?.frameTimeMs).toBe(40);
    expect(window.average()?.score).toBeDefined();
  });
});
