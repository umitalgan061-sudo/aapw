import { describe, expect, it } from 'vitest';
import {
  RuntimeApplication,
} from '../../src/3d/modern/runtimeApplicationV18';
import { InputPipelineV18 } from '../../src/3d/modern/inputPipelineV18';
import { RuntimeTopologyV18 } from '../../src/3d/modern/runtimeTopologyV18';
import { AssetLifecycleV18 } from '../../src/3d/modern/assetLifecycleV18';
import { WorldLifecycleV18 } from '../../src/3d/modern/worldLifecycleV18';
import { RenderPolicyV18 } from '../../src/3d/modern/renderPolicyV18';
import {
  MemoryPersistenceAdapterV18,
  PersistenceEnvelopeV18,
} from '../../src/3d/modern/persistenceEnvelopeV18';

describe('runtime topology V18', () => {
  it('orders services deterministically', async () => {
    const topology = new RuntimeTopologyV18({ clock: () => 10 });
    const started: string[] = [];

    topology.register({
      id: 'render',
      version: 18,
      scope: 'session',
      capabilities: ['render'],
      dependencies: ['world'],
      value: {},
      start: () => {
        started.push('render');
      },
    });

    topology.register({
      id: 'world',
      version: 18,
      scope: 'session',
      capabilities: ['world'],
      dependencies: ['input'],
      value: {},
      start: () => {
        started.push('world');
      },
    });

    topology.register({
      id: 'input',
      version: 18,
      scope: 'session',
      capabilities: ['input'],
      value: {},
      start: () => {
        started.push('input');
      },
    });

    await topology.start();
    expect(started).toEqual(['input', 'world', 'render']);
    expect(topology.snapshot().dependencyErrors).toEqual([]);
  });

  it('rejects cycles', () => {
    const topology = new RuntimeTopologyV18();
    topology.register({
      id: 'a',
      version: 1,
      scope: 'singleton',
      capabilities: ['clock'],
      dependencies: ['b'],
      value: {},
    });
    topology.register({
      id: 'b',
      version: 1,
      scope: 'singleton',
      capabilities: ['diagnostics'],
      dependencies: ['a'],
      value: {},
    });

    expect(topology.validate().dependencyErrors.some((item) => item.includes('dependency cycle'))).toBe(true);
  });
});

describe('input pipeline V18', () => {
  it('maps keyboard input into semantic commands', () => {
    const input = new InputPipelineV18({ now: () => 100 });
    const event = input.normalizeKeyboard('KeyW', 'pressed', 100);

    expect(event?.action).toBe('move-forward');
    const command = input.enqueue(event!, 0);
    expect(command?.device).toBe('keyboard');

    input.setTick(0);
    expect(input.drain()).toHaveLength(1);
    expect(input.isActive('move-forward')).toBe(true);
  });

  it('normalizes touch magnitude and bounds the queue', () => {
    const input = new InputPipelineV18({
      maxQueue: 32,
      maxAxisMagnitude: 1,
      now: () => 100,
    });

    for (let index = 0; index < 80; index += 1) {
      input.enqueue(input.normalizeTouch(100, 100, 10, 100 + index), 0);
    }

    const snapshot = input.snapshot();
    expect(snapshot.queueSize).toBeLessThanOrEqual(32);
    expect(snapshot.dropped).toBeGreaterThan(0);
  });
});

describe('asset lifecycle V18', () => {
  it('deduplicates in-flight requests', async () => {
    let requests = 0;

    const asset = new AssetLifecycleV18({
      maxConcurrent: 2,
      maxRetries: 0,
      fetcher: async () => {
        requests += 1;
        const body = new TextEncoder().encode('model-data').buffer;
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      },
    });

    asset.declare({
      id: 'model.hero',
      url: './hero.bin',
      kind: 'binary',
      priority: 'high',
      maxBytes: 1024,
    });

    const [a, b] = await Promise.all([
      asset.load('model.hero'),
      asset.load('model.hero'),
    ]);

    expect(a.bytes).toBe(b.bytes);
    expect(requests).toBe(1);
    expect(asset.hasReady('model.hero')).toBe(true);
  });

  it('evicts cold records when the budget is exceeded', async () => {
    const body = new TextEncoder().encode('1234567890').buffer;
    const asset = new AssetLifecycleV18({
      maxResidentBytes: 10 * 1024 * 1024,
      maxRetries: 0,
      fetcher: async () => new Response(body, { status: 200 }),
    });

    asset.declare({
      id: 'a',
      url: './a',
      kind: 'binary',
      priority: 'low',
      maxBytes: 1024,
    });

    await asset.load('a');
    asset.release('a');
    expect(asset.snapshot().residentCount).toBe(1);
    expect(asset.sweep(1000 + 120000).length).toBe(1);
  });
});

