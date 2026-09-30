import { describe, expect, it } from 'vitest';
import { R16WorldInterest } from '../../../src/3d/modern/r16/worldInterest.js';
import { R16WorldStreamingPlanner } from '../../../src/3d/modern/r16/worldStreaming.js';

describe('R16 interest and streaming policy',()=>{
  it('separates active and sleeping entities',()=>{
    const interest=new R16WorldInterest({near:4,mid:4,far:4,sleeping:4});
    interest.upsert({id:'active',x:1,y:0,z:0,importance:1,active:true});
    interest.upsert({id:'inactive',x:1,y:0,z:0,importance:1,active:false});
    const decisions=interest.decide({x:0,y:0,z:0},{near:2,mid:5,far:10});
    expect(decisions.find(x=>x.band==='near')?.ids).toContain('active');
    expect(decisions.find(x=>x.band==='sleeping')?.ids).toContain('inactive');
  });
  it('never exceeds stream load caps',()=>{
    const planner=new R16WorldStreamingPlanner({maxCells:3,maxBytes:120,maxLoadsPerTick:1,maxUnloadsPerTick:1});
    for(let i=0;i<5;i++)planner.register({id:'c'+i,distance:i,importance:1-i*.1,bytes:20,lastRequestedTick:1,revision:1,residency:'queued',pinned:false});
    const plan=planner.plan(1);
    expect(plan.load).toHaveLength(1);
    expect(plan.bytes).toBeLessThanOrEqual(120);
  });
});
