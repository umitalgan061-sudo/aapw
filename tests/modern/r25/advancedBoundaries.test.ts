import { describe, expect, it } from 'vitest';
import {
  ClientPredictionR25,
  createInputCommandR25,
  validateAuthoritativeStateR25,
} from '../../../src/3d/modern/r25/networkPrediction.ts';
import {
  ObjectPoolR25,
  leaseFromPoolR25,
} from '../../../src/3d/modern/r25/objectPool.ts';
import {
  AdaptiveQualityR25,
  estimateDynamicPixelRatio,
} from '../../../src/3d/modern/r25/adaptiveQuality.ts';
import {
  AssetRuntimeR25,
  createMemoryAssetTransport,
} from '../../../src/3d/modern/r25/assetRuntime.ts';
import { MemoryPersistenceAdapterR25, PersistenceLedgerR25 } from '../../../src/3d/modern/r25/persistence.ts';
import { InputIntentR25 } from '../../../src/3d/modern/r25/inputIntent.ts';
import { RuntimeR25 } from '../../../src/3d/modern/r25/runtime.ts';
import { WorkerProtocolR25 } from '../../../src/3d/modern/r25/workerProtocol.ts';

function syntheticCapabilities() {
  return {
    backend: 'webgpu' as const,
    webgpu: true,
    webgl2: true,
    webgl: true,
    secureContext: true,
    offscreenCanvas: true,
    sharedArrayBuffer: true,
    crossOriginIsolated: true,
    maxTextureSize: 16384,
    maxSamples: 8,
    maxUniformBufferSize: 65536,
    deviceMemoryGb: 16,
    hardwareConcurrency: 16,
    pixelRatio: 1,
    viewportWidth: 1920,
    viewportHeight: 1080,
    prefersReducedMotion: false,
    saveData: false,
    coarsePointer: false,
  };
}

describe('R25 networking', () => {
  it('creates sequential commands with bounded normalized values', () => {
    const client = new ClientPredictionR25({
      clock: () => 123,
    });

    const command = client.nextCommand(7, {
      move: { x: 4, y: -3 },
      look: { x: 9, y: -9 },
      actions: ['attack', 'attack', ''],
    });

    expect(command.sequence).toBe(1);
    expect(command.tick).toBe(7);
    expect(command.move).toEqual({ x: 1, y: -1 });
    expect(command.look).toEqual({ x: 4, y: -4 });
    expect(command.actions).toEqual(['attack']);
    expect(command.clientTimeMs).toBe(123);
  });

  it('keeps stale authoritative snapshots from rewinding confirmed state', () => {
    const client = new ClientPredictionR25({
      maxCorrectionMeters: 0.5,
      clock: () => 0,
    });

    client.recordPrediction({
      tick: 1,
      sequence: 1,
      position: { x: 10, y: 0 },
      velocity: { x: 1, y: 0 },
      stateHash: 'aaaa',
      payload: { hp: 100 },
      predictedFromSequence: 1,
    });

    const accepted = client.acceptAuthoritative({
      tick: 1,
      sequence: 1,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      stateHash: 'bbbb',
      payload: { hp: 99 },
    });

    expect(accepted.accepted).toBe(true);
    expect(accepted.corrected).toBe(true);
    expect(accepted.errorMeters).toBe(10);

    const stale = client.acceptAuthoritative({
      tick: 0,
      sequence: 0,
      position: { x: 100, y: 0 },
      velocity: { x: 0, y: 0 },
      stateHash: 'cccc',
      payload: { hp: 0 },
    });

    expect(stale.accepted).toBe(false);
    expect(stale.reason).toBe('stale-authoritative-sequence');
    expect(client.lastConfirmedSequence).toBe(1);
  });

  it('interpolates remote snapshots using tick space', () => {
    const client = new ClientPredictionR25({
      interpolationDelayTicks: 0,
    });

    client.pushRemoteSample({
      tick: 10,
      sequence: 10,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      stateHash: 'a',
      payload: { side: 'a' },
    });
    client.pushRemoteSample({
      tick: 12,
      sequence: 12,
      position: { x: 10, y: 4 },
      velocity: { x: 2, y: 1 },
      stateHash: 'b',
      payload: { side: 'b' },
    });

    const result = client.interpolateRemote(11);
    expect(result?.alpha).toBe(0.5);
    expect(result?.position).toEqual({ x: 5, y: 2 });
    expect(result?.velocity).toEqual({ x: 1, y: 0.5 });
  });

  it('validates authoritative network state boundaries', () => {
    const valid = validateAuthoritativeStateR25({
      tick: 10,
      sequence: 7,
      position: { x: 1, y: 2 },
      velocity: { x: 3, y: 4 },
      stateHash: 'valid-hash',
      payload: { hp: 100 },
    });

    expect(valid.ok).toBe(true);

    expect(validateAuthoritativeStateR25({
      tick: -1,
      sequence: 1,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      stateHash: 'bad',
      payload: null,
    }).ok).toBe(false);
  });

  it('produces deterministic standalone command normalization', () => {
    const command = createInputCommandR25(9, 20, { x: 0.3, y: -0.4 }, [
      'attack',
      'attack',
      'block',
    ]);
    expect(command.actions).toEqual(['attack', 'block']);
    expect(command.clientTimeMs).toBe(0);
  });
});

