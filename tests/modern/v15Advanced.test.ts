import { describe, expect, it } from "vitest";
import {
  AdaptiveQualityDirectorV15,
  MemorySaveStorageV15,
  PredictiveWorldPartitionV15,
  RenderTelemetryBufferV15,
  RuntimeSupervisorV15,
  SaveManagerV15,
  SecureNetworkEnvelopeV15,
  checksumV15,
  chunkIdV15,
  frameV15,
  probeCapabilitiesV15,
  tickV15,
} from "../../src/3d/modern/v15/index.ts";

function sample(frame: number, patch: Record<string, unknown> = {}) {
  return {
    frame: frameV15(frame),
    frameMs: 16,
    cpuMs: 7,
    gpuMs: 9,
    drawCalls: 300,
    triangles: 450_000,
    visibleObjects: 200,
    textureBytes: 10_000_000,
    memoryPressure: 0.1,
    thermalPressure: 0.1,
    timestampMs: frame * 16,
    ...patch,
  };
}

describe("v15 telemetry", () => {
  it("retains only the configured history", () => {
    const telemetry = new RenderTelemetryBufferV15(4);
    for (let frame = 1; frame <= 10; frame += 1) {
      telemetry.push({
        frame,
        backend: "webgpu",
        gpuMs: 8,
        cpuMs: 5,
        frameMs: 15,
        drawCalls: 200,
        triangles: 200_000,
        visibleObjects: 100,
        textureBytes: 4_000_000,
        renderScale: 0.9,
        quality: "high",
      });
    }
    expect(telemetry.window().map(value => value.frame)).toEqual([7, 8, 9, 10]);
  });

  it("detects high p95 latency", () => {
    const telemetry = new RenderTelemetryBufferV15();
    for (let frame = 0; frame < 57; frame += 1) {
      telemetry.push({
        frame,
        backend: "webgpu",
        gpuMs: 8,
        cpuMs: 5,
        frameMs: 14,
        drawCalls: 100,
        triangles: 100_000,
        visibleObjects: 50,
        textureBytes: 1_000_000,
        renderScale: 1,
        quality: "ultra",
      });
    }
    telemetry.push({
      frame: 58,
      backend: "webgpu",
      gpuMs: 40,
      cpuMs: 20,
      frameMs: 55,
      drawCalls: 2_000,
      triangles: 4_000_000,
      visibleObjects: 2_000,
      textureBytes: 100_000_000,
      renderScale: 0.6,
      quality: "ultra",
    });
    telemetry.push({
      frame: 59,
      backend: "webgpu",
      gpuMs: 40,
      cpuMs: 20,
      frameMs: 55,
      drawCalls: 2_000,
      triangles: 4_000_000,
      visibleObjects: 2_000,
      textureBytes: 100_000_000,
      renderScale: 0.6,
      quality: "ultra",
    });
    telemetry.push({
      frame: 60,
      backend: "webgpu",
      gpuMs: 40,
      cpuMs: 20,
      frameMs: 55,
      drawCalls: 2_000,
      triangles: 4_000_000,
      visibleObjects: 2_000,
      textureBytes: 100_000_000,
      renderScale: 0.6,
      quality: "ultra",
    });
    expect(telemetry.percentileFrameMs(0.95)).toBeGreaterThan(14);
  });
});

