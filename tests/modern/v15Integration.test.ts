import { describe, expect, it } from "vitest";
import { createModernRuntime } from "../../src/3d/modern/runtime.ts";
import { createV15PlatformBridge } from "../../src/3d/modern/v15/platformBridge.ts";

const camera = {
  position: { x: 0, y: 60, z: 120 },
  target: { x: 0, y: 0, z: 0 },
  fov: 60,
  near: 0.1,
  far: 30_000,
  viewportWidth: 1280,
  viewportHeight: 720,
  dpr: 1,
};

describe("v15 platform bridge", () => {
  it("feeds a measured frame into the existing modern runtime", async () => {
    const runtime = await createModernRuntime({});
    const bridge = createV15PlatformBridge({ runtime, initialQuality: "balanced" });
    await bridge.initialize();
    const result = await bridge.frame({
      frame: 1,
      frameMs: 16,
      cpuMs: 7,
      gpuMs: 8,
      drawCalls: 180,
      triangles: 250_000,
      visibleObjects: 120,
      textureBytes: 4_000_000,
      memoryPressure: 0.1,
      thermalPressure: 0.1,
      camera,
    });
    expect(result.legacyRuntime.frame).toBe(1);
    expect(result.supervisor.frame).toBe(1);
    expect(result.quality.tier).toBeDefined();
    await bridge.dispose();
  });

  it("does not require a live canvas to test governance", async () => {
    const runtime = await createModernRuntime({});
    const bridge = createV15PlatformBridge({ runtime });
    await bridge.initialize();
    const latestBefore = bridge.latest();
    expect(latestBefore).toBeUndefined();
    await bridge.dispose();
  });

  it("carries keyboard intent through the bridge boundary", async () => {
    const runtime = await createModernRuntime({});
    const bridge = createV15PlatformBridge({ runtime });
    bridge.observeKeyboard("Space", true, 1);
    await bridge.initialize();
    const input = bridge.supervisor.consumeInput(1);
    expect(input.actions).toContain("jump");
    await bridge.dispose();
  });
});
