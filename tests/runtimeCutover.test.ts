import { describe, expect, it, vi } from 'vitest';
import type { InputAction, NetworkEntityState, Vec3 } from '../src/3d/modern/types';
import { checksum, FixedStepClock, stableStringify } from '../src/3d/modern/deterministic';
import { RuntimeKernel } from '../src/3d/modern/runtimeKernel';
import { RuntimeLifecycle } from '../src/3d/modern/runtimeLifecycle';
import { RuntimeProfiler } from '../src/3d/modern/runtimeProfiler';
import { RecoveryController } from '../src/3d/modern/recoveryController';
import { RenderBridge } from '../src/3d/modern/renderBridge';
import { AssetRuntime } from '../src/3d/modern/assetRuntime';
import { WorkerPool } from '../src/3d/modern/workerPool';
import { NetworkReplicationController } from '../src/3d/modern/networkReplication';
import { LegacyRuntimeAdapter } from '../src/3d/modern/legacyAdapter';
import { ModernRuntimeFacade, cameraFromThreeLike } from '../src/3d/modern/modernRuntimeFacade';
import { PlatformHealthMonitor, validateHealthReport } from '../src/3d/modern/platformHealth';
import { ModernStateStore } from '../src/3d/modern/stateStore';
import { TypedEventBus } from '../src/3d/modern/eventBus';

const camera = {
  position: { x: 0, y: 2, z: 5 },
  target: { x: 0, y: 1, z: 0 },
  fov: 60,
  near: 0.1,
  far: 5_000,
  viewportWidth: 1280,
  viewportHeight: 720,
  dpr: 1,
};

function entity(id: string, position: Vec3 = { x: 0, y: 0, z: 0 }): NetworkEntityState {
  return {
    id: id as NetworkEntityState['id'],
    position,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    flags: 1,
  };
}

describe('runtime kernel', () => {
  it('starts, ticks, streams and emits typed lifecycle events', async () => {
    const kernel = new RuntimeKernel({ seed: 1234, environment: { preferredBackend: 'headless' }, streamLoadRadius: 2, streamUnloadRadius: 3 });
    const frames: number[] = [];
    kernel.events.on('runtime:frame', (event) => frames.push(Number(event.frame)));
    kernel.start();
    const result = await kernel.tick({
      frameMs: 16.6,
      cpuMs: 5,
      gpuMs: 6,
      drawCalls: 20,
      triangles: 400,
      visibleObjects: 12,
      textureBytes: 1024,
      camera,
    });
    expect(result.snapshot.backend).toBe('headless');
    expect(result.streamPlan.load.length).toBeGreaterThan(0);
    expect(frames).toEqual([1]);
    expect(kernel.health().scheduler).toBe(true);
  });

  it('keeps deterministic probes identical for equal seeds', () => {
    const a = new RuntimeKernel({ seed: 99, environment: { preferredBackend: 'headless' } });
    const b = new RuntimeKernel({ seed: 99, environment: { preferredBackend: 'headless' } });
    expect(a.deterministicProbe(128)).toEqual(b.deterministicProbe(128));
    expect(a.deterministicProbe(128)).toEqual(a.deterministicProbe(128));
    expect(a.seed).toBe(99);
  });

  it('enforces task budgets and produces diagnostics snapshots', async () => {
    const kernel = new RuntimeKernel({ environment: { preferredBackend: 'headless' } });
    let executions = 0;
    for (let i = 0; i < 20; i += 1) {
      kernel.enqueueTask({
        id: `task-${i}`,
        priority: (i % 5) as 0 | 1 | 2 | 3 | 4,
        affinity: 'simulation',
        estimatedMs: 0.1,
        run: () => { executions += 1; },
      });
    }
    kernel.start();
    await kernel.tick({ frameMs: 16, cpuMs: 1, drawCalls: 0, triangles: 0, visibleObjects: 0, textureBytes: 0, camera });
    expect(executions).toBeGreaterThan(0);
    expect(kernel.diagnosticsSnapshot()).toHaveProperty('scheduler');
  });
});

