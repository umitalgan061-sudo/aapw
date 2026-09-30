import { describe, expect, it } from 'vitest';
import { R16FixedStepClock, R16FrameScheduler } from '../../../src/3d/modern/r16/frameScheduler.js';

describe('R16 frame scheduler', () => {
  it('caps catch-up steps and tracks dropped time', () => {
    const clock = new R16FixedStepClock(10, 2, 100);
    expect(clock.advance(35)).toHaveLength(2);
    expect(clock.tick).toBe(2);
    expect(clock.stats().simulatedMs).toBe(20);
    expect(clock.alpha).toBeGreaterThanOrEqual(0);
  });

  it('orders tasks by priority and defers work past the budget', () => {
    const scheduler = new R16FrameScheduler(8, [{ phase:'simulation',units:5,milliseconds:10,weight:1 }]);
    const seen:string[]=[];
    scheduler.enqueue({ id:'low',phase:'simulation',budget:'simulation',units:4,priority:1,enqueuedTick:1,expiresTick:10,payload:null,run:()=>{seen.push('low');return{ok:true,value:null};} });
    scheduler.enqueue({ id:'high',phase:'simulation',budget:'simulation',units:4,priority:10,enqueuedTick:1,expiresTick:10,payload:null,run:()=>{seen.push('high');return{ok:true,value:null};} });
    const result=scheduler.runPhase('simulation',2,16.6,()=>0);
    expect(seen).toEqual(['high']);
    expect(result.deferred).toContain('low');
  });
});
