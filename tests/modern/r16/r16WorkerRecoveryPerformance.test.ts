import { describe,expect,it } from 'vitest';
import { R16WorkerScheduler } from '../../../src/3d/modern/r16/workerScheduler.js';
import { R16RecoveryCoordinator } from '../../../src/3d/modern/r16/recovery.js';
import { R16PerformanceGovernor } from '../../../src/3d/modern/r16/performanceGovernor.js';

describe('R16 resilience controls',()=>{
  it('dispatches only within registered concurrency',()=>{
    const workers=new R16WorkerScheduler({maxWorkItemsPerBudget:4});
    workers.registerLane({id:'render',concurrency:2,budget:'render',latencyTargetMs:5});
    workers.enqueue('render',{id:'a',units:1,priority:1,enqueuedTick:1,expiresTick:5,payload:null});
    workers.enqueue('render',{id:'b',units:1,priority:1,enqueuedTick:1,expiresTick:5,payload:null});
    workers.enqueue('render',{id:'c',units:1,priority:1,enqueuedTick:1,expiresTick:5,payload:null});
    expect(workers.dispatch(2)).toHaveLength(2);
  });
  it('moves recovery through explicit lifecycle phases',()=>{
    const recovery=new R16RecoveryCoordinator();
    expect(recovery.request({domain:'network',reason:'disconnect',maxAttempts:3,cooldownTicks:1},1).ok).toBe(true);
    expect(recovery.status('network').phase).toBe('diagnose');
    recovery.advance('network',2);expect(recovery.status('network').phase).toBe('quiesce');
    recovery.advance('network',3);expect(recovery.status('network').phase).toBe('reset');
  });
  it('uses hysteresis instead of oscillating quality',()=>{
    const governor=new R16PerformanceGovernor({hysteresisTicks:3});
    governor.evaluate({frameMs:30,cpuMs:20,gpuMs:20,memoryPressure:0.9,networkPressure:0,simulationPressure:0},1);
    expect(governor.tier()).toBe('balanced');
    for(let i=0;i<3;i++)governor.evaluate({frameMs:5,cpuMs:2,gpuMs:2,memoryPressure:0,networkPressure:0,simulationPressure:0},i+2);
    expect(governor.tier()).toBe('quality');
  });
});