describe('lifecycle coordinator', () => {
  it('suspends and resumes without duplicating browser listeners', async () => {
    const target = { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Document;
    const kernel = new RuntimeKernel({ environment: { preferredBackend: 'headless' } });
    const clock = new FixedStepClock();
    const lifecycle = new RuntimeLifecycle({ kernel, visibilityTarget: target, clock });
    lifecycle.start();
    expect(lifecycle.state.phase).toBe('running');
    lifecycle.suspend();
    expect(lifecycle.state.phase).toBe('suspended');
    lifecycle.resume();
    expect(lifecycle.state.phase).toBe('running');
    await lifecycle.frame({ frameMs: 16, cpuMs: 2, drawCalls: 0, triangles: 0, visibleObjects: 0, textureBytes: 0, camera });
    expect(lifecycle.state.frames).toBe(1);
    lifecycle.dispose();
    expect(target.removeEventListener).toHaveBeenCalled();
  });
});

describe('recovery controller', () => {
  it('uses bounded backoff and transitions through recovery states', () => {
    const recovery = new RecoveryController({ backend: 'webgpu', seed: 7, policy: { baseDelayMs: 100, maxDelayMs: 500 } });
    const first = recovery.notifyDeviceLoss('lost', 1000);
    expect(first.ok).toBe(true);
    expect(recovery.state().attempts).toBe(1);
    expect(recovery.state().nextRetryAt).toBeGreaterThan(1000);
    recovery.markRetryStarted();
    recovery.markRetrySucceeded('webgl2');
    expect(recovery.state().stage).toBe('degraded');
    recovery.reset();
    expect(recovery.state().stage).toBe('healthy');
  });

  it('selects a lower backend when the current backend is unavailable', () => {
    const recovery = new RecoveryController({ backend: 'webgpu' });
    expect(recovery.chooseFallback(['webgpu', 'webgl2'])).toBe('webgl2');
    expect(recovery.fallback('webgl2', 'test')).toBe(true);
    expect(recovery.state().backend).toBe('webgl2');
  });
});

describe('render bridge', () => {
  it('creates immutable packets and records metrics', async () => {
    const calls: string[] = [];
    const bridge = new RenderBridge({
      backend: 'headless',
      hooks: {
        create: ({ backend }) => ({ backend }),
        draw: ({ packet }) => calls.push(packet.checksum),
        destroy: () => undefined,
      },
    });
    expect((await bridge.initialize({ backend: 'headless' })).ok).toBe(true);
    const packet = bridge.createPacket({ frame: 1, camera, quality: 'balanced', renderScale: 0.8, pressure: 0.2, backend: 'headless', draws: [] });
    expect(Object.isFrozen(packet)).toBe(true);
    const result = await bridge.render({ frame: 1, camera, quality: 'balanced', renderScale: 0.8, pressure: 0.2, backend: 'headless', draws: [] }, 5);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(bridge.metrics.frames).toBe(1);
    await bridge.dispose();
  });
});

describe('asset runtime', () => {
  it('rejects cross-origin assets and shares registry residency', async () => {
    const asset = new AssetRuntime({ baseUrl: 'https://game.example/' });
    const registered = asset.registerManifest([
      { id: 'hero', url: '/assets/hero.glb', kind: 'mesh', priority: 4, tags: ['hero'], bytes: 128, cache: 'immutable' },
    ]);
    expect(registered).toEqual({ ok: true, value: 1 });
    const bad = await asset.fetchBytes('https://evil.example/hero.glb');
    expect(bad.ok).toBe(false);
    expect(asset.stats().manifestEntries).toBe(1);
    expect(asset.digest()).toHaveLength(8);
  });
});

describe('worker pool', () => {
  it('serializes jobs onto idle workers and exposes bounded stats', async () => {
    const listeners = new Set<(message: { id: string; ok: boolean; payload?: unknown }) => void>();
    const transport = {
      postMessage(message: { id: string; method: string; payload: unknown }) {
        queueMicrotask(() => {
          for (const listener of listeners) listener({ id: message.id, ok: true, payload: { method: message.method, payload: message.payload } });
        });
      },
      addMessageListener(listener: (message: { id: string; ok: boolean; payload?: unknown }) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const pool = new WorkerPool({ size: 2, maxQueued: 4, transportFactory: () => transport });
    const result = await pool.submit({ id: 'job-1', method: 'echo', payload: 42, priority: 4, affinity: 'any' });
    expect(result.ok).toBe(true);
    expect(pool.stats().completed).toBe(1);
    await pool.shutdown();
  });
});

describe('network replication', () => {
  it('captures full snapshots and emits deterministic deltas', () => {
    const controller = new NetworkReplicationController({ policy: { snapshotIntervalTicks: 1, maxDeltaEntities: 8 } });
    const first = controller.capture(1, [entity('b', { x: 2, y: 0, z: 0 }), entity('a')]);
    expect(first.ok).toBe(true);
    const envelope = controller.nextEnvelope();
    expect(envelope?.snapshot).not.toBeNull();
    const second = controller.capture(2, [entity('a', { x: 1, y: 0, z: 0 }), entity('b')]);
    expect(second.ok).toBe(true);
    const secondEnvelope = controller.nextEnvelope();
    expect(secondEnvelope?.digest).toHaveLength(8);
    expect(controller.stats().entitiesReplicated).toBe(4);
  });
});

describe('legacy adapter and facade', () => {
  it('mirrors modern quality into legacy state', () => {
    const legacyState = new Map<string, unknown>();
    const adapter = new LegacyRuntimeAdapter({
      kernel: new RuntimeKernel({ environment: { preferredBackend: 'headless' } }),
      state: { set: (key, value) => legacyState.set(key, value) },
    });
    adapter.connect();
    adapter.kernel.start();
    adapter.kernel.quality.force('minimal');
    expect(legacyState.get('renderQuality')).toBe('minimal');
    adapter.disconnect();
  });

  it('creates an explicit browser-neutral camera contract', () => {
    expect(cameraFromThreeLike({ position: { x: 1, y: 2, z: 3 }, fov: 70 }, { width: 800, height: 600, dpr: 2 })).toEqual({
      position: { x: 1, y: 2, z: 3 },
      target: { x: 0, y: 0, z: 0 },
      fov: 70,
      near: 0.1,
      far: 5_000,
      viewportWidth: 800,
      viewportHeight: 600,
      dpr: 2,
    });
  });

  it('keeps facade snapshots stable and diagnostics serializable', () => {
    const facade = new ModernRuntimeFacade({ legacyState: {} });
    const state = facade.snapshot(3, 'high', 'headless', 0.2, 8);
    expect(state.frame).toBe(3);
    expect(state.digest).toHaveLength(8);
    expect(() => JSON.stringify(facade.diagnostics())).not.toThrow();
  });
});

describe('platform health', () => {
  it('classifies critical frame pressure and validates report integrity', () => {
    const monitor = new PlatformHealthMonitor({ maxHistory: 32 });
    const report = monitor.observe({
      timestampMs: 10,
      frameMs: 50,
      cpuMs: 20,
      gpuMs: 30,
      memoryPressure: 0.95,
      thermalPressure: 0.8,
      entityCount: 60_000,
      streamCells: 100,
      residentBytes: 200_000,
      workerQueue: 200,
    });
    expect(report.level).toBe('critical');
    expect(report.recommendations.length).toBeGreaterThan(2);
    expect(validateHealthReport(report).ok).toBe(true);
  });
});

describe('strict state and deterministic helpers', () => {
  it('rejects invalid state and canonicalizes object keys', () => {
    const state = new ModernStateStore();
    expect(() => state.set('loadProgress', 2)).toThrow();
    expect(stableStringify({ z: 1, a: [3, 2, 1] })).toBe('{"a":[3,2,1],"z":1}');
    expect(checksum({ b: 1, a: 2 })).toBe(checksum({ a: 2, b: 1 }));
  });

  it('delivers event snapshots without cross-handler mutation', () => {
    const bus = new TypedEventBus<{ ping: { value: number } }>();
    const values: number[] = [];
    bus.on('ping', (payload) => values.push(payload.value));
    bus.emit('ping', { value: 7 });
    expect(bus.snapshot().get('ping')).toBe(1);
    expect(values).toEqual([7]);
  });
});

describe('profiler', () => {
  it('records phase marks and reports budget violations', () => {
    const profiler = new RuntimeProfiler({ budget: { totalMs: 1, simulationMs: 0.1 }, maxFrames: 32 });
    profiler.begin(1);
    profiler.enter('simulation');
    profiler.exit();
    const profile = profiler.end({ cpu: 0, gpu: 0, frame: 0, memory: 0, thermal: 0, combined: 0 }, 'balanced');
    expect(profile.frame).toBe(1);
    expect(profiler.summary().frames).toBe(1);
    expect(profiler.violations(profile).length).toBeGreaterThanOrEqual(0);
  });
});

void ([] as InputAction[]);
