import { describe, expect, it } from 'vitest';
import { R29Runtime } from '../../src/3d/modern/r29/runtime.ts';

describe('R29Runtime', () => {
  it('starts lazily and advances with a deterministic fixed-step clock', async () => {
    const runtime = new R29Runtime({ tickRate: 60, maxStepsPerFrame: 5, backend: 'headless', qualityTier: 'high' });
    expect(runtime.mode).toBe('created');
    await runtime.frame(1 / 30);
    expect(runtime.mode).toBe('running');
    expect(runtime.snapshot().tick).toBe(2);
    expect(runtime.snapshot().runtimeVersion).toBe('r29');
    runtime.dispose();
  });

  it('applies a world registration and exposes it through snapshots', async () => {
    const runtime = new R29Runtime({ backend: 'headless' });
    runtime.registerZone({
      id: 'center',
      x: 0,
      z: 0,
      radiusMeters: 128,
      estimatedBytes: 2 * 1024 * 1024,
      priority: 90,
    });
    const entityId = runtime.world.createEntity({ kind: 'hero', position: { x: 5, y: 0, z: 5 }, importance: 10 });
    runtime.world.updateTransform(entityId, { rotationY: 1.25 });
    await runtime.frame(1 / 60);
    const snapshot = runtime.snapshot();
    expect(snapshot.entityCount).toBe(1);
    expect(snapshot.activeEntityCount).toBe(1);
    expect(snapshot.streaming.load).toContain('center');
    runtime.dispose();
  });

  it('does not let failed optional work stop the whole frame', async () => {
    const runtime = new R29Runtime({ backend: 'headless' });
    runtime.registerTask({
      id: 'optional.failure',
      phase: 'telemetry',
      priority: 10,
      budgetMs: 0.1,
      optional: true,
      run: () => { throw new Error('expected'); },
    });
    await expect(runtime.frame(1 / 60)).resolves.toBeDefined();
    expect(runtime.snapshot().health.status).not.toBe('critical');
    runtime.dispose();
  });

  it('rejects duplicate tasks and survives repeated stop/dispose calls', async () => {
    const runtime = new R29Runtime({ backend: 'headless' });
    runtime.registerTask({ id: 'x', phase: 'simulation', priority: 1, budgetMs: 0.1, run: () => undefined });
    expect(() => runtime.registerTask({ id: 'x', phase: 'simulation', priority: 1, budgetMs: 0.1, run: () => undefined })).toThrow(/R29_TASK_DUPLICATE/);
    await runtime.start();
    await runtime.stop();
    await runtime.stop();
    runtime.dispose();
    runtime.dispose();
    expect(runtime.mode).toBe('stopped');
  });
});
