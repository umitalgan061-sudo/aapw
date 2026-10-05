import { describe, expect, it } from 'vitest';
import {
  PerformanceGovernor,
  createBudgetDecision,
} from '../../../src/3d/modern/r50/performanceGovernor.ts';

describe('R50 performance governor', () => {
  it('increases quality after sustained healthy frames', () => {
    const governor=new PerformanceGovernor({
      minDwellFrames:0,
    });

    governor.force('performance');
    governor.release();

    for(let i=0;i<30;i+=1){
      governor.observe({
        frameMilliseconds:8,
        networkRttMilliseconds:30,
        memoryBytes:128*1024*1024,
        droppedTasks:0,
      });
    }

    expect([
      'ultra',
      'high',
      'balanced',
    ]).toContain(
      governor.snapshot().level,
    );
  });

  it('reduces expensive work under poor frame time', () => {
    const governor=new PerformanceGovernor({
      minDwellFrames:0,
    });

    for(let i=0;i<60;i+=1){
      governor.observe({
        frameMilliseconds:40,
        networkRttMilliseconds:250,
        memoryBytes:900*1024*1024,
        droppedTasks:3,
      });
    }

    const decision=createBudgetDecision(
      governor.snapshot(),
    );

    expect(decision.allowExpensivePass).toBe(false);
    expect(decision.visibleEntityCap).toBeLessThan(1200);
  });
});
