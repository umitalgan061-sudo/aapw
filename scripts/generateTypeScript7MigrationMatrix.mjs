import { mkdir, writeFile } from 'node:fs/promises';

const axes = [
  ['js-bridge', 'ts-native', 'ts-declaration', 'ts-worker'],
  ['browser', 'worker', 'headless', 'replay'],
  ['render', 'simulation', 'assets', 'audio', 'input', 'persistence', 'telemetry', 'world'],
  ['strict', 'strict-indexed', 'strict-exact', 'strict-verbatim'],
  ['nodenext', 'esnext', 'preserve', 'bundler'],
  ['es2024', 'esnext', 'webgpu', 'webgl2'],
  ['result', 'assert', 'brand', 'readonly'],
  ['main', 'worker', 'shared-worker', 'stream'],
  ['native', 'fallback', 'bridge', 'dual'],
  ['json', 'structured-clone', 'binary', 'envelope'],
  ['resident', 'streamed', 'compressed', 'evictable'],
  ['forward', 'deferred', 'mrt', 'compute'],
  ['volatile', 'checkpoint', 'autosave', 'manual'],
  ['none', 'soft', 'device-loss', 'rollback'],
  ['stable', 'seeded', 'replayable', 'auditable'],
];
const expected = 4096;
const pickCase = (id) => {
  let cursor = id - 1;
  return axes.map((axis) => { const value = axis[cursor % axis.length]; cursor = Math.floor(cursor / axis.length); return value; });
};
const names = ['language','runtime','module','strictness','moduleMode','target','safety','concurrency','compatibility','serialization','assetMode','renderMode','persistenceMode','recovery','determinism'];
const rows = [];
for (let id = 1; id <= expected; id += 1) {
  const values = pickCase(id);
  const item = { id };
  for (let i = 0; i < names.length; i += 1) item[names[i]] = values[i];
  rows.push(`  ${JSON.stringify(item)} as const,`);
}
const output = [
  '// GENERATED FILE: TypeScript 7 migration regression corpus.',
  '// Source: scripts/generateTypeScript7MigrationMatrix.mjs',
  '',
  'export interface MigrationContractCase {',
  ...names.map((name) => `  readonly ${name}: string;`),
  '  readonly id: number;',
  '}',
  '',
  'export const MIGRATION_CONTRACT_CASES = [',
  ...rows,
  '] as const satisfies readonly MigrationContractCase[];',
  '',
  'export const MIGRATION_CONTRACT_COUNT = MIGRATION_CONTRACT_CASES.length;',
  '',
  'export const getMigrationContract = (id: number): MigrationContractCase | undefined => MIGRATION_CONTRACT_CASES[id - 1];',
  '',
].join('\n');
await mkdir('artifacts/typescript7-runtime-foundation', { recursive: true });
await writeFile('artifacts/typescript7-runtime-foundation/migration-contract-matrix.ts', output, 'utf8');
console.log(`generated ${expected} migration contracts`);
