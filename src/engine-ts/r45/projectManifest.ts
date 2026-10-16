import { RuntimeFault } from "./contracts";
import { TypeScriptMigrationGovernance, type MigrationStage, type MigrationRisk } from "./migrationGovernance";

interface ProjectModuleSeed {
  readonly path: string;
  readonly stage: MigrationStage;
  readonly owner: string;
  readonly dependencies?: readonly string[];
  readonly tests?: readonly string[];
  readonly risk: MigrationRisk;
  readonly runtimeCritical?: boolean;
  readonly sourceOfTruth?: boolean;
}

const PROJECT_MODULES: readonly ProjectModuleSeed[] = Object.freeze([
  {
    path: "src/3d/game3d.js", stage: "legacy-js", owner: "game-loop",
    dependencies: [], tests: ["scripts/checkGame3dRuntime.mjs"], risk: "critical",
    runtimeCritical: true, sourceOfTruth: false,
  },
  {
    path: "src/3d/sceneManager.js", stage: "legacy-js", owner: "world-rendering",
    dependencies: ["src/3d/game3d.js"], tests: [], risk: "critical",
    runtimeCritical: true, sourceOfTruth: false,
  },
  {
    path: "src/3d/physics.js", stage: "legacy-js", owner: "physics",
    dependencies: [], tests: [], risk: "high", runtimeCritical: true, sourceOfTruth: false,
  },
  {
    path: "src/3d/world/chunkManager.js", stage: "legacy-js", owner: "world-streaming",
    dependencies: ["src/3d/physics.js"], tests: [], risk: "high", runtimeCritical: true, sourceOfTruth: false,
  },
  {
    path: "src/engine-ts/index.ts", stage: "typed-boundary", owner: "engine-platform",
    dependencies: ["src/engine-ts/r43/index.ts", "src/engine-ts/r44/index.ts", "src/engine-ts/r45/index.ts"], tests: ["tests/engine-r44"], risk: "critical", runtimeCritical: false, sourceOfTruth: false,
  },
  {
    path: "src/engine-ts/r43/index.ts", stage: "typed-source", owner: "engine-platform",
    dependencies: [], tests: ["tests/engine-r43"], risk: "high",
    runtimeCritical: false, sourceOfTruth: false,
  },
  {
    path: "src/engine-ts/r44/index.ts", stage: "typed-source", owner: "runtime-governance",
    dependencies: ["src/engine-ts/r43/index.ts"], tests: ["tests/engine-r44"], risk: "high",
    runtimeCritical: false, sourceOfTruth: false,
  },
  {
    path: "src/engine-ts/r45/contracts.ts", stage: "strict-core", owner: "runtime-operations",
    dependencies: [], tests: ["tests/engine-r45/contracts.test.ts"], risk: "critical",
    runtimeCritical: true, sourceOfTruth: true,
  },
  {
    path: "src/engine-ts/r45/logicalClock.ts", stage: "strict-core", owner: "runtime-operations",
    dependencies: ["src/engine-ts/r45/contracts.ts"], tests: ["tests/engine-r45/logicalClock.test.ts"], risk: "critical",
    runtimeCritical: true, sourceOfTruth: true,
  },
  {
    path: "src/engine-ts/r45/lifecycleGraph.ts", stage: "strict-core", owner: "runtime-operations",
    dependencies: ["src/engine-ts/r45/contracts.ts"], tests: ["tests/engine-r45/lifecycleGraph.test.ts"], risk: "critical",
    runtimeCritical: true, sourceOfTruth: true,
  },
  {
    path: "src/engine-ts/r45/commandGateway.ts", stage: "strict-core", owner: "runtime-security",
    dependencies: ["src/engine-ts/r45/contracts.ts"], tests: ["tests/engine-r45/commandGateway.test.ts"], risk: "critical",
    runtimeCritical: true, sourceOfTruth: true,
  },
  {
    path: "src/engine-ts/r45/workScheduler.ts", stage: "strict-core", owner: "runtime-scheduling",
    dependencies: ["src/engine-ts/r45/contracts.ts"], tests: ["tests/engine-r45/workScheduler.test.ts"], risk: "high",
    runtimeCritical: true, sourceOfTruth: true,
  },
  {
    path: "src/engine-ts/r45/persistenceCoordinator.ts", stage: "strict-core", owner: "runtime-persistence",
    dependencies: ["src/engine-ts/r45/contracts.ts"], tests: ["tests/engine-r45/persistenceCoordinator.test.ts"], risk: "critical",
    runtimeCritical: true, sourceOfTruth: true,
  },
  {
    path: "src/engine-ts/r45/telemetrySpool.ts", stage: "strict-core", owner: "runtime-observability",
    dependencies: ["src/engine-ts/r45/contracts.ts"], tests: ["tests/engine-r45/telemetrySpool.test.ts"], risk: "high",
    runtimeCritical: true, sourceOfTruth: true,
  },
  {
    path: "src/engine-ts/r45/qualityDirector.ts", stage: "strict-core", owner: "runtime-performance",
    dependencies: ["src/engine-ts/r45/contracts.ts"], tests: ["tests/engine-r45/qualityDirector.test.ts"], risk: "high",
    runtimeCritical: true, sourceOfTruth: true,
  },
  {
    path: "src/engine-ts/r45/runtimeDiagnostics.ts", stage: "strict-core", owner: "runtime-observability",
    dependencies: ["src/engine-ts/r45/contracts.ts"], tests: ["tests/engine-r45/runtimeDiagnostics.test.ts"], risk: "high",
    runtimeCritical: true, sourceOfTruth: true,
  },
  {
    path: "src/engine-ts/r45/migrationGovernance.ts", stage: "strict-core", owner: "typescript-migration",
    dependencies: ["src/engine-ts/r45/contracts.ts"], tests: ["tests/engine-r45/migrationGovernance.test.ts"], risk: "critical",
    runtimeCritical: true, sourceOfTruth: true,
  },
  {
    path: "src/engine-ts/r45/runtimeOperations.ts", stage: "strict-core", owner: "runtime-operations",
    dependencies: [
      "src/engine-ts/r45/contracts.ts",
      "src/engine-ts/r45/logicalClock.ts",
      "src/engine-ts/r45/lifecycleGraph.ts",
      "src/engine-ts/r45/commandGateway.ts",
      "src/engine-ts/r45/workScheduler.ts",
      "src/engine-ts/r45/persistenceCoordinator.ts",
      "src/engine-ts/r45/telemetrySpool.ts",
      "src/engine-ts/r45/qualityDirector.ts",
      "src/engine-ts/r45/runtimeDiagnostics.ts",
    ],
    tests: ["tests/engine-r45/runtimeOperations.test.ts"], risk: "critical",
    runtimeCritical: true, sourceOfTruth: true,
  },
  {
    path: "src/engine-ts/r45/projectManifest.ts", stage: "typed-source", owner: "typescript-migration",
    dependencies: ["src/engine-ts/r45/migrationGovernance.ts"],
    tests: ["tests/engine-r45/projectManifest.test.ts"], risk: "high",
    runtimeCritical: false, sourceOfTruth: false,
  },
  {
    path: "src/engine-ts/r45/index.ts", stage: "typed-source", owner: "runtime-operations",
    dependencies: [
      "src/engine-ts/r45/contracts.ts", "src/engine-ts/r45/logicalClock.ts",
      "src/engine-ts/r45/lifecycleGraph.ts", "src/engine-ts/r45/commandGateway.ts",
      "src/engine-ts/r45/workScheduler.ts", "src/engine-ts/r45/persistenceCoordinator.ts",
      "src/engine-ts/r45/telemetrySpool.ts", "src/engine-ts/r45/qualityDirector.ts",
      "src/engine-ts/r45/runtimeDiagnostics.ts", "src/engine-ts/r45/migrationGovernance.ts",
      "src/engine-ts/r45/projectManifest.ts", "src/engine-ts/r45/runtimeOperations.ts",
    ],
    tests: ["tests/engine-r45/runtimeOperations.test.ts"], risk: "high",
    runtimeCritical: false, sourceOfTruth: false,
  },
]);

