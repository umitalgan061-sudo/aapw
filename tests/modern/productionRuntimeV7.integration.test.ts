import { describe, expect, it } from 'vitest';
import {
  AssetCacheV7, BudgetSchedulerV7, MemorySaveStorageV7, NetworkRuntimeV7, RuntimeCodecV7,
  RuntimeRecoveryV7, RuntimeTelemetryV7, createProductionRuntimeV7, entityIdV7, revisionV7,
  runProductionBenchmarksV7, tickV7, vec3V7, resolveRenderProfileV7, platformProfileForTestsV7,
} from '../../src/3d/modern/production-v7/index.ts';

const components = () => ({
  transform: { position: vec3V7(), yaw: 0, pitch: 0, scale: vec3V7(1, 1, 1) },
  kinematics: { velocity: vec3V7(), acceleration: vec3V7(), grounded: true, maxSpeed: 6 },
  vital: { health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, poise: 100, maxPoise: 100, invulnerableUntilTick: tickV7(0) },
  interest: { priority: 20, simulationLod: 0 as const, renderLod: 0 as const, alwaysRelevant: true },
  network: { owner: 'server', dirtyRevision: revisionV7(0), lastAckedSequence: 0 as never, replicated: true },
  tags: ['player'],
});

describe('production runtime v7 integration', () => {
  it('keeps save/load/checksum stable across instances', () => {
    const storage = new MemorySaveStorageV7();
    const runtime = createProductionRuntimeV7({ profile: platformProfileForTestsV7('full') });
    runtime.boot();
    expect(runtime.spawn(entityIdV7(1), 'player', components())).toBe(true);
    runtime.enqueue({ type: 'move', id: entityIdV7(1), position: vec3V7(10, 0, 2), velocity: vec3V7(1, 0, 0) });
    const snapshot = runtime.snapshot();
    const codec = new RuntimeCodecV7();
    const encoded = codec.encodeSnapshot(snapshot);
    expect(codec.decodeSnapshot(encoded).checksum).toBe(snapshot.checksum);
    const manager = runtime.saves;
    manager.save(1, snapshot.tick, revisionV7(runtime.revision), { snapshot, mode: runtime.mode, phase: runtime.phase });
    const loaded = manager.load(1);
    expect(loaded?.checksum).toBeDefined();
    expect(loaded?.payload.snapshot.checksum).toBe(snapshot.checksum);
    expect(storage.keys('aapw:v7:save:')).toEqual(['aapw:v7:save:1']);
  });

  it('honours platform-specific rendering limits', () => {
    const constrained = resolveRenderProfileV7(platformProfileForTestsV7('constrained'));
    const full = resolveRenderProfileV7(platformProfileForTestsV7('full'));
    expect(constrained.maxDrawCalls).toBeLessThan(full.maxDrawCalls);
    expect(constrained.textureBudgetBytes).toBeLessThan(full.textureBudgetBytes);
    expect(constrained.features.reflections).toBe(false);
    expect(full.features.reflections).toBe(true);
  });

  it('adapts quality under sustained frame pressure', () => {
    const policy = new (class {
      readonly inner = new (requirePolicy())(resolveRenderProfileV7(platformProfileForTestsV7('full')));
      decide(budget: any, health: any) { return this.inner.decide(budget, health); }
    });
    const budget = { frameMs: 32, drawCalls: 3000, triangles: 8_000_000, textureBytes: 500_000_000, gpuMemoryBytes: 700_000_000 };
    const first = policy.decide(budget, null);
    const second = policy.decide(budget, null);
    expect(second.effectiveScale).toBeLessThanOrEqual(first.effectiveScale);
  });

  it('runs scheduler work without leaking queued tasks', () => {
    const scheduler = new BudgetSchedulerV7(123);
    for (let i = 0; i < 8; i += 1) {
      scheduler.enqueue({ id: `task-${i}`, lane: 'simulation', priority: 10 - i, costEstimateMs: 0.1, budgetClass: 'preferred', maxDeferrals: 2, payload: i, run: () => ({ outcome: 'executed', costMs: 0.1 }) });
    }
    const report = scheduler.runTick(tickV7(1), 4);
    expect(report.executed).toBe(8);
    expect(scheduler.queuedCount()).toBe(0);
  });

  it('tracks network reliability and reconciliation data', () => {
    const network = new NetworkRuntimeV7();
    network.connect();
    network.markConnected();
    const packet = network.buildCommandPacket({ hello: 'world' }, tickV7(1));
    expect(packet).not.toBeNull();
    expect(network.receive(packet!, tickV7(1))).toBe(true);
    network.acknowledge(packet!.sequence, 50);
    expect(network.stats().estimatedRttMs).toBeLessThan(80);
    network.recordPrediction({ tick: tickV7(1), sequence: packet!.sequence, position: vec3V7(0, 0, 0), velocity: vec3V7(), checksum: 'a' as never });
    const result = network.reconcile({ tick: tickV7(1), sequence: packet!.sequence, position: vec3V7(1, 0, 0), velocity: vec3V7(), checksum: 'b' as never });
    expect(result.corrected).toBe(true);
  });

  it('produces deterministic benchmark output', () => {
    const a = runProductionBenchmarksV7(99, 8);
    const b = runProductionBenchmarksV7(99, 8);
    expect(a.aggregateChecksum).toBe(b.aggregateChecksum);
    expect(a.results.map((result) => result.name)).toEqual(['rng', 'spatial-nearest', 'scheduler', 'entity-digest', 'asset-cache']);
  });
});

function requirePolicy() {
  return class {
    #inner: any;
    constructor(profile: any) { this.#inner = new (globalThis as any).__AAPW_AdaptiveRenderPolicyV7(profile); }
  };
}
