import { describe, expect, it } from 'vitest';
import {
  normalizeNetworkSignal,
  normalizeBatterySignal,
  normalizeViewportSignal,
  buildStreamingSignal,
  normalizeGamepadSignal,
  shouldEnterLowPowerMode,
} from '../../src/3d/runtime/runtimeSignalAdapters.ts';
import {
  createDeterministicRuntimeScheduler,
  partitionElapsed,
  validateSchedulerSnapshot,
} from '../../src/3d/runtime/deterministicRuntimeScheduler.ts';
import {
  createRuntimeFeatureFlagRegistry,
  createDefaultRuntimeFlags,
} from '../../src/3d/runtime/runtimeFeatureFlagRegistry.ts';
import {
  createRuntimeHealthMonitor,
  combineHealthLevels,
} from '../../src/3d/runtime/runtimeHealthMonitor.ts';
import { classifyPlatformProfile, createCapabilityMatrix } from '../../src/3d/runtime/platformCapabilityProbe.ts';
import { evaluateRuntimeInvariants, createDiagnosticsDigest } from '../../src/3d/runtime/modernRuntimeDiagnostics.ts';
import { getR21StrictRuntimeSnapshot } from '../../src/3d/modern/migrationLedgerR21.ts';

describe('R21 strict runtime core', () => {
  it('records zero escape hatches across the tracked runtime core', () => {
    const snapshot = getR21StrictRuntimeSnapshot();
    expect(snapshot.version).toBe(21);
    expect(snapshot.tracked).toBe(6);
    expect(snapshot.strictOwners).toBe(6);
    expect(snapshot.escapeHatches).toBe(0);
    expect(snapshot.coveragePercent).toBe(100);
  });

  it('normalizes platform signals into bounded immutable contracts', () => {
    expect(normalizeNetworkSignal({ rttMs: 99999, downlinkMbps: -5 }).rttMs).toBe(10000);
    expect(normalizeBatterySignal({ level: -1, charging: false }).level).toBe(0);
    expect(normalizeViewportSignal({ width: 99999, dpr: 99 }).dpr).toBe(4);
    expect(buildStreamingSignal({ distance: 500, playerSpeed: 15, qualityTier: 'ultra' }).prefetch).toBe(true);
    expect(normalizeGamepadSignal({ axes: [2, -2], buttons: [{ value: 2 }] }).axes).toEqual([1, -1]);
    expect(shouldEnterLowPowerMode({ batteryLevel: 0.1, charging: false })).toBe(true);
  });

  it('keeps fixed-step scheduling deterministic and bounded', () => {
    const a = createDeterministicRuntimeScheduler({ fixedStepMs: 10, maxCatchupMs: 40, maxStepsPerFrame: 3 });
    const b = createDeterministicRuntimeScheduler({ fixedStepMs: 10, maxCatchupMs: 40, maxStepsPerFrame: 3 });
    const traceA:number[] = [];
    const traceB:number[] = [];
    a.frame(35, { simulate: context => traceA.push(context.tick) });
    b.frame(35, { simulate: context => traceB.push(context.tick) });
    expect(traceA).toEqual(traceB);
    expect(a.tick).toBe(3);
    expect(a.snapshot().maxStepsPerFrame).toBe(3);
    expect(validateSchedulerSnapshot(a.snapshot()).valid).toBe(true);
    expect(partitionElapsed(35, 10, 3)).toEqual({ chunks: [10, 10, 10], remainderMs: 5 });
  });

  it('keeps feature flags validated and health aggregation stable', () => {
    const registry = createRuntimeFeatureFlagRegistry();
    registry.defineMany(createDefaultRuntimeFlags());
    expect(registry.isEnabled('runtime.fixed-step')).toBe(true);
    expect(() => registry.setOverride('runtime.fixed-step', 'yes')).toThrow();
    expect(combineHealthLevels('healthy', 'degraded', 'critical')).toBe('critical');

    const monitor = createRuntimeHealthMonitor({ historySize: 30 });
    for (let i = 0; i < 4; i += 1) monitor.sample({ deltaMs: 40 });
    expect(monitor.health).toBe('critical');
    expect(monitor.recommend().action).toBe('shed-effects');
  });

  it('keeps diagnostics and capability profiles deterministic', () => {
    const invariant = evaluateRuntimeInvariants({
      scheduler: { fixedStepMs: 16.67, maxCatchupMs: 100, maxStepsPerFrame: 6 },
      quality: { pressure: 0.5 },
      health: { health: 'healthy' },
      input: { capacity: 64 },
      telemetry: { eventCount: 4 },
    });
    expect(invariant.valid).toBe(true);
    expect(classifyPlatformProfile({
      capabilities: { webgl: true, webgpu: true, hardwareConcurrency: 8, devicePixelRatio: 1 },
      memory: { deviceMemoryGb: 8 },
      network: { saveData: false },
    } as any)).toBe('performance');
    expect(createCapabilityMatrix({ capabilities: { webgl: true, webgpu: false } } as any)).toHaveLength(8);
    expect(createDiagnosticsDigest({ platformProfile: 'balanced', quality: { tier: 'high' }, scheduler: { tick: 12 }, telemetry: { eventCount: 4 }, input: { queued: [] }, health: { health: 'healthy' }, residency: { usedMb: 2, capacityMb: 64 } }).health).toBe('healthy');
  });
});
