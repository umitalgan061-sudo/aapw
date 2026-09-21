import { describe, expect, it, vi } from 'vitest';
import { RuntimeStateGraph } from '../../src/3d/modern/runtimeState';
import { RuntimeSecurityBoundary } from '../../src/3d/modern/runtimeSecurity';
import { LoopbackTransport, RuntimeTransport } from '../../src/3d/modern/networkTransport';
import { WorldSnapshotStore } from '../../src/3d/modern/worldSnapshotStore';
import { RecoveryOrchestrator } from '../../src/3d/modern/recoveryOrchestrator';
import { InputIntentRouter } from '../../src/3d/modern/inputIntentRouter';
import { RenderBudgetOrchestrator } from '../../src/3d/modern/renderBudgetOrchestrator';
import { RuntimeWorldCoordinator } from '../../src/3d/modern/runtimeWorldCoordinator';
import { AssetIntegrityPipeline } from '../../src/3d/modern/assetIntegrityPipeline';
import { evaluateProductionHealth, assertProductionHealth } from '../../src/3d/modern/productionChecks';
import type { FrameId, UnixMillis } from '../../src/3d/modern/types';

describe('RuntimeStateGraph', () => {
  it('commits immutable transactional changes', () => {
    const graph = new RuntimeStateGraph({ initial: { player: { health: 100 }, flags: {} }, now: () => 10 as UnixMillis });
    const patch = graph.transaction({ source: 'ui', frame: 3 as FrameId }).set('player.health', 87).set('flags.menu', true).commit();
    expect(patch.revision).toBe(1);
    expect(graph.read('player.health')).toBe(87);
    const snapshot = graph.snapshot();
    expect(Object.isFrozen(snapshot.state)).toBe(true);
  });

  it('rejects cyclic state', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => new RuntimeStateGraph({ initial: value })).toThrow(/Cyclic/);
  });

  it('enforces nested transaction closure', () => {
    const graph = new RuntimeStateGraph({ initial: { value: 1 } });
    const tx = graph.transaction().set('value', 2);
    tx.commit();
    expect(() => tx.set('value', 3)).toThrow(/closed/);
  });

  it('exports committed patches with deterministic checksums', () => {
    const graph = new RuntimeStateGraph({ initial: { score: 0 } });
    graph.transaction().set('score', 10).commit();
    graph.transaction().set('score', 20).commit();
    expect(graph.exportPatch(0)).toHaveLength(2);
    expect(graph.exportPatch(1)).toHaveLength(1);
  });
});

describe('RuntimeSecurityBoundary', () => {
  it('accepts ordinary payloads', () => {
    const security = new RuntimeSecurityBoundary({ maxPayloadBytes: 4096 });
    expect(security.inspectPayload({ action: 'move', value: 0.5 }, 'input').ok).toBe(true);
  });

  it('rejects deep payloads', () => {
    const security = new RuntimeSecurityBoundary({ maxDepth: 2 });
    const nested = { a: { b: { c: 1 } } };
    expect(security.inspectPayload(nested, 'network').ok).toBe(false);
  });

  it('rejects data urls by default', () => {
    const security = new RuntimeSecurityBoundary();
    expect(security.checkUrl('data:text/plain,hello').accepted).toBe(false);
  });

  it('rejects credential-bearing urls', () => {
    const security = new RuntimeSecurityBoundary();
    expect(security.checkUrl('https://user:pass@example.test/a').accepted).toBe(false);
  });

  it('accepts configured origin', () => {
    const security = new RuntimeSecurityBoundary({ allowedOrigins: ['https://cdn.example.test'] });
    expect(security.checkUrl('https://cdn.example.test/asset.glb').accepted).toBe(true);
  });
});

