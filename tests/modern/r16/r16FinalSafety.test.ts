import { describe, expect, it } from 'vitest';
import { R16DeterminismMonitor } from '../../../src/3d/modern/r16/determinismMonitor.js';
import { R16FaultInjector } from '../../../src/3d/modern/r16/faultInjection.js';

describe('R16 final safety invariants',()=>{
  it('keeps determinism samples capped and sorted by insertion order',()=>{
    const monitor=new R16DeterminismMonitor({maxSamples:16});
    for(let tick=0;tick<64;tick+=1)monitor.compare(tick,'same','same');
    const report=monitor.report();
    expect(report.samples).toHaveLength(16);
    expect(report.mismatched).toBe(0);
    expect(report.firstMismatchTick).toBeNull();
  });

  it('does not exceed configured fault hit caps',()=>{
    const injector=new R16FaultInjector(9);
    injector.arm({id:'drop',subsystem:'network',kind:'drop',probability:1,maxHits:3,message:'drop'});
    for(let tick=1;tick<=20;tick+=1)injector.shouldInject('drop',tick);
    expect(injector.hits(100)).toHaveLength(3);
    expect(injector.stats().byKind.drop).toBe(3);
  });

  it('stays usable after reset',()=>{
    const injector=new R16FaultInjector(11);
    injector.arm({id:'reject',subsystem:'input',kind:'reject',probability:1,maxHits:1,message:'reject'});
    expect(injector.shouldInject('reject',1).value).toBeTruthy();
    injector.reset();
    expect(injector.hits()).toHaveLength(0);
    expect(injector.shouldInject('reject',2).value).toBeTruthy();
  });
});
