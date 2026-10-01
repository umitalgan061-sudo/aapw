import { describe, expect, it } from 'vitest';
import {
  RuntimeWatchdogR33,
  RUNTIME_WATCHDOG_DEFAULT_POLICY_R33,
} from '../../src/3d/strict/runtimeWatchdogR33.ts';
import {
  detectRenderCapabilities,
  selectRenderBackend,
  buildRenderProfile,
} from '../../src/3d/renderBackendCapability.ts';

describe('R33 strict runtime hardening', () => {
  it('transitions from degraded to nominal through hysteresis', () => {
    const watchdog = new RuntimeWatchdogR33({
      consecutiveBadFrames: 2,
      criticalConsecutiveBadFrames: 4,
      recoveryFrames: 3,
      historyCapacity: 8,
    });

    watchdog.observe({ frame: 1, frameMs: 35, cpuMs: 20, gpuMs: 15, pressure: 0.8, hardeningState: 'throttled' });
    const degraded = watchdog.observe({ frame: 2, frameMs: 35, cpuMs: 20, gpuMs: 15, pressure: 0.8, hardeningState: 'throttled' });
    expect(['degraded', 'critical']).toContain(degraded.state);

    for (let frame = 3; frame <= 8; frame += 1) {
      watchdog.observe({ frame, frameMs: 10, cpuMs: 5, gpuMs: 4, pressure: 0.05, hardeningState: 'nominal' });
    }
    expect(watchdog.snapshot().state).toBe('nominal');
    expect(watchdog.snapshot().history.length).toBeLessThanOrEqual(8);
  });

  it('sanitizes invalid metrics and keeps deterministic defaults', () => {
    expect(RUNTIME_WATCHDOG_DEFAULT_POLICY_R33.frameBudgetMs).toBe(16.67);
    const watchdog = new RuntimeWatchdogR33();
    const snapshot = watchdog.observe({
      frame: Number.NaN,
      frameMs: Number.NaN,
      cpuMs: -4,
      gpuMs: Number.POSITIVE_INFINITY,
      pressure: 4,
      hardeningState: '',
    });
    expect(snapshot.last?.frame).toBe(0);
    expect(snapshot.last?.frameMs).toBe(0);
    expect(snapshot.last?.cpuMs).toBe(0);
    expect(snapshot.last?.gpuMs).toBe(0);
    expect(snapshot.last?.pressure).toBe(1);
  });

  it('negotiates rendering capabilities without throwing in headless contexts', () => {
    const capabilities = detectRenderCapabilities({
      navigatorObject: { hardwareConcurrency: 8, deviceMemory: 16 },
      documentObject: undefined,
      windowObject: undefined,
    });
    const selection = selectRenderBackend(capabilities, { preferWebGPU: false });
    const profile = buildRenderProfile(capabilities, selection);
    expect(['none', 'webgpu', 'webgl2', 'webgl']).toContain(selection.backend);
    expect(profile.pixelRatioCap).toBeGreaterThan(0);
  });
});
