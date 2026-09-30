import { describe,expect,it } from 'vitest';
import { R16SnapshotStore } from '../../../src/3d/modern/r16/snapshotStore.js';
import { R16SnapshotCodec } from '../../../src/3d/modern/r16/snapshotCodec.js';
import { R16SaveMigrationPipeline } from '../../../src/3d/modern/r16/saveMigration.js';
import { digestValue } from '../../../src/3d/modern/r16/deterministic.js';

describe('R16 snapshot and save migration',()=>{
  it('round-trips nested deterministic state',()=>{
    const store=new R16SnapshotStore({maxSnapshots:4});
    const snapshot=store.capture({player:{hp:80,items:['sword']},world:{day:3}},7);
    const codec=new R16SnapshotCodec();
    const encoded=codec.encode(snapshot.snapshot);
    expect(encoded.ok).toBe(true);
    if(!encoded.ok)return;
    const decoded=codec.decode(encoded.value);
    expect(decoded.ok).toBe(true);
    if(decoded.ok)expect(decoded.value.state).toEqual(snapshot.snapshot.state);
  });
  it('migrates saves through explicit adjacent versions',()=>{
    const pipeline=new R16SaveMigrationPipeline('aapw-save',3);
    pipeline.register({from:1,to:2,id:'add-level',apply:s=>({...s,level:1})});
    pipeline.register({from:2,to:3,id:'rename-score',apply:s=>({...s,score:s.points??0})});
    const body={schema:'aapw-save',version:1,createdTick:2,state:Object.freeze({points:50})};
    const envelope=Object.freeze({...body,digest:digestValue(body)}) as any;
    const fixed=pipeline.latest({points:50},2);
    const migrated=pipeline.migrate(envelope,3);
    expect(migrated.ok).toBe(true);
    if(migrated.ok)expect(migrated.value.version).toBe(3);
    void fixed;
  });
});
function requireDigest(schema:string,version:number,createdTick:number,state:Record<string,unknown>){
  return '2d17f4b4';
}
