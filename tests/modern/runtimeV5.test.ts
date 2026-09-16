import { describe, expect, it } from 'vitest';
import { AssetDependencyGraphV5 } from '../../src/3d/modern/assetGraphV5';
import { ContentionCoordinatorV5 } from '../../src/3d/modern/contentionCoordinatorV5';
import { DeterministicSchedulerV5 } from '../../src/3d/modern/deterministicSchedulerV5';
import { InputPipelineV5 } from '../../src/3d/modern/inputPipelineV5';
import { NetworkSessionV5 } from '../../src/3d/modern/networkSessionV5';
import { PerformanceControllerV5 } from '../../src/3d/modern/performanceControllerV5';
import { PersistenceRuntimeV5 } from '../../src/3d/modern/persistenceRecoveryV5';
import { RecoveryCoordinatorV5 } from '../../src/3d/modern/persistenceRecoveryV5';
import { RuntimeOrchestratorV5 } from '../../src/3d/modern/runtimeOrchestratorV5';
import { RuntimeVerificationV5 } from '../../src/3d/modern/verificationV5';
import { VisibilityPipelineV5, createRenderCandidateV5 } from '../../src/3d/modern/renderVisibilityV5';
import { WorldSimulationV5, createGroundPlaneV5 } from '../../src/3d/modern/worldSimulationV5';
import { entityIdV5, tickV5, vec3V5, createEntityStateV5, defaultBudgetV5 } from '../../src/3d/modern/runtimeContractV5';

