import { describe, expect, it } from 'vitest';
import { RuntimeEventJournalR31 } from '../../../src/3d/strict/r31/runtimeEventJournalR31.ts';
import { ReplayRuntimeR31 } from '../../../src/3d/strict/r31/replayRuntimeR31.ts';
import { TelemetryBufferR31 } from '../../../src/3d/strict/r31/telemetryR31.ts';
import { MetricsAggregatorR31 } from '../../../src/3d/strict/r31/metricsAggregatorR31.ts';
import { PerformanceBudgetR31 } from '../../../src/3d/strict/r31/performanceBudgetR31.ts';

describe('R31 replay and observability', () => {
  it('keeps a bounded deterministic event journal', () => {
    const journal = new RuntimeEventJournalR31(64);
    journal.appendRaw(1, 'spawn', { id: 'a' });
    journal.appendRaw(2, 'move', { x: 1, z: 2 });
    expect(journal.query({ fromTick: 2 })[0]?.type).toBe('move');
    expect(journal.diagnostics().entries).toBe(2);
  });

  it('verifies replay checkpoints by canonical digest', () => {
    const replay = new ReplayRuntimeR31<{ score: number }>();
    replay.recordCheckpoint({
      version: 31,
      schema: 'aapw.runtime.r31',
      tick: 4,
      createdAt: 100,
      digest: 'a7eba9d6',
      state: { score: 10 },
    });
    const report = replay.verify((_tick, expected) => expected, 0, 10);
    expect(report.checkpoints).toBe(1);
    expect(report.ok).toBe(true);
  });

  it('aggregates telemetry and metrics without unbounded growth', () => {
    const telemetry = new TelemetryBufferR31(32);
    const metrics = new MetricsAggregatorR31(16);
    for (let i = 0; i < 40; i++) {
      telemetry.record({ timestampMs: i, name: 'frame', value: i, unit: 'ms', tags: {} });
      metrics.timer('frame', i);
    }
    expect(telemetry.diagnostics().samples).toBe(32);
    expect(metrics.summary('frame')?.count).toBe(16);
  });

  it('flags budget violations explicitly', () => {
    const budget = new PerformanceBudgetR31({
      frameMs: 10,
      simulationMs: 5,
      renderMs: 5,
      networkMs: 2,
      persistenceMs: 1,
      maxCommandsPerFrame: 10,
      maxEventsPerFrame: 10,
    });
    expect(budget.decide('simulation', 7).allowed).toBe(false);
    expect(budget.violations()).toBe(1);
  });
});