describe('R25 object pooling', () => {
  it('reuses objects instead of allocating on every acquisition', () => {
    interface Entry {
      value: number;
      reset(): void;
    }

    let nextId = 0;
    const pool = new ObjectPoolR25<Entry>({
      factory: () => ({ value: ++nextId, reset() { this.value = 0; } }),
      preallocate: 2,
      maxRetained: 4,
    });

    const a = pool.acquire();
    const b = pool.acquire();
    const firstAllocationCount = pool.snapshot().allocations;

    expect(firstAllocationCount).toBe(2);
    expect(pool.release(a)).toBe(true);
    expect(pool.release(b)).toBe(true);

    const c = pool.acquire();
    expect(pool.snapshot().allocations).toBe(firstAllocationCount);
    expect(c.value).toBe(0);
    expect(pool.release(c)).toBe(true);
  });

  it('supports one-shot leases and rejects duplicate releases', () => {
    const pool = new ObjectPoolR25({
      factory: () => ({ value: 1 }),
      maxRetained: 2,
    });

    const lease = leaseFromPoolR25(pool);
    expect(lease.release()).toBe(true);
    expect(lease.release()).toBe(false);
    expect(pool.snapshot().checkedOut).toBe(0);
  });
});

describe('R25 quality', () => {
  it('stays inside safe tier bounds when manually forced', () => {
    const profile = {
      tier: 'balanced' as const,
      backend: 'webgpu' as const,
      pixelRatio: 1.5,
      shadowResolution: 2048,
      drawDistanceMeters: 5000,
      vegetationDensity: 0.6,
      particleDensity: 0.6,
      postFxQuality: 0.5,
      temporalHistory: true,
      targetFps: 60,
      maxVisibleObjects: 50000,
    };

    const quality = new AdaptiveQualityR25(profile, {
      minTier: 'low',
      maxTier: 'high',
      clock: () => 1,
    });

    expect(quality.forceTier('safe').tier).toBe('low');
    expect(quality.forceTier('ultra').tier).toBe('high');
    expect(quality.decision().tier).toBe('high');
  });

  it('computes dynamic resolution as a bounded continuous policy', () => {
    expect(estimateDynamicPixelRatio(1, 8, 16)).toBeGreaterThan(1);
    expect(estimateDynamicPixelRatio(2.5, 100, 16)).toBeLessThanOrEqual(2.5);
    expect(estimateDynamicPixelRatio(1, 16, 16)).toBe(1);
  });

  it('downgrades repeatedly rather than oscillating on isolated spikes', () => {
    const quality = new AdaptiveQualityR25({
      ...({
        tier: 'ultra',
        backend: 'webgpu',
        pixelRatio: 2,
        shadowResolution: 4096,
        drawDistanceMeters: 9000,
        vegetationDensity: 1,
        particleDensity: 1,
        postFxQuality: 1,
        temporalHistory: true,
        targetFps: 120,
        maxVisibleObjects: 140000,
      }),
    }, {
      downgradeSamples: 3,
      upgradeSamples: 999,
      cooldownFrames: 1,
      clock: () => 0,
    });

    const spike = {
      frameMs: 40,
      cpuMs: 30,
      gpuMs: 30,
      memoryPressure: 1,
      thermalPressure: 0,
      drawCalls: 5000,
      visibleObjects: 140000,
      timestampMs: 0,
    };

    quality.observe(spike);
    const middle = quality.observe(spike);
    expect(middle.changed).toBe(false);
    const changed = quality.observe(spike);
    expect(changed.changed).toBe(true);
    expect(changed.tier).toBe('high');
  });
});

