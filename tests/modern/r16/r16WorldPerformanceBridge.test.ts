import { describe,expect,it } from 'vitest';
import { R16RenderBudgetBridge } from '../../../src/3d/modern/r16/renderBudgetBridge.js';
import { R16PerformanceGovernor } from '../../../src/3d/modern/r16/performanceGovernor.js';

describe('R16 render budget bridge',()=>{
  it('maps a performance decision to bounded renderer caps',()=>{
    const governor=new R16PerformanceGovernor();
    const performance=governor.evaluate({frameMs:18,cpuMs:8,gpuMs:8,memoryPressure:.6,networkPressure:.2,simulationPressure:.1},1);
    const bridge=new R16RenderBudgetBridge();
    const decision=bridge.evaluate({frameMs:18,cpuMs:8,gpuMs:8,drawCalls:3000,triangles:1000000,textureBytes:100000000,memoryLimitBytes:200000000,effectMs:3},performance);
    expect(decision.visibleCap).toBeGreaterThanOrEqual(128);
    expect(decision.instanceCap).toBeGreaterThanOrEqual(64);
    expect(decision.renderScale).toBeGreaterThanOrEqual(.5);
  });
});
