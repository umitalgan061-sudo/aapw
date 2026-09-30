import { describe, expect, it } from 'vitest';
import { StrictLiveCoreRuntime } from '../../../src/3d/strict/liveCoreRuntime.ts';
import { StrictLegacyLiveCoreBridge } from '../../../src/3d/strict/liveCoreBridge.ts';
import { vec3 } from '../../../src/3d/strict/liveCoreTypes.ts';

const ground={sampleHeight:()=>0,sampleNormal:()=>vec3(0,1,0),sampleMaterial:()=> 'grass'};

describe('composed live core runtime', () => {
  it('initializes and starts through typed lifecycle', () => {
    const runtime=new StrictLiveCoreRuntime({groundSampler:ground});
    expect(runtime.initialize().ok).toBe(true); expect(runtime.start().ok).toBe(true);
    expect(runtime.transitions().map(t=>t.from+'->'+t.to)).toEqual(['created->initializing','initializing->ready','ready->running']);
  });
  it('normalizes input and advances fixed-step simulation', () => {
    const runtime=new StrictLiveCoreRuntime({groundSampler:ground}); runtime.start();
    expect(runtime.submitInput({source:'keyboard',moveX:1,timestampSeconds:1}).ok).toBe(true);
    const tick=runtime.tick({deltaSeconds:1/60,timestampSeconds:1,movement:vec3(1,0,0),cameraTarget:{position:vec3(0,1,0),lookAt:vec3(0,1.2,0),yaw:0,pitch:.45}});
    expect(tick.ok).toBe(true); if(!tick.ok)return; expect(tick.value.diagnostics.simulationSteps).toBeGreaterThanOrEqual(1); expect(tick.value.diagnostics.backend).toBe('webgl2');
  });
  it('round-trips a valid snapshot', () => {
    const runtime=new StrictLiveCoreRuntime({groundSampler:ground}); runtime.start(); runtime.tick({deltaSeconds:1/60,timestampSeconds:1});
    const snapshot=runtime.snapshot(); expect(snapshot.ok).toBe(true); if(!snapshot.ok)return;
    expect(runtime.restore(snapshot.value).ok).toBe(true);
    const restored=runtime.snapshot(); expect(restored.ok).toBe(true); if(!restored.ok)return;
    expect(restored.value.digest).toBe(snapshot.value.digest);
  });
  it('pauses simulation without advancing the frame', () => {
    const runtime=new StrictLiveCoreRuntime({groundSampler:ground}); runtime.start(); runtime.pause();
    const result=runtime.tick({deltaSeconds:.5,timestampSeconds:1,movement:vec3(10,0,0)}); expect(result.ok).toBe(true); if(!result.ok)return;
    const frame=result.value.frame; expect(frame.ok).toBe(true); if(!frame.ok)return; expect(frame.value.deltaSeconds).toBe(0);
  });
  it('falls back from WebGPU after device loss', () => {
    const runtime=new StrictLiveCoreRuntime({groundSampler:ground,capabilities:{secureContext:true,webgpu:true,webgl2:true,offscreenCanvas:true,hardwareConcurrency:8,memoryGiB:8,devicePixelRatio:1}});
    expect(runtime.requestRendererPreference({backend:'webgpu',quality:'high'}).ok).toBe(true);
    const policy=runtime.markDeviceLost(); expect(policy.ok).toBe(true); if(policy.ok)expect(policy.value.backend).toBe('webgl2');
  });
  it('bridges legacy keyboard state to typed input', () => {
    const bridge=new StrictLegacyLiveCoreBridge({});
    const result=bridge.submitLegacyInput({input:{getAxes:()=>({forward:1,strafe:.25,running:true,guarding:true,jumpRequested:true})}},1);
    expect(result.ok).toBe(true); if(!result.ok)return; expect(result.value.held.has('sprint')).toBe(true); expect(result.value.pressed.has('jump')).toBe(true);
  });
  it('bridges gamepad state to semantic actions', () => {
    const bridge=new StrictLegacyLiveCoreBridge({});
    const result=bridge.submitGamepad({connected:true,mapping:'standard',axes:[1,0,0,0],buttons:Array.from({length:12},(_,index)=>({pressed:index===2,value:index===2?1:0}))},1);
    expect(result.ok).toBe(true); if(!result.ok)return; expect(result.value.held.has('light')).toBe(true);
  });
  it('disposes all composed subsystems', () => {
    const runtime=new StrictLiveCoreRuntime({groundSampler:ground}); runtime.start(); runtime.dispose();
    const result=runtime.tick({deltaSeconds:.016,timestampSeconds:1}); expect(result.ok).toBe(false); if(!result.ok)expect(result.error.code).toBe('RUNTIME_DISPOSED');
  });
});