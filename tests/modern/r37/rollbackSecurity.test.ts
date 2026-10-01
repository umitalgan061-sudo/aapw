import { describe, expect, it } from 'vitest';
import { RollbackBufferR37 } from '../../../src/3d/strict/r37/rollbackBuffer.ts';
import { SecurityBoundaryR37 } from '../../../src/3d/strict/r37/securityBoundary.ts';
import { interpolateAngle, sampleByTimestamp } from '../../../src/3d/strict/r37/interpolation.ts';

const snapshot = {
  version: 37 as const,
  seed: 1,
  tick: 10,
  mode: 'running' as const,
  entities: [],
  flags: {},
  values: {},
};

describe('R37 rollback/security/interpolation', () => {
  it('creates bounded rollback plans only inside the replay window', () => {
    const buffer = new RollbackBufferR37({ maxReplayTicks: 10 });
    buffer.push({ tick: 4, world: { ...snapshot, tick: 4 }, commands: [] });
    buffer.push({ tick: 8, world: { ...snapshot, tick: 8 }, commands: [] });
    expect(buffer.plan(8, 4).accepted).toBe(true);
    expect(buffer.plan(30, 4).accepted).toBe(false);
    expect(buffer.plan(4, 8).accepted).toBe(false);
  });

  it('rejects hostile deep payloads without executing them', () => {
    const security = new SecurityBoundaryR37({ maxDepth: 2 });
    const value = security.sanitize({ safe: { ok: { deeper: true } } });
    expect(value.accepted).toBe(false);
    expect(security.isSafeId('player:01')).toBe(true);
    expect(security.isSafeId('../escape')).toBe(false);
  });

  it('interpolates timestamps and wraps angles through the shortest path', () => {
    const sample = sampleByTimestamp([{ sentAtMs: 0, value: 1 }, { sentAtMs: 100, value: 2 }], 50);
    expect(sample?.alpha).toBe(0.5);
    expect(interpolateAngle(Math.PI * 0.95, -Math.PI * 0.95, 0.5)).toBeCloseTo(Math.PI, 5);
  });
});