describe('RuntimeTransport', () => {
  it('loops a reliable message through loopback', async () => {
    const transport = new RuntimeTransport(new LoopbackTransport());
    const received: unknown[] = [];
    transport.onMessage((message) => received.push(message.payload));
    await transport.connect();
    const sent = await transport.send('ping', { ok: true });
    expect(sent.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual([{ ok: true }]);
    expect(transport.stats().received).toBe(1);
    await transport.close();
  });

  it('queues messages before connection', async () => {
    const adapter = new LoopbackTransport();
    const transport = new RuntimeTransport(adapter);
    const queued = await transport.send('queued', { n: 1 });
    expect(queued.ok).toBe(true);
    expect(transport.stats().pending).toBe(1);
    await transport.connect();
    expect(transport.stats().pending).toBe(0);
    await transport.close();
  });

  it('rejects malformed incoming packets', async () => {
    const adapter = new LoopbackTransport();
    const transport = new RuntimeTransport(adapter);
    await transport.connect();
    let calls = 0;
    transport.onMessage(() => { calls += 1; });
    await adapter.send('{"bad":true}');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(0);
    expect(transport.stats().rejected).toBeGreaterThan(0);
    await transport.close();
  });
});

describe('WorldSnapshotStore', () => {
  it('retains latest snapshots under capacity', () => {
    const store = new WorldSnapshotStore<{ value: number }>({ capacity: 2 });
    store.capture({ value: 1 }, 1 as FrameId, 'one');
    store.capture({ value: 2 }, 2 as FrameId, 'two');
    store.capture({ value: 3 }, 3 as FrameId, 'three');
    expect(store.list()).toHaveLength(2);
    expect(store.latest()?.payload.value).toBe(3);
    expect(store.find('one')).toBeNull();
  });

  it('restores a cloned payload', () => {
    const store = new WorldSnapshotStore({ capacity: 2 });
    const record = store.capture({ nested: { x: 7 } }, 1 as FrameId, 'restore');
    const restored = store.restore(record.id);
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      (restored.value as { nested: { x: number } }).nested.x = 9;
      expect((record.payload as { nested: { x: number } }).nested.x).toBe(7);
    }
  });

  it('detects no corruption for untouched records', () => {
    const store = new WorldSnapshotStore({ capacity: 3 });
    store.capture({ x: 1 }, 1 as FrameId, 'x');
    expect(store.verify()).toEqual([]);
  });
});

describe('RecoveryOrchestrator', () => {
  it('executes the recovery lifecycle in order', async () => {
    const calls: string[] = [];
    const orchestrator = new RecoveryOrchestrator({ retryDelayMs: 0, now: (() => { let t = 0; return () => (++t) as UnixMillis; })() });
    orchestrator.register('renderer', {
      diagnose: () => { calls.push('diagnose'); return true; },
      quiesce: () => calls.push('quiesce'),
      reset: () => calls.push('reset'),
      replay: () => calls.push('replay'),
      resume: () => calls.push('resume'),
    });
    const result = await orchestrator.recover({ domain: 'renderer', reason: 'device-loss' });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['diagnose', 'quiesce', 'reset', 'replay', 'resume']);
  });

  it('stops after a failed handler', async () => {
    const orchestrator = new RecoveryOrchestrator({ retryDelayMs: 0 });
    orchestrator.register('network', { reset: () => { throw new Error('boom'); } });
    const result = await orchestrator.recover({ domain: 'network', reason: 'socket-error' });
    expect(result.ok).toBe(false);
    expect(orchestrator.stats().failed).toBe(1);
  });
});

describe('InputIntentRouter', () => {
  it('normalizes movement input', () => {
    const router = new InputIntentRouter();
    router.beginFrame(2 as FrameId);
    router.consume({ action: 'move.forward', source: 'keyboard', phase: 'value', value: 1, timestamp: 0 as UnixMillis, frame: 2 as FrameId, repeat: false });
    router.consume({ action: 'move.right', source: 'keyboard', phase: 'value', value: 1, timestamp: 0 as UnixMillis, frame: 2 as FrameId, repeat: false });
    const state = router.snapshot();
    expect(state.movement.x).toBeGreaterThan(0);
    expect(state.movement.y).toBeGreaterThan(0);
  });

  it('blocks gameplay-only interactions in menu mode', () => {
    const router = new InputIntentRouter();
    router.setMode('menu');
    router.beginFrame(1 as FrameId);
    expect(router.consume({ action: 'interaction.primary', source: 'keyboard', phase: 'pressed', value: 1, timestamp: 0 as UnixMillis, frame: 1 as FrameId, repeat: false })).toBeNull();
  });
});

