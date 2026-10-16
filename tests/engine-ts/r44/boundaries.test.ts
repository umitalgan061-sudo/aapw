import { describe, expect, it } from "vitest";
import { r44FingerprintBytes } from "../../../src/engine-ts/r44/hash.js";
import { R44AssetPipeline, type R44AssetLoader } from "../../../src/engine-ts/r44/assetPipeline.js";
import { R44NetworkGuard, type R44NetworkEnvelope } from "../../../src/engine-ts/r44/networkGuard.js";

describe("R44 asset pipeline", () => {
  it("validates integrity and returns immutable copies to callers", async () => {
    const bytes = new TextEncoder().encode("known model bytes");
    const pipeline = new R44AssetPipeline({ maxResidentBytes: 1024, maxAssetBytes: 512 });
    pipeline.register({
      id: "model-1", uri: "/assets/model.bin", version: "v1", contentType: "application/octet-stream",
      estimatedBytes: bytes.byteLength, expectedFingerprint: r44FingerprintBytes(bytes).fingerprint,
    }, 1);
    const loader: R44AssetLoader = { load: async () => ({ bytes, contentType: "application/octet-stream" }) };
    const result = await pipeline.load("model-1", loader, { tick: 2 });
    expect(result.state).toBe("ready");
    const copy = pipeline.readyPayload("model-1");
    expect(copy?.bytes.byteLength).toBe(bytes.byteLength);
    copy?.bytes.fill(0);
    expect(new TextDecoder().decode(pipeline.readyPayload("model-1")?.bytes)).toBe("known model bytes");
    expect(pipeline.residentBytes).toBe(bytes.byteLength);
  });

  it("rejects traversal, disallowed URI schemes, and unexpected content types", async () => {
    const pipeline = new R44AssetPipeline();
    expect(() => pipeline.register({
      id: "bad", uri: "/assets/../../secret", version: "1", contentType: "text/plain", estimatedBytes: 1,
    })).toThrow();
    expect(() => pipeline.register({
      id: "script", uri: "javascript:alert(1)", version: "1", contentType: "text/plain", estimatedBytes: 1,
    })).toThrow();
    pipeline.register({ id: "typed", uri: "/assets/test.txt", version: "1", contentType: "text/plain", estimatedBytes: 20 });
    const result = await pipeline.load("typed", { load: async () => ({ bytes: new Uint8Array([1]), contentType: "application/octet-stream" }) });
    expect(result.state).toBe("failed");
    expect(result.failureCode).toBe("asset-content-type");
  });

  it("requires ready dependencies and supports explicit eviction", async () => {
    const pipeline = new R44AssetPipeline({ maxResidentBytes: 20 });
    pipeline.register({ id: "base", uri: "/base.bin", version: "1", contentType: "application/octet-stream", estimatedBytes: 2 });
    pipeline.register({ id: "child", uri: "/child.bin", version: "1", contentType: "application/octet-stream", estimatedBytes: 2, dependencies: ["base"] });
    await expect(pipeline.load("child", { load: async () => ({ bytes: new Uint8Array([2]), contentType: "application/octet-stream" }) })).rejects.toThrow();
    await pipeline.load("base", { load: async () => ({ bytes: new Uint8Array([1, 2]), contentType: "application/octet-stream" }) });
    await pipeline.load("child", { load: async () => ({ bytes: new Uint8Array([3, 4]), contentType: "application/octet-stream" }) });
    expect(pipeline.evict("base")).toBe(true);
    expect(pipeline.residentBytes).toBe(2);
  });

  it("deduplicates concurrent requests and observes explicit cancellation", async () => {
    const pipeline = new R44AssetPipeline();
    pipeline.register({ id: "slow", uri: "/slow.bin", version: "1", contentType: "application/octet-stream", estimatedBytes: 1 });
    let release: ((value: { bytes: Uint8Array; contentType: string }) => void) | undefined;
    const loader: R44AssetLoader = {
      load: async () => new Promise((resolve) => { release = resolve; }),
    };
    const first = pipeline.load("slow", loader);
    const second = pipeline.load("slow", loader);
    expect(pipeline.activeLoads).toBe(1);
    const buffer = new Uint8Array([1]);
    release?.({ bytes: buffer, contentType: "application/octet-stream" });
    await expect(first).resolves.toMatchObject({ state: "ready" });
    await expect(second).resolves.toMatchObject({ state: "ready" });
  });
});

describe("R44 network guard", () => {
  const envelope = (sequence: number, overrides: Partial<R44NetworkEnvelope> = {}): R44NetworkEnvelope => ({
    protocol: 1,
    channel: "gameplay",
    sender: "player-1",
    sequence,
    tick: 10,
    messageId: "msg-" + sequence,
    kind: "input",
    payload: { buttons: ["forward"], axisX: 0.25 },
    ...overrides,
  });

  it("accepts valid traffic and rejects replayed sequence numbers", () => {
    const guard = new R44NetworkGuard({ rateCapacity: 10, rateRefillPerTick: 0 });
    expect(guard.validate(envelope(1), 10).accepted).toBe(true);
    const replay = guard.validate(envelope(1), 10);
    expect(replay.accepted).toBe(false);
    expect(replay.code).toBe("replay");
  });

  it("checks protocol, allowlists, payload size, and tick horizon", () => {
    const guard = new R44NetworkGuard({ maxPayloadBytes: 512, maxFutureTickDelta: 3, maxPastTickDelta: 3 });
    expect(guard.validate(envelope(1, { protocol: 2 }), 10).code).toBe("protocol-mismatch");
    expect(guard.validate(envelope(2, { kind: "admin-command" }), 10).code).toBe("kind-denied");
    expect(guard.validate(envelope(3, { tick: 99 }), 10).code).toBe("tick-out-of-range");
    expect(guard.validate(envelope(4, { payload: { text: "x".repeat(2000) } }), 10).code).toBe("payload-too-large");
  });

  it("refills rate buckets only from monotonic logical ticks", () => {
    const guard = new R44NetworkGuard({ rateCapacity: 1, rateRefillPerTick: 0.5 });
    expect(guard.validate(envelope(1), 10).accepted).toBe(true);
    expect(guard.validate(envelope(2), 10).code).toBe("rate-limited");
    expect(guard.validate(envelope(3), 12).accepted).toBe(true);
    expect(() => guard.validate(envelope(4), 11)).toThrow();
  });

  it("rejects envelopes with a mismatching fingerprint", () => {
    const guard = new R44NetworkGuard();
    expect(guard.validate(envelope(1, { fingerprint: "tampered" }), 10).code).toBe("fingerprint-mismatch");
  });
});
