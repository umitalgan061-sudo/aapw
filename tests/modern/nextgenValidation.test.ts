import { describe, expect, it } from 'vitest';
import { validateRuntimeMetrics, validateSimulationConfig, validateWorldSnapshot } from '../../src/3d/modern/nextgen/validation.ts';
import { stableChecksum, tickValue, revisionValue } from '../../src/3d/modern/nextgen/types.ts';

describe('nextgen validation', () => {
  it('accepts a valid simulation configuration', () => {
    const result = validateSimulationConfig({ tickRate: 60, maxCatchUpTicks: 8, maxFrameDeltaSeconds: 0.25, deterministicSeed: 1 });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('warns about extreme but still valid configuration values', () => {
    const result = validateSimulationConfig({ tickRate: 480, maxCatchUpTicks: 64, maxFrameDeltaSeconds: 0.25, deterministicSeed: 1 });
    expect(result.valid).toBe(true);
    expect(result.issues.every((issue) => issue.severity === 'warning')).toBe(true);
  });

  it('rejects invalid runtime metrics', () => {
    const result = validateRuntimeMetrics({ frameTimeMs: -1, simulationTimeMs: 1, renderTimeMs: 1, networkTimeMs: 1, entityCount: 0, activeSystems: 1, pendingCommands: 0, pendingResources: 0, snapshotBytes: 1 });
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('metrics.invalid');
  });

  it('accepts a correctly checksummed world snapshot', () => {
    const entities = [{ id: 1 as never, mask: 1, components: { Health: 100 } }];
    const snapshot = { tick: tickValue(3), revision: revisionValue(2), entities, checksum: stableChecksum(entities) };
    const result = validateWorldSnapshot(snapshot);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags duplicate entity ids and checksum drift', () => {
    const snapshot = {
      tick: tickValue(1),
      revision: revisionValue(1),
      entities: [
        { id: 1 as never, mask: 1, components: {} },
        { id: 1 as never, mask: 1, components: {} },
      ],
      checksum: 999,
    };
    const result = validateWorldSnapshot(snapshot);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'entity.duplicate')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'snapshot.checksum')).toBe(true);
  });
});
