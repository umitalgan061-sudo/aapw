import { describe, expect, it } from 'vitest';
import {
  BudgetSchedulerV7, FrameOrchestratorV7, RuntimeDiagnosticsV7, RuntimeRecoveryV7, RuntimeTelemetryV7,
  tickV7,
} from '../../src/3d/modern/production-v7/index.ts';

describe('production runtime v7 frame orchestration', () => {
  it('executes all declared stages in deterministic order', () => {
    const scheduler = new BudgetSchedulerV7(1);
    const telemetry = new RuntimeTelemetryV7();
    const diagnostics = new RuntimeDiagnosticsV7();
    const recovery = new RuntimeRecoveryV7();
    const budgets = {
      render: { frameMs: 16.67, drawCalls: 100, triangles: 1000, textureBytes: 1000, gpuMemoryBytes: 2000 },
      simulation: { tickMs: 2, actorUpdates: 100, pathQueries: 10, physicsQueries: 20 },
      network: { maxBytesPerSecond: 65536, maxPacketBytes: 1200, maxSnapshotsPerSecond: 30, maxCommandsPerSecond: 120 },
      schedulerMs: 2.5,
    };
    const orchestrator = new FrameOrchestratorV7(scheduler, telemetry, diagnostics, recovery, budgets);
    const report = orchestrator.frame(tickV7(1), {
      input: () => 0.1, critical: () => 0.2, simulation: () => 0.3,
      streaming: () => 0.4, render: () => 0.5, telemetry: () => 0.6, background: () => 0.7,
    });
    expect(report.stages.map((stage) => stage.stage)).toEqual(['input', 'critical', 'simulation', 'streaming', 'render', 'telemetry', 'background']);
    expect(report.stages.reduce((sum, stage) => sum + stage.spentMs, 0)).toBeCloseTo(2.8);
    expect(report.schedulerSpentMs).toBe(0);
  });

  it('contains failures without terminating the frame', () => {
    const orchestrator = new FrameOrchestratorV7(
      new BudgetSchedulerV7(2), new RuntimeTelemetryV7(), new RuntimeDiagnosticsV7(), new RuntimeRecoveryV7(),
      {
        render: { frameMs: 16.67, drawCalls: 100, triangles: 1000, textureBytes: 1000, gpuMemoryBytes: 2000 },
        simulation: { tickMs: 2, actorUpdates: 100, pathQueries: 10, physicsQueries: 20 },
        network: { maxBytesPerSecond: 65536, maxPacketBytes: 1200, maxSnapshotsPerSecond: 30, maxCommandsPerSecond: 120 },
        schedulerMs: 2.5,
      },
    );
    const report = orchestrator.frame(tickV7(2), { simulation: () => { throw new Error('boom'); } });
    expect(report.stages.find((stage) => stage.stage === 'simulation')?.failed).toBe(1);
    expect(report.stages).toHaveLength(7);
  });
});
