import { describe, expect, it } from 'vitest';
import { createR28IntegrationManifest, validateR28IntegrationManifest } from '../../../src/3d/modern/r28/integrationManifest.ts';
import { readBrowserCapabilities } from '../../../src/3d/modern/r28/environment.ts';
import { BoundedWorkerPool } from '../../../src/3d/modern/r28/workerPool.ts';

describe('R28 integration manifest and worker scheduling', () => {
  it('creates a capability-aware manifest with valid budgets', () => {
    const manifest = createR28IntegrationManifest(readBrowserCapabilities(), {
      maxEntities: 3000,
      features: { telemetry: true },
    });
    expect(manifest.version).toBe('r28');
    expect(manifest.runtime.maxEntities).toBe(3000);
    expect(manifest.features.telemetry).toBe(true);
    expect(validateR28IntegrationManifest(manifest)).toEqual([]);
  });

  it('returns failures from worker tasks instead of rejecting the scheduler promise', async () => {
    const pool = new BoundedWorkerPool(1, 4);
    const result = await pool.enqueue(10, async () => {
      throw new Error('worker-failure');
    });
    expect(result.error).toBe('worker-failure');
    expect(pool.running()).toBe(0);
    expect(pool.queued()).toBe(0);
  });

  it('serializes competing tasks without exceeding configured concurrency', async () => {
    const pool = new BoundedWorkerPool(2, 4);
    let active = 0;
    let maximum = 0;
    const task = (value: number) => pool.enqueue(value, async () => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return value;
    });
    const results = await Promise.all([task(1), task(2), task(3), task(4)]);
    expect(results.map((item) => item.value).sort()).toEqual([1, 2, 3, 4]);
    expect(maximum).toBeLessThanOrEqual(2);
  });
});
