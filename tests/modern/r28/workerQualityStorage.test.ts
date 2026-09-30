import { describe, expect, it } from 'vitest';
import { BoundedWorkerPool } from '../../../src/3d/modern/r28/workerPool.ts';
import { resolveQualityPolicy, qualityFeatureEnabled } from '../../../src/3d/modern/r28/qualityPolicy.ts';
import { BrowserStorageCodec } from '../../../src/3d/modern/r28/storageCodec.ts';

describe('R28 worker, quality and storage policy', () => {
  it('executes worker tasks by priority with bounded concurrency', async () => {
    const pool = new BoundedWorkerPool(1, 8);
    const calls: string[] = [];
    const low = pool.enqueue(1, async () => { calls.push('low'); return 1; });
    const high = pool.enqueue(10, async () => { calls.push('high'); return 2; });
    const first = await low;
    const second = await high;
    expect(first.value).toBe(1);
    expect(second.value).toBe(2);
    expect(calls).toEqual(['low', 'high']);
  });

  it('derives stable quality policy from pressure signals', () => {
    const pressured = resolveQualityPolicy({
      level: 4,
      frameMs: 30,
      memoryMb: 1700,
      drawCalls: 7000,
      visibleCount: 1800,
      coarsePointer: false,
      webgpu: false,
    });
    const efficient = resolveQualityPolicy({
      level: 4,
      frameMs: 9,
      memoryMb: 500,
      drawCalls: 500,
      visibleCount: 500,
      coarsePointer: false,
      webgpu: true,
    });
    expect(pressured.pixelRatioCap).toBeLessThan(efficient.pixelRatioCap);
    expect(qualityFeatureEnabled(4, 'postFx')).toBe(true);
    expect(qualityFeatureEnabled(1, 'denseVegetation')).toBe(false);
  });

  it('enforces encoded storage byte budgets', () => {
    const codec = new BrowserStorageCodec<{ value: string }>({ maxBytes: 1024, version: 2 });
    const encoded = codec.encode({ value: 'hello' });
    expect(codec.decode(encoded)).toEqual({ value: 'hello' });
    expect(() => codec.decode({ ...encoded, bytes: encoded.bytes + 1 })).toThrow(/byte/i);
  });
});