describe('world lifecycle V18', () => {
  it('prioritizes predicted proximity', () => {
    const world = new WorldLifecycleV18({
      maxResidentBytes: 64 * 1024 * 1024,
      loadConcurrency: 2,
    });

    world.register({
      id: 'near',
      x: 0,
      z: 0,
      radiusMeters: 50,
      kind: 'settlement',
      priority: 0,
      memoryBytes: 100,
    });

    world.register({
      id: 'far',
      x: 5000,
      z: 5000,
      radiusMeters: 50,
      kind: 'wildlife',
      priority: 0,
      memoryBytes: 100,
    });

    const plan = world.plan({
      x: 0,
      z: 0,
      velocityX: 20,
      velocityZ: 0,
      horizonSeconds: 1,
      prefetchRadiusMeters: 100,
    });

    expect(plan.predicted).toContain('near');
    expect(plan.load).toContain('near');
    expect(plan.predicted).not.toContain('far');
  });

  it('protects critical zones from unload', () => {
    const world = new WorldLifecycleV18();
    world.register({
      id: 'capital',
      x: 0,
      z: 0,
      radiusMeters: 100,
      kind: 'settlement',
      priority: 100,
      memoryBytes: 1024,
      critical: true,
    });
    world.completeLoad('capital');

    const plan = world.plan({
      x: 5000,
      z: 5000,
      horizonSeconds: 0,
      prefetchRadiusMeters: 0,
    });

    expect(plan.blockedUnload).toContain('capital');
    expect(world.unload('capital')).toBe(false);
  });
});

describe('render policy V18', () => {
  it('selects WebGPU only when explicitly available', () => {
    const policy = new RenderPolicyV18(
      {
        webgl2: true,
        webgpu: true,
        maxTextureSize: 8192,
        maxSamples: 8,
        deviceMemoryGb: 16,
        hardwareConcurrency: 12,
      },
      { preferredBackend: 'webgpu', initialTier: 'ultra' },
    );

    expect(policy.backend).toBe('webgpu');
    expect(policy.currentTier).toBe('ultra');
  });

  it('adapts down under sustained pressure', () => {
    const policy = new RenderPolicyV18(
      {
        webgl2: true,
        webgpu: false,
        maxTextureSize: 4096,
        maxSamples: 4,
        deviceMemoryGb: 8,
        hardwareConcurrency: 8,
      },
      {
        initialTier: 'high',
        downgradeFrames: 2,
        upgradeFrames: 3,
      },
    );

    policy.observe({
      frameMs: 40,
      cpuMs: 30,
      gpuMs: 30,
      memoryPressure: 1,
      thermalPressure: 1,
      drawCalls: 4000,
      visibleObjects: 4000,
      viewportWidth: 1920,
      viewportHeight: 1080,
      timestampMs: 1,
    });

    const decision = policy.observe({
      frameMs: 40,
      cpuMs: 30,
      gpuMs: 30,
      memoryPressure: 1,
      thermalPressure: 1,
      drawCalls: 4000,
      visibleObjects: 4000,
      viewportWidth: 1920,
      viewportHeight: 1080,
      timestampMs: 2,
    });

    expect(decision.tier).toBe('balanced');
  });
});

