import { RuntimeFault, normalizeIdentifier } from "./contracts";

export type MigrationStage =
  | "legacy-js"
  | "compatibility-adapter"
  | "typed-boundary"
  | "typed-source"
  | "strict-core";

export type MigrationRisk = "low" | "medium" | "high" | "critical";

export interface ModuleOwnershipRecord {
  readonly path: string;
  readonly stage: MigrationStage;
  readonly owner: string;
  readonly dependencies: readonly string[];
  readonly tests: readonly string[];
  readonly risk: MigrationRisk;
  readonly runtimeCritical: boolean;
  readonly sourceOfTruth: boolean;
  readonly lastReviewedAt: number;
}

export interface MigrationFinding {
  readonly code:
    | "MISSING_DEPENDENCY"
    | "DEPENDENCY_CYCLE"
    | "UNTYPED_CRITICAL"
    | "MISSING_TEST"
    | "MULTIPLE_SOURCES"
    | "STAGE_REGRESSION"
    | "INVALID_PATH"
    | "UNOWNED_MODULE";
  readonly severity: "error" | "warning";
  readonly module: string;
  readonly detail: string;
}

export interface MigrationAssessment {
  readonly ready: boolean;
  readonly score: number;
  readonly totalModules: number;
  readonly typedModules: number;
  readonly strictModules: number;
  readonly testedModules: number;
  readonly sourceOfTruthModules: number;
  readonly findings: readonly MigrationFinding[];
  readonly plan: readonly string[];
}

