import { describe,expect,it } from 'vitest';
import { R16DeterminismMonitor } from '../../../src/3d/modern/r16/determinismMonitor.js';
import { R16FaultInjector } from '../../../src/3d/modern/r16/faultInjection.js';

describe('R16 determinism and fault controls',()=>{
  it('detects mismatched digests and remains bounded',()=>{
    const monitor=new R16DeterminismMonitor({maxSamples:16,failFast:true});
    expect(monitor.compare(1,'a','a')).toBe(true);
    expect(monitor.compare(2,'a','b')).toBe(false);
    expect(monitor.blocked()).toBe(true);
    expect(monitor.report().mismatched).toBe(1);
    expect(()=>monitor.assertClean()).toThrow();
    monitor.reset();
    expect(monitor.report().mismatched).toBe(0);
  });
  it('keeps fault injection deterministic and capped',()=>{
    const faults=new R16FaultInjector(42);
    faults.arm({id:'network-drop',subsystem:'network',kind:'drop',probability:1,maxHits:2,message:'drop packet'});
    expect(faults.shouldInject('network-drop',1).value).toBeTruthy();
    expect(faults.shouldInject('network-drop',2).value).toBeTruthy();
    expect(faults.shouldInject('network-drop',3).value).toBeNull();
    expect(faults.stats().hits).toBe(2);
  });
});
