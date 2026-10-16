import { readFile, readdir } from "node:fs/promises";
import { relative } from "node:path";

const ROOT = new URL("../", import.meta.url);
const sourceRoot = new URL("src/engine-ts/r44/", ROOT);
const testRoot = new URL("tests/engine-r44/", ROOT);
const required = [
  "src/engine-ts/r44/contracts.ts",
  "src/engine-ts/r44/budget.ts",
  "src/engine-ts/r44/lifecycle.ts",
  "src/engine-ts/r44/journal.ts",
  "src/engine-ts/r44/security.ts",
  "src/engine-ts/r44/assets.ts",
  "src/engine-ts/r44/telemetry.ts",
  "src/engine-ts/r44/session.ts",
  "src/engine-ts/r44/diagnostics.ts",
  "src/engine-ts/r44/runtime.ts",
  "src/engine-ts/r44/index.ts"
];
const failures = [];
const read = (path) => readFile(new URL(path, ROOT), "utf8");
const rootPath = new URL(".", ROOT).pathname;

for (const path of required) {
  try {
    const source = await read(path);
    if (source.trim().length === 0) failures.push("empty:" + path);
  } catch {
    failures.push("missing:" + path);
  }
}

const sourceFiles = (await walk(sourceRoot)).filter((path) => path.endsWith(".ts"));
const testFiles = (await walk(testRoot)).filter((path) => path.endsWith(".test.ts"));
let sourceLines = 0;
for (const path of sourceFiles) {
  const source = await readFile(path, "utf8");
  sourceLines += source.split("\n").length;
  if (/@ts-nocheck|Math\.random\s*\(|Date\.now\s*\(/u.test(source)) {
    failures.push("nondeterministic-or-untyped:" + relative(rootPath, path));
  }
}
if (sourceFiles.length < 10) failures.push("source-count:" + sourceFiles.length);
if (sourceLines < 3000) failures.push("source-line-budget:" + sourceLines);
if (testFiles.length < 8) failures.push("test-suite-count:" + testFiles.length);

const index = await read("src/engine-ts/index.ts");
if (!index.includes("export * from './r43/index.ts';")) failures.push("missing-r43-entry");
if (!index.includes("export * as R44RuntimeGovernance from './r44/index.ts';")) failures.push("missing-r44-namespace");
const pkg = JSON.parse(await read("package.json"));
for (const name of ["verify:r44", "typecheck:r44", "test:r44", "check:r44"]) {
  if (!pkg.scripts?.[name]) failures.push("missing-script:" + name);
}
const tsconfig = JSON.parse(await read("tsconfig.r44.json"));
if (!tsconfig.include?.some((value) => value.includes("src/engine-ts/r44"))) failures.push("typecheck-source-scope");
if (!tsconfig.include?.some((value) => value.includes("tests/engine-r44"))) failures.push("typecheck-test-scope");

console.info("[engine-r44] " + JSON.stringify({
  files: sourceFiles.length,
  sourceLines,
  tests: testFiles.length,
  failures: failures.length
}));
if (failures.length > 0) {
  for (const failure of failures) console.error("[engine-r44] " + failure);
  process.exitCode = 1;
}

async function walk(url) {
  const output = [];
  for (const entry of await readdir(url, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), url);
    if (entry.isDirectory()) output.push(...await walk(child));
    else output.push(child.pathname);
  }
  return output;
}
