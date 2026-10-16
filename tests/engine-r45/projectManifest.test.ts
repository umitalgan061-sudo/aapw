import { describe, expect, it } from "vitest";
import { RuntimeFault, assessProjectTypeScriptMigration, createProjectMigrationManifest } from "../../src/engine-ts/r45";

describe("project TypeScript migration manifest", () => {
  it("models critical legacy entrypoints and strict R45 runtime modules explicitly", () => {
    const manifest = createProjectMigrationManifest(42);
    expect(manifest.moduleCount).toBeGreaterThanOrEqual(18);
    expect(manifest.legacyCriticalModules).toContain("src/3d/game3d.js");
    expect(manifest.strictRuntimeModules).toContain("src/engine-ts/r45/runtimeOperations.ts");
    expect(manifest.governance.get("src/engine-ts/r45/runtimeOperations.ts")?.lastReviewedAt).toBe(42);
  });

  it("returns a migration assessment without hiding remaining JavaScript authorities", () => {
    const result = assessProjectTypeScriptMigration(100);
    expect(result.assessment.ready).toBe(true);
    expect(result.assessment.totalModules).toBe(result.moduleCount);
    expect(result.assessment.findings.some((finding) => finding.code === "UNTYPED_CRITICAL" && finding.severity === "warning")).toBe(true);
    expect(result.nextActions.length).toBeGreaterThan(0);
  });

  it("rejects invalid review timestamps", () => {
    expect(() => createProjectMigrationManifest(-1)).toThrow(RuntimeFault);
  });
});
