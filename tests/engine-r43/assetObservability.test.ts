import { describe, expect, it } from 'vitest';
import { AssetCache, AssetOrchestrator } from '../../src/engine-ts/r43/assets.ts';
import { HealthMonitor, MetricBuffer, TelemetryRegistry } from '../../src/engine-ts/r43/observability.ts';

describe('r43 assets', () => {
  it('evicts the oldest cache entries when byte capacity is exceeded', () => {
    const cache = new AssetCache<string>(1024 * 1024);
    cache.set('a', 'A', 700_000, 1);
    cache.set('b', 'B', 700_000, 2);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.bytes()).toBe(700_000);
  });

  it('deduplicates concurrent asset requests by key', async () => {
    const orchestrator = new AssetOrchestrator<string>({ maxBytes: 2 * 1024 * 1024, concurrency: 2 });
    let loads = 0;
    const provider = {
      async load() {
        loads += 1;
        return { value: 'shared', bytes: 6 };
      },
    };
    const descriptor = { key: 'shared', url: '/shared', bytes: 6, priority: 'high' as const };
    const [a, b] = await Promise.all([
      orchestrator.request({ ...descriptor, provider, tick: 1 }),
      orchestrator.request({ ...descriptor, provider, tick: 1 }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(loads).toBe(1);
    expect(orchestrator.stats().cache.entries).toBe(1);
  });

  it('rejects a declared asset hash mismatch', async () => {
    const orchestrator = new AssetOrchestrator<string>({ maxBytes: 2 * 1024 * 1024, concurrency: 1 });
    const result = await orchestrator.request({
      descriptor: { key: 'bad', url: '/bad', bytes: 4, priority: 'critical', hash: '00000000' },
      provider: { async load() { return { value: 'wrong', bytes: 4 }; } },
      tick: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ASSET_HASH_MISMATCH');
  });
});

describe('r43 observability', () => {
  it('keeps bounded metrics and computes percentiles', () => {
    const buffer = new MetricBuffer(16);
    for (let i = 1; i <= 8; i += 1) buffer.add({ name: 'frame', value: i, frame: i, tags: {} });
    expect(buffer.snapshot()).toHaveLength(8);
    expect(buffer.average('frame')).toBeCloseTo(4.5, 6);
    expect(buffer.percentile('frame', 0.5)).toBe(4);
  });

  it('records monotonic counters and a stable telemetry digest', () => {
    const telemetry = new TelemetryRegistry(64);
    expect(telemetry.count('boot')).toBe(1);
    expect(telemetry.count('boot', 2)).toBe(3);
    const first = telemetry.flushDigest();
    const second = telemetry.flushDigest();
    expect(first).toBe(second);
  });

  it('turns sustained pressure into actionable health recommendations', () => {
    const monitor = new HealthMonitor(16);
    let health = monitor.observe({
      frameMs: 40,
      cpuMs: 20,
      gpuMs: 20,
      memoryPressure: 0.8,
      networkPressure: 0.6,
      assetPressure: 0.7,
    });
    for (let i = 0; i < 15; i += 1) {
      health = monitor.observe({
        frameMs: 40,
        cpuMs: 20,
        gpuMs: 20,
        memoryPressure: 0.8,
        networkPressure: 0.6,
        assetPressure: 0.7,
      });
    }
    expect(health.score).toBeLessThan(70);
    expect(health.recommendations.length).toBeGreaterThan(0);
    expect(health.grade).toMatch(/^[CDF]$/);
  });
});
