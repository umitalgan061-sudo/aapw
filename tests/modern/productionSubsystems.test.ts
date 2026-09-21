import { describe, expect, it } from 'vitest';
import { checksum } from '../../src/3d/modern/deterministic';
import { RuntimeStateGraph } from '../../src/3d/modern/runtimeState';
import { RuntimeSecurityBoundary } from '../../src/3d/modern/runtimeSecurity';
import { WorldDeltaReplicator } from '../../src/3d/modern/worldDeltaReplicator';
import { WorldSnapshotStore } from '../../src/3d/modern/worldSnapshotStore';
import { RuntimeWorldCoordinator } from '../../src/3d/modern/runtimeWorldCoordinator';
import { RenderBudgetOrchestrator } from '../../src/3d/modern/renderBudgetOrchestrator';
import { AssetIntegrityPipeline } from '../../src/3d/modern/assetIntegrityPipeline';
import { RecoveryOrchestrator } from '../../src/3d/modern/recoveryOrchestrator';
import { detectCapabilitySignals, resolvePlatformProfile } from '../../src/3d/modern/browserCapabilityMatrix';
import { evaluateProductionHealth } from '../../src/3d/modern/productionChecks';

describe('state graph regression', () => {
  it.each([
    ['number', { value: 1 }],
    ['nested', { player: { health: 100, stamina: 40 } }],
    ['arrays', { items: [1, 2, 3] }],
  ])('stores %s state', (_name, initial) => {
    const graph = new RuntimeStateGraph({ initial });
    graph.transaction({ source: 'engine' }).set('value', 2).commit();
    expect(graph.snapshot().state).toBeDefined();
  });

  it('supports merge operations', () => {
    const graph = new RuntimeStateGraph({ initial: { settings: { volume: 1 } } });
    graph.transaction().merge('settings', { quality: 'high' }).commit();
    expect(graph.read('settings.quality')).toBe('high');
    expect(graph.read('settings.volume')).toBe(1);
  });

  it('supports delete operations', () => {
    const graph = new RuntimeStateGraph({ initial: { settings: { volume: 1, muted: true } } });
    graph.transaction().delete('settings.muted').commit();
    expect(graph.read('settings.muted')).toBeUndefined();
  });

  it('prevents invalid empty commits', () => {
    const graph = new RuntimeStateGraph({ initial: { x: 1 } });
    expect(() => graph.transaction().commit()).toThrow(/empty/);
  });
});

describe('security regression', () => {
  it('enforces array bounds', () => {
    const security = new RuntimeSecurityBoundary({ maxArrayLength: 3 });
    expect(security.inspectPayload([1, 2, 3, 4], 'network').ok).toBe(false);
  });

  it('enforces byte bounds', () => {
    const security = new RuntimeSecurityBoundary({ maxPayloadBytes: 20 });
    expect(security.inspectPayload({ text: 'x'.repeat(100) }, 'network').ok).toBe(false);
  });

  it('rejects unsupported protocols', () => {
    const security = new RuntimeSecurityBoundary();
    expect(security.checkUrl('javascript:alert(1)').accepted).toBe(false);
  });

  it('verifies digests', () => {
    const security = new RuntimeSecurityBoundary();
    const payload = { a: 1 };
    expect(security.verifyIntegrity(payload, checksum(payload)).ok).toBe(true);
    expect(security.verifyIntegrity(payload, '00000000').ok).toBe(false);
  });
});

describe('delta replication regression', () => {
  const entity = { id: 'hero', kind: 'player', transform: { x: 1, y: 0, z: 2, yaw: 0 }, state: 3, revision: 1 } as const;

  it('creates and applies deterministic deltas', () => {
    const server = new WorldDeltaReplicator();
    const client = new WorldDeltaReplicator();
    server.set(entity);
    const delta = server.createDelta(new Map(), 1 as never);
    const result = client.applyDelta(delta);
    expect(result.accepted).toBe(true);
    expect(client.entities()[0]?.id).toBe('hero');
  });

  it('rejects a bad checksum', () => {
    const server = new WorldDeltaReplicator();
    server.set(entity);
    const delta = server.createDelta(new Map(), 1 as never);
    const corrupted = { ...delta, checksum: 'bad' };
    expect(new WorldDeltaReplicator().applyDelta(corrupted).accepted).toBe(false);
  });

  it('rejects base revision mismatch', () => {
    const server = new WorldDeltaReplicator();
    server.set(entity);
    const delta = server.createDelta(new Map(), 1 as never);
    const client = new WorldDeltaReplicator();
    client.set({ ...entity, id: 'other' });
    expect(client.applyDelta(delta).accepted).toBe(false);
  });
});

describe('snapshot store regression', () => {
  it('evicts by capacity deterministically', () => {
    const store = new WorldSnapshotStore({ capacity: 3 });
    for (let i = 0; i < 10; i += 1) store.capture({ i }, i as never, `s${i}`);
    expect(store.list().map((item) => item.id)).toEqual(['s7', 's8', 's9']);
  });

  it('finds frame checkpoint at or before target', () => {
    const store = new WorldSnapshotStore();
    store.capture({ i: 1 }, 10 as never, 'a');
    store.capture({ i: 2 }, 20 as never, 'b');
    store.capture({ i: 3 }, 30 as never, 'c');
    expect(store.atOrBefore(24 as never)?.id).toBe('b');
  });
});

