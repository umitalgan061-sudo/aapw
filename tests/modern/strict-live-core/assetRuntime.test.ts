import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSET_POLICY, StrictAssetRuntime, makeAssetRequest } from '../../../src/3d/strict/assetRuntime.ts';
import { tickId } from '../../../src/3d/strict/liveCoreTypes.ts';

const request = (key: string, bytes: number, priority: number) => makeAssetRequest({
  key, url: './assets/' + key + '.glb', kind: 'model', estimatedBytes: bytes, priority, maxRetries: 2,
});

describe('assetRuntime', () => {
  it('creates safe local requests', () => {
    const result = request('castle', 1024, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe('castle');
    expect(result.value.estimatedBytes).toBe(1024);
  });
  it('rejects unsafe protocols', () => {
    expect(makeAssetRequest({ key: 'x', url: 'javascript:alert(1)', kind: 'json', priority: 1 }).ok).toBe(false);
  });
  it('queues and respects inflight limits', () => {
    const runtime = new StrictAssetRuntime({ ...DEFAULT_ASSET_POLICY, maxInflightRequests: 1, maxInflightBytes: 2048 });
    const first = request('one', 1024, 10);
    const second = request('two', 1024, 5);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const firstAdmission = runtime.admit(first.value, tickId(1));
    const secondAdmission = runtime.admit(second.value, tickId(2));
    expect(firstAdmission.ok).toBe(true);
    expect(secondAdmission.ok).toBe(true);
    expect(runtime.beginLoad(first.value.id).ok).toBe(true);
    expect(runtime.beginLoad(second.value.id).ok).toBe(false);
  });
  it('completes assets into resident memory', () => {
    const runtime = new StrictAssetRuntime();
    const item = request('tree', 4096, 1);
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    runtime.admit(item.value, tickId(1));
    runtime.beginLoad(item.value.id);
    expect(runtime.complete(item.value.id, 2048, tickId(2)).ok).toBe(true);
    expect(runtime.diagnostics().residentBytes).toBe(2048);
  });
  it('evicts the least valuable resident asset first', () => {
    const runtime = new StrictAssetRuntime({ ...DEFAULT_ASSET_POLICY, maxResidentBytes: 100 });
    const low = request('low', 80, 1);
    const high = request('high', 80, 100);
    expect(low.ok && high.ok).toBe(true);
    if (!low.ok || !high.ok) return;
    runtime.admit(low.value, tickId(1)); runtime.beginLoad(low.value.id); runtime.complete(low.value.id, 80, tickId(2));
    runtime.admit(high.value, tickId(3)); runtime.beginLoad(high.value.id);
    expect(runtime.complete(high.value.id, 80, tickId(4)).ok).toBe(true);
    expect(runtime.record(low.value.id)?.state).toBe('evicted');
    expect(runtime.record(high.value.id)?.state).toBe('resident');
  });
  it('retries failed loads with bounded backoff', () => {
    const runtime = new StrictAssetRuntime();
    const item = request('retry', 10, 2);
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    runtime.admit(item.value, tickId(1)); runtime.beginLoad(item.value.id);
    expect(runtime.fail(item.value.id, 'temporary', tickId(2)).ok).toBe(true);
    expect(runtime.record(item.value.id)?.state).toBe('queued');
    expect(runtime.diagnostics().retryCount).toBe(1);
  });
  it('marks stale residents after configured age', () => {
    const runtime = new StrictAssetRuntime({ ...DEFAULT_ASSET_POLICY, staleAfterTicks: 2 });
    const item = request('old', 10, 1);
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    runtime.admit(item.value, tickId(1)); runtime.beginLoad(item.value.id); runtime.complete(item.value.id, 10, tickId(1));
    runtime.tick(tickId(4));
    expect(runtime.record(item.value.id)?.state).toBe('stale');
  });
});