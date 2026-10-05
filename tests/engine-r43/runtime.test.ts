import { describe, expect, it } from 'vitest';
import { R43Runtime } from '../../src/engine-ts/r43/runtime.ts';

describe('r43 runtime', () => {
  it('boots with deterministic defaults and exposes a coherent snapshot', () => {
    const runtime = new R43Runtime({ seed: 123 });
    const result = runtime.initialize();
    expect(result.ok).toBe(true);
    expect(result.value?.frame).toBe(0);
    expect(result.value?.tick).toBe(0);
    expect(result.value?.snapshot.version).toBe(1);
    expect(result.value?.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('samples and stores typed input history', () => {
    const runtime = new R43Runtime();
    const intent = runtime.submitInput(1, {
      axes: { horizontal: 1, vertical: 1 },
      buttons: { attack: true },
    });
    expect(Math.hypot(intent.moveX, intent.moveY)).toBeCloseTo(1, 8);
    expect(intent.pressed.has('attack')).toBe(true);
    expect(runtime.inputHistory()).toHaveLength(1);
  });

  it('rejects an oversized custom command through security validation', () => {
    const runtime = new R43Runtime();
    const result = runtime.enqueue({
      type: 'custom',
      name: 'test',
      payload: 'x'.repeat(200_000),
    });
    expect(result.ok).toBe(false);
  });

  it('runs registered gameplay systems on fixed ticks', () => {
    const runtime = new R43Runtime();
    const score = runtime.world.defineComponent<number>('score');
    const entity = runtime.world.create();
    score.set(entity, 0);
    runtime.registerSystem({
      id: 'score-tick',
      phase: 'simulation',
      priority: 'critical',
      update: () => {
        const current = runtime.world.getComponent<number>(entity, 'score') ?? 0;
        runtime.world.addComponent(entity, 'score', current + 1);
      },
    });
    const frame = runtime.frame(0.05, 10, 2, 2);
    expect(frame.ok).toBe(true);
    expect(runtime.world.getComponent<number>(entity, 'score')).toBe(3);
    expect(frame.value?.health.score).toBeGreaterThan(90);
  });

  it('adjusts quality in response to frame pressure', () => {
    const runtime = new R43Runtime();
    let current = runtime.frame(0.0167, 35, 25, 25);
    for (let i = 0; i < 50; i += 1) current = runtime.frame(0.0167, 35, 25, 25);
    expect(current.value?.quality.renderScale).toBeLessThan(1);
  });

  it('saves and restores state through the runtime manager', async () => {
    const runtime = new R43Runtime();
    await runtime.saveState({ campaign: { turn: 4 } });
    const loaded = await runtime.loadState();
    expect(loaded.ok).toBe(true);
    expect(loaded.value).toEqual({ campaign: { turn: 4 } });
  });

  it('creates network checkpoints on deterministic snapshot cadence', () => {
    const runtime = new R43Runtime({ seed: 7 });
    for (let i = 0; i < 12; i += 1) runtime.frame(0.05, 12, 4, 4);
    expect(runtime.checkpoints.values().length).toBeGreaterThan(0);
    expect(runtime.network.latestSent()).toBeDefined();
  });

  it('stops changing simulation state while paused', () => {
    const runtime = new R43Runtime();
    const before = runtime.snapshotResult();
    runtime.pause();
    runtime.frame(0.5, 50, 30, 30);
    const after = runtime.snapshotResult();
    expect(after.tick).toBe(before.tick);
    runtime.resume();
  });
});