describe('persistence envelope V18', () => {
  it('detects checksum corruption', () => {
    const ledger = new PersistenceEnvelopeV18<{ hp: number }>({
      schema: 18,
      clock: () => 10,
      validate: (value): value is { hp: number } =>
        Boolean(value) &&
        typeof value === 'object' &&
        typeof (value as { hp?: unknown }).hp === 'number',
    });

    const encoded = ledger.encode({ hp: 100 }, 12);
    const corrupted = JSON.parse(encoded) as Record<string, unknown>;
    corrupted.checksum = '0'.repeat(64);

    const result = ledger.decode(JSON.stringify(corrupted));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('CHECKSUM_MISMATCH');
  });

  it('stores and restores a slot using memory storage', async () => {
    const adapter = new MemoryPersistenceAdapterV18();
    const ledger = new PersistenceEnvelopeV18<{ value: number }>({
      schema: 18,
      adapter,
      clock: () => 20,
      validate: (value): value is { value: number } =>
        Boolean(value) &&
        typeof value === 'object' &&
        typeof (value as { value?: unknown }).value === 'number',
    });

    await ledger.save('slot-a', { value: 42 }, 9);
    const loaded = await ledger.load('slot-a');

    expect(loaded.ok).toBe(true);
    expect(loaded.payload?.value).toBe(42);
  });
});

describe('runtime application V18', () => {
  it('boots and exposes a coherent snapshot', async () => {
    let time = 0;
    const runtime = new RuntimeApplication({
      clock: () => time,
      persistence: new MemoryPersistenceAdapterV18(),
      renderCapabilities: {
        webgl2: true,
        webgpu: false,
        maxTextureSize: 4096,
        maxSamples: 4,
        deviceMemoryGb: 8,
        hardwareConcurrency: 8,
      },
    });

    runtime.registerWorldZone({
      id: 'spawn',
      x: 0,
      z: 0,
      radiusMeters: 50,
      kind: 'terrain',
      priority: 1,
      memoryBytes: 2048,
    });

    await runtime.start();
    time = 16.67;
    const snapshot = await runtime.tick(time);

    expect(snapshot.state).toBe('running');
    expect(snapshot.frame).toBeGreaterThan(0);
    expect(snapshot.topology.orderedServices.length).toBeGreaterThan(0);
    expect(snapshot.render.tier).toBeDefined();

    await runtime.stop();
    expect(runtime.state).toBe('stopped');
  });

  it('keeps legacy game behind a typed loading boundary', async () => {
    let initialized = false;
    const runtime = new RuntimeApplication({
      persistence: new MemoryPersistenceAdapterV18(),
    });

    await runtime.attachLegacyGame({
      autoInitialize: true,
      moduleLoader: async () => ({
        initGame3D: async () => {
          initialized = true;
        },
        disposeGame3D: async () => {},
      }),
    });

    expect(initialized).toBe(true);
    expect(runtime.legacyAttached).toBe(true);
    await runtime.stop();
  });

  it('saves a deterministic runtime envelope', async () => {
    let time = 0;
    const adapter = new MemoryPersistenceAdapterV18();
    const runtime = new RuntimeApplication({
      clock: () => time,
      persistence: adapter,
    });

    await runtime.start();
    time = 16.67;
    await runtime.tick(time);

    await runtime.saveToSlot('slot-v18', { feature: 'typed-spine' });
    const loaded = await runtime.loadFromSlot('slot-v18');

    expect(loaded.ok).toBe(true);
    expect(loaded.payload?.version).toBe(18);

    await runtime.stop();
  });
});

describe('runtime lifecycle edge contracts V18', () => {
  it('rejects restart after terminal stop', async () => {
    const runtime = new RuntimeApplication({
      persistence: new MemoryPersistenceAdapterV18(),
    });
    await runtime.start();
    await runtime.stop();
    await expect(runtime.start()).rejects.toThrow('cannot restart after stop');
  });

  it('does not exceed world load concurrency in a single plan', () => {
    const world = new WorldLifecycleV18({ loadConcurrency: 2 });
    for (let index = 0; index < 8; index += 1) {
      world.register({
        id: `zone-${index}`,
        x: index * 10,
        z: 0,
        radiusMeters: 20,
        kind: 'terrain',
        priority: 0,
        memoryBytes: 1024,
      });
    }
    const plan = world.plan({ x: 0, z: 0, prefetchRadiusMeters: 100, horizonSeconds: 0 });
    expect(plan.load.length).toBeLessThanOrEqual(2);
  });
});