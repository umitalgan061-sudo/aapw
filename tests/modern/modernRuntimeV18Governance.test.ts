import { describe, expect, it } from 'vitest';
import {
  RuntimeMigrationRegistryV18,
  createDefaultMigrationRegistryV18,
} from '../../src/3d/modern/runtimeMigrationV18';
import {
  TypedLegacyBoundaryV18,
  createDefaultLegacyContractRegistryV18,
} from '../../src/3d/modern/typedLegacyBoundaryV18';
import { ObservabilityV18 } from '../../src/3d/modern/observabilityV18';

describe('migration governance V18', () => {
  it('requires parity before validated cutover', () => {
    const registry = new RuntimeMigrationRegistryV18({
      clock: () => 100,
      minParityScore: 0.98,
    });

    registry.register({
      id: 'demo',
      domain: 'platform',
      legacyPath: 'src/demo.js',
      typedPath: 'src/demo.ts',
      owner: 'hybrid',
      state: 'legacy',
      risk: 'medium',
      contractIds: ['demo'],
      dependencies: [],
      parityRequired: true,
      notes: [],
    });

    registry.transition('demo', 'adapter', 0.5);
    registry.transition('demo', 'shadow', 0.97);

    expect(() =>
      registry.transition('demo', 'typed', 0.97),
    ).not.toThrow();

    expect(() =>
      registry.transition('demo', 'validated', 0.97),
    ).toThrow('Parity threshold');

    registry.transition('demo', 'blocked');
    registry.transition('demo', 'adapter');
    expect(registry.get('demo')?.state).toBe('adapter');
  });

  it('reports dependency blockers', () => {
    const registry = createDefaultMigrationRegistryV18();
    const failures = registry.validateDependencies();
    expect(Array.isArray(failures)).toBe(true);
    expect(registry.snapshot().surfaces.length).toBeGreaterThan(0);
    expect(registry.blockers('3d.chunk-manager')).toContain('PARITY_NOT_VALIDATED');
  });
});

describe('legacy typed boundary V18', () => {
  it('initializes idempotently and exposes capabilities', async () => {
    let initCalls = 0;
    let disposeCalls = 0;

    const boundary = new TypedLegacyBoundaryV18({
      clock: () => 25,
    });

    boundary.attach({
      id: 'legacy-world',
      init: async () => {
        initCalls += 1;
      },
      dispose: async () => {
        disposeCalls += 1;
      },
      snapshot: () => ({ ok: true }),
      health: () => ({ score: 1 }),
    });

    await boundary.initialize();
    await boundary.initialize();

    expect(initCalls).toBe(1);
    expect(boundary.hasCapability('snapshot')).toBe(true);
    expect(boundary.hasCapability('health')).toBe(true);

    await boundary.dispose();
    await boundary.dispose();
    expect(disposeCalls).toBe(1);
    expect(boundary.snapshot().state).toBe('disposed');
  });

  it('keeps legacy contract dependencies explicit', () => {
    const registry = createDefaultLegacyContractRegistryV18();
    const snapshot = registry.snapshot();

    expect(snapshot.count).toBeGreaterThanOrEqual(5);
    expect(snapshot.blockers).toEqual([]);
    expect(registry.validate()).toEqual([]);
  });
});

describe('observability V18', () => {
  it('keeps telemetry bounded and computes percentiles', () => {
    const telemetry = new ObservabilityV18({
      maxEvents: 128,
      maxMetrics: 16,
      clock: () => 100,
    });

    for (let i = 0; i < 700; i += 1) {
      telemetry.timing('frame', i % 50, i);
      telemetry.counter('frames', 1, i);
    }

    const snapshot = telemetry.snapshot();
    expect(snapshot.events.length).toBeLessThanOrEqual(128);
    expect(snapshot.droppedEvents).toBeGreaterThan(0);

    const frame = telemetry.metric('frame');
    expect(frame?.count).toBe(700);
    expect(frame?.p95).toBeGreaterThanOrEqual(frame?.p50 ?? 0);
  });

  it('closes spans after failures', () => {
    const telemetry = new ObservabilityV18({ clock: () => 10 });
    expect(() =>
      telemetry.withSpan('failing.operation', 1, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(telemetry.snapshot().activeSpans).toBe(0);
    expect(telemetry.errors().length).toBeGreaterThan(0);
  });
});