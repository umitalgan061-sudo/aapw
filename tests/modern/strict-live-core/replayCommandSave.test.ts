import { describe, expect, it } from 'vitest';
import { StrictReplayRuntime } from '../../../src/3d/strict/replayRuntime.ts';
import { StrictCommandRuntime } from '../../../src/3d/strict/commandRuntime.ts';
import { MemorySaveStorage, StrictSaveRuntime } from '../../../src/3d/strict/saveRuntime.ts';
import { entityId, tickId, frameId, vec3 } from '../../../src/3d/strict/liveCoreTypes.ts';

describe('replay, command and save runtimes', () => {
  it('records monotonic replay commands', () => {
    const replay=new StrictReplayRuntime();
    expect(replay.append(1,1,{source:'keyboard',held:['move']})).not.toBeNull();
    expect(replay.append(2,2,{source:'keyboard',pressed:['jump']})).not.toBeNull();
    expect(replay.append(3,2,{source:'keyboard'})).toBeNull();
    expect(replay.verify().ok).toBe(true);
  });
  it('creates and selects a checkpoint', () => {
    const replay=new StrictReplayRuntime();
    const snapshot={
      frame:frameId(10), tick:tickId(10), phase:'running' as const,
      player:{entity:entityId('p'),position:vec3(),velocity:vec3(),radius:.4,height:1.8,onGround:true,groundedMaterial:'grass'},
      camera:{mode:'explore' as const,distance:9,height:2.8,shoulder:1 as const,fov:65,sensitivity:1,recenter:false,cameraCut:false,position:vec3(0,3,9),lookAt:vec3(0,1,0),velocity:vec3()},
      jump:{heightAboveGround:0,verticalVelocity:0,grounded:true,coyoteRemaining:.1},digest:'checkpoint',
    };
    replay.checkpoint(snapshot); expect(replay.nearestCheckpoint(10)?.snapshot).toBe(snapshot);
  });
  it('creates deterministic replay branches', () => {
    const replay=new StrictReplayRuntime(); replay.append(1,1,{source:'keyboard',held:['move']}); replay.append(2,2,{source:'keyboard',pressed:['light']});
    const branch=replay.createBranch('alt',1); expect(branch).toHaveLength(1); expect(replay.branch('alt')).toEqual(branch); expect(replay.branchAppend('alt',3,3,{source:'keyboard',pressed:['heavy']})).not.toBeNull();
  });
  it('accepts ordered commands and rejects stale sequences', () => {
    const runtime=new StrictCommandRuntime();
    const first=runtime.submit({sequence:1,tick:1,actor:entityId('p'),kind:'move',payload:{x:1,z:0}});
    expect('accepted' in first&&first.accepted).toBe(true);
    const stale=runtime.submit({sequence:1,tick:1,actor:entityId('p'),kind:'move',payload:{x:2,z:0}});
    expect('accepted' in stale&&!stale.accepted&&stale.reason==='sequence').toBe(true);
  });
  it('verifies command checksums and actor filters', () => {
    const runtime=new StrictCommandRuntime(); const admission=runtime.submit({sequence:1,tick:1,actor:entityId('p'),kind:'combat',payload:{damage:20}});
    expect('command' in admission&&admission.command).toBeDefined(); if(!('command' in admission)||!admission.command)return;
    expect(runtime.verify(admission.command)).toBe(true); expect(runtime.byActor(entityId('p'))).toHaveLength(1); expect(runtime.verifyAll()).toBe(true);
  });
  it('saves, loads and migrates data', async () => {
    const storage=new MemorySaveStorage();
    const runtime=new StrictSaveRuntime(storage,{keyPrefix:'test.',maxBytes:100_000,maxSchemaLength:64,build:'test',currentVersion:2});
    runtime.registerMigration({from:1,to:2,migrate:payload=>({...payload as {score:number},migrated:true})});
    const oldRuntime=new StrictSaveRuntime(storage,{keyPrefix:'test.',maxBytes:100_000,maxSchemaLength:64,build:'test',currentVersion:1});
    expect((await oldRuntime.save('slot',{score:10},1)).ok).toBe(true);
    const loaded=await runtime.load<{score:number;migrated:boolean}>('slot'); expect(loaded.ok).toBe(true); if(!loaded.ok||!loaded.value.ok)return;
    expect(loaded.value.value).toEqual({score:10,migrated:true});
  });
  it('rejects a tampered envelope', async () => {
    const runtime=new StrictSaveRuntime(new MemorySaveStorage()); const saved=await runtime.save('slot',{score:10},1); expect(saved.ok).toBe(true); if(!saved.ok)return;
    expect(runtime.validateEnvelope({...saved.value,payload:{score:999}}).ok).toBe(false);
  });
});