import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SCOPES = Object.freeze([
  'src/3d/runtime',
  'src/3d/rendering',
  'src/3d/materials',
  'src/3d/ui',
  'src/3d/persistence',
]);
const SINGLE_FILES = Object.freeze([
  'src/3d/sky.js',
  'src/3d/fog.js',
  'src/3d/renderBackendCapability.js',
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

async function readScopeFiles() {
  const files = [];
  for (const scope of SCOPES) {
    files.push(...await walk(resolve(ROOT, scope)));
  }
  for (const path of SINGLE_FILES) {
    files.push(resolve(ROOT, path));
  }
  return files.sort();
}

function expectedShimVariants(baseName) {
  return [
    `export * from './${baseName}.ts';`,
    `export * from './${baseName}.ts';\nexport { default } from './${baseName}.ts';`,
    `import './${baseName}.ts';`,
  ];
}

function normalizeShim(source) {
  return source
    .replace(/\r\n/g, '\n')
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export async function collectMigrationReport() {
  const files = await readScopeFiles();
  const failures = [];
  const owners = [];
  const shims = [];
  let implementationJs = 0;

  for (const absolutePath of files) {
    const projectPath = relative(ROOT, absolutePath).replaceAll('\\', '/');
    const source = await readFile(absolutePath, 'utf8');
    if (!projectPath.endsWith('.js')) continue;

    const tsPath = projectPath.slice(0, -3) + '.ts';
    const tsAbsolutePath = resolve(ROOT, tsPath);
    let typedSource = null;
    try {
      typedSource = await readFile(tsAbsolutePath, 'utf8');
    } catch {
      failures.push(`${projectPath}: missing TypeScript owner ${tsPath}`);
    }

    const normalized = normalizeShim(source);
    const baseName = projectPath.split('/').pop().slice(0, -3);
    const isShim = expectedShimVariants(baseName).some((variant) => normalized === variant);
    if (!isShim) {
      implementationJs += 1;
      failures.push(`${projectPath}: contains JavaScript implementation instead of a TypeScript compatibility shim`);
    } else {
      shims.push(projectPath);
    }

    if (typedSource === null || !typedSource.trim()) {
      failures.push(`${tsPath}: empty TypeScript owner`);
    } else {
      owners.push(tsPath);
    }
  }

  const uniqueOwners = [...new Set(owners)].sort();
  const uniqueShims = [...new Set(shims)].sort();
  return Object.freeze({
    version: 12,
    scopes: SCOPES,
    singleFiles: SINGLE_FILES,
    scannedJavaScriptFiles: files.filter((path) => path.endsWith('.js')).length,
    compatibilityShimCount: uniqueShims.length,
    typeScriptOwnerCount: uniqueOwners.length,
    implementationJavaScriptCount: implementationJs,
    failures: Object.freeze(failures),
    clean: failures.length === 0,
  });
}

export async function assertMigrationClean() {
  const report = await collectMigrationReport();
  if (!report.clean) {
    const details = report.failures.map((failure) => `- ${failure}`).join('\n');
    throw new Error(`R12 TypeScript production boundary failed:\n${details}`);
  }
  return report;
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.cwd(), process.argv[1])).href : null;
if (entry && import.meta.url === entry) {
  try {
    const report = await assertMigrationClean();
    console.log(
      `R12 TypeScript production boundary passed: ${report.typeScriptOwnerCount} TS owners, ` +
      `${report.compatibilityShimCount} JS compatibility shims, 0 JS implementations.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
