import { describe,expect,it } from 'vitest';
import { R16WorldStreamingPlanner } from '../../../src/3d/modern/r16/worldStreaming.js';
import { R16ReplayVerifier } from '../../../src/3d/modern/r16/replayVerifier.js';
import { R16SecurityAuditLog } from '../../../src/3d/modern/r16/securityAudit.js';

describe('R16 world and audit systems',()=>{
  it('selects requested streaming cells inside bounded budgets',()=>{
    const planner=new R16WorldStreamingPlanner({maxCells:2,maxBytes:100,maxLoadsPerTick:2,maxUnloadsPerTick:1});
    planner.register({id:'near',distance:1,importance:1,bytes:40,lastRequestedTick:1,revision:1,residency:'queued',pinned:false});
    planner.register({id:'far',distance:10,importance:.1,bytes:40,lastRequestedTick:0,revision:1,residency:'unloaded',pinned:false});
    planner.request('near',2);
    const plan=planner.plan(2);
    expect(plan.load).toEqual(['near']);
  });
  it('detects replay mismatches deterministically',()=>{
    const verifier=new R16ReplayVerifier();
    const expected=[{index:1,tick:1,digest:'a'}] as any;
    const actual=[{index:1,tick:1,digest:'b'}] as any;
    expect(verifier.compare(expected,actual).accepted).toBe(false);
    expect(verifier.verifyMonotonic(expected)).toBe(true);
  });
  it('summarizes security findings',()=>{
    const audit=new R16SecurityAuditLog();
    audit.record('x','warn','network','rate limit',4);
    audit.record('y','block','save','digest mismatch',5);
    expect(audit.audit().warn).toBe(1);
    expect(audit.audit().block).toBe(1);
  });
});
