import { describe, expect, it } from 'vitest';
import {
  assertProductionReleaseGateV7, BudgetSchedulerV7, ProductionRuntimeV7, RuntimeValidatorV7,
  runProductionReleaseGateV7, tickV7,
} from '../../src/3d/modern/production-v7/index.ts';

describe('production runtime v7 release gate', () => {
  it('passes with default configuration', () => {
    const report = runProductionReleaseGateV7();
    expect(report.ok).toBe(true);
    expect(report.errors).toBe(0);
    expect(report.checks.some((check) => check.id === 'codec.roundtrip')).toBe(true);
    expect(assertProductionReleaseGateV7().checksum).toBe(report.checksum);
  });

  it('rejects unsafe scheduler budgets', () => {
    const report = runProductionReleaseGateV7({ ...({
      fixedHz: 60, maxCatchUpSteps: 4, schedulerMs: 2.5, worldCellMeters: 32,
      network: { maxBytesPerSecond: 64 * 1024, maxPacketBytes: 1200, maxSnapshotsPerSecond: 30, maxCommandsPerSecond: 120 },
      asset: { maxBytes: 256 * 1024 * 1024, reserveBytes: 16 * 1024 * 1024, maxEntries: 4096 },
    }), schedulerMs: 20 });
    expect(report.ok).toBe(false);
    expect(report.errors).toBeGreaterThan(0);
  });

  it('keeps scheduler order reproducible with identical seeds', () => {
    const build = (seed: number) => {
      const scheduler = new BudgetSchedulerV7(seed);
      for (let i = 0; i < 50; i += 1) scheduler.enqueue({
        id: `g-${i}`, lane: i % 2 ? 'simulation' : 'background', priority: i % 7,
        costEstimateMs: 0.01, budgetClass: 'preferred', maxDeferrals: 2, payload: i,
        run: (value, context) => ({ outcome: 'executed', costMs: 0.005 + (value + context.deterministicSeed) % 3 * 0.001 }),
      });
      return scheduler.runTick(tickV7(12), 1.5);
    };
    expect(build(123)).toEqual(build(123));
    expect(build(123).executed).toBeGreaterThan(0);
  });

  it('exposes validator failure paths', () => {
    const validator = new RuntimeValidatorV7();
    const report = validator.validateInput({ sequence: 1, tick: 1, move: { x: 5, y: 0, z: 0 }, look: { yaw: 0, pitch: 0 }, actions: [] });
    expect(report.ok).toBe(false);
    expect(report.failures.map((failure) => failure.path)).toContain('move');
  });
});
