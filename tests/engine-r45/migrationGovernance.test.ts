import { describe, expect, it } from "vitest";
import { TypeScriptMigrationGovernance } from "../../src/engine-ts/r45";

describe("TypeScriptMigrationGovernance", () => {
  it("assesses an owned, tested, strictly typed module graph as ready", () => {
    const governance = new TypeScriptMigrationGovernance();
    governance.register({
      path: "src/core/contracts.ts", stage: "strict-core", owner: "platform",
      dependencies: [], tests: ["tests/contracts.test.ts"], risk: "critical",
      runtimeCritical: true, sourceOfTruth: true, lastReviewedAt: 10,
    });
    governance.register({
      path: "src/core/runtime.ts", stage: "typed-source", owner: "engine",
      dependencies: ["src/core/contracts.ts"], tests: ["tests/runtime.test.ts"], risk: "high",
      runtimeCritical: true, sourceOfTruth: true, lastReviewedAt: 11,
    });
    const assessment = governance.assess();
    expect(assessment.ready).toBe(true);
    expect(assessment.totalModules).toBe(2);
    expect(assessment.typedModules).toBe(2);
    expect(assessment.strictModules).toBe(1);
    expect(assessment.score).toBeGreaterThan(70);
    expect(assessment.findings).toEqual([]);
  });

  it("flags typed runtime code that depends directly on legacy JavaScript", () => {
    const governance = new TypeScriptMigrationGovernance();
    governance.register({
      path: "src/old/player.js", stage: "legacy-js", owner: "gameplay",
      dependencies: [], tests: [], risk: "high", runtimeCritical: true,
      sourceOfTruth: false, lastReviewedAt: 1,
    });
    governance.register({
      path: "src/new/player.ts", stage: "strict-core", owner: "engine",
      dependencies: ["src/old/player.js"], tests: ["tests/player.test.ts"], risk: "critical",
      runtimeCritical: true, sourceOfTruth: true, lastReviewedAt: 2,
    });
    const assessment = governance.assess();
    expect(assessment.ready).toBe(false);
    expect(assessment.findings.some((finding) => finding.code === "STAGE_REGRESSION")).toBe(true);
    expect(assessment.findings.some((finding) => finding.code === "UNTYPED_CRITICAL")).toBe(true);
  });

  it("finds dependency cycles and missing modules", () => {
    const governance = new TypeScriptMigrationGovernance();
    const base = {
      owner: "team", tests: ["tests/a.test.ts"], risk: "medium" as const,
      runtimeCritical: false, sourceOfTruth: false, lastReviewedAt: 1,
    };
    governance.register({ ...base, path: "src/a.ts", stage: "typed-boundary", dependencies: ["src/b.ts"] });
    governance.register({ ...base, path: "src/b.ts", stage: "typed-boundary", dependencies: ["src/a.ts", "src/missing.ts"] });
    const assessment = governance.assess();
    expect(assessment.findings.some((finding) => finding.code === "DEPENDENCY_CYCLE")).toBe(true);
    expect(assessment.findings.some((finding) => finding.code === "MISSING_DEPENDENCY")).toBe(true);
  });

  it("requires strict-core modules to declare test contracts", () => {
    const governance = new TypeScriptMigrationGovernance();
    governance.register({
      path: "src/critical.ts", stage: "strict-core", owner: "engine",
      dependencies: [], tests: [], risk: "critical", runtimeCritical: true,
      sourceOfTruth: true, lastReviewedAt: 100,
    });
    expect(governance.assess().findings.some((finding) => finding.code === "MISSING_TEST" && finding.severity === "error")).toBe(true);
  });

  it("prevents duplicate source-of-truth claims for the same logical module", () => {
    const governance = new TypeScriptMigrationGovernance();
    const common = {
      owner: "platform", dependencies: [], tests: ["tests/mod.test.ts"], risk: "low" as const,
      runtimeCritical: false, sourceOfTruth: true, lastReviewedAt: 1,
    };
    governance.register({ ...common, path: "src/module.js", stage: "legacy-js" });
    governance.register({ ...common, path: "src/module.ts", stage: "typed-source" });
    expect(governance.assess().findings.some((finding) => finding.code === "MULTIPLE_SOURCES")).toBe(true);
  });

  it("allows stage advancement but blocks accidental migration regression", () => {
    const governance = new TypeScriptMigrationGovernance();
    const record = {
      path: "src/world.ts", owner: "world", dependencies: [], tests: ["tests/world.test.ts"],
      risk: "high" as const, runtimeCritical: true, sourceOfTruth: true, lastReviewedAt: 5,
    };
    governance.register({ ...record, stage: "typed-boundary" });
    governance.register({ ...record, stage: "typed-source", lastReviewedAt: 6 });
    expect(() => governance.register({ ...record, stage: "legacy-js", lastReviewedAt: 7 })).toThrow(/regress/u);
  });

  it("normalizes paths and provides highest-risk migration work first", () => {
    const governance = new TypeScriptMigrationGovernance();
    const base = { owner: "team", dependencies: [], tests: [], runtimeCritical: false, sourceOfTruth: false, lastReviewedAt: 1 };
    governance.register({ ...base, path: "./src/low.js", stage: "legacy-js", risk: "low" });
    governance.register({ ...base, path: "src/high.js", stage: "legacy-js", risk: "critical" });
    expect(governance.get("src/low.js")?.path).toBe("src/low.js");
    expect(governance.assess().plan[0]).toBe("src/high.js");
    expect(() => governance.register({ ...base, path: "../escape.ts", stage: "legacy-js", risk: "low" })).toThrow();
  });
});