const STAGE_SCORE: Readonly<Record<MigrationStage, number>> = {
  "legacy-js": 0,
  "compatibility-adapter": 25,
  "typed-boundary": 50,
  "typed-source": 75,
  "strict-core": 100,
};
const RISK_SCORE: Readonly<Record<MigrationRisk, number>> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export class TypeScriptMigrationGovernance {
  readonly maxModules: number;
  #records = new Map<string, ModuleOwnershipRecord>();

  constructor(maxModules = 20_000) {
    if (!Number.isInteger(maxModules) || maxModules < 1 || maxModules > 100_000) {
      throw new RuntimeFault("INVALID_INPUT", "Migration record capacity is invalid", "migrationGovernance.constructor");
    }
    this.maxModules = maxModules;
  }

  register(recordValue: ModuleOwnershipRecord): void {
    const record = this.#normalizeRecord(recordValue);
    const existing = this.#records.get(record.path);
    if (existing && STAGE_SCORE[record.stage] < STAGE_SCORE[existing.stage]) {
      throw new RuntimeFault("CONFLICT", "Migration stage cannot regress without an explicit reset", "migrationGovernance.register", {
        details: { path: record.path, previous: existing.stage, next: record.stage },
      });
    }
    if (!existing && this.#records.size >= this.maxModules) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Migration manifest is full", "migrationGovernance.register");
    }
    this.#records.set(record.path, record);
  }

  remove(pathValue: string): boolean {
    const path = this.#normalizePath(pathValue);
    return this.#records.delete(path);
  }

  get(pathValue: string): ModuleOwnershipRecord | undefined {
    return this.#records.get(this.#normalizePath(pathValue));
  }

  records(): readonly ModuleOwnershipRecord[] {
    return Object.freeze([...this.#records.values()].sort((a, b) => a.path.localeCompare(b.path)));
  }

  assess(): MigrationAssessment {
    const findings: MigrationFinding[] = [];
    const records = this.records();
    const paths = new Set(records.map((record) => record.path));
    const owners = new Map<string, ModuleOwnershipRecord[]>();
    for (const record of records) {
      if (!record.owner) {
        findings.push(this.#finding("UNOWNED_MODULE", "error", record.path, "Module has no accountable owner"));
      }
      for (const dependencyValue of record.dependencies) {
        const dependency = this.#normalizePath(dependencyValue);
        if (!paths.has(dependency)) {
          findings.push(this.#finding("MISSING_DEPENDENCY", "error", record.path, "Missing dependency: " + dependency));
          continue;
        }
        const target = this.#records.get(dependency);
        if (!target) continue;
        if (
          record.stage === "strict-core" &&
          target.stage === "legacy-js"
        ) {
          findings.push(this.#finding("STAGE_REGRESSION", "error", record.path, "Strict core depends directly on legacy JavaScript: " + dependency));
        }
        if (record.runtimeCritical && target.stage === "legacy-js" && record.stage !== "legacy-js") {
          findings.push(this.#finding("UNTYPED_CRITICAL", "error", record.path, "Runtime-critical typed module reaches legacy JS directly: " + dependency));
        }
      }
      if (record.runtimeCritical && record.stage === "legacy-js") {
        findings.push(this.#finding("UNTYPED_CRITICAL", "warning", record.path, "Runtime-critical module is still JavaScript-owned"));
      }
      if (record.stage === "strict-core" && record.tests.length === 0) {
        findings.push(this.#finding("MISSING_TEST", "error", record.path, "Strict-core module must name at least one test contract"));
      } else if (record.stage !== "legacy-js" && record.tests.length === 0) {
        findings.push(this.#finding("MISSING_TEST", "warning", record.path, "Typed module has no test contract recorded"));
      }
      if (record.sourceOfTruth) {
        const key = record.path.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/u, "");
        const list = owners.get(key) ?? [];
        list.push(record);
        owners.set(key, list);
      }
    }
    for (const [key, sources] of owners) {
      if (sources.length > 1) {
        findings.push(this.#finding("MULTIPLE_SOURCES", "error", key, "Multiple modules claim source-of-truth authority"));
      }
    }

    const cycleFinding = this.#findCycle();
    if (cycleFinding) findings.push(cycleFinding);
    const typedModules = records.filter((record) => STAGE_SCORE[record.stage] >= STAGE_SCORE["typed-boundary"]).length;
    const strictModules = records.filter((record) => record.stage === "strict-core").length;
    const testedModules = records.filter((record) => record.tests.length > 0).length;
    const sourceOfTruthModules = records.filter((record) => record.sourceOfTruth).length;
    const weighted = records.length === 0 ? 100 : records.reduce((total, record) => {
      const riskWeight = RISK_SCORE[record.risk];
      const riskFactor = 1 / riskWeight;
      return total + STAGE_SCORE[record.stage] * riskFactor;
    }, 0) / records.reduce((total, record) => total + 1 / RISK_SCORE[record.risk], 0);
    const errors = findings.filter((finding) => finding.severity === "error").length;
    const warnings = findings.filter((finding) => finding.severity === "warning").length;
    const score = Math.max(0, Math.round(weighted - errors * 12 - warnings * 2));
    const plan = this.#migrationPlan();
    return Object.freeze({
      ready: errors === 0,
      score,
      totalModules: records.length,
      typedModules,
      strictModules,
      testedModules,
      sourceOfTruthModules,
      findings: Object.freeze(findings.sort((a, b) =>
        a.severity.localeCompare(b.severity) || a.module.localeCompare(b.module) || a.code.localeCompare(b.code))),
      plan: Object.freeze(plan),
    });
  }

  snapshot(): Readonly<{ records: readonly ModuleOwnershipRecord[]; assessment: MigrationAssessment }> {
    return Object.freeze({ records: this.records(), assessment: this.assess() });
  }

  #normalizeRecord(input: ModuleOwnershipRecord): ModuleOwnershipRecord {
    const path = this.#normalizePath(input.path);
    const owner = normalizeIdentifier(input.owner, "migration.owner");
    if (!Number.isSafeInteger(input.lastReviewedAt) || input.lastReviewedAt < 0) {
      throw new RuntimeFault("INVALID_INPUT", "Review tick must be a non-negative integer", "migrationGovernance.register");
    }
    if (!(input.stage in STAGE_SCORE) || !(input.risk in RISK_SCORE)) {
      throw new RuntimeFault("INVALID_INPUT", "Migration stage or risk is invalid", "migrationGovernance.register");
    }
    const dependencies = [...new Set(input.dependencies.map((entry) => this.#normalizePath(entry)))].sort();
    const tests = [...new Set(input.tests.map((entry) => this.#normalizePath(entry)))].sort();
    return Object.freeze({
      ...input,
      path,
      owner,
      dependencies: Object.freeze(dependencies),
      tests: Object.freeze(tests),
    });
  }

  #normalizePath(value: string): string {
    if (typeof value !== "string") {
      throw new RuntimeFault("INVALID_INPUT", "Module path must be a string", "migrationGovernance.path");
    }
    const normalized = value.replace(/\\/gu, "/").replace(/^\.\//u, "");
    if (
      normalized.startsWith("/") ||
      normalized.includes("..") ||
      normalized.trim().length === 0 ||
      normalized.length > 512 ||
      !/^[a-zA-Z0-9_./-]+$/u.test(normalized)
    ) {
      throw new RuntimeFault("INVALID_INPUT", "Module path is unsafe", "migrationGovernance.path");
    }
    return normalized;
  }

  #findCycle(): MigrationFinding | null {
    const marks = new Map<string, "visiting" | "visited">();
    const visit = (path: string, trail: string[]): MigrationFinding | null => {
      const state = marks.get(path);
      if (state === "visited") return null;
      if (state === "visiting") {
        return this.#finding("DEPENDENCY_CYCLE", "error", path, "Dependency cycle: " + [...trail, path].join(" -> "));
      }
      marks.set(path, "visiting");
      const record = this.#records.get(path);
      for (const dependency of record?.dependencies ?? []) {
        if (!this.#records.has(dependency)) continue;
        const finding = visit(dependency, [...trail, path]);
        if (finding) return finding;
      }
      marks.set(path, "visited");
      return null;
    };
    for (const path of [...this.#records.keys()].sort()) {
      const finding = visit(path, []);
      if (finding) return finding;
    }
    return null;
  }

  #migrationPlan(): string[] {
    return this.records()
      .filter((record) => record.stage !== "strict-core")
      .sort((a, b) => RISK_SCORE[b.risk] - RISK_SCORE[a.risk] ||
        STAGE_SCORE[a.stage] - STAGE_SCORE[b.stage] ||
        a.path.localeCompare(b.path))
      .map((record) => record.path);
  }

  #finding(code: MigrationFinding["code"], severity: MigrationFinding["severity"], module: string, detail: string): MigrationFinding {
    return Object.freeze({ code, severity, module, detail });
  }
}
