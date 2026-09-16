import { describe, expect, it, vi } from 'vitest';
import { BudgetedTaskScheduler, FixedStepScheduler } from '../../../src/3d/modern/next/scheduler.ts';
import { LocalWorkerPool } from '../../../src/3d/modern/next/worker.ts';

describe('next scheduler and workers', () => {
  it('caps simulation steps to avoid a spiral of death', () => {
    const scheduler = new FixedStepScheduler({ stepSeconds: 1 / 60, maxStepsPerFrame: 2, maxFrameDeltaSeconds: 1 });
    const run = vi.fn();
    scheduler.addTask('tick', run);
    const result = scheduler.advance(0.5);
    expect(result.steps).toBe(2);
    expect(result.spiralPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('executes interval tasks only on their cadence', () => {
    const scheduler = new FixedStepScheduler({ stepSeconds: 1, maxStepsPerFrame: 10, maxFrameDeltaSeconds: 10 });
    const everyTwo = vi.fn();
    scheduler.addTask('cadence', everyTwo, { intervalTicks: 2, startDelayTicks: 2 });
    scheduler.advance(6);
    expect(everyTwo).toHaveBeenCalledTimes(3);
  });

  it('orders tasks by priority and insertion id', () => {
    const scheduler = new FixedStepScheduler({ stepSeconds: 1, maxStepsPerFrame: 10, maxFrameDeltaSeconds: 10 });
    const order: string[] = [];
    scheduler.addTask('late', () => order.push('late'), { priority: 10 });
    scheduler.addTask('early', () => order.push('early'), { priority: -1 });
    scheduler.advance(1);
    expect(order).toEqual(['early', 'late']);
  });

  it('supports disabling and removing scheduled tasks', () => {
    const scheduler = new FixedStepScheduler({ stepSeconds: 1, maxStepsPerFrame: 10, maxFrameDeltaSeconds: 10 });
    const run = vi.fn();
    const id = scheduler.addTask('switchable', run);
    expect(scheduler.setTaskEnabled(id, false)).toBe(true);
    scheduler.advance(1);
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.removeTask(id)).toBe(true);
    expect(scheduler.removeTask(id)).toBe(false);
  });

  it('runs budgeted jobs while deferring work that exceeds budget', () => {
    const scheduler = new BudgetedTaskScheduler();
    const seen: string[] = [];
    scheduler.schedule(() => seen.push('a'), { priority: 0, estimatedCostMs: 2 });
    scheduler.schedule(() => seen.push('b'), { priority: 0, estimatedCostMs: 5 });
    scheduler.schedule(() => seen.push('c'), { priority: 1, estimatedCostMs: 2 });
    const result = scheduler.run({ tick: 1 as never, dtSeconds: 1 / 60, simTime: 1 / 60 as never }, 4);
    expect(result.executed).toBe(1);
    expect(result.deferred).toBe(2);
    expect(seen).toEqual(['a']);
  });

  it('runs worker jobs concurrently up to configured capacity', async () => {
    const pool = new LocalWorkerPool({ concurrency: 2, maxQueue: 8 });
    let inFlight = 0;
    let maxInFlight = 0;
    pool.register({ kind: 'compression', execute: async (value: number) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return value * 2;
    } });
    const results = await Promise.all([pool.enqueue('compression', 1), pool.enqueue('compression', 2), pool.enqueue('compression', 3)]);
    expect(results.map((result) => result.result)).toEqual([2, 4, 6]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('returns structured worker errors rather than throwing from handlers', async () => {
    const pool = new LocalWorkerPool({ concurrency: 1, maxQueue: 4 });
    pool.register({ kind: 'compression', execute: () => { throw new Error('boom'); } });
    const result = await pool.enqueue('compression', 1);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
    expect(pool.stats().failed).toBe(1);
  });

  it('rejects unknown workers and queue overflow', async () => {
    const pool = new LocalWorkerPool({ concurrency: 1, maxQueue: 1 });
    await expect(pool.enqueue('terrain', { count: 2, seed: 1 })).rejects.toThrow('worker handler missing');
    pool.register({ kind: 'terrain', execute: (payload: { count: number }) => payload.count });
    const first = pool.enqueue('terrain', { count: 1 });
    await expect(pool.enqueue('terrain', { count: 2 })).resolves.toMatchObject({ ok: true });
    await first;
  });
});
