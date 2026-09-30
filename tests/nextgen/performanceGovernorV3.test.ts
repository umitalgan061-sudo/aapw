import { describe, expect, it } from 'vitest';
import { PerformanceGovernorV3 } from '../../src/3d/nextgen/performanceGovernorV3';

describe('performance governor', () => {
  it('downgrades after sustained frame pressure', () => {
    const governor = new PerformanceGovernorV3('high');
    for (let i = 0; i < 8; i += 1) governor.sample({ frameMs: 30, simulationMs: 12, renderMs: 15, memoryBytes: 300 * 1024 * 1024, entityCount: 1000 });
    expect(governor.state.quality).toBe('balanced');
    expect(governor.state.downgradeCount).toBe(1);
  });

  it('upgrades only after a sustained stable window', () => {
    const governor = new PerformanceGovernorV3('performance');
    for (let i = 0; i < 59; i += 1) governor.sample({ frameMs: 8, simulationMs: 2, renderMs: 4, memoryBytes: 100 * 1024 * 1024, entityCount: 400 });
    expect(governor.state.quality).toBe('performance');
    governor.sample({ frameMs: 8, simulationMs: 2, renderMs: 4, memoryBytes: 100 * 1024 * 1024, entityCount: 400 });
    expect(governor.state.quality).toBe('balanced');
  });

  it('supports explicit operator quality override', () => {
    const governor = new PerformanceGovernorV3();
    expect(governor.forceQuality('cinematic').quality).toBe('cinematic');
    expect(governor.forceQuality('battery').scale).toBeLessThan(1);
  });
});
