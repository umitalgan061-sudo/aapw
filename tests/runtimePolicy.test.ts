import { describe, expect, it } from 'vitest';
import { RUNTIME_PROFILES } from '../src/3d/modern/runtimeConfig';
import { evaluateRuntimePolicy, validatePolicyDecision } from '../src/3d/modern/runtimePolicy';
import { RuntimeBudgetController } from '../src/3d/modern/runtimeBudgetController';

describe('runtime policy', () => {
  it('degrades quality coherently as pressure rises', () => {
    const calm = evaluateRuntimePolicy({ backend: 'webgpu', quality: 'high', pressure: 0.1, memoryPressure: 0.1, thermalPressure: 0.1, saveData: false });
    const stressed = evaluateRuntimePolicy({ backend: 'webgpu', quality: 'high', pressure: 0.95, memoryPressure: 0.96, thermalPressure: 0.95, saveData: false });
    expect(stressed.quality).toBe('minimal');
    expect(stressed.renderScale).toBeLessThan(calm.renderScale);
    expect(validatePolicyDecision(stressed).ok).toBe(true);
  });

  it('respects save-data, reduced-motion and low-battery signals', () => {
    const decision = evaluateRuntimePolicy({ backend: 'webgl2', quality: 'balanced', pressure: 0.2, memoryPressure: 0.2, thermalPressure: 0.2, saveData: true, reducedMotion: true, batteryLevel: 0.1, batteryCharging: false });
    expect(decision.reason).toEqual(['save-data', 'reduced-motion', 'low-battery']);
    expect(decision.animationsRate).toBeLessThan(1);
  });
});

describe('unified runtime budgets', () => {
  it('smooths large pressure changes rather than oscillating immediately', () => {
    const controller = new RuntimeBudgetController(RUNTIME_PROFILES.desktop);
    const calm = { cpu: 0.1, gpu: 0.1, frame: 0.1, memory: 0.1, thermal: 0.1, combined: 0.1 };
    const stressed = { cpu: 0.9, gpu: 0.9, frame: 0.9, memory: 0.9, thermal: 0.9, combined: 0.95 };
    const a = controller.decide(calm, 'high');
    const b = controller.decide(stressed, 'high');
    expect(b.scale).toBeLessThan(a.scale);
    expect(b.limits.maxDrawItems).toBeLessThan(a.limits.maxDrawItems);
    controller.reset();
  });
});
