import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ROOTS = ['src/3d', 'src/engine-ts'];
const LEGACY_ALLOWLIST = new Set(['src/3d/vendor/']);
const MUST_EXIST = [
  'src/engine-ts/coreTypes.ts',
  'src/engine-ts/runtimeContracts.ts',
  'src/engine-ts/persistence.ts',
  'src/engine-ts/renderBridge.ts',
  'src/engine-ts/assets.ts',
  'src/engine-ts/input.ts',
  'src/engine-ts/world.ts',
  'src/engine-ts/ecsRuntime.ts',
  'src/engine-ts/modernEngine.ts',
  'src/engine-ts/legacyAdapters.ts',
  'src/3d/config.ts',
  'src/3d/eventBus.ts',
  'src/3d/state.ts',
];

const walk = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else result.push(path);
  }
  return result;
};

const normalize = path => path.split('\\').join('/');
const failures = [];
const rootFiles = (await Promise.all(ROOTS.map(root => walk(root)))).flat().map(normalize);
const sourceFiles = rootFiles.filter(path => /\.(ts|tsx|js|jsx)$/.test(path));
const sourceSet = new Set(sourceFiles);

for (const path of MUST_EXIST) {
  try { await readFile(path, 'utf8'); } catch { failures.push(`required typed module missing: ${path}`); }
}

const legacyFiles = sourceFiles.filter(path => /\.(js|jsx)$/.test(path) && ![...LEGACY_ALLOWLIST].some(prefix => path.startsWith(prefix)));
const typedFiles = sourceFiles.filter(path => /\.(ts|tsx)$/.test(path));
const migrationCandidates = legacyFiles.filter(path => !path.includes('/vendor/'));
const untypedImportPattern = /from\s+['"](\.\.?\/[^'"]+\.js)['"]/g;
// Count TypeScript type-position `any`; ordinary identifiers such as an ECS query variable named
// `any` are valid code and must not be treated as unsafe type escapes.
const explicitAnyPattern = /(?:\bas\s+any\b|[:=<]\s*any\b|,\s*any\s*(?=[>,])|\bany\s*\[\])/g;

function typedSourceExists(ownerPath, specifier) {
  const ownerDir = dirname(ownerPath);
  const sourcePath = normalize(join(ownerDir, specifier.slice(0, -3)));
  const candidates = [`${sourcePath}.ts`, `${sourcePath}.tsx`, `${sourcePath}/index.ts`, `${sourcePath}/index.tsx`];
  return candidates.some(candidate => sourceSet.has(candidate));
}

for (const path of typedFiles) {
  const content = await readFile(path, 'utf8');
  const unsafeAny = content.match(explicitAnyPattern)?.length ?? 0;
  if (unsafeAny > 12) failures.push(`${path}: excessive explicit any type usage (${unsafeAny})`);
  if (/\b(Math\.random|Date\.now)\s*\(/.test(content) && /determin/i.test(content)) failures.push(`${path}: deterministic module uses wall/random clock source`);
  for (const match of content.matchAll(untypedImportPattern)) {
    const specifier = match[1];
    if (specifier && !typedSourceExists(path, specifier) && !specifier.includes('/vendor/')) {
      failures.push(`${path}: typed module imports legacy .js dependency ${specifier}`);
    }
  }
}

const manifest = {
  schemaVersion: 3,
  generatedAt: 'source-controlled',
  strategy: 'typed-core-first',
  sourceRoots: ROOTS,
  totalSourceFiles: sourceFiles.length,
  typedFiles: typedFiles.length,
  legacyRuntimeFiles: migrationCandidates.length,
  legacyPolicy: 'legacy runtime files are frozen at the boundary; new engine code must be TypeScript',
  esmResolutionPolicy: 'an emitted .js import is typed-safe when a sibling .ts/.tsx source module resolves to the same specifier',
  explicitAnyPolicy: 'only syntactic type-position any is counted; identifiers named any are not type escapes',
};

console.log(JSON.stringify(manifest, null, 2));
if (failures.length) {
  console.error(`Typed architecture check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Typed architecture check passed: ${typedFiles.length} typed source files, ${migrationCandidates.length} legacy runtime files remain on the migration boundary.`);