import { describe, expect, it } from 'vitest';
import { RuntimeNetworkMonitor, classifyNetworkSample } from '../../../src/3d/modern/r28/networkMonitor.ts';

describe('R28 network monitoring', () => {
  it('classifies transport quality from bounded RTT and loss', () => {
    expect(classifyNetworkSample(10, 0)).toBe('excellent');
    expect(classifyNetworkSample(80, 0.02)).toMatch(/good|degraded/);
    expect(classifyNetworkSample(200, 0.4)).toBe('poor');
  });

  it('derives interpolation and redundancy recommendations from rolling evidence', () => {
    const monitor = new RuntimeNetworkMonitor(4);
    monitor.record({ tick: 1, rttMs: 20, lossRatio: 0, inboundBytes: 100, outboundBytes: 80 });
    monitor.record({ tick: 2, rttMs: 25, lossRatio: 0.01, inboundBytes: 100, outboundBytes: 90 });
    const report = monitor.report();
    expect(report.averageRttMs).toBeCloseTo(22.5);
    expect(report.recommendedInterpolationTicks).toBeGreaterThanOrEqual(1);
    expect(monitor.sampleCount()).toBe(2);
  });
});
