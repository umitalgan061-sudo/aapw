import { describe, expect, it } from "vitest";
import {
  AdaptiveQualityDirectorV15,
  AssetPipelineV15,
  FixedFrameSchedulerV15,
  MemorySaveStorageV15,
  PredictiveWorldPartitionV15,
  SaveManagerV15,
  SecureNetworkEnvelopeV15,
  SemanticInputPipelineV15,
  checksumV15,
  chunkIdV15,
  frameV15,
  probeCapabilitiesV15,
  tickV15,
} from "../../src/3d/modern/v15/index.ts";

function observation(frame: number, patch: Partial<Parameters<AdaptiveQualityDirectorV15["observe"]>[0]> = {}) {
  return {
    frame: frameV15(frame),
    frameMs: 16,
    cpuMs: 7,
    gpuMs: 9,
    drawCalls: 300,
    triangles: 450_000,
    visibleObjects: 200,
    textureBytes: 8_000_000,
    memoryPressure: 0.1,
    thermalPressure: 0.1,
    timestampMs: frame * 16,
    ...patch,
  };
}

describe("v15 capability probe", () => {
  it("falls back cleanly without WebGPU", async () => {
    const value = await probeCapabilitiesV15({
      navigator: { hardwareConcurrency: 8 },
      window: { devicePixelRatio: 2, matchMedia: () => ({ matches: false }) },
      canvas: { getContext: () => ({}) },
      now: () => 100,
    });
    expect(value.backend).toBe("webgl2");
    expect(value.webgpuAvailable).toBe(false);
    expect(value.webgl2Available).toBe(true);
    expect(value.hardwareConcurrency).toBe(8);
    expect(value.timestamp).toBe(100);
  });

  it("prefers WebGPU when an adapter is available", async () => {
    const value = await probeCapabilitiesV15({
      navigator: { hardwareConcurrency: 16, gpu: { requestAdapter: async () => ({}) } },
      window: { devicePixelRatio: 1.5, matchMedia: () => ({ matches: false }) },
      canvas: { getContext: () => ({}) },
    });
    expect(value.backend).toBe("webgpu");
    expect(value.webgpuAvailable).toBe(true);
  });
});

describe("v15 adaptive quality", () => {
  it("downgrades one tier after sustained pressure", () => {
    const quality = new AdaptiveQualityDirectorV15({ initial: "ultra" });
    for (let index = 1; index <= 3; index += 1) {
      quality.observe(observation(index, {
        frameMs: 55,
        cpuMs: 38,
        gpuMs: 45,
        drawCalls: 3_000,
        triangles: 6_000_000,
        visibleObjects: 3_000,
        memoryPressure: 1,
        thermalPressure: 1,
      }));
    }
    expect(quality.tier).toBe("high");
  });

  it("waits before upgrading", () => {
    const quality = new AdaptiveQualityDirectorV15({ initial: "balanced" });
    for (let index = 1; index <= 19; index += 1) quality.observe(observation(index));
    expect(quality.tier).toBe("balanced");
    quality.observe(observation(20));
    expect(quality.tier).toBe("high");
  });

  it("can estimate pressure without changing tier", () => {
    const quality = new AdaptiveQualityDirectorV15({ initial: "high" });
    const before = quality.tier;
    const pressure = quality.observePressureOnly(observation(1, { frameMs: 50 }));
    expect(pressure.combined).toBeGreaterThan(0);
    expect(quality.tier).toBe(before);
  });
});

describe("v15 fixed step scheduler", () => {
  it("executes deterministic sixty hertz ticks", () => {
    const scheduler = new FixedFrameSchedulerV15({ tickRate: 60 });
    let calls = 0;
    const result = scheduler.step(0.1, () => { calls += 1; });
    expect(result.simulatedTicks).toBe(6);
    expect(calls).toBe(6);
  });

  it("guards against an unbounded catch-up spiral", () => {
    const scheduler = new FixedFrameSchedulerV15({ tickRate: 60, maxCatchUpTicks: 2, maxFrameDeltaSeconds: 1 });
    const result = scheduler.step(0.5, () => undefined);
    expect(result.simulatedTicks).toBe(2);
    expect(result.droppedSeconds).toBeGreaterThan(0);
  });

  it("halts simulation while suspended", () => {
    const scheduler = new FixedFrameSchedulerV15();
    scheduler.setMode("suspended");
    const result = scheduler.step(0.5, () => { throw new Error("should not execute"); });
    expect(result.simulatedTicks).toBe(0);
  });
});

describe("v15 semantic input", () => {
  it("normalizes movement", () => {
    const input = new SemanticInputPipelineV15();
    input.setMove(10, 10, "keyboard");
    const result = input.consume(10);
    expect(Math.hypot(result.move.x, result.move.y)).toBeLessThanOrEqual(1);
  });

  it("maps common keyboard actions", () => {
    const input = new SemanticInputPipelineV15();
    input.ingestKeyboard("Space", true, 1);
    input.ingestKeyboard("KeyF", true, 1);
    const result = input.consume(1);
    expect(result.actions).toEqual(["attack", "jump"]);
  });

  it("tracks held button bits", () => {
    const input = new SemanticInputPipelineV15();
    input.ingestKeyboard("KeyG", true, 1);
    const result = input.consume(1);
    expect(result.buttons).toBeGreaterThan(0);
    expect(input.isHeld("block")).toBe(true);
    input.ingestKeyboard("KeyG", false, 2);
    input.consume(2);
    expect(input.isHeld("block")).toBe(false);
  });
});

