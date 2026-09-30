import { describe,expect,it } from 'vitest';
import { R16SaveMigrationPipeline } from '../../../src/3d/modern/r16/saveMigration.js';
import { R16SnapshotCodec } from '../../../src/3d/modern/r16/snapshotCodec.js';
import { digestValue } from '../../../src/3d/modern/r16/deterministic.js';

describe('R16 codec and migration contracts',()=>{
  it('rejects tampered encoded snapshots',()=>{
    const codec=new R16SnapshotCodec();
    const snapshot={version:16 as const,revision:1,tick:2,state:Object.freeze({value:7}),digest:'unused',createdAtTick:2};
    const encoded=codec.encode(snapshot);expect(encoded.ok).toBe(true);if(!encoded.ok)return;
    const tampered={...encoded.value,payload:encoded.value.payload.replace('7','8')};
    expect(codec.decode(tampered).ok).toBe(false);
  });
  it('migrates a valid v1 save through adjacent steps',()=>{
    const pipeline=new R16SaveMigrationPipeline('aapw-save',3);
    pipeline.register({from:1,to:2,id:'add-level',apply:s=>({...s,level:1})});
    pipeline.register({from:2,to:3,id:'rename-points',apply:s=>({...s,score:s.points??0})});
    const state={points:50};
    const body={schema:'aapw-save',version:1,createdTick:2,state};
    const envelope={...body,digest:digestValue(body)} as any;
    const result=pipeline.migrate(envelope,3);
    expect(result.ok).toBe(true);if(result.ok)expect(result.value.state.score).toBe(50);
  });
});
