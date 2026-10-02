
import { describe, expect, it } from 'vitest';
import { DiagnosticsR41 } from '../../src/3d/strict/r41/diagnostics.ts';
import { StreamingPlannerR41, StreamingBudgetR41, lodForDistance } from '../../src/3d/strict/r41/streaming.ts';
import { WorkerPoolR41, SerialWorkerR41 } from '../../src/3d/strict/r41/workers.ts';
import { RuntimeIntegrityR41 } from '../../src/3d/strict/r41/integrity.ts';
import type { Entity, TelemetrySample, RuntimeConfig } from '../../src/3d/strict/r41/types.ts';
import { createDefaultBudgetsR41 } from '../../src/3d/strict/r41/scheduler.ts';

function sample(tick: number, frameMs: number): TelemetrySample {
  return {
    tick,
    frameMs,
    simulationMs: frameMs * 0.5,
    renderMs: frameMs * 0.4,
    networkMs: 0.1,
    streamingMs: 0.2,
    persistenceMs: 0,
    entityCount: 10,
    activeCount: 8,
    memoryBytes: 1024,
    quality: 'balanced',
  };
}

const entity: Entity = {
  id: 'npc-a',
  kind: 'npc',
  transform: { position: { x: 20, y: 0, z: 20 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
  velocity: { x: 0, y: 0, z: 0 },
  health: 100,
  stamina: 100,
  active: true,
  lod: 1,
  revision: 1,
  tags: ['town'],
  data: {},
};

describe('R41 diagnostics', () => {
  it('computes percentile telemetry and actionable alerts', () => {
    const diagnostics = new DiagnosticsR41();
    diagnostics.setMode('running');
    for (let tick = 1; tick <= 10; tick += 1) diagnostics.record(sample(tick, 22 + tick));
    diagnostics.recordDroppedSteps(2);
    diagnostics.recordFailedTasks(1);
    const report = diagnostics.snapshot();
    expect(report.p95FrameMs).toBeGreaterThanOrEqual(report.p50FrameMs);
    expect(diagnostics.alerts().some(alert => alert.code === 'frame-warning')).toBe(true);
    expect(diagnostics.alerts().some(alert => alert.code === 'simulation-drops')).toBe(true);
    expect(diagnostics.health().score).toBeLessThan(100);
  });
});

describe('R41 streaming', () => {
  it('maps distance and quality into stable LODs', () => {
    expect(lodForDistance(40)).toBe(0);
    expect(lodForDistance(300)).toBe(2);
    expect(lodForDistance(1000)).toBe(3);
    expect(lodForDistance(300, 'minimal')).toBe(3);
  });

  it('prioritizes player interest and limits loads', () => {
    const planner = new StreamingPlannerR41({ maxRequests: 1, maxConcurrentLoads: 1 });
    const plan = planner.plan(
      10,
      [{ id: 'camera', position: { x: 0, y: 0, z: 0 }, radius: 500, weight: 1, class: 'camera' }],
      [entity],
      new Set(),
      'balanced',
    );
    expect(plan.loads).toHaveLength(1);
    expect(plan.loads[0]?.id).toBe('npc-a');
  });

  it('keeps streaming loads bounded by active capacity', () => {
    const budget = new StreamingBudgetR41(1, 1);
    expect(budget.beginLoad('a', 1)).toBe(true);
    expect(budget.beginLoad('b', 1)).toBe(false);
    budget.completeLoad('a');
    expect(budget.activeCount()).toBe(0);
  });
});

describe('R41 workers', () => {
  it('executes bounded priority work and retains results', async () => {
    const pool = new WorkerPoolR41({ concurrency: 2 });
    const values: number[] = [];
    pool.enqueue({ id: 'low', priority: 'low', payload: 1, run: value => values.push(value) });
    pool.enqueue({ id: 'high', priority: 'high', payload: 2, run: value => values.push(value) });
    await pool.drain(() => 0);
    expect(values).toContain(2);
    expect(values).toContain(1);
    expect(pool.snapshot().completed).toBe(2);
  });

  it('provides an explicit serial worker guard', async () => {
    const worker = new SerialWorkerR41(async () => undefined);
    const first = await worker.execute(null);
    const second = await worker.execute(null);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(worker.running).toBe(false);
  });
});

describe('R41 integrity', () => {
  it('accepts a sane runtime config', () => {
    const integrity = new RuntimeIntegrityR41();
    const config: RuntimeConfig = {
      seed: 41,
      fixedStepSeconds: 1 / 60,
      maxCatchUpSteps: 6,
      maxEntities: 4096,
      maxCommandsPerTick: 128,
      maxEvents: 8192,
      maxTelemetrySamples: 512,
      snapshotHistory: 64,
      networkRole: 'offline',
      quality: 'balanced',
      frameBudgets: createDefaultBudgetsR41(),
    };
    expect(integrity.validateConfig(config).ok).toBe(true);
  });

  it('flags hostile numeric and payload state', () => {
    const integrity = new RuntimeIntegrityR41();
    const bad = {
      ...entity,
      transform: {
        ...entity.transform,
        position: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
      },
      data: { nested: { x: { y: { z: { w: { q: { overflow: true } } } } } } },
    };
    const report = integrity.validateEntity(bad);
    expect(report.ok).toBe(false);
    expect(report.issues.some(issue => issue.code === 'vector-finite')).toBe(true);
    expect(integrity.safeModeFor(report, 'running')).toBe('faulted');
  });

  it('canonicalizes a vector within hard world bounds', () => {
    const integrity = new RuntimeIntegrityR41({ maxPositionMagnitude: 100 });
    expect(integrity.sanitizeVector({ x: 1000, y: -1000, z: 5 })).toEqual({ x: 100, y: -100, z: 5 });
  });
});
