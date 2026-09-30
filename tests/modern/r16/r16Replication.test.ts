import { describe,expect,it } from 'vitest';
import { R16ReplicationLedger } from '../../../src/3d/modern/r16/replication.js';

const base={entityId:'npc-1',revision:1,authority:'authoritative' as const,position:[1,2,3] as [number,number,number],components:{health:100,state:'idle'}};
describe('R16 replication',()=>{
  it('accepts monotonic revisions',()=>{
    const ledger=new R16ReplicationLedger({maxReplicationEntities:8,maxReplicationDeltasPerTick:8,maxReplicationBytesPerTick:10000});
    expect(ledger.upsert(base).ok).toBe(true);expect(ledger.upsert({...base,revision:1}).ok).toBe(false);expect(ledger.upsert({...base,revision:2}).ok).toBe(true);
  });
  it('protects deltas with checksums',()=>{
    const ledger=new R16ReplicationLedger({maxReplicationEntities:8,maxReplicationDeltasPerTick:4,maxReplicationBytesPerTick:10000});ledger.upsert(base);ledger.beginTick(4);
    const delta=ledger.delta('npc-1',{health:80},[]);expect(delta.ok).toBe(true);if(!delta.ok)return;expect(ledger.accept(delta.value).rejected).toBe(false);
    expect(ledger.accept({...delta.value,changed:{health:1}}).rejected).toBe(true);
  });
});
