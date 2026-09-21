import { describe, expect, it } from 'vitest';
import { buildSnapshotDelta } from '../../src/3d/modern/next/network.ts';
import { tick } from '../../src/3d/modern/next/types.ts';
import { InputButton } from '../../src/3d/modern/next/input.ts';
import { ProductionEntityRegistry } from '../../src/3d/modern/next/production/entityRegistry.ts';
import { ProductionRenderPlanner } from '../../src/3d/modern/next/production/renderRuntime.ts';
import { ProductionNetworkRuntime } from '../../src/3d/modern/next/production/networkRuntime.ts';
import { MemoryPersistenceStore, ProductionPersistenceRuntime } from '../../src/3d/modern/next/production/persistenceRuntime.ts';
import { ProductionLifecycleSupervisor, createLifecycleIdentity } from '../../src/3d/modern/next/production/lifecycle.ts';
import { ProductionRuntimeController } from '../../src/3d/modern/next/production/runtimeController.ts';
import { ProductionDiagnosticsService } from '../../src/3d/modern/next/production/diagnostics.ts';
import { runProductionAcceptanceSuite, summarizeAcceptance } from '../../src/3d/modern/next/production/acceptance.ts';

describe('R4 production acceptance', () => {
  it('passes the complete production acceptance suite with filesystem gate disabled in isolation', async () => {
    const report = await runProductionAcceptanceSuite({ includeMigrationFilesystemGate: false });
    expect(report.status).toBe('pass');
    expect(report.blockingFailures).toBe(0);
    expect(report.passed).toBeGreaterThan(20);
    expect(summarizeAcceptance(report)).toContain('AAPW production runtime R4');
  });

  it('preserves bounded entity capacity and stable visibility', () => {
    const entities = new ProductionEntityRegistry({ maxEntities: 4, maxVisibleEntities: 2 });
    entities.create({ id: 1, position: { x: 0, y: 0, z: 0 } });
    entities.create({ id: 2, position: { x: 2, y: 0, z: 0 } });
    entities.create({ id: 3, position: { x: 10, y: 0, z: 0 } });
    entities.frameUpdate(1, tick(1), { x: 0, y: 0, z: 0 }, 100);
    expect(entities.visibleIds()).toEqual([1, 2]);
    expect(entities.stats().capacity).toBe(4);
  });

  it('rejects network session mismatches and accepts valid deltas', () => {
    const network = new ProductionNetworkRuntime({ session: 'r4-test', commandRatePerSecond: 3 });
    network.connect('peer', 'loopback', 0);
    const base = { tick: tick(3), entities: [{ id: 1 as any, x: 0, y: 0, z: 0, yaw: 0, flags: 0 }] };
    const next = { tick: tick(6), entities: [{ id: 1 as any, x: 1, y: 0, z: 0, yaw: 0, flags: 1 }] };
    const delta = buildSnapshotDelta(base, next);
    const applied = network.applyDelta('peer', base, delta, tick(6));
    const wrong = network.receive('peer', { protocol: 3, session: 'bad', sequence: 1, ack: 0, sentTick: tick(6), kind: 'event', payload: {} }, tick(6), 10);
    expect(applied?.tick).toBe(next.tick);
    expect(wrong).toBe(false);
    expect(network.stats().rejectedPackets).toBe(1);
  });

  it('round-trips a save and rejects a malformed imported payload', async () => {
    const store = new MemoryPersistenceStore();
    const persistence = new ProductionPersistenceRuntime(store);
    const identity = createLifecycleIdentity({ build: 'r4-test' });
    await persistence.save('slot', 'manual', identity, {
      position: { x: 0, y: 1, z: 2 },
      health: 100,
      stamina: 75,
      flags: 0,
      entities: [],
      tick: tick(4),
    }, 44);
    const loaded = await persistence.load('slot');
    expect(loaded?.state.health).toBe(100);
    await expect(persistence.importSlot('{broken-json', 'fallback')).rejects.toThrow();
  });

  it('orders lifecycle transitions and exposes stopped mode', async () => {
    const calls: string[] = [];
    const lifecycle = new ProductionLifecycleSupervisor({ identity: createLifecycleIdentity(), recoveryAttempts: 1, faultAfterFailures: 2 });
    lifecycle.register({ id: 'simulation', subsystem: 'simulation', priority: 1, failurePolicy: 'fault-runtime', start: () => calls.push('start'), stop: () => calls.push('stop') });
    await lifecycle.start();
    await lifecycle.stop();
    expect(calls).toEqual(['start', 'stop']);
    expect(lifecycle.mode).toBe('stopped');
  });

  it('coordinates frame, save and diagnostics through one controller', async () => {
    const runtime = new ProductionRuntimeController({ maxEntities: 8, maxVisibleEntities: 4, identity: { build: 'r4-test' } });
    runtime.createEntity({ id: 1, position: { x: 0, y: 0, z: 0 }, health: 91 });
    await runtime.start();
    const frame = await runtime.frame({
      deltaSeconds: 1 / 60,
      input: { tick: tick(0), moveX: 0, moveZ: 1, lookX: 0, lookY: 0, buttons: InputButton.Primary },
      budget: { simulationMs: 1, renderMs: 4, streamingMs: 1, networkMs: 0, totalMs: 6 },
      wallTimeMs: 60,
    });
    const save = await runtime.save('r4', 'checkpoint');
    const diagnostics = new ProductionDiagnosticsService(runtime);
    const snapshot = diagnostics.capture();
    expect(frame.mode).toBe('running');
    expect(save.slot).toBe('r4');
    expect(snapshot.counters.entities).toBe(1);
    await runtime.dispose();
  });

  it('keeps diagnostics serializable after multiple captures', async () => {
    const runtime = new ProductionRuntimeController({ maxEntities: 4 });
    runtime.createEntity({ id: 1 });
    await runtime.start();
    const diagnostics = new ProductionDiagnosticsService(runtime, { historySize: 4 });
    for (let index = 0; index < 3; index += 1) {
      await runtime.frame({ deltaSeconds: 1 / 60, budget: { simulationMs: 1, renderMs: 2, streamingMs: 0, networkMs: 0, totalMs: 3 }, wallTimeMs: index * 20 });
      const value = diagnostics.exportJson();
      expect(() => JSON.parse(value)).not.toThrow();
    }
    await runtime.dispose();
  });
});