describe('RenderBudgetOrchestrator', () => {
  it('downgrades under sustained pressure', () => {
    const budget = new RenderBudgetOrchestrator('high', { cooldownFrames: 2 });
    for (let frame = 1; frame <= 3; frame += 1) budget.observe(frame as FrameId, { frameMs: 40, cpuMs: 20, gpuMs: 25, drawCalls: 3000, triangles: 4_000_000, memoryBytes: 700 * 1024 * 1024, pressure: 1 });
    expect(['medium', 'minimal']).toContain(budget.tier);
  });

  it('upgrades only after stable headroom', () => {
    const budget = new RenderBudgetOrchestrator('medium', { cooldownFrames: 1 });
    for (let frame = 1; frame <= 3; frame += 1) budget.observe(frame as FrameId, { frameMs: 10, cpuMs: 2, gpuMs: 3, drawCalls: 300, triangles: 300_000, memoryBytes: 100 * 1024 * 1024, pressure: 0.1 });
    expect(budget.tier).toBe('high');
  });
});

describe('RuntimeWorldCoordinator', () => {
  it('builds deterministic interest tiers', () => {
    const world = new RuntimeWorldCoordinator({ nearRadius: 10, midRadius: 20, farRadius: 50 });
    world.upsert({ id: 'hero', kind: 'player', position: { x: 0, y: 0, z: 0 }, radius: 1, priority: 10, dynamic: true });
    world.upsert({ id: 'wolf', kind: 'animal', position: { x: 5, y: 0, z: 0 }, radius: 1, priority: 2, dynamic: true });
    world.upsert({ id: 'castle', kind: 'structure', position: { x: 100, y: 0, z: 0 }, radius: 1, priority: 5, dynamic: false });
    const interest = world.rebuildInterest({ x: 0, z: 0 }, 1 as FrameId);
    expect(interest.near).toContain('hero');
    expect(interest.near).toContain('wolf');
    expect(interest.sleeping).toContain('castle');
  });

  it('queries using spatial cells', () => {
    const world = new RuntimeWorldCoordinator({ cellSize: 10 });
    world.upsert({ id: 'a', kind: 'npc', position: { x: 2, y: 0, z: 2 }, radius: 1, priority: 1, dynamic: true });
    world.upsert({ id: 'b', kind: 'npc', position: { x: 50, y: 0, z: 50 }, radius: 1, priority: 1, dynamic: true });
    expect(world.queryRadius({ x: 0, z: 0 }, 5).map((item) => item.id)).toEqual(['a']);
  });
});

describe('AssetIntegrityPipeline', () => {
  it('registers an asset with validated metadata', () => {
    const pipeline = new AssetIntegrityPipeline();
    const result = pipeline.register({ id: 'hero', url: 'https://cdn.example.test/hero.glb', type: 'model', bytes: 4, digest: 'abcdef12345678', required: true });
    expect(result.ok).toBe(true);
    expect(pipeline.entry('hero')?.cacheKey).toMatch(/^aapw:hero:/);
  });

  it('rejects type mismatches', () => {
    const pipeline = new AssetIntegrityPipeline();
    const result = pipeline.register({ id: 'hero', url: 'https://cdn.example.test/hero.png', type: 'model', bytes: 4, digest: 'abcdef12345678', required: true });
    expect(result.ok).toBe(false);
  });
});

describe('production health', () => {
  it('reports healthy for nominal state', () => {
    const report = evaluateProductionHealth({ runtime: { lifecycle: 'running', frame: 120 as FrameId, quality: 'high', backend: 'webgpu', network: null, performance: {}, telemetry: {}, stateDigest: 'x' }, fps: 60, frameP95: 14, memoryBytes: 100, memoryLimitBytes: 1000, saveAvailable: true, security: [] });
    expect(assertProductionHealth(report, 'warning').ok).toBe(true);
  });

  it('blocks on security blocker', () => {
    const report = evaluateProductionHealth({ security: [{ code: 'X', severity: 'blocker', source: 'network', message: 'bad', timestamp: 0 as UnixMillis, metadata: {} }] });
    expect(report.level).toBe('blocked');
    expect(assertProductionHealth(report, 'warning').ok).toBe(false);
  });

  it('keeps the digest deterministic for equal check values', () => {
    const input = { runtime: null, fps: 60, frameP95: 14, security: [] as never[] };
    const first = evaluateProductionHealth(input);
    const second = evaluateProductionHealth(input);
    expect(first.digest).toBe(second.digest);
  });
});
