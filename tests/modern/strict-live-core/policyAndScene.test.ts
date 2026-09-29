import { describe, expect, it } from 'vitest';
import { StrictSceneRuntime } from '../../../src/3d/strict/sceneRuntime.ts';
import { DEFAULT_STRICT_LIVE_CORE_POLICY, effectiveRenderScale, recommendPolicy, validateCorePolicy, validateObservation } from '../../../src/3d/strict/strictLiveCorePolicy.ts';

const policy=DEFAULT_STRICT_LIVE_CORE_POLICY;

describe('policy and scene runtime', () => {
  it('accepts the canonical strict policy',()=>expect(validateCorePolicy(policy)).toHaveLength(0));
  it('detects impossible sub-budgets',()=>expect(validateCorePolicy({...policy,budgets:{...policy.budgets,frameMs:10}}).length).toBeGreaterThan(0));
  it('validates memory and command budgets',()=>{
    const valid=validateObservation({frameTimeMs:10,memoryBytes:100,networkBytesPerSecond:100,thermalPressure:0,droppedInputs:0,backendLost:false,commandsThisFrame:1},policy);
    expect(valid.ok).toBe(true);
    const invalid=validateObservation({frameTimeMs:10,memoryBytes:policy.budgets.memoryBytes+1,networkBytesPerSecond:100,thermalPressure:0,droppedInputs:0,backendLost:false,commandsThisFrame:1},policy);
    expect(invalid.ok).toBe(false);
  });
  it('recommends bounded degradation under pressure',()=>{
    const recommendations=recommendPolicy({frameTimeMs:25,memoryBytes:policy.budgets.memoryBytes*.95,networkBytesPerSecond:policy.budgets.networkBytesPerSecond*.5,thermalPressure:.2,droppedInputs:12,backendLost:true,commandsThisFrame:1},policy);
    expect(recommendations.some(item=>item.action==='enter-recovery')).toBe(true); expect(effectiveRenderScale(1,recommendations)).toBeLessThan(1);
  });
  it('tracks visibility and lifecycle transitions',()=>{
    const scene=new StrictSceneRuntime({width:1280,height:720,pixelRatio:1},policy.renderDefaults);
    expect(scene.transition('initializing','boot').ok).toBe(true); expect(scene.transition('ready','resources-ready').ok).toBe(true); expect(scene.transition('running','user-start').ok).toBe(true);
    const hidden=scene.setVisibility(true); expect(hidden.ok).toBe(true); if(!hidden.ok)return; expect(hidden.value).toBe('paused');
    const visible=scene.setVisibility(false); expect(visible.ok).toBe(true); if(!visible.ok)return; expect(visible.value).toBe('running');
    const frame=scene.frame(.2,{simulationMs:2,renderMs:4,inputMs:.2,assetMs:.4,telemetryMs:.1},1); expect(frame.ok).toBe(true); if(!frame.ok)return;
    expect(frame.value.deltaSeconds).toBe(.1); expect(scene.latest()?.frame).toBe(frame.value.id);
  });
  it('rejects illegal lifecycle transitions',()=>{
    const scene=new StrictSceneRuntime({width:1280,height:720,pixelRatio:1},policy.renderDefaults);
    expect(scene.transition('running','skip-ready').ok).toBe(false);
  });
  it('normalizes resize and bounds history',()=>{
    const scene=new StrictSceneRuntime({width:1,height:1,pixelRatio:10},policy.renderDefaults,{maxDeltaSeconds:.1,pauseWhenHidden:true,maxTransitions:64,maxFrameHistory:2});
    expect(scene.viewport()).toEqual({width:1,height:1,pixelRatio:3});
    scene.transition('initializing','boot'); scene.transition('ready','ready'); scene.transition('running','run');
    for(let i=0;i<3;i+=1)scene.frame(.01,{simulationMs:0,renderMs:0,inputMs:0,assetMs:0,telemetryMs:0},0);
    expect(scene.diagnostics().historyLength).toBe(2);
  });
});