describe("v15 network", () => {
  it("uses a checksum over the logical envelope", () => {
    const network = new SecureNetworkEnvelopeV15<{ hp: number }>({ maxPacketsPerSecond: 1000 });
    network.ready();
    const packet = network.build("player.state", { hp: 100 }, 10, 100);
    expect(packet).toBeDefined();
    expect(packet?.checksum).toBe(checksumV15({
      protocol: 15,
      kind: "player.state",
      sequence: packet!.sequence,
      ack: packet!.ack,
      tick: tickV15(10),
      payload: { hp: 100 },
    }));
  });

  it("rejects checksum tampering", () => {
    const network = new SecureNetworkEnvelopeV15({ maxPacketsPerSecond: 1000 });
    const packet = network.build("state", { hp: 100 }, 1, 1);
    expect(packet).toBeDefined();
    expect(network.parse({ ...packet!, payload: { hp: 99 } }, 1)).toBeUndefined();
  });

  it("enforces a byte budget", () => {
    const network = new SecureNetworkEnvelopeV15({ maxPacketsPerSecond: 1000, maxBytesPerSecond: 1_024 });
    const packet = network.build("state", { text: "x".repeat(2_000) }, 1, 1);
    expect(packet).toBeUndefined();
    expect(network.stats().dropped).toBe(1);
  });
});

describe("v15 saves", () => {
  it("increments revisions monotonically", () => {
    const storage = new MemorySaveStorageV15();
    const manager = new SaveManagerV15(storage, { now: () => 100 });
    const one = manager.save("one", { hp: 100 }, tickV15(1), { title: "One", playtimeSeconds: 1 });
    const two = manager.save("two", { hp: 80 }, tickV15(2), { title: "Two", playtimeSeconds: 2 });
    expect(Number(two.envelope.revision)).toBe(Number(one.envelope.revision) + 1);
    expect(manager.list().length).toBe(2);
  });

  it("ignores a corrupt save when indexing slots", () => {
    const storage = new MemorySaveStorageV15();
    const manager = new SaveManagerV15(storage);
    manager.save("one", { hp: 100 }, tickV15(1), { title: "One", playtimeSeconds: 1 });
    const key = "aapw:v15:save:one";
    const raw = storage.read(key)!;
    storage.write(key, raw.replace("100", "101"));
    expect(manager.list()).toEqual([]);
  });

  it("exports a value that a second manager can validate", () => {
    const storageA = new MemorySaveStorageV15();
    const managerA = new SaveManagerV15(storageA, { now: () => 2 });
    managerA.save("slot", { score: 42 }, tickV15(7), { title: "North", playtimeSeconds: 10 });
    const exported = managerA.export("slot");
    const storageB = new MemorySaveStorageV15();
    const managerB = new SaveManagerV15(storageB, { now: () => 3 });
    const imported = managerB.import(exported);
    expect(imported.envelope.tick).toBe(tickV15(7));
    expect(managerB.load("slot")?.metadata.title).toBe("North");
  });
});

describe("v15 world partition", () => {
  it("returns deterministic desired ids", () => {
    const world = new PredictiveWorldPartitionV15();
    world.defineGrid({ minX: -1, maxX: 1, minZ: -1, maxZ: 1, chunkSizeMeters: 500 });
    world.setInterest({
      id: "player",
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 50, y: 0, z: 0 },
      viewDistance: 1_500,
      priority: 1_000,
    });
    const first = world.plan(20);
    const firstDigest = world.digest();
    const ids = world.desiredIds();
    const second = world.plan(20);
    expect(second).toEqual(first);
    expect(world.digest()).toBe(firstDigest);
    expect(ids.every(id => typeof id === "string")).toBe(true);
  });

  it("supports resident restoration", () => {
    const world = new PredictiveWorldPartitionV15({ maxResidentChunks: 2 });
    world.define({ id: chunkIdV15("0:0"), x: 0, z: 0, radiusMeters: 300, estimatedBytes: 10, generationMs: 1, critical: true, biome: "core" });
    world.define({ id: chunkIdV15("1:0"), x: 1, z: 0, radiusMeters: 300, estimatedBytes: 10, generationMs: 1, critical: false, biome: "plains" });
    world.setState(chunkIdV15("0:0"), "resident");
    world.setState(chunkIdV15("1:0"), "resident");
    const snapshot = world.serialize();
    const restored = new PredictiveWorldPartitionV15({ maxResidentChunks: 2 });
    restored.restore(snapshot);
    expect(restored.serialize()).toEqual(snapshot);
  });
});

