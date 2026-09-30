import { describe, expect, it } from 'vitest';
import { R16RuntimeAdapter } from '../../../src/3d/modern/r16/runtimeAdapter.js';

function adapter() {
  let mounted = false;
  let applied = 0;
  return {
    mount: () => {
      mounted = true;
      return { ok: true as const, value: undefined };
    },
    unmount: () => {
      mounted = false;
      return { ok: true as const, value: undefined };
    },
    applyPhase: () => {
      applied += 1;
      return { ok: mounted, ...(mounted ? { value: undefined } : { error: { code: 'NOT_MOUNTED', message: 'no mount', retryable: false } }) } as const;
    },
    metrics: () => ({ visibleEntities: applied * 10, activeEffects: 2, residentBytes: 1024 }),
  };
}

describe('R16 presentation adapter',()=>{
  it('requires an explicit mounted lifecycle',()=>{
    const runtime=new R16RuntimeAdapter(adapter());
    expect(runtime.renderPacket(1,{frame:1}).ok).toBe(false);
    expect(runtime.mount().ok).toBe(true);
    expect(runtime.renderPacket(1,{frame:1}).ok).toBe(true);
    expect(runtime.sceneState().lastAppliedTick).toBe(1);
  });

  it('rejects stale scene ticks and reports adapter pressure',()=>{
    const runtime=new R16RuntimeAdapter(adapter());
    runtime.mount();
    runtime.apply({phase:'render',tick:4,payload:{ok:true}});
    expect(runtime.apply({phase:'render',tick:3,payload:{ok:true}}).ok).toBe(false);
    expect(runtime.stats().rejections).toBe(1);
  });

  it('is deterministic for equivalent metrics',()=>{
    const runtime=new R16RuntimeAdapter(adapter());
    runtime.mount();
    runtime.apply({phase:'render',tick:1,payload:{frame:1}});
    const first=runtime.sceneState();
    runtime.resetCounters();
    const second=runtime.sceneState();
    expect(first.visibleEntities).toBe(second.visibleEntities);
    expect(first.digest).toBe(second.digest);
  });
});