describe('R25 persistence', () => {
  it('supports schema migration with validation', async () => {
    const oldLedger = new PersistenceLedgerR25({
      schema: 1,
      clock: () => 10,
    });

    const adapter = new MemoryPersistenceAdapterR25();
    await oldLedger.save(adapter, 'save-1', { hp: 50 }, 5);

    const newLedger = new PersistenceLedgerR25({
      schema: 2,
      clock: () => 20,
      migrate: (payload, from, to) => {
        expect(from).toBe(1);
        expect(to).toBe(2);
        return {
          hp: Number((payload as { hp?: unknown }).hp ?? 0),
          stamina: 100,
        };
      },
      validate: (value): value is { hp: number; stamina: number } => (
        Boolean(value) &&
        typeof value === 'object' &&
        typeof (value as { hp?: unknown }).hp === 'number' &&
        typeof (value as { stamina?: unknown }).stamina === 'number'
      ),
    });

    const result = await newLedger.load(adapter, 'save-1', {
      allowMigration: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual({ hp: 50, stamina: 100 });
    }
  });

  it('rejects tampered envelopes', () => {
    const ledger = new PersistenceLedgerR25({
      schema: 1,
      clock: () => 0,
    });

    const encoded = ledger.encode({ hp: 100 }, 1);
    const parsed = JSON.parse(encoded) as { payload: { hp: number } };
    parsed.payload.hp = 1;

    const result = ledger.decode(JSON.stringify(parsed));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CHECKSUM');
  });
});

describe('R25 asset edge cases', () => {
  it('stops retrying after configured attempts and exposes failure state', async () => {
    const clock = {
      nowMs: () => 0,
      simulationTick: () => 1,
      fixedStepMs: () => 16,
    };

    let calls = 0;
    const assets = new AssetRuntimeR25({
      maxResidentBytes: 10000,
      maxConcurrentLoads: 1,
      maxAttempts: 3,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      clock,
      transport: {
        async load() {
          calls += 1;
          throw new Error('network-down');
        },
      },
    });

    const id = 'broken' as never;
    assets.declare({
      id,
      url: 'memory://broken',
      type: 'binary',
      priority: 100,
      bytes: 10,
      critical: false,
      tags: [],
      dependencies: [],
    });

    const result = await assets.load(id);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
    expect(assets.get(id)?.state).toBe('failed');
  });

  it('honors the resident memory budget when loading synthetic payloads', async () => {
    const clock = {
      nowMs: () => 0,
      simulationTick: () => 10,
      fixedStepMs: () => 16,
    };

    const transport = createMemoryAssetTransport(
      new Map([['memory://payload', { large: 'x'.repeat(256) }]]),
    );

    const assets = new AssetRuntimeR25({
      maxResidentBytes: 512,
      maxConcurrentLoads: 1,
      maxAttempts: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      clock,
      transport,
    });

    assets.declare({
      id: 'payload' as never,
      url: 'memory://payload',
      type: 'json',
      priority: 1,
      bytes: 256,
      critical: false,
      tags: [],
      dependencies: [],
    });

    const result = await assets.load('payload' as never);
    expect(result.ok).toBe(true);
    expect(assets.snapshot().residentBytes).toBeGreaterThanOrEqual(256);
  });
});

describe('R25 runtime lifecycle', () => {
  it('does not advance simulation while paused', async () => {
    const runtime = new RuntimeR25({
      forceBackend: 'none',
      qualityTier: 'safe',
    });

    await runtime.start();
    const before = runtime.clock.simulationTick();
    runtime.pause();
    await runtime.tick(100);
    expect(runtime.clock.simulationTick()).toBe(before + 1);
    runtime.resume();
    await runtime.tick(16);
    expect(runtime.clock.simulationTick()).toBe(before + 2);
    await runtime.stop();
    runtime.dispose();
  });

  it('attaches a legacy tick without making it authoritative', async () => {
    let calls = 0;
    const runtime = new RuntimeR25({
      forceBackend: 'none',
      qualityTier: 'safe',
    });

    runtime.attachLegacyTick(() => {
      calls += 1;
    });

    await runtime.tick(16);
    await runtime.tick(16);

    expect(calls).toBe(2);
    expect(runtime.snapshot().backend).toBe('none');
    runtime.dispose();
  });
});

describe('R25 input and worker interoperability', () => {
  it('coalesces move-axis changes while preserving action events', () => {
    const input = new InputIntentR25({
      maxQueue: 8,
      clock: () => 0,
    });

    input.enqueueMove(0.1, 0.1);
    input.enqueueMove(0.2, 0.2);
    input.enqueue({
      device: 'keyboard',
      code: 'Space',
      phase: 'pressed',
      timestampMs: 0,
    });

    const drained = input.drain(8);
    expect(drained.filter((value) => value.kind === 'move')).toHaveLength(1);
    expect(drained.some((value) => value.kind === 'jump')).toBe(true);
  });

  it('constructs protocol state around a host transport', async () => {
    const listeners = new Map<string, EventListener[]>();
    const transport = {
      postMessage(message: unknown) {
        queueMicrotask(() => {
          const list = listeners.get('message') ?? [];
          for (const listener of list) {
            listener(new MessageEvent('message', {
              data: {
                kind: 'response',
                id: (message as { id: string }).id,
                ok: true,
                result: { pong: true },
                respondedAtMs: 0,
                sequence: (message as { sequence: number }).sequence,
              },
            }));
          }
        });
      },
      addEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener) {
        const list = listeners.get(type) ?? [];
        list.push(listener);
        listeners.set(type, list);
      },
      removeEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener) {
        listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
      },
    };

    const protocol = new WorkerProtocolR25(transport, {
      requestTimeoutMs: 100,
    });

    const result = await protocol.request('ping', { value: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ pong: true });
    protocol.dispose();
  });
});

describe('R25 synthetic capability shape', () => {
  it('keeps capability structures stable for platform consumers', () => {
    const capabilities = syntheticCapabilities();
    expect(capabilities.backend).toBe('webgpu');
    expect(capabilities.maxTextureSize).toBe(16384);
    expect(capabilities.hardwareConcurrency).toBe(16);
  });
});
