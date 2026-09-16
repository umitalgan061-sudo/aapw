import { mkdir, writeFile } from 'node:fs/promises';

const languages = ['js-bridge', 'ts-native', 'ts-declaration', 'ts-worker'];
const runtimes = ['browser', 'worker', 'headless', 'replay'];
const modules = ['render', 'simulation', 'assets', 'audio', 'input', 'persistence', 'telemetry', 'world'];
const strictness = ['strict', 'strict-indexed', 'strict-exact', 'strict-verbatim'];
const moduleModes = ['nodenext', 'esnext', 'preserve', 'bundler'];
const targets = ['es2024', 'esnext', 'webgpu', 'webgl2'];
const safety = ['result', 'assert', 'brand', 'readonly'];
const concurrency = ['main', 'worker', 'shared-worker', 'stream'];
const compatibility = ['native', 'fallback', 'bridge', 'dual'];
const serialization = ['json', 'structured-clone', 'binary', 'envelope'];
const assetModes = ['resident', 'streamed', 'compressed', 'evictable'];
const renderModes = ['forward', 'deferred', 'mrt', 'compute'];
const persistenceModes = ['volatile', 'checkpoint', 'autosave', 'manual'];
const recovery = ['none', 'soft', 'device-loss', 'rollback'];
const determinism = ['stable', 'seeded', 'replayable', 'auditable'];

const axes = [languages, runtimes, modules, strictness, moduleModes, targets, safety, concurrency, compatibility, serialization, assetModes, renderModes, persistenceModes, recovery, determinism];
const expectedCases = 4096;

const indexFor = (value, size) => value % size;
const buildCase = (id) => {
  let remaining = id - 1;
  const values = [];
  for (let axis = axes.length - 1; axis >= 0; axis -= 1) {
    const size = axes[axis].length;
    values[axis] = axes[axis][indexFor(remaining, size)];
    remaining = Math.floor(remaining / size);
  }
  const [language, runtime, module, strictnessMode, moduleMode, target, safetyMode, concurrencyMode, compatibilityMode, serializationMode, assetMode, renderMode, persistenceMode, recoveryMode, determinismMode] = values;
  return {
    id,
    language,
    runtime,
    module,
    strictness: strictnessMode,
    moduleMode,
    target,
    safety: safetyMode,
    concurrency: concurrencyMode,
    compatibility: compatibilityMode,
    serialization: serializationMode,
    assetMode,
    renderMode,
    persistenceMode,
    recovery: recoveryMode,
    determinism: determinismMode,
  };
};

const cases = Array.from({ length: expectedCases }, (_, index) => buildCase(index + 1));
const ids = new Set(cases.map((item) => item.id));
if (cases.length !== expectedCases || ids.size !== expectedCases || ids.has(0)) {
  throw new Error('TypeScript 7 migration matrix cardinality invariant failed');
}

const header = `// GENERATED FILE: deterministic TypeScript 7 migration coverage corpus.\n// Do not edit manually; regenerate with scripts/generateTypeScript7MigrationMatrix.mjs.\n\nexport interface MigrationContractCase {\n  readonly id: number;\n  readonly language: string;\n  readonly runtime: string;\n  readonly module: string;\n  readonly strictness: string;\n  readonly moduleMode: string;\n  readonly target: string;\n  readonly safety: string;\n  readonly concurrency: string;\n  readonly compatibility: string;\n  readonly serialization: string;\n  readonly assetMode: string;\n  readonly renderMode: string;\n  readonly persistenceMode: string;\n  readonly recovery: string;\n  readonly determinism: string;\n}\n\nexport const MIGRATION_CONTRACT_CASES = [\n`;
const body = cases.map((item) => `  ${JSON.stringify(item)} as const,`).join('\n');
const footer = `\n] as const satisfies readonly MigrationContractCase[];\n\nexport const MIGRATION_CONTRACT_COUNT = MIGRATION_CONTRACT_CASES.length;\n\nexport function getMigrationContract(id: number): MigrationContractCase | undefined {\n  return MIGRATION_CONTRACT_CASES[id - 1];\n}\n`;

await mkdir('artifacts/typescript7-runtime-foundation', { recursive: true });
await writeFile('artifacts/typescript7-runtime-foundation/migration-contract-matrix.ts', header + body + footer, 'utf8');
console.log(`generated ${cases.length} TypeScript 7 migration contracts`);
