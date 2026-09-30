import { describe, expect, it } from 'vitest';
import { R16CacheCoordinator } from '../../../src/3d/modern/r16/cacheCoordinator.js';
import { R16PerformanceGovernor } from '../../../src/3d/modern/r16/performanceGovernor.js';

describe('R16 performance governance', () => {
  it('degrades under sustained frame pressure and recovers only after hysteresis', () => {
    const governor=new R16PerformanceGovernor({hysteresisTicks:2});
    const first=governor.evaluate({frameMs:30,cpuMs:20,gpuMs:20,memoryPressure:0.2,networkPressure:0,simulationPressure:0},1);
    expect(first.tier).toBe('balanced');
    governor.evaluate({frameMs:5,cpuMs:2,gpuMs:2,memoryPressure:0,networkPressure:0,simulationPressure:0},2);
    const recovered=governor.evaluate({frameMs:5,cpuMs:2,gpuMs:2,memoryPressure:0,networkPressure:0,simulationPressure:0},3);
    expect(recovered.changed).toBe(true);
  });

  it('produces deterministic cache eviction plans', () => {
    const cache=new R16CacheCoordinator({maxBytes:100,maxItems:2,maxPinnedBytes:50});
    cache.register({id:'a',bytes:60,className:'texture',priority:10,lastUsedTick:1,pinned:false});
    cache.register({id:'b',bytes:60,className:'geometry',priority:5,lastUsedTick:2,pinned:false});
    const plan=cache.plan();
    expect(plan.retained).toHaveLength(1);
    expect(plan.evict).toHaveLength(1);
  });
});
