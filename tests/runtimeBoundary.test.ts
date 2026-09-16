import { describe, expect, it } from 'vitest';
import { guardRuntimeBoundary, validateRuntimeBoundary } from '../src/3d/modern/runtimeBoundary';
import { RuntimeKernel } from '../src/3d/modern/runtimeKernel';
import { runRuntimeAcceptance } from '../src/3d/modern/runtimeAcceptance';

describe('runtime boundary validation', () => {
  it('accepts ordinary serializable payloads and rejects excessive depth', () => {
    const valid = validateRuntimeBoundary({ id: 'hero', values: [1, 2, 3], nested: { ok: true } });
    expect(valid.ok).toBe(true);
    const deeplyNested: { next?: unknown } = {};
    let cursor = deeplyNested;
    for (let i = 0; i < 40; i += 1) {
      cursor.next = {};
      cursor = cursor.next as { next?: unknown };
    }
    expect(validateRuntimeBoundary(deeplyNested, { maxDepth: 16 }).ok).toBe(false);
  });

  it('rejects giant arrays before they can cross a worker/network boundary', () => {
    const payload = Array.from({ length: 100 }, (_, index) => index);
    expect(validateRuntimeBoundary(payload, { maxArrayLength: 10 }).ok).toBe(false);
    expect(() => guardRuntimeBoundary(payload, { maxArrayLength: 10 })).toThrow();
  });
});

describe('runtime acceptance smoke', () => {
  it('reports a healthy headless kernel without touching browser renderer APIs', () => {
    const kernel = new RuntimeKernel({ environment: { preferredBackend: 'headless' } });
    const result = runRuntimeAcceptance(kernel);
    expect(result.value.totalCount).toBeGreaterThanOrEqual(5);
    expect(result.value.digest).toHaveLength(8);
  });
});
