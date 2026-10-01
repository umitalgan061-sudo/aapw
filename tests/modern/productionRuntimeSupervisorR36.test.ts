import { describe, expect, it } from 'vitest';

import {
  ProductionRuntimeSupervisorR36,
  PRODUCTION_RUNTIME_SUPERVISOR_POLICY_R36,
} from '../../src/3d/strict/productionRuntimeSupervisorR36.ts';

describe('R36 production runtime supervisor', () => {
  it('selects the strongest supported backend from deterministic capabilities', () => {
    const supervisor = new ProductionRuntimeSupervisorR36({
      secureContext: true,
      gpuAdapterAvailable: true,
      webgl2ContextAvailable: true,
      offscreenCanvas: true,
      hardwareConcurrency: 12,
      memoryGiB: 16,
      devicePixelRatio: 2,
    });

    const snapshot = supervisor.snapshot();
    expect(snapshot.version).toBe(36);
    expect(snapshot.backend).toBe('webgpu');
    expect(snapshot.capabilities.webgpu).toBe(true);
    expect(snapshot.policy.temporalEffects).toBe(true);
    expect(PRODUCTION_RUNTIME_SUPERVISOR_POLICY_R36.degradeAfterScore).toBeGreaterThan(0);
  });

  it('throttles after sustained pressure and recovers after a healthy window', () => {
    const supervisor = new ProductionRuntimeSupervisorR36({
      secureContext: true,
      gpuAdapterAvailable: true,
      webgl2ContextAvailable: true,
      hardwareConcurrency: 8,
      memoryGiB: 8,
      devicePixelRatio: 1,
    });

    let decision = supervisor.observe({
      frame: 1,
      frameMs: 40,
      cpuMs: 22,
      gpuMs: 18,
      pressure: 0.95,
    });

    expect(['throttled', 'critical', 'circuit-open']).toContain(decision.state);

    for (let frame = 2; frame < 20; frame += 1) {
      decision = supervisor.observe({
        frame,
        frameMs: 8,
        cpuMs: 4,
        gpuMs: 3,
        pressure: 0.05,
      });
    }

    expect(['recovering', 'nominal', 'throttled']).toContain(decision.state);
    expect(decision.digest).toMatch(/^\{/);
  });

  it('falls back when WebGPU is lost without destroying the runtime contract', () => {
    const supervisor = new ProductionRuntimeSupervisorR36({
      secureContext: true,
      gpuAdapterAvailable: true,
      webgl2ContextAvailable: true,
      hardwareConcurrency: 8,
      memoryGiB: 8,
      devicePixelRatio: 1,
    });

    const before = supervisor.snapshot();
    const after = supervisor.markDeviceLost();

    expect(before.backend).toBe('webgpu');
    expect(after.backend).toBe('webgl2');
    expect(after.reason).toBe('device-lost');
    expect(after.generation).not.toBe(before.generation);
  });
});


describe('R36 supervisor lifecycle', () => {
  it('resets health state without disposing the watchdog', () => {
    const supervisor = new ProductionRuntimeSupervisorR36({
      secureContext: true,
      gpuAdapterAvailable: true,
      webgl2ContextAvailable: true,
      hardwareConcurrency: 8,
      memoryGiB: 8,
      devicePixelRatio: 1,
    });

    supervisor.observe({ frame: 1, frameMs: 45, cpuMs: 30, gpuMs: 20, pressure: 0.98 });
    const reset = supervisor.reset();

    expect(reset.state).toBe('nominal');
    expect(reset.watchdog.state).toBe('nominal');
    expect(reset.circuit.state).toBe('closed');

    const next = supervisor.observe({ frame: 2, frameMs: 8, cpuMs: 4, gpuMs: 3, pressure: 0.05 });
    expect(next.state).toBe('nominal');
  });
});