describe("v15 asset pipeline", () => {
  it("deduplicates declarations", () => {
    const assets = new AssetPipelineV15();
    const descriptor = { id: "hero", url: "https://example.com/hero.glb", priority: 10, tags: ["hero"], critical: true };
    const one = assets.declare(descriptor);
    const two = assets.declare(descriptor);
    expect(one.id).toBe(two.id);
    expect(assets.stats().records).toBe(1);
  });

  it("loads a valid asset through the bounded fetch path", async () => {
    const assets = new AssetPipelineV15({
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "model/gltf-binary" },
      }),
    });
    assets.declare({ id: "model", url: "https://example.com/model.glb", priority: 10, tags: [], critical: false, expectedMime: "model/gltf-binary" });
    assets.request("model");
    const result = await assets.pump(1);
    expect(result).toHaveLength(1);
    expect(result[0]?.record.state).toBe("ready");
  });

  it("rejects disallowed protocols before loading", () => {
    const assets = new AssetPipelineV15();
    expect(() => assets.declare({ id: "bad", url: "data:text/plain,evil", priority: 1, tags: [], critical: false })).toThrow();
  });
});

describe("v15 world partition", () => {
  it("defines a grid without duplicate accounting", () => {
    const world = new PredictiveWorldPartitionV15();
    expect(world.defineGrid({ minX: 0, maxX: 2, minZ: 0, maxZ: 2, chunkSizeMeters: 500 })).toBe(9);
    expect(world.defineGrid({ minX: 0, maxX: 2, minZ: 0, maxZ: 2, chunkSizeMeters: 500 })).toBe(0);
    expect(world.stats().defined).toBe(9);
  });

  it("plans load work for a nearby interest", () => {
    const world = new PredictiveWorldPartitionV15();
    world.define({ id: chunkIdV15("0:0"), x: 0, z: 0, radiusMeters: 200, estimatedBytes: 1_000, generationMs: 1, critical: true, biome: "core" });
    world.setInterest({ id: "player", position: { x: 0, y: 0, z: 0 }, velocity: { x: 5, y: 0, z: 0 }, viewDistance: 800, priority: 1000 });
    expect(world.plan(1).length).toBeGreaterThan(0);
    expect(world.desiredIds()).toContain(chunkIdV15("0:0"));
  });

  it("protects critical chunks", () => {
    const world = new PredictiveWorldPartitionV15({ maxResidentChunks: 1 });
    world.define({ id: chunkIdV15("0:0"), x: 0, z: 0, radiusMeters: 200, estimatedBytes: 1, generationMs: 1, critical: true, biome: "core" });
    world.setState(chunkIdV15("0:0"), "resident");
    expect(world.setState(chunkIdV15("0:0"), "cooldown")).toBe(false);
  });
});

describe("v15 network envelope", () => {
  it("round-trips a packet at a fixed observation time", () => {
    const network = new SecureNetworkEnvelopeV15({ maxPacketsPerSecond: 1000 });
    network.ready();
    const packet = network.build("player.state", { hp: 100 }, 5, 1);
    expect(packet).toBeDefined();
    expect(network.parse(packet, 1)).toBeDefined();
    expect(network.stats().received).toBe(1);
  });

  it("rejects tampering", () => {
    const network = new SecureNetworkEnvelopeV15({ maxPacketsPerSecond: 1000 });
    const packet = network.build("player.state", { hp: 100 }, 5, 1);
    expect(network.parse({ ...packet!, payload: { hp: 99 } }, 1)).toBeUndefined();
  });

  it("keeps acknowledgement monotonic", () => {
    const network = new SecureNetworkEnvelopeV15({ maxPacketsPerSecond: 1000 });
    const one = network.build("one", {}, 1, 1)!;
    network.acknowledge(Number(one.sequence));
    const stats = network.stats();
    expect(stats.sent).toBe(1);
    expect(network.pending()).toEqual([]);
  });
});

describe("v15 save store", () => {
  it("saves and loads a versioned envelope", () => {
    const storage = new MemorySaveStorageV15();
    const manager = new SaveManagerV15<{ hp: number }>(storage, { now: () => 10 });
    const saved = manager.save("slot", { hp: 100 }, tickV15(42), { title: "North", playtimeSeconds: 3 });
    expect(saved.envelope.version).toBe(15);
    expect(manager.load("slot")?.envelope.tick).toBe(tickV15(42));
  });

  it("rejects modified payload", () => {
    const storage = new MemorySaveStorageV15();
    const manager = new SaveManagerV15(storage);
    manager.save("slot", { hp: 100 }, tickV15(1), { title: "North", playtimeSeconds: 1 });
    const key = "aapw:v15:save:slot";
    storage.write(key, storage.read(key)!.replace("100", "101"));
    expect(() => manager.load("slot")).toThrow();
  });

  it("produces stable checksums", () => {
    expect(checksumV15({ a: 1, b: 2 })).toBe(checksumV15({ b: 2, a: 1 }));
  });
});
