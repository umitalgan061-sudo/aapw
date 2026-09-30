import { describe,expect,it } from 'vitest';
import { createR16Runtime } from '../../../src/3d/modern/r16/runtime.js';
import { R16CommandBus } from '../../../src/3d/modern/r16/commandBus.js';
import { R16BudgetScheduler } from '../../../src/3d/modern/r16/budgetScheduler.js';

describe('R16 deterministic stress',()=>{
  it('remains stable across repeated 256-frame replay runs',()=>{
    const runtime=createR16Runtime({seed:1234});
    const a=runtime.verifyDeterministicReplay(256);
    const b=createR16Runtime({seed:1234}).verifyDeterministicReplay(256);
    expect(a.ok).toBe(true);expect(b.ok).toBe(true);
    if(a.ok&&b.ok)expect(a.value).toBe(b.value);
  });
  it('bounds command throughput at a fixed tick',()=>{
    const bus=new R16CommandBus({seed:1,maxCommandsPerTick:16});
    bus.register({topic:'noop',apply:()=>({ok:true,value:null})});
    for(let i=0;i<64;i++)bus.enqueue('noop',{i},1,'engine',i);
    expect(bus.tick(1)).toHaveLength(16);
    expect(bus.stats().queued).toBe(0);
  });
  it('keeps budget sampling bounded over repeated pressure',()=>{
    const scheduler=new R16BudgetScheduler({maxWorkItemsPerBudget:64});
    for(let tick=1;tick<=128;tick++){
      scheduler.enqueue({id:'w'+tick,budget:'simulation',units:8,priority:tick%4,enqueuedTick:tick,expiresTick:tick+4,payload:null});
      scheduler.consume('simulation',tick,1);
    }
    expect(scheduler.samples(10000).length).toBeLessThanOrEqual(4096);
    expect(scheduler.digest().length).toBeGreaterThan(0);
  });
});
