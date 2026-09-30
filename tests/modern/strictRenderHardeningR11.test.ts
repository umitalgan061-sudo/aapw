import { describe, expect, it } from 'vitest';
import { getR11StrictRenderSnapshot, R11_STRICT_RENDER_MODULES } from '../../src/3d/modern/migrationLedgerR11.ts';
import { evaluateGpuPressure } from '../../src/3d/rendering/gpuPressureModel.ts';
import { createRenderPassBudgetPlanner, passBudgetDigest } from '../../src/3d/rendering/renderPassBudgetPlanner.ts';
import { createDynamicResolutionGovernor } from '../../src/3d/rendering/dynamicResolutionGovernor.ts';

describe('R11 strict adaptive rendering', () => {
  it('records complete strict ownership', () => {
    const snapshot = getR11StrictRenderSnapshot();
    expect(snapshot.version).toBe(11);
    expect(snapshot.strictCount).toBe(R11_STRICT_RENDER_MODULES.length);
    expect(snapshot.coveragePercent).toBe(100);
  });

  it('classifies GPU pressure deterministically', () => {
    const input = { gpuMs: 28, cpuMs: 10, frameMs: 30, memoryUtilization: 0.91, thermalPressure: 0.4 };
    expect(evaluateGpuPressure(input)).toEqual(evaluateGpuPressure(input));
    expect(evaluateGpuPressure(input).state).toBe('critical');
  });

  it('keeps render-pass admission bounded and deterministic', () => {
    const planner = createRenderPassBudgetPlanner();
    const result = planner.plan([
      { id:'optional-heavy', costMs:3, priority:.4, optional:true },
      { id:'required-core', costMs:3, priority:1, optional:false },
      { id:'optional-cheap', costMs:.5, priority:.2, optional:true },
    ], { budgetMs:4, emergency:true });
    expect(result.spentMs).toBeLessThanOrEqual(4);
    expect(result.accepted.some((p)=>p.id==='required-core')).toBe(true);
    expect(passBudgetDigest(result)).toBe(passBudgetDigest(result));
  });

  it('uses hysteresis and dwell before downscaling', () => {
    const governor = createDynamicResolutionGovernor({ initialScale: .85 });
    const first = governor.update({ frameMs: 40, thermalPressure: .9 });
    expect(first.scale).toBe(.85);
    let latest = first;
    for (let i=0;i<15;i+=1) latest = governor.update({ frameMs: 40, thermalPressure: .9 });
    expect(latest.scale).toBeLessThan(.85);
    expect(latest.direction).toBe('down');
    governor.setForcedScale(.7);
    expect(governor.snapshot().scale).toBe(.7);
    expect(governor.snapshot().forced).toBe(true);
  });
});
