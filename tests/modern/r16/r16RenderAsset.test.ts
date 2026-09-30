import { describe, expect, it } from 'vitest';
import { R16RenderBudgetBridge } from '../../../src/3d/modern/r16/renderBudgetBridge.js';
import { R16PerformanceGovernor } from '../../../src/3d/modern/r16/performanceGovernor.js';
import { R16AssetIntegrityRegistry } from '../../../src/3d/modern/r16/assetIntegrity.js';
import { digestValue } from '../../../src/3d/modern/r16/deterministic.js';

describe('R16 render and asset boundaries',()=>{
  it('reduces render capacity under pressure',()=>{
    const governor=new R16PerformanceGovernor();
    const performance=governor.evaluate({frameMs:40,cpuMs:20,gpuMs:20,memoryPressure:1,networkPressure:0,simulationPressure:1},2);
    const bridge=new R16RenderBudgetBridge();
    const decision=bridge.evaluate({frameMs:40,cpuMs:20,gpuMs:20,drawCalls:6000,triangles:4000000,textureBytes:200000000,memoryLimitBytes:200000000,effectMs:10},performance);
    expect(decision.visibleCap).toBeLessThan(4096);
    expect(decision.effectCap).toBeLessThan(9);
    expect(bridge.signalFromFrame({frameMs:10,cpuMs:4,gpuMs:4,drawCalls:1000,triangles:100000,textureBytes:10,memoryLimitBytes:100,effectMs:2}).memoryPressure).toBe(.1);
  });
  it('rejects unsafe asset bytes and protects the manifest',()=>{
    const registry=new R16AssetIntegrityRegistry();
    const bytes=[1,2,3,4];
    const digest=digestValue(bytes);
    expect(registry.register({id:'tree',url:'/assets/tree.glb',kind:'model',bytes:4,digest,required:true}).ok).toBe(true);
    expect(registry.validateBytes('tree',new Uint8Array(bytes)).accepted).toBe(true);
    expect(registry.validateBytes('tree',new Uint8Array([1,2,9,4])).accepted).toBe(false);
    expect(registry.register({id:'bad',url:'data:text/plain,evil',kind:'data',bytes:4,digest,required:false}).ok).toBe(false);
  });
});