export interface ProjectMigrationManifest {
  readonly governance: TypeScriptMigrationGovernance;
  readonly moduleCount: number;
  readonly legacyCriticalModules: readonly string[];
  readonly strictRuntimeModules: readonly string[];
}

export function createProjectMigrationManifest(reviewedAtTick = 0): ProjectMigrationManifest {
  if (!Number.isSafeInteger(reviewedAtTick) || reviewedAtTick < 0) {
    throw new RuntimeFault("INVALID_INPUT", "Review tick must be a non-negative safe integer", "projectManifest.create");
  }
  const governance = new TypeScriptMigrationGovernance(1024);
  for (const seed of PROJECT_MODULES) {
    governance.register({
      path: seed.path,
      stage: seed.stage,
      owner: seed.owner,
      dependencies: seed.dependencies ?? [],
      tests: seed.tests ?? [],
      risk: seed.risk,
      runtimeCritical: seed.runtimeCritical ?? false,
      sourceOfTruth: seed.sourceOfTruth ?? false,
      lastReviewedAt: reviewedAtTick,
    });
  }
  return Object.freeze({
    governance,
    moduleCount: PROJECT_MODULES.length,
    legacyCriticalModules: Object.freeze(
      PROJECT_MODULES.filter((record) => record.stage === "legacy-js" && record.runtimeCritical === true)
        .map((record) => record.path),
    ),
    strictRuntimeModules: Object.freeze(
      PROJECT_MODULES.filter((record) => record.stage === "strict-core" && record.runtimeCritical === true)
        .map((record) => record.path),
    ),
  });
}

export function assessProjectTypeScriptMigration(reviewedAtTick = 0) {
  const manifest = createProjectMigrationManifest(reviewedAtTick);
  const assessment = manifest.governance.assess();
  return Object.freeze({
    assessment,
    legacyCriticalModules: manifest.legacyCriticalModules,
    strictRuntimeModules: manifest.strictRuntimeModules,
    moduleCount: manifest.moduleCount,
    nextActions: Object.freeze(assessment.plan.slice(0, 10)),
  });
}
