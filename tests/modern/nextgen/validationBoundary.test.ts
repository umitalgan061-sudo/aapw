import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIMULATION_CONFIG,
  entityId,
  stableChecksum,
  validatePosition,
  validateRuntimeMetrics,
  validateSimulationConfig,
  validateWorldSnapshot,
} from '../../../src/3d/modern/nextgen/index.ts';

describe('modern nextgen validation boundary', () => {
  it('accepts the default simulation contract', () => {
    const report = validateSimulationConfig(DEFAULT_SIMULATION_CONFIG);
    expect(report.valid).toBe(true);
    expect(report.issues.filter(issue => issue.severity === 'error')).toHaveLength(0);
    expect(report.checksum).toBe(stableChecksum(DEFAULT_SIMULATION_CONFIG));
  });

  it('rejects zero-rate simulation configurations', () => {
    const report = validateSimulationConfig({
      ...DEFAULT_SIMULATION_CONFIG,
      tickRate: 0,
    });
    expect(report.valid).toBe(false);
    expect(report.issues.some(issue => issue.code === 'config.invalid')).toBe(true);
  });

  it('warns on extreme but structurally valid simulation settings', () => {
    const report = validateSimulationConfig({
      ...DEFAULT_SIMULATION_CONFIG,
      tickRate: 360,
      maxCatchUpTicks: 64,
    });
    expect(report.valid).toBe(true);
    expect(report.issues.filter(issue => issue.severity === 'warning')).toHaveLength(2);
  });

  it('accepts a canonical empty world snapshot', () => {
    const snapshot = {
      tick: 0,
      revision: 0,
      entities: [],
      checksum: stableChecksum([]),
    };
    const report = validateWorldSnapshot(snapshot);
    expect(report.valid).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('accepts valid entity snapshots and rejects checksum drift', () => {
    const entities = [{
      id: entityId(1),
      mask: 1,
      components: { Transform: { position: { x: 1, y: 2, z: 3 } } },
    }];
    const valid = validateWorldSnapshot({
      tick: 12,
      revision: 4,
      entities,
      checksum: stableChecksum(entities),
    });
    expect(valid.valid).toBe(true);

    const invalid = validateWorldSnapshot({
      tick: 12,
      revision: 4,
      entities,
      checksum: 123,
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.some(issue => issue.code === 'snapshot.checksum')).toBe(true);
  });

  it('rejects duplicate entity ids', () => {
    const entities = [
      { id: entityId(1), mask: 0, components: {} },
      { id: entityId(1), mask: 0, components: {} },
    ];
    const report = validateWorldSnapshot({
      tick: 1,
      revision: 1,
      entities,
      checksum: stableChecksum(entities),
    });
    expect(report.valid).toBe(false);
    expect(report.issues.some(issue => issue.code === 'entity.duplicate')).toBe(true);
  });

  it('rejects invalid entity masks and component shapes', () => {
    const entities = [
      { id: entityId(2), mask: -1, components: [] as never },
    ];
    const report = validateWorldSnapshot({
      tick: 1,
      revision: 1,
      entities,
      checksum: stableChecksum(entities),
    });
    const codes = report.issues.map(issue => issue.code);
    expect(report.valid).toBe(false);
    expect(codes).toContain('entity.mask');
    expect(codes).toContain('entity.components');
  });

  it('rejects non-finite component payloads', () => {
    const entities = [{
      id: entityId(3),
      mask: 1,
      components: {
        Transform: {
          position: { x: Number.NaN, y: 0, z: Number.POSITIVE_INFINITY },
        },
      },
    }];
    const report = validateWorldSnapshot({
      tick: 2,
      revision: 3,
      entities,
      checksum: stableChecksum(entities),
    });
    expect(report.valid).toBe(false);
    expect(report.issues.some(issue => issue.code === 'component.non_finite')).toBe(true);
  });

  it('rejects oversized component keys', () => {
    const longName = 'x'.repeat(129);
    const entities = [{
      id: entityId(4),
      mask: 1,
      components: { [longName]: true },
    }];
    const report = validateWorldSnapshot({
      tick: 2,
      revision: 3,
      entities,
      checksum: stableChecksum(entities),
    });
    expect(report.valid).toBe(false);
    expect(report.issues.some(issue => issue.code === 'component.name_length')).toBe(true);
  });

  it('accepts healthy runtime metrics', () => {
    const metrics = {
      frameTimeMs: 4,
      simulationTimeMs: 2,
      renderTimeMs: 1,
      networkTimeMs: 0.5,
      entityCount: 10_000,
      activeSystems: 32,
      pendingCommands: 4,
      pendingResources: 8,
      snapshotBytes: 1024,
    };
    const report = validateRuntimeMetrics(metrics);
    expect(report.valid).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('rejects negative and non-finite metrics', () => {
    const report = validateRuntimeMetrics({
      frameTimeMs: -1,
      simulationTimeMs: Number.NaN,
      renderTimeMs: 1,
      networkTimeMs: Number.POSITIVE_INFINITY,
      entityCount: 1,
      activeSystems: 1,
      pendingCommands: 0,
      pendingResources: 0,
      snapshotBytes: 0,
    });
    expect(report.valid).toBe(false);
    expect(report.issues.filter(issue => issue.code === 'metrics.invalid').length).toBeGreaterThanOrEqual(3);
  });

  it('warns instead of failing for high population telemetry', () => {
    const report = validateRuntimeMetrics({
      frameTimeMs: 8,
      simulationTimeMs: 3,
      renderTimeMs: 4,
      networkTimeMs: 1,
      entityCount: 1_000_001,
      activeSystems: 12,
      pendingCommands: 20,
      pendingResources: 32,
      snapshotBytes: 2 * 1024 * 1024,
    });
    expect(report.valid).toBe(true);
    expect(report.issues.some(issue => issue.code === 'metrics.entity_pressure')).toBe(true);
  });

  it('warns instead of failing for large persistence snapshots', () => {
    const report = validateRuntimeMetrics({
      frameTimeMs: 8,
      simulationTimeMs: 3,
      renderTimeMs: 4,
      networkTimeMs: 1,
      entityCount: 100,
      activeSystems: 12,
      pendingCommands: 20,
      pendingResources: 32,
      snapshotBytes: 9 * 1024 * 1024,
    });
    expect(report.valid).toBe(true);
    expect(report.issues.some(issue => issue.code === 'metrics.snapshot_size')).toBe(true);
  });

  it('validates standalone positions with precise paths', () => {
    expect(validatePosition({ x: 1, y: 2, z: 3 }, 'player.position')).toHaveLength(0);
    const issues = validatePosition({ x: Number.NaN, y: 2, z: 3 }, 'player.position');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('player.position');
    expect(issues[0]?.severity).toBe('error');
  });

  it('keeps invalid snapshot reporting deterministic', () => {
    const entities = [{
      id: entityId(9),
      mask: -4,
      components: { Nested: { value: Number.NaN } },
    }];
    const snapshot = { tick: -1, revision: -2, entities, checksum: 0 };
    const first = validateWorldSnapshot(snapshot);
    const second = validateWorldSnapshot(snapshot);
    expect(second).toEqual(first);
    expect(second.issues.map(issue => issue.code)).toEqual(first.issues.map(issue => issue.code));
  });
});