describe('world coordinator regression', () => {
  it('maintains cell membership when entities move', () => {
    const world = new RuntimeWorldCoordinator({ cellSize: 10 });
    world.upsert({ id: 'npc', kind: 'npc', position: { x: 1, y: 0, z: 1 }, radius: 1, priority: 1, dynamic: true });
    world.upsert({ id: 'npc', kind: 'npc', position: { x: 25, y: 0, z: 25 }, radius: 1, priority: 1, dynamic: true });
    expect(world.queryRadius({ x: 1, z: 1 }, 4)).toHaveLength(0);
    expect(world.queryRadius({ x: 25, z: 25 }, 4)).toHaveLength(1);
  });

  it('caps prioritized interest buckets', () => {
    const world = new RuntimeWorldCoordinator({ nearRadius: 20, maxNear: 2 });
    for (let i = 0; i < 20; i += 1) world.upsert({ id: `npc-${i}`, kind: 'npc', position: { x: i, y: 0, z: 0 }, radius: 1, priority: i, dynamic: true });
    expect(world.rebuildInterest({ x: 0, z: 0 }, 1 as never).near.length).toBeLessThanOrEqual(2);
  });
});

describe('render budget regression', () => {
  it('enters panic reduction under severe pressure', () => {
    const orchestrator = new RenderBudgetOrchestrator('ultra');
    const result = orchestrator.observe(1 as never, { frameMs: 100, cpuMs: 80, gpuMs: 90, drawCalls: 10000, triangles: 10_000_000, memoryBytes: 2 * 1024 * 1024 * 1024, pressure: 1 });
    expect(result.decision).toBe('panic');
    expect(orchestrator.tier).toBe('medium');
  });

  it('keeps tier stable in a normal frame', () => {
    const orchestrator = new RenderBudgetOrchestrator('high');
    const result = orchestrator.observe(1 as never, { frameMs: 16, cpuMs: 6, gpuMs: 8, drawCalls: 1000, triangles: 1_000_000, memoryBytes: 200 * 1024 * 1024, pressure: 0.2 });
    expect(result.next).toBe('high');
  });
});

describe('asset integrity regression', () => {
  it('rejects an over-budget model', () => {
    const pipeline = new AssetIntegrityPipeline({ maxModelBytes: 100 });
    expect(pipeline.register({ id: 'big', url: 'https://cdn.example.test/big.glb', type: 'model', bytes: 101, digest: 'abcdef12345678', required: true }).ok).toBe(false);
  });

  it('rejects extension/type mismatch', () => {
    const pipeline = new AssetIntegrityPipeline();
    expect(pipeline.register({ id: 'texture', url: 'https://cdn.example.test/hero.png', type: 'model', bytes: 4, digest: 'abcdef12345678', required: true }).ok).toBe(false);
  });
});

describe('recovery regression', () => {
  it('runs a full domain order without deadlocking', async () => {
    const orchestrator = new RecoveryOrchestrator({ retryDelayMs: 0 });
    const calls: string[] = [];
    for (const domain of ['input', 'streaming', 'network', 'save', 'renderer', 'simulation'] as const) orchestrator.register(domain, { reset: () => calls.push(domain) });
    const result = await orchestrator.recover({ domain: 'full', reason: 'global-restart', severity: 'fatal' });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['input', 'streaming', 'network', 'save', 'renderer', 'simulation']);
  });

  it('rate limits repeated failures', async () => {
    const orchestrator = new RecoveryOrchestrator({ retryDelayMs: 0, maxAttempts: 1, windowMs: 60_000 });
    orchestrator.register('network', { reset: () => { throw new Error('fail'); } });
    expect((await orchestrator.recover({ domain: 'network', reason: 'x' })).ok).toBe(false);
    expect((await orchestrator.recover({ domain: 'network', reason: 'x' })).ok).toBe(false);
  });
});

describe('capability matrix regression', () => {
  it('returns a deterministic profile shape', () => {
    const signals = detectCapabilitySignals();
    const profile = resolvePlatformProfile(signals);
    expect(profile.maxWorkers).toBeGreaterThanOrEqual(1);
    expect(['webgpu', 'webgl2', 'webgl1']).toContain(profile.graphics);
    expect(['minimal', 'medium', 'high', 'ultra']).toContain(profile.quality);
  });
});

describe('production health regression', () => {
  it('blocks a report with a blocker', () => {
    const report = evaluateProductionHealth({ security: [{ code: 'blocked', severity: 'blocker', source: 'network', message: 'bad', timestamp: 0 as never, metadata: {} }] });
    expect(report.level).toBe('blocked');
    expect(report.checks.some((check) => check.id === 'security.blockers' && check.score === 0)).toBe(true);
  });
});
