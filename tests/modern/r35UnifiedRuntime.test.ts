import { describe, expect, it } from 'vitest';
import {
  createR35Application,
  createRuntimeSnapshot,
  createSelector,
  R35StateStore,
  R35WorkScheduler,
  createDefaultR35Budgets,
  runtimeSnapshotChecksum,
} from '../../src/3d/nextgen/r35';

describe('R35 unified runtime', () => {
  it('boots with deterministic defaults and explicit feature flags', () => {
    const app = createR35Application({ config: { seed: 123 } });
    expect(app.mode).toBe('booting');
    expect(app.tick).toBe(0);
    expect(app.features().deterministicSimulation).toBe(true);
    expect(app.features().workerPool).toBe(true);
  });

  it('creates a player and advances deterministic frames', async () => {
    const app = createR35Application({ config: { seed: 7 } });
    const id = app.createPlayer();
    app.start();
    app.enqueueInput({ device: 'keyboard', code: 'KeyW', pressed: true, timestampMs: 1 });
    const first = await app.frame(async () => ({ ok: true } as Response));
    const second = await app.frame(async () => ({ ok: true } as Response));
    expect(id).toBeGreaterThan(0);
    expect(first.snapshot.tick).toBe(1);
    expect(second.snapshot.tick).toBe(2);
    expect(second.snapshot.player?.id).toBe(id);
  });

  it('serializes and restores the state store checkpoint', () => {
    const first = createRuntimeSnapshot({ tick: 11 });
    const store = new R35StateStore(first);
    store.patch({ label: 'advance', apply: (state) => ({ ...state, tick: state.tick + 2 }) });
    const checkpoint = store.checkpoint();
    const checksum = runtimeSnapshotChecksum(checkpoint.state);
    expect(checksum).toBe(checkpoint.checksum);
    store.patch({ label: 'advance-more', apply: (state) => ({ ...state, tick: state.tick + 5 }) });
    store.restore(checkpoint);
    expect(store.state.tick).toBe(13);
  });

  it('notifies selectors only when selected values change', () => {
    const store = new R35StateStore(createRuntimeSnapshot());
    let notifications = 0;
    store.subscribe(createSelector('mode', (snapshot) => snapshot.mode), () => {
      notifications += 1;
    });
    store.patch({ label: 'tick-only', apply: (state) => ({ ...state, tick: 4 }) });
    store.patch({ label: 'mode-change', apply: (state) => ({ ...state, mode: 'running' }) });
    expect(notifications).toBe(1);
  });

  it('coalesces scheduler work by key and respects budget pressure', async () => {
    const scheduler = new R35WorkScheduler(createDefaultR35Budgets());
    const completed: string[] = [];
    scheduler.enqueue({
      id: 'weather',
      phase: 'simulation',
      priority: 'normal',
      estimatedMs: 1,
      deadlineTick: null,
      coalescingKey: 'weather',
      payload: 1,
      execute: () => completed.push('old'),
    });
    scheduler.enqueue({
      id: 'weather',
      phase: 'simulation',
      priority: 'high',
      estimatedMs: 1,
      deadlineTick: null,
      coalescingKey: 'weather',
      payload: 2,
      execute: () => completed.push('new'),
    });
    const report = await scheduler.runTick(1, () => 1);
    expect(completed).toEqual(['new']);
    expect(report.phases.some((phase) => phase.phase === 'simulation')).toBe(true);
  });
});
