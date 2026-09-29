import { describe, expect, it } from 'vitest';
import { RuntimeHardeningSupervisorV25 } from '../../src/3d/strict/runtimeHardeningV25.ts';

describe('V25 runtime hardening', () => {
  it('degrades under sustained pressure and recovers with hysteresis', () => {
    let clock = 0;
    const supervisor = new RuntimeHardeningSupervisorV25({
      now: () => clock,
      recoverySamples: 3,
      maxFailuresPerWindow: 3,
      failureWindowMs: 1000,
    });

    const degraded = supervisor.observeFrame({
      frame: 1, frameMs: 28, cpuMs: 18, gpuMs: 18, drawCalls: 1400, triangles: 2_400_000,
      memoryPressure: 0.8, entityPressure: 0.82, assetBacklog: 30, networkJitterMs: 45,
    });
    expect(degraded.state).toBe('throttled');
    expect(degraded.throttleFactor).toBeLessThan(1);

    clock += 100;
    supervisor.observeFrame({
      frame: 2, frameMs: 16, cpuMs: 8, gpuMs: 8, drawCalls: 500, triangles: 500_000,
      memoryPressure: 0.2, entityPressure: 0.2, assetBacklog: 2, networkJitterMs: 5,
    });
    clock += 100;
    supervisor.observeFrame({
      frame: 3, frameMs: 16, cpuMs: 8, gpuMs: 8, drawCalls: 500, triangles: 500_000,
      memoryPressure: 0.2, entityPressure: 0.2, assetBacklog: 2, networkJitterMs: 5,
    });
    clock += 100;
    const recovered = supervisor.observeFrame({
      frame: 4, frameMs: 16, cpuMs: 8, gpuMs: 8, drawCalls: 500, triangles: 500_000,
      memoryPressure: 0.2, entityPressure: 0.2, assetBacklog: 2, networkJitterMs: 5,
    });

    expect(recovered.state).toBe('nominal');
    expect(recovered.throttleFactor).toBe(1);
  });

  it('opens a critical guard state after repeated failures, then expires failures by time', () => {
    let clock = 0;
    const supervisor = new RuntimeHardeningSupervisorV25({
      now: () => clock,
      maxFailuresPerWindow: 3,
      failureWindowMs: 1000,
    });

    supervisor.recordFailure('stream', new Error('a'));
    supervisor.recordFailure('stream', new Error('b'));
    supervisor.recordFailure('stream', new Error('c'));
    expect(supervisor.snapshot().state).toBe('critical');
    expect(supervisor.canStartOperation()).toBe(false);

    clock = 2000;
    const decision = supervisor.observeFrame({
      frame: 10, frameMs: 16, cpuMs: 7, gpuMs: 7, drawCalls: 300, triangles: 300_000,
      memoryPressure: 0.1, entityPressure: 0.1, assetBacklog: 0, networkJitterMs: 0,
    });
    expect(decision.failureCount).toBe(0);
  });
});
