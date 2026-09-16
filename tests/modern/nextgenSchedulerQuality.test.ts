import { describe, expect, it } from 'vitest';
import { DeterministicScheduler, createSystem } from '../../src/3d/modern/nextgen/scheduler.ts';
import { AdaptiveQualityController, resolveQualityProfile } from '../../src/3d/modern/nextgen/qualityProfile.ts';
import { RuntimeMetricWindow, emptyMetrics } from '../../src/3d/modern/nextgen/metrics.ts';
import { tickValue } from '../../src/3d/modern/nextgen/types.ts';

describe('nextgen scheduler and quality', () => {
  it('orders systems by phase and priority', () => {
    const order: string[] = [];
    const scheduler = new DeterministicScheduler({ systems: [
      createSystem('low', 'simulation', () => order.push('low'), { priority: 1 }),
      createSystem('high', 'simulation', () => order.push('high'), { priority: 20 }),
      createSystem('input', 'input', () => order.push('input'), { priority: 100 }),
    ] });
    scheduler.runTick(tickValue(1), 1 / 60, () => 1);
    expect(order).toEqual(['input', 'high', 'low']);
  });

  it('bounds command and event queues', () => {
    const scheduler = new DeterministicScheduler({ systems: [], maxCommandsPerTick: 2, maxEventsPerTick: 1 });
    expect(scheduler.dispatch('a', 1)).toBe(true);
    expect(scheduler.dispatch('b', 2)).toBe(true);
    expect(scheduler.dispatch('c', 3)).toBe(false);
    expect(scheduler.emit('event', 1)).toBe(true);
    expect(scheduler.emit('event', 2)).toBe(false);
    expect(scheduler.consumeCommands()).toHaveLength(2);
    expect(scheduler.consumeEvents()).toHaveLength(1);
  });

  it('detects quality tiers from device capability signals', () => {
    const mobile = resolveQualityProfile({ coarsePointer: true, hardwareConcurrency: 8, deviceMemoryGb: 8, pixelRatio: 2, supportsWebGPU: true, reducedMotion: false });
    const desktop = resolveQualityProfile({ coarsePointer: false, hardwareConcurrency: 16, deviceMemoryGb: 16, pixelRatio: 1, maxTextureSize: 8192, supportsWebGPU: true, reducedMotion: false });
    expect(mobile.tier).toBe('mobile');
    expect(desktop.tier).toBe('ultra');
    expect(mobile.maxVisibleEntities).toBeLessThan(desktop.maxVisibleEntities);
  });

  it('adapts quality under sustained frame pressure', () => {
    const profile = resolveQualityProfile({ coarsePointer: false, hardwareConcurrency: 8, deviceMemoryGb: 8, pixelRatio: 1.5, maxTextureSize: 4096, supportsWebGPU: false, reducedMotion: false });
    const controller = new AdaptiveQualityController(profile);
    const before = controller.profile.renderScale;
    controller.observe(42);
    controller.observe(42);
    expect(controller.profile.renderScale).toBeLessThanOrEqual(before);
  });

  it('computes rolling health and percentiles', () => {
    const window = new RuntimeMetricWindow({ capacity: 5 });
    for (let index = 1; index <= 5; index += 1) {
      window.record(tickValue(index), { ...emptyMetrics(), frameTimeMs: index * 4, simulationTimeMs: index });
    }
    expect(window.averages().frameTimeMs).toBe(12);
    expect(window.percentile('frameTimeMs', 0.5)).toBe(12);
    expect(window.health().status).toMatch(/healthy|degraded|critical/);
    expect(window.digest()).toBeTypeOf('number');
  });
});
