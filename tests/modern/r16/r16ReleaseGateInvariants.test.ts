import { describe,expect,it } from 'vitest';
import { R16MigrationLedger } from '../../../src/3d/modern/r16/migrationAudit.js';
import { R16WorldStreamingPlanner } from '../../../src/3d/modern/r16/worldStreaming.js';

describe('R16 release gate invariants',()=>{
  it('blocks promotion after a failed parity result',()=>{
    const ledger=new R16MigrationLedger();
    ledger.register({id:'render',owner:'renderer',legacyPath:'render.js',modernPath:'render.ts'});
    ledger.record('render',false,'contract mismatch');
    expect(ledger.promote('render')).toBe(false);
    expect(ledger.audit().blocked).toBe(1);
  });

  it('keeps streaming plans deterministic for identical state',()=>{
    const make=()=>{
      const p=new R16WorldStreamingPlanner({maxCells:2,maxBytes:100,maxLoadsPerTick:2,maxUnloadsPerTick:1});
      p.register({id:'a',distance:2,importance:.7,bytes:30,lastRequestedTick:5,revision:1,residency:'queued',pinned:false});
      p.register({id:'b',distance:4,importance:.6,bytes:30,lastRequestedTick:5,revision:1,residency:'queued',pinned:false});
      return p.plan(5).digest;
    };
    expect(make()).toBe(make());
  });
});
