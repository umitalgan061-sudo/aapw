import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const required = [
  "src/engine-ts/r44/contracts.ts",
  "src/engine-ts/r44/hash.ts",
  "src/engine-ts/r44/eventLedger.ts",
  "src/engine-ts/r44/performanceGovernor.ts",
  "src/engine-ts/r44/incidentSupervisor.ts",
  "src/engine-ts/r44/resourceScope.ts",
  "src/engine-ts/r44/taskScheduler.ts",
  "src/engine-ts/r44/assetPipeline.ts",
  "src/engine-ts/r44/networkGuard.ts",
  "src/engine-ts/r44/saveCoordinator.ts",
  "src/engine-ts/r44/featureGates.ts",
  "src/engine-ts/r44/runtimeAssurance.ts",
  "src/engine-ts/r44/index.ts",
  "tests/engine-ts/r44/ledger.test.ts",
  "tests/engine-ts/r44/scheduler.test.ts",
  "tests/engine-ts/r44/governance.test.ts",
  "tests/engine-ts/r44/boundaries.test.ts",
  "tests/engine-ts/r44/save-runtime.test.ts",
];
for (const path of required) await access(resolve(root, path));

const sourceFiles = required.filter((path) => path.startsWith("src/engine-ts/r44/") && path.endsWith(".ts"));
const sources = await Promise.all(sourceFiles.map((path) => readFile(resolve(root, path), "utf8")));
const stripComments = (value) => value
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/(^|[^:])\/\/.*$/gmu, "$1");
const executableText = stripComments(sources.join("\n"));
assert.doesNotMatch(executableText, /\bMath\.random\s*\(/u, "R44 core must not use ambient randomness");
assert.doesNotMatch(executableText, /\bDate\.now\s*\(/u, "R44 core must not use wall-clock timestamps");
assert.doesNotMatch(executableText, /\bcrypto\.randomUUID\s*\(/u, "R44 identities must be reproducible");
assert.doesNotMatch(executableText, /\beval\s*\(/u, "R44 core must not evaluate dynamic source");
assert.doesNotMatch(executableText, /\bnew\s+Function\s*\(/u, "R44 core must not compile dynamic source");

const engineIndex = await readFile(resolve(root, "src/engine-ts/index.ts"), "utf8");
assert.match(engineIndex, /export\s+\*\s+from\s+['"]\.\/r44\/index\.ts['"]/u, "R44 barrel is not exported by the engine entry point");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(packageJson.scripts["verify:runtime-assurance-r44"], "node scripts/checkRuntimeAssuranceR44.mjs");
assert.equal(packageJson.scripts["test:runtime-assurance-r44"], "vitest run tests/engine-ts/r44");
assert.equal(packageJson.scripts["check:runtime-assurance-r44"], "npm run verify:runtime-assurance-r44 && npm run typecheck && npm run test:runtime-assurance-r44");

const testFiles = required.filter((path) => path.startsWith("tests/"));
const testBodies = await Promise.all(testFiles.map((path) => readFile(resolve(root, path), "utf8")));
const testCount = testBodies.reduce((sum, text) => sum + (text.match(/\bit\s*\(/gu) ?? []).length, 0);
assert.ok(testCount >= 25, "R44 regression coverage has too few focused cases: " + testCount);
console.log("R44 runtime assurance contract check passed (" + sourceFiles.length + " source modules, " + testCount + " test cases).");
