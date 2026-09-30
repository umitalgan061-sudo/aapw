import { describe, expect, it } from 'vitest';
import { R16CacheCoordinator } from '../../../src/3d/modern/r16/cacheCoordinator.js';
import { R16FixedStepClock } from '../../../src/3d/modern/r16/frameScheduler.js';

describe('R16 cache and frame statistics',()=>{
  it('evicts non-pinned data when the residency budget is full',()=>{
    const cache=new R16CacheCoordinator({maxBytes:100,maxItems:4,maxPinnedBytes:50});
    cache.register({id:'pinned',bytes:40,className:'texture',priority:100,lastUsedTick:10,pinned:true});
    cache.register({id:'large',bytes:80,className:'geometry',priority:90,lastUsedTick:9,pinned:false});
    cache.register({id:'small',bytes:20,className:'audio',priority:10,lastUsedTick:1,pinned:false});
    const plan=cache.plan();
    expect(plan.retained).toContain('pinned');
    expect(plan.evict.length).toBeGreaterThanOrEqual(1);
  });
  it('reports accumulated fixed-step statistics',()=>{
    const clock=new R16FixedStepClock(10,4,100);
    clock.advance(35);
    const stats=clock.stats();
    expect(stats.tick).toBe(3);
    expect(stats.simulatedMs).toBe(30);
    expect(stats.alpha).toBeGreaterThanOrEqual(0);
  });
});
