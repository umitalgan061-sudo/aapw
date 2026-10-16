import { readFile, readdir } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const sourceRoot = new URL("src/engine-ts/r45/", ROOT);
const testRoot = new URL("tests/engine-r45/", ROOT);
const requiredSource = [
  "src/engine-ts/r45/contracts.ts",
  "src/engine-ts/r45/logicalClock.ts",
  "src/engine-ts/r45/lifecycleGraph.ts",
  "src/engine-ts/r45/commandGateway.ts",
  "src/engine-ts/r45/workScheduler.ts",
  "src/engine-ts/r45/persistenceCoordinator.ts",
  "src/engine-ts/r45/telemetrySpool.ts",
  "src/engine-ts/r45/qualityDirector.ts",
  "src/engine-ts/r45/runtimeDiagnostics.ts",
  "src/engine-ts/r45/migrationGovernance.ts",
  "src/engine-ts/r45/projectManifest.ts",
  "src/engine-ts/r45/runtimeOperations.ts",
  "src/engine-ts/r45/index.ts",
];
const requiredTests = [
  "tests/engine-r45/contracts.test.ts",
  "tests/engine-r45/logicalClock.test.ts",
  "tests/engine-r45/lifecycleGraph.test.ts",
  "tests/engine-r45/commandGateway.test.ts",
  "tests/engine-r45/workScheduler.test.ts",
  "tests/engine-r45/persistenceCoordinator.test.ts",
  "tests/engine-r45/telemetrySpool.test.ts",
  "tests/engine-r45/qualityDirector.test.ts",
  "tests/engine-r45/runtimeDiagnostics.test.ts",
  "tests/engine-r45/migrationGovernance.test.ts",
  "tests/engine-r45/runtimeOperations.test.ts",
  "tests/engine-r45/projectManifest.test.ts",
];
const failures = [];
const read = (path) => readFile(new URL(path, ROOT), "utf8");

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) result.push(...await walk(path));
    else result.push(path);
  }
  return result;
}

for (const path of [...requiredSource, ...requiredTests, "tsconfig.r45.json", "docs/ENGINE_R45_RUNTIME_OPERATIONS.md", ".github/workflows/engine-r45-runtime-operations.yml"]) {
  try {
    if (!(await read(path)).trim()) failures.push("empty:" + path);
  } catch {
    failures.push("missing:" + path);
  }
}

const sourceFiles = (await walk(sourceRoot)).filter((path) => path.pathname.endsWith(".ts"));
const testFiles = (await walk(testRoot)).filter((path) => path.pathname.endsWith(".test.ts"));
let sourceLines = 0;
let testLines = 0;
for (const url of sourceFiles) {
  const source = await readFile(url, "utf8");
  sourceLines += source.split("\n").length;
  const path = relative(fileURLToPath(ROOT), fileURLToPath(url)).replaceAll("\\", "/");
  if (/@ts-nocheck|Math\.random\s*\(|Date\.now\s*\(|\beval\s*\(|new\s+Function\s*\(/u.test(source)) {
    failures.push("unsafe-or-untyped-runtime:" + path);
  }
  if (/TODO|FIXME|IMPLEMENT ME|throw new Error\(["']not implemented/u.test(source)) {
    failures.push("placeholder-runtime-code:" + path);
  }
}
for (const url of testFiles) {
  const source = await readFile(url, "utf8");
  testLines += source.split("\n").length;
  const path = relative(fileURLToPath(ROOT), fileURLToPath(url)).replaceAll("\\", "/");
  if (/\b(?:describe|it|test)\s*\.\s*only\s*\(|\b(?:fit|fdescribe)\s*\(/u.test(source)) {
    failures.push("focused-test:" + path);
  }
  if (!/\b(?:describe|it|test)\s*\(/u.test(source)) failures.push("missing-test-cases:" + path);
}
if (sourceFiles.length < 13) failures.push("source-file-count:" + sourceFiles.length);
if (sourceLines < 3400) failures.push("source-line-budget:" + sourceLines);
if (testFiles.length < 11) failures.push("test-file-count:" + testFiles.length);
if (testLines < 950) failures.push("test-line-budget:" + testLines);

const barrel = await read("src/engine-ts/r45/index.ts");
for (const exportName of [
  "./contracts", "./logicalClock", "./lifecycleGraph", "./commandGateway", "./workScheduler",
  "./persistenceCoordinator", "./telemetrySpool", "./qualityDirector", "./runtimeDiagnostics",
  "./migrationGovernance", "./projectManifest", "./runtimeOperations",
]) {
  if (!barrel.includes('"' + exportName + '"')) failures.push("barrel-export-missing:" + exportName);
}
const rootIndex = await read("src/engine-ts/index.ts");
if (!rootIndex.includes("export * as R45RuntimeOperations from './r45/index.ts';")) failures.push("root-namespace-export-missing");
const packageJson = JSON.parse(await read("package.json"));
for (const scriptName of ["verify:r45", "typecheck:r45", "test:r45", "check:r45", "check:modern:r45"]) {
  if (!packageJson.scripts?.[scriptName]) failures.push("package-script-missing:" + scriptName);
}
const tsconfig = JSON.parse(await read("tsconfig.r45.json"));
if (!tsconfig.include?.some((value) => value.includes("src/engine-ts/r45"))) failures.push("typecheck-source-scope");
if (!tsconfig.include?.some((value) => value.includes("tests/engine-r45"))) failures.push("typecheck-test-scope");
const workflow = await read(".github/workflows/engine-r45-runtime-operations.yml");
for (const command of ["npm run verify:r45", "npm run typecheck:r45", "npm run test:r45"]) {
  if (!workflow.includes(command)) failures.push("workflow-command-missing:" + command);
}

if (failures.length > 0) {
  console.error("[engine-r45] FAILED");
  for (const failure of failures) console.error(" - " + failure);
  process.exitCode = 1;
} else {
  console.info("[engine-r45] PASS " + JSON.stringify({
    sourceFiles: sourceFiles.length, sourceLines, testFiles: testFiles.length, testLines,
    checkedExports: 12,
    invariants: ["strict-types", "bounded-resources", "deterministic-clock", "no ambient randomness", "privacy-filtered telemetry"],
  }));
}
