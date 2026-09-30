import { describe, expect, it } from 'vitest';
import { R29NetworkCoordinator } from '../../src/3d/modern/r29/networkCoordinator.ts';
import { R29RenderCoordinator, createHeadlessR29Backend } from '../../src/3d/modern/r29/renderCoordinator.ts';
import { R29WorldRuntime } from '../../src/3d/modern/r29/worldRuntime.ts';
import { R29WorldQuery } from '../../src/3d/modern/r29/worldQuery.ts';
import { R29WorkerScheduler } from '../../src/3d/modern/r29/workerScheduler.ts';

describe('R29 advanced runtime contracts', () => {
  it('produces adaptive network recommendations', () => {
    const network = new R29NetworkCoordinator();
    for (let tick = 1; tick <= 12; tick += 1) {
      network.record({ tick, rttMs: 140, jitterMs: 30, lossRatio: 0.08, inboundBytes: 1000, outboundBytes: 900, acknowledgedSequence: tick });
    }
    const report = network.report();
    expect(report.health).toBe('poor');
    expect(report.interpolationTicks).toBeGreaterThan(2);
    expect(report.inputRedundancy).toBeGreaterThan(1);
  });

  it('creates a dependency-safe render plan with a headless fallback', () => {
    const render = new R29RenderCoordinator({
      preferredBackend: 'webgpu',
      adapters: [createHeadlessR29Backend()],
      tier: 'medium',
    });
    expect(render.plan().backend).toBe('headless');
    expect(render.plan().hazards).toEqual([]);
    expect(render.plan().passes.length).toBeGreaterThan(0);
  });

  it('raycasts against active entities in deterministic order', () => {
    const world = new R29WorldRuntime();
    world.createEntity({ kind: 'near', position: { x: 0, y: 0, z: 5 } });
    world.createEntity({ kind: 'far', position: { x: 0, y: 0, z: 9 } });
    const query = new R29WorldQuery(world);
    const hits = query.raycast({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 20 }, { radiusMeters: 1 });
    expect(hits.map((hit) => hit.entityId)).toEqual([1, 2]);
  });

  it('runs worker tasks with priority ordering', async () => {
    const scheduler = new R29WorkerScheduler({ concurrency: 1, timeoutMs: 1000 });
    const order: string[] = [];
    await Promise.all([
      scheduler.submit({ id: 'low', priority: 1, run: async () => { order.push('low'); } }),
      scheduler.submit({ id: 'high', priority: 10, run: async () => { order.push('high'); } }),
    ]);
    expect(order[0]).toBe('high');
    expect(scheduler.snapshot().completed).toBe(2);
  });
});
