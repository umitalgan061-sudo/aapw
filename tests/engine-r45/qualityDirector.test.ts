import { describe, expect, it } from "vitest";
import { AdaptiveQualityDirector } from "../../src/engine-ts/r45";

describe("AdaptiveQualityDirector", () => {
  it("downshifts promptly during sustained severe pressure", () => {
    const director = new AdaptiveQualityDirector({
      initialLevel: "ultra", downshiftFrames: 3, upshiftFrames: 10,
      minTicksBetweenChanges: 0, memoryHardLimitBytes: 1_000_000,
    });
    let decision: ReturnType<AdaptiveQualityDirector["observe"]> = null;
    for (let tick = 1; tick <= 3; tick += 1) {
      const next = director.observe({
        tick, frameMs: 100, frameBudgetMs: 16,
        inputLatencyMs: 500, memoryBytes: 2_000_000, networkRttMs: 1000,
        taskQueueDepth: 200, assetQueueDepth: 200, droppedFrames: 20,
      });
      if (next) decision = next;
    }
    expect(decision?.current).toBe("minimal");
    expect(decision?.reasons).toContain("memory-hard-limit");
    expect(director.profile.renderScale).toBeLessThan(1);
  });

  it("upshifts only after an adequate sustained headroom window", () => {
    const director = new AdaptiveQualityDirector({
      initialLevel: "minimal", upshiftFrames: 3, minTicksBetweenChanges: 2, pressureWindow: 3,
    });
    let decision: ReturnType<AdaptiveQualityDirector["observe"]> = null;
    for (let tick = 1; tick <= 4; tick += 1) {
      decision = director.observe({ tick, frameMs: 5, frameBudgetMs: 16, inputLatencyMs: 5, memoryBytes: 1_000_000 });
    }
    expect(director.level).toBe("low");
    expect(director.decisions().some((entry) => entry.current === "low")).toBe(true);
  });

  it("holds the current level while pressure remains in the neutral band", () => {
    const director = new AdaptiveQualityDirector({ initialLevel: "balanced" });
    for (let tick = 1; tick <= 20; tick += 1) {
      director.observe({ tick, frameMs: 15, frameBudgetMs: 16, memoryBytes: 200_000_000 });
    }
    expect(director.level).toBe("balanced");
  });

  it("supports a time-bounded operator override", () => {
    const director = new AdaptiveQualityDirector();
    director.observe({ tick: 1, frameMs: 16 });
    const forced = director.forceLevel("minimal", 4);
    expect(forced).toBeUndefined();
    const decision = director.observe({ tick: 2, frameMs: 16 });
    expect(decision?.reasons).toContain("operator-override");
    expect(director.level).toBe("minimal");
    director.observe({ tick: 5, frameMs: 16 });
    expect(director.snapshot().forced).toBe(false);
  });

  it("records transitions with profile data and bounds history", () => {
    const director = new AdaptiveQualityDirector({
      initialLevel: "high", downshiftFrames: 1, minTicksBetweenChanges: 0, memoryHardLimitBytes: 1_000_000,
    });
    director.observe({ tick: 1, frameMs: 50, memoryBytes: 2_000_000 });
    expect(director.decisions()).toHaveLength(1);
    expect(director.decisions()[0]?.profile.level).toBe("low");
  });

  it("rejects repeated ticks and invalid pressure samples", () => {
    const director = new AdaptiveQualityDirector();
    director.observe({ tick: 2, frameMs: 12 });
    expect(() => director.observe({ tick: 2, frameMs: 12 })).toThrow(/increasing ticks/u);
    expect(() => director.observe({ tick: 3, frameMs: Number.NaN })).toThrow();
  });
});