describe("v15 quality", () => {
  it("degrades after three consecutive high-pressure observations", () => {
    const director = new AdaptiveQualityDirectorV15({ initial: "ultra" });
    for (let index = 1; index <= 3; index += 1) {
      director.observe(sample(index, { frameMs: 60, cpuMs: 44, gpuMs: 48, drawCalls: 4_000, triangles: 7_000_000, visibleObjects: 3_000, memoryPressure: 1, thermalPressure: 1 }));
    }
    expect(director.tier).toBe("high");
  });

  it("does not immediately oscillate back upward", () => {
    const director = new AdaptiveQualityDirectorV15({ initial: "high" });
    for (let index = 1; index <= 3; index += 1) {
      director.observe(sample(index, { frameMs: 60, cpuMs: 44, gpuMs: 48, drawCalls: 4_000, triangles: 7_000_000, visibleObjects: 3_000, memoryPressure: 1, thermalPressure: 1 }));
    }
    const tier = director.tier;
    director.observe(sample(4));
    expect(director.tier).toBe(tier);
  });
});

describe("v15 capabilities", () => {
  it("handles WebGPU adapter failure safely", async () => {
    const capabilities = await probeCapabilitiesV15({
      navigator: { gpu: { requestAdapter: async () => { throw new Error("denied"); } } },
      window: { matchMedia: () => ({ matches: false }), devicePixelRatio: 2 },
      canvas: { getContext: () => ({}) },
    });
    expect(capabilities.backend).toBe("webgl2");
    expect(capabilities.webgpuAvailable).toBe(false);
  });

  it("reads a battery saver hint without requiring the API", async () => {
    const capabilities = await probeCapabilitiesV15({
      navigator: { getBattery: async () => ({ charging: false, level: 0.1 }) },
      window: { matchMedia: () => ({ matches: false }) },
      canvas: { getContext: () => null },
    });
    expect(capabilities.batterySaver).toBe(true);
  });
});

describe("v15 supervisor", () => {
  it("initializes explicitly and exposes a stable snapshot shape", async () => {
    const supervisor = new RuntimeSupervisorV15({ autoInitialize: false, seed: 7, telemetryCapacity: 32 });
    expect(supervisor.initialized).toBe(false);
    await supervisor.initialize();
    expect(supervisor.initialized).toBe(true);
    const snapshot = await supervisor.tick({
      frame: 1,
      frameMs: 16,
      cpuMs: 7,
      gpuMs: 8,
      drawCalls: 200,
      triangles: 200_000,
      visibleObjects: 100,
      textureBytes: 4_000_000,
      memoryPressure: 0.1,
      thermalPressure: 0.1,
      timestampMs: 16,
    });
    expect(snapshot.frame).toBe(1);
    expect(snapshot.checksum).toEqual(expect.any(Number));
    await supervisor.dispose();
  });

  it("flags severe pressure as non-healthy", async () => {
    const supervisor = new RuntimeSupervisorV15({ autoInitialize: false });
    await supervisor.initialize();
    const snapshot = await supervisor.tick({
      frame: 1,
      frameMs: 60,
      cpuMs: 44,
      gpuMs: 48,
      drawCalls: 4_000,
      triangles: 8_000_000,
      visibleObjects: 3_000,
      textureBytes: 700_000_000,
      memoryPressure: 1,
      thermalPressure: 1,
      timestampMs: 16,
    });
    expect(snapshot.health.state).not.toBe("healthy");
    await supervisor.dispose();
  });

  it("accepts semantic input without changing runtime ownership", async () => {
    const supervisor = new RuntimeSupervisorV15({ autoInitialize: false });
    supervisor.observeKeyboard("Space", true, 10);
    const input = supervisor.consumeInput(10);
    expect(input.actions).toContain("jump");
    await supervisor.dispose();
  });
});