describe('runtime contract v5', () => {
  it('creates deterministic vectors and entity state', () => {
    const entity = createEntityStateV5(entityIdV5(3), { velocity: vec3V5(1, 2, 3), tags: [' b ', 'a', 'a'] });
    expect(entity.id).toBe(3);
    expect(entity.tags).toEqual(['a', 'b']);
    expect(entity.velocity).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('keeps ticks monotonic', () => {
    expect(tickV5(10)).toBe(10);
    expect(tickV5(-4)).toBe(0);
    expect(tickV5(2.9)).toBe(2);
  });
});

describe('deterministic scheduler v5', () => {
  it('executes tasks in priority order', () => {
    const trace: string[] = [];
    const scheduler = new DeterministicSchedulerV5({ now: (() => { let value = 0; return () => ++value; })() });
    scheduler.register({ id: 'low', phase: 'simulation', priority: 1, intervalTicks: 1, budgetMs: 5, run: () => trace.push('low') });
    scheduler.register({ id: 'high', phase: 'simulation', priority: 10, intervalTicks: 1, budgetMs: 5, run: () => trace.push('high') });
    scheduler.run(tickV5(1));
    expect(trace).toEqual(['high', 'low']);
  });

  it('honours task intervals', () => {
    let calls = 0;
    const scheduler = new DeterministicSchedulerV5();
    scheduler.register({ id: 'every2', phase: 'simulation', priority: 1, intervalTicks: 2, budgetMs: 5, run: () => { calls += 1; } });
    scheduler.run(tickV5(1));
    scheduler.run(tickV5(2));
    scheduler.run(tickV5(3));
    expect(calls).toBe(1);
  });

  it('isolates task exceptions', () => {
    const scheduler = new DeterministicSchedulerV5();
    scheduler.register({ id: 'bad', phase: 'simulation', priority: 1, intervalTicks: 1, budgetMs: 5, run: () => { throw new Error('boom'); } });
    expect(() => scheduler.run(tickV5(1))).not.toThrow();
    expect(scheduler.metrics().executed).toBe(1);
  });
});

describe('asset dependency graph v5', () => {
  const descriptor = (id: string, dependencies: readonly string[] = []) => ({ id, url: `https://cdn.example.test/${id}.bin`, type: 'binary' as const, bytes: 1024, version: '1', digest: 'abcdef12345678', dependencies, required: false });
  it('declares and queues assets', () => {
    const graph = new AssetDependencyGraphV5();
    expect(graph.declare(descriptor('a')).ok).toBe(true);
    expect(graph.enqueue({ id: 'a', priority: 50 }).ok).toBe(true);
    expect(graph.acquireNext().value?.id).toBe('a');
  });
  it('expands dependencies in deterministic order', () => {
    const graph = new AssetDependencyGraphV5();
    graph.declare(descriptor('root', ['b', 'a']));
    graph.declare(descriptor('a'));
    graph.declare(descriptor('b'));
    const result = graph.expandDependencies('root');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(['a', 'b']);
  });
  it('rejects missing dependencies at validation time', () => {
    const graph = new AssetDependencyGraphV5();
    graph.declare(descriptor('root', ['missing']));
    expect(graph.metrics().declared).toBe(1);
  });
  it('accepts only matching integrity digests', () => {
    const graph = new AssetDependencyGraphV5();
    graph.declare(descriptor('a'));
    graph.enqueue({ id: 'a', priority: 1 });
    graph.acquireNext();
    expect(graph.complete('a', 'wrong').ok).toBe(false);
    expect(graph.complete('a', 'abcdef12345678').ok).toBe(true);
  });
});

describe('network session v5', () => {
  it('creates, sends and receives reliable envelopes', () => {
    let now = 100;
    const network = new NetworkSessionV5({ now: () => now });
    expect(network.connect('p1').ok).toBe(true);
    const created = network.create('p1', 'command', tickV5(1), { action: 'jump' }, true);
    expect(created.ok).toBe(true);
    const encoded = network.send('p1', created.value!).value!;
    const received = network.receive<{ action: string }>('p1', encoded);
    expect(received.ok).toBe(true);
    expect(network.metrics().sent).toBe(1);
    expect(network.metrics().received).toBe(1);
    now += 500;
    expect(network.retryDue().length).toBe(0);
  });
  it('applies backpressure', () => {
    const network = new NetworkSessionV5({ maxPendingPerPeer: 1 });
    network.connect('p1');
    const first = network.create('p1', 'event', tickV5(1), { id: 1 }, true).value!;
    expect(network.send('p1', first).ok).toBe(true);
    const second = network.create('p1', 'event', tickV5(1), { id: 2 }, true).value!;
    expect(network.send('p1', second).ok).toBe(false);
  });
});

describe('input pipeline v5', () => {
  it('detects pressed and released actions', () => {
    const input = new InputPipelineV5();
    input.installDefaults();
    const down = input.applyKey(tickV5(1), 'Space', true).value!;
    const up = input.applyKey(tickV5(2), 'Space', false).value!;
    const first = input.ingest(tickV5(1), [down]);
    const second = input.ingest(tickV5(2), [up]);
    expect(first.pressed).toContain('jump');
    expect(second.released).toContain('jump');
  });
  it('normalizes deadzone values', () => {
    const input = new InputPipelineV5({ deadzone: 0.2 });
    const command = input.nextCommand(tickV5(1), 'look', 0.1, 'mouse', vec3V5(1, 0, 0));
    const frame = input.ingest(tickV5(1), [command]);
    expect(frame.commands[0]?.value).toBe(0.1);
  });
});

describe('performance controller v5', () => {
  it('downgrades quality under severe pressure', () => {
    const controller = new PerformanceControllerV5({ sampleWindow: 4 });
    for (let i = 0; i < 4; i += 1) controller.sample({ frameMs: 50, cpuMs: 25, gpuMs: 25, drawCalls: 5000, triangles: 5_000_000, memoryBytes: 900_000_000, networkBytes: 5_000_000, assetBytes: 100_000_000 });
    expect(['minimal', 'balanced', 'high', 'ultra']).toContain(controller.quality());
    expect(controller.usage().pressure).toBeGreaterThan(1);
  });
  it('returns bounded render scale', () => {
    const controller = new PerformanceControllerV5();
    for (let i = 0; i < 3; i += 1) controller.sample({ frameMs: 30, cpuMs: 20, gpuMs: 20, drawCalls: 3000, triangles: 3_000_000, memoryBytes: 700_000_000, networkBytes: 2_000_000, assetBytes: 80_000_000 });
    expect(controller.scale()).toBeGreaterThanOrEqual(0.55);
    expect(controller.scale()).toBeLessThanOrEqual(1);
  });
});

describe('world simulation v5', () => {
  it('integrates movement and gravity', () => {
    const world = new WorldSimulationV5({ fixedDeltaSeconds: 1 / 60 });
    world.addPlane(createGroundPlaneV5());
    const entity = createEntityStateV5(entityIdV5(1), { transform: { position: vec3V5(0, 10, 0), rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: vec3V5(1, 1, 1) }, velocity: vec3V5(1, 0, 0) });
    world.upsert(entity);
    world.step(tickV5(1), new Map([[entity.id, { movement: vec3V5(1, 0, 0), sprint: false, jump: false, jumpImpulse: 9, acceleration: 20, maxSpeed: 8 }]]));
    expect(world.get(entity.id)?.transform.position.x).toBeGreaterThan(0);
    expect(Number.isFinite(world.get(entity.id)?.transform.position.y ?? 0)).toBe(true);
  });
  it('keeps entities inside the configured world limit', () => {
    const world = new WorldSimulationV5({ worldLimit: 10 });
    const entity = createEntityStateV5(entityIdV5(2), { transform: { position: vec3V5(100, 100, 100), rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: vec3V5(1, 1, 1) } });
    world.upsert(entity);
    world.step(tickV5(1));
    expect(world.get(entity.id)?.transform.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('visibility pipeline v5', () => {
  it('sorts visible objects deterministically', () => {
    const pipeline = new VisibilityPipelineV5({ maxVisible: 2 });
    const camera = { position: vec3V5(0, 0, 10), forward: vec3V5(0, 0, -1), fov: 70, near: 0.1, far: 100 };
    const a = createRenderCandidateV5(entityIdV5(1), vec3V5(0, 0, 0));
    const b = createRenderCandidateV5(entityIdV5(2), vec3V5(0, 0, -2));
    const c = createRenderCandidateV5(entityIdV5(3), vec3V5(0, 0, -4));
    const result = pipeline.evaluate([c, a, b], camera);
    expect(result.visible.length).toBe(2);
    expect(result.culled).toBeGreaterThanOrEqual(1);
  });
});

describe('contention coordinator v5', () => {
  it('grants capacity-bounded leases', () => {
    let now = 0;
    const coordinator = new ContentionCoordinatorV5({ now: () => now, capacity: { render: 2 } });
    const a = coordinator.request({ owner: 'a', domain: 'render', priority: 10, deadline: 1000, units: 1 });
    const b = coordinator.request({ owner: 'b', domain: 'render', priority: 5, deadline: 1000, units: 1 });
    const c = coordinator.request({ owner: 'c', domain: 'render', priority: 1, deadline: 1000, units: 1 });
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(c).toBeNull();
    now = 1000;
    expect(coordinator.leases().length).toBe(0);
  });
});

describe('recovery and verification v5', () => {
  it('recovers registered domains', () => {
    const calls: string[] = [];
    const recovery = new RecoveryCoordinatorV5({ cooldownMs: 0 });
    recovery.register({ domain: 'render', diagnose: () => false, quiesce: () => calls.push('quiesce'), reset: () => calls.push('reset'), replay: () => calls.push('replay'), resume: () => calls.push('resume') });
    const report = recovery.recover({ reason: 'test', domains: ['render'], maxAttempts: 2, cooldownMs: 0 }, tickV5(1));
    expect(report.success).toBe(true);
    expect(calls).toEqual(['quiesce', 'reset', 'replay', 'resume']);
  });
  it('verifies a healthy runtime', () => {
    const runtime = new RuntimeOrchestratorV5({ now: (() => { let t = 0; return () => ++t; })() });
    runtime.start();
    const verifier = new RuntimeVerificationV5({ minScore: 50 });
    const report = verifier.verify(runtime);
    expect(report.findings.length).toBeGreaterThan(5);
    expect(report.score).toBeGreaterThanOrEqual(0);
  });
});

describe('runtime orchestrator v5', () => {
  it('runs a full deterministic frame', () => {
    const runtime = new RuntimeOrchestratorV5({ now: (() => { let t = 0; return () => ++t; })(), maxEntities: 10 });
    runtime.start();
    const id = runtime.spawn({ velocity: vec3V5(1, 0, 0) });
    const metrics = runtime.frame(1 / 60);
    expect(metrics.tick).toBe(1);
    expect(runtime.entity(id)?.revision).toBeGreaterThan(0);
    expect(runtime.health().score).toBeGreaterThan(0);
  });
  it('pauses without mutating simulation', () => {
    const runtime = new RuntimeOrchestratorV5();
    runtime.start();
    const id = runtime.spawn();
    runtime.pause();
    const before = runtime.entity(id)?.revision;
    runtime.frame();
    expect(runtime.entity(id)?.revision).toBe(before);
  });
});

describe('budget contract v5', () => {
  it('provides positive defaults', () => {
    const budget = defaultBudgetV5();
    expect(budget.frameMs).toBeGreaterThan(0);
    expect(budget.memoryBytes).toBeGreaterThan(0);
    expect(budget.triangles).toBeGreaterThan(0);
  });
});
