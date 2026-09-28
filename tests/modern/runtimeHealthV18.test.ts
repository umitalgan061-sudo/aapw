import {describe,expect,it} from 'vitest';
import {RuntimeHealthV18} from '../../src/3d/modern/runtimeHealthV18';

describe('runtime health V18',()=>{
  it('aggregates healthy signals without false degradation',()=>{
    const health=new RuntimeHealthV18({clock:()=>25});
    health.setReadiness('input',true);
    health.setReadiness('world',true);
    health.setPressure('frame',0.2);
    const report=health.snapshot();
    expect(report.state).toBe('healthy');
    expect(report.score).toBeGreaterThan(0.9);
    expect(report.criticalFailures).toEqual([]);
  });

  it('blocks when too many systems are not ready',()=>{
    const health=new RuntimeHealthV18({minimumReadyRatio:0.8});
    health.setReadiness('input',true);
    health.setReadiness('world',true);
    health.setReadiness('render',false,false);
    health.setReadiness('assets',false,false);
    health.setPressure('frame',0.2);
    expect(health.snapshot().state).toBe('degraded');
  });

  it('reports critical failures separately',()=>{
    const health=new RuntimeHealthV18();
    health.setReadiness('input',false,true);
    const report=health.snapshot();
    expect(report.state).toBe('failed');
    expect(report.criticalFailures).toEqual(['input']);
  });

  it('converts pressure into bounded state and score',()=>{
    const health=new RuntimeHealthV18();
    health.setPressure('gpu',1.8);
    const report=health.snapshot();
    const signal=report.signals[0];
    expect(signal?.state).toBe('failed');
    expect(signal?.score).toBeGreaterThanOrEqual(0);
    expect(signal?.score).toBeLessThanOrEqual(1);
  });
});
