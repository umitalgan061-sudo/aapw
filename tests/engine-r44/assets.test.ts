import { describe, expect, it } from "vitest";
import { AssetPipeline } from "../../src/engine-ts/r44/assets.ts";

describe("AssetPipeline", () => {
  it("deduplicates concurrent requests for the same key and URL", async () => {
    let loads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const pipeline = new AssetPipeline(async (request) => {
      loads += 1;
      await barrier;
      return { value: { url: request.url }, bytes: 4 };
    }, { concurrency: 2, maxResidentBytes: 32, maxAssetBytes: 16 });
    const first = pipeline.request({ key: "mesh", url: "/mesh.glb", priority: 0 });
    const second = pipeline.request({ key: "mesh", url: "/mesh.glb", priority: 1 });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(loads).toBe(1);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(pipeline.metrics().residentEntries).toBe(1);
  });

  it("rejects unsafe URL schemes and excessive declared bytes before loading", async () => {
    let loads = 0;
    const pipeline = new AssetPipeline(async () => { loads += 1; return { value: true, bytes: 1 }; }, { maxAssetBytes: 10 });
    expect((await pipeline.request({ key: "x", url: "javascript:alert(1)", priority: 0 })).ok).toBe(false);
    expect((await pipeline.request({ key: "y", url: "/y", priority: 0, expectedBytes: 11 })).ok).toBe(false);
    expect(loads).toBe(0);
  });

  it("rejects a loader result that exceeds the byte budget", async () => {
    const pipeline = new AssetPipeline(async () => ({ value: "huge", bytes: 50 }), { maxAssetBytes: 10 });
    const result = await pipeline.request({ key: "huge", url: "/huge", priority: 0 });
    expect(result.ok).toBe(false);
    expect(pipeline.metrics().rejected).toBe(1);
    expect(pipeline.metrics().residentBytes).toBe(0);
  });

  it("evicts least-recently-used entries when the resident byte budget is reached", async () => {
    const pipeline = new AssetPipeline(async (request) => ({ value: request.key, bytes: 6 }), {
      maxResidentBytes: 10,
      maxAssetBytes: 10,
      maxEntries: 2,
      cacheTtlMs: 1000,
    });
    await pipeline.request({ key: "a", url: "/a", priority: 0 });
    await pipeline.request({ key: "b", url: "/b", priority: 0 });
    expect(pipeline.metrics().residentBytes).toBeLessThanOrEqual(10);
    expect(pipeline.metrics().evictions).toBe(1);
    expect(pipeline.cacheKeys()).toHaveLength(1);
  });

  it("cancels queued work and returns a stable failure result", async () => {
    let finishFirst!: () => void;
    const gate = new Promise<void>((resolve) => { finishFirst = resolve; });
    const pipeline = new AssetPipeline(async (request) => {
      if (request.key === "first") await gate;
      return { value: request.key, bytes: 1 };
    }, { concurrency: 1, maxPending: 8 });
    const first = pipeline.request({ key: "first", url: "/first", priority: 0 });
    const second = pipeline.request({ key: "second", url: "/second", priority: 1 });
    expect(pipeline.cancel("second")).toBe(true);
    finishFirst();
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(false);
    expect(pipeline.metrics().queued).toBe(0);
  });

  it("invalidates one asset without invalidating unrelated cache entries", async () => {
    let loads = 0;
    const pipeline = new AssetPipeline(async (request) => ({
      value: { key: request.key, load: ++loads },
      bytes: 1,
    }), { maxResidentBytes: 8, maxAssetBytes: 8, cacheTtlMs: 1000 });
    await pipeline.request({ key: "a", url: "/a", priority: 0 });
    await pipeline.request({ key: "b", url: "/b", priority: 0 });
    expect(pipeline.cacheKeys()).toEqual(["a", "b"]);
    expect(pipeline.invalidate("a")).toBe(true);
    expect(pipeline.cacheKeys()).toEqual(["b"]);
    expect((await pipeline.request({ key: "a", url: "/a", priority: 0 })).ok).toBe(true);
    expect(loads).toBe(3);
    expect(pipeline.cacheKeys()).toEqual(["a", "b"]);
  });

  it("expires cached records using the supplied monotonic clock", async () => {
    let now = 0;
    let loads = 0;
    const pipeline = new AssetPipeline(async (request) => {
      loads += 1;
      return { value: { load: loads, key: request.key }, bytes: 2 };
    }, { cacheTtlMs: 10 }, { now: () => now });
    await pipeline.request({ key: "brief", url: "/brief", priority: 0 });
    await pipeline.request({ key: "brief", url: "/brief", priority: 0 });
    expect(loads).toBe(1);
    now = 11;
    await pipeline.request({ key: "brief", url: "/brief", priority: 0 });
    expect(loads).toBe(2);
  });

  it("bounds prefetch breadth and disposable cache state", async () => {
    const pipeline = new AssetPipeline(async (request) => ({ value: request.key, bytes: 1 }), { maxPending: 3 });
    const results = await pipeline.prefetch([
      { key: "a", url: "/a", priority: 0 },
      { key: "b", url: "/b", priority: 0 },
      { key: "c", url: "/c", priority: 0 },
      { key: "d", url: "/d", priority: 0 },
    ]);
    expect(results).toHaveLength(3);
    pipeline.dispose();
    expect(pipeline.metrics().residentEntries).toBe(0);
    expect(pipeline.metrics().residentBytes).toBe(0);
  });
});
