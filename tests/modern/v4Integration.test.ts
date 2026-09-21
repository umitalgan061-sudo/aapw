import { describe, expect, it } from 'vitest';
import { RuntimeV4Facade } from '../../src/3d/modern/runtimeV4Facade';
import { ReplayRuntimeV4 } from '../../src/3d/modern/replayRuntimeV4';
import { PerformanceBudgetV4 } from '../../src/3d/modern/performanceBudgetV4';
import { MigrationRegistryV4 } from '../../src/3d/modern/migrationV4';
import { ReleaseGateV4 } from '../../src/3d/modern/releaseGateV4';
import { traceId, tickId, vec3V4, transformV4, quaternionV4 } from '../../src/3d/modern/runtimeContractsV4';

describe('v4 facade and migration', () => {
  it('exposes a stable bridge state around the runtime', () => {
    const facade = new RuntimeV4Facade({ id: 'integration', now: () => 100 });
    expect(facade.boot()).toBe(true);
    facade.registerPlayer(transformV4(vec3V4(1, 2, 3), quaternionV4(), vec3V4(1, 1, 1)));
    facade.movePlayer(vec3V4(4, 5, 6), vec3V4(1, 0, 0));
    expect(facade.bridgeState().player?.position.x).toBe(4);
    expect(facade.health().phase).toBe('running');
    facade.shutdown();
  });

  it('keeps migration promotion evidence explicit', () => {
    const facade = new RuntimeV4Facade({ id: 'migration', now: () => 100 });
    const registry = new MigrationRegistryV4(facade.id);
    expect(registry.promote('render').ok).toBe(false);
    registry.record('render', { count: 10 }, { count: 10 });
    expect(registry.promote('render').ok).toBe(true);
    expect(registry.status('render')).toBe('promoted');
  });
});

describe('v4 replay runtime', () => {
  it('records and imports deterministic tapes', () => {
    const replay = new ReplayRuntimeV4({ now: () => 100 });
    replay.start('build', 'runtime', 16.67, { seed: 7 });
    replay.recordInput({ device: 'keyboard', code: 'KeyW', value: 1, pressed: true, timestamp: 100, sequence: 1 }, traceId('input'));
    replay.marker('milestone', tickId(1), traceId('marker'), { x: 1 });
    const tape = replay.tape();
    expect(tape.ok).toBe(true);
    const imported = new ReplayRuntimeV4({ now: () => 100 });
    expect(imported.importTape(tape.value).ok).toBe(true);
    expect(imported.next()?.kind).toBe('input');
    expect(imported.next()?.kind).toBe('marker');
  });

  it('rejects a modified tape', () => {
    const replay = new ReplayRuntimeV4({ now: () => 100 });
    replay.start('build', 'runtime', 16.67, 3);
    replay.marker('ok', tickId(1), traceId('t'));
    const tape = replay.tape().value;
    const imported = new ReplayRuntimeV4({ now: () => 100 });
    expect(imported.importTape({ ...tape, checksum: 'badbad00' }).ok).toBe(false);
  });
});

describe('v4 performance policy', () => {
  it('downgrades only after sustained overload', () => {
    const performance = new PerformanceBudgetV4({ hysteresisFrames: 2, minimumQuality: 'low' });
    const sample = { frameMs: 100, cpuMs: 100, gpuMs: 100, drawCalls: 9999, triangles: 9999999, memoryMb: 9999, networkKbps: 99999, activeEntities: 5000 };
    performance.update(sample);
    expect(performance.state().quality).toBe('high');
    performance.update(sample);
    expect(performance.state().quality).toBe('medium');
  });

  it('does not upgrade during ordinary pressure', () => {
    const performance = new PerformanceBudgetV4({ hysteresisFrames: 2 });
    for (let i = 0; i < 3; i += 1) performance.update({ frameMs: 20, cpuMs: 4, gpuMs: 4, drawCalls: 100, triangles: 10000, memoryMb: 256, networkKbps: 200, activeEntities: 100 });
    expect(performance.state().quality).toBe('high');
  });
});

describe('v4 release gate', () => {
  it('reports exact blocking gate details', () => {
    const gate = new ReleaseGateV4();
    const result = gate.evaluate({
      buildId: 'integration-build',
      health: { phase: 'running', score: 92, errors: 0, warnings: 0, stalled: false, memoryPressure: 0, networkPressure: 0, renderPressure: 0, simulationDrift: 0 },
      quality: 'high',
      typecheckPassed: true,
      testsPassed: true,
      deterministicGuardPassed: false,
      forbiddenPrimitiveCount: 0,
      assetIntegrityFailures: 0,
      networkProtocolErrors: 0,
    });
    expect(result.report.passed).toBe(false);
    expect(result.blockingFailures.map((gateEntry) => gateEntry.name)).toContain('deterministic-guard');
  });
});